use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Result};
use dats::base::{Dat, DatId, ZoneId};
use dats::context::DatContext;
use dats::dat_format::DatFormat;
use dats::id_mapping::{DatDescriptor, DatLanguage, DatUsage, DatWithLang};
use processor::{
    dat_yaml_util::DatYamlUtil,
    processor::{DatProcessorMessage, ZoneWavefrontKind},
    ximesh::get_ximesh_bytes,
};
use serde::Serialize;
use tracing_subscriber::fmt::MakeWriter;

use crate::{
    app_persistence::PersistenceData,
    dat_query::{self, BrowseInfo, DatDescriptorInfo, TriangleMetadata, ZoneInfo},
    entity_diff::{
        self, DiffToolKind, EntityDiffResult, EntityDiffRow, EntityDiffSaveResult,
        FolderDiffResult, SpellDiffResult, SpellDiffRow,
    },
    errors::AppError,
    state::{AppState, FileNotification},
    DAT_GENERATION_DIR, LOOKUP_TABLE_DIR, RAW_DATA_DIR, ZONE_MAPPING_FILE,
};
use tauri::ipc::Response;

#[tauri::command]
#[specta::specta]
pub async fn select_ffxi_folder<'a>(
    path: Option<PathBuf>,
    state: AppState<'a>,
) -> Result<Option<PathBuf>, AppError> {
    state.write().set_ffxi_path(path)
}

#[tauri::command]
#[specta::specta]
pub async fn select_project_folder<'a>(
    path: Option<PathBuf>,
    state: AppState<'a>,
) -> Result<Vec<PathBuf>, AppError> {
    state.write().set_project_path(path)
}

#[tauri::command]
#[specta::specta]
pub async fn select_local_edit_folder<'a>(
    path: Option<PathBuf>,
    state: AppState<'a>,
) -> Result<Option<PathBuf>, AppError> {
    state.write().set_local_edit_path(path)
}

#[tauri::command]
#[specta::specta]
pub async fn load_persistence_data<'a>(state: AppState<'a>) -> Result<PersistenceData, AppError> {
    Ok(state.read().persistence.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn browse_dats(state: AppState<'_>) -> Result<Vec<BrowseInfo>, AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    Ok(dat_query::get_browse_info(dat_context).await)
}

#[tauri::command]
#[specta::specta]
pub async fn get_zones_for_type(
    dat_descriptor: DatDescriptor,
    state: AppState<'_>,
) -> Result<Vec<ZoneInfo>, AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    Ok(dat_query::get_zone_infos_for_type(dat_descriptor, dat_context).await)
}

#[tauri::command]
pub async fn get_zone_model(zone_id: ZoneId, state: AppState<'_>) -> Result<Response, AppError> {
    if let Some(model) = state.read().cached_zones.get(&zone_id) {
        let mesh_data = get_ximesh_bytes(&model);
        return Ok(Response::new(mesh_data));
    }

    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let zone_model = dat_query::get_zone_model(zone_id, dat_context).await;
    match zone_model {
        Some(model) => {
            let mesh_data = get_ximesh_bytes(&model);
            state.write().cached_zones.insert(zone_id, model);
            return Ok(Response::new(mesh_data));
        }
        None => {
            return Err(anyhow!("Unable to get zone model bytes.").into());
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn zone_to_wavefront(
    zone_id: u16,
    kind: ZoneWavefrontKind,
    state: AppState<'_>,
) -> Result<(), AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let project_path = state
        .read()
        .project_path
        .as_ref()
        .ok_or(anyhow!("No project path specified."))?
        .clone();

    let processor = state.read().processor.clone();

    processor.zone_dat_to_wavefront(zone_id, kind, dat_context, project_path);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn all_zones_to_wavefront(
    kind: ZoneWavefrontKind,
    state: AppState<'_>,
) -> Result<(), AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let project_path = state
        .read()
        .project_path
        .as_ref()
        .ok_or(anyhow!("No project path specified."))?
        .clone();

    let processor = state.read().processor.clone();

    let zone_ids = dat_context
        .zone_id_to_name
        .keys()
        .cloned()
        .collect::<Vec<_>>();

    zone_ids.into_iter().for_each(|zone_id| {
        processor.zone_dat_to_wavefront(zone_id, kind, dat_context.clone(), project_path.clone());
    });

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_misc_dats() -> Result<&'static [DatDescriptorInfo], AppError> {
    Ok(dat_query::MISC_DATS)
}

#[tauri::command]
#[specta::specta]
pub async fn get_triangle_metadata(
    zone_id: ZoneId,
    grid_entry_idx: u32,
    mesh_entry_idx: u32,
    triangle_idx: u32,
    state: AppState<'_>,
) -> Result<Option<TriangleMetadata>, AppError> {
    let read_state = state.read();
    let Some(model) = read_state.cached_zones.get(&zone_id) else {
        return Err(anyhow!("Unable to get zone model bytes.").into());
    };

    let metadata = model
        .mesh
        .grid_cells
        .get(grid_entry_idx as usize)
        .and_then(|grid_entry| grid_entry.indices.get(mesh_entry_idx as usize))
        .and_then(|indices| {
            let block = model.mesh.blocks.get(indices.block_idx as usize)?;
            let placement = model.mesh.placements.get(indices.placement_idx as usize)?;
            Some((block, placement))
        })
        .and_then(|(block, placement)| {
            let tri = block.triangles.get(triangle_idx as usize)?;
            Some(TriangleMetadata {
                grid_entry_idx: grid_entry_idx,
                mesh_entry_idx: mesh_entry_idx,

                material: tri.material,
                is_invalid_triangle: tri.is_invalid_triangle,
                is_barrier: tri.is_barrier,

                map_id: placement.get_map_id(),
                o2w: placement.o2w.into_raw(),
                o2w_opts: placement.o2w_opts,
                w2o: placement.w2o.into_raw(),
                w2o_opts: placement.w2o_opts,
                unk_floats: placement.unk_floats,
                data_field_1: placement.data_field,
                data_field_2: placement.unk_coll4_offset,
                unk_bytes: placement.unk_bytes,
                unk_1: placement.unk_1,
                min_y: placement.min_y,
                max_y: placement.max_y,
                unk_2: placement.unk_2,

                block_flags: block.flags,
            })
        });

    Ok(metadata)
}

#[tauri::command]
#[specta::specta]
pub async fn get_standalone_string_dats() -> Result<&'static [DatDescriptorInfo], AppError> {
    Ok(dat_query::STANDALONE_DATS)
}

#[tauri::command]
#[specta::specta]
pub async fn get_mission_dats() -> Result<&'static [DatDescriptorInfo], AppError> {
    Ok(dat_query::MISSION_DATS)
}

#[tauri::command]
#[specta::specta]
pub async fn get_quest_dats() -> Result<&'static [DatDescriptorInfo], AppError> {
    Ok(dat_query::QUEST_DATS)
}

#[tauri::command]
#[specta::specta]
pub async fn get_item_dats() -> Result<&'static [DatDescriptorInfo], AppError> {
    Ok(dat_query::ITEM_DATS)
}

#[tauri::command]
#[specta::specta]
pub async fn get_global_dialog_dats() -> Result<&'static [DatDescriptorInfo], AppError> {
    Ok(dat_query::GLOBAL_DIALOG_DATS)
}

#[tauri::command]
#[specta::specta]
pub async fn get_working_files(state: AppState<'_>) -> Result<Vec<DatWithLang>, AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let project_path = state
        .read()
        .project_path
        .as_ref()
        .ok_or(anyhow!("No project path specified."))?
        .clone();

    let raw_data_dir = project_path.join(RAW_DATA_DIR);
    Ok(walkdir::WalkDir::new(&raw_data_dir)
        .into_iter()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            DatYamlUtil::dat_from_path(&entry.into_path(), &raw_data_dir, &dat_context)
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub async fn make_all_dats(state: AppState<'_>) -> Result<(), AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let project_path = state
        .read()
        .project_path
        .as_ref()
        .ok_or(anyhow!("No project path specified."))?
        .clone();

    let processor = state.read().processor.clone();

    let raw_data_dir = project_path.join(RAW_DATA_DIR);
    let dat_root_path = project_path.join(DAT_GENERATION_DIR);

    Ok(walkdir::WalkDir::new(&raw_data_dir)
        .into_iter()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            DatYamlUtil::dat_from_path(&entry.into_path(), &raw_data_dir, &dat_context)
        })
        .for_each(|dat| {
            let dat_context = dat_context.clone();
            let raw_data_root_path = raw_data_dir.clone();
            let dat_root_path = dat_root_path.clone();

            processor.yaml_to_dat(
                dat.descriptor,
                dat.lang,
                dat_context,
                raw_data_root_path,
                dat_root_path,
            );
        }))
}

#[tauri::command]
#[specta::specta]
pub async fn make_dat(
    dat_descriptor: DatDescriptor,
    lang: Option<DatLanguage>,
    state: AppState<'_>,
) -> Result<(), AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let project_path = state
        .read()
        .project_path
        .as_ref()
        .ok_or(anyhow!("No project path specified."))?
        .clone();

    let processor = state.read().processor.clone();

    processor.yaml_to_dat(
        dat_descriptor,
        lang.unwrap_or(DatLanguage::English),
        dat_context,
        project_path.join(RAW_DATA_DIR),
        project_path.join(DAT_GENERATION_DIR),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn make_yaml(
    dat_descriptor: DatDescriptor,
    lang: Option<DatLanguage>,
    state: AppState<'_>,
) -> Result<(), AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let project_path = state
        .read()
        .project_path
        .as_ref()
        .ok_or(anyhow!("No project path specified."))?
        .clone();

    let processor = state.read().processor.clone();

    processor.dat_to_yaml(
        dat_descriptor,
        lang.unwrap_or(DatLanguage::English),
        dat_context,
        project_path.join(RAW_DATA_DIR),
    );

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn copy_lookup_tables(state: AppState<'_>) -> Result<(), AppError> {
    let dat_context = state
        .read()
        .dat_context
        .clone()
        .ok_or(anyhow!("No DAT context."))?;

    let mut lookup_table_dir = state
        .read()
        .project_path
        .as_ref()
        .ok_or(anyhow!("No project path specified."))?
        .clone();
    lookup_table_dir.push(LOOKUP_TABLE_DIR);

    // Clean old lookup table directory, if it already exists.
    if lookup_table_dir.exists() {
        fs::remove_dir_all(&lookup_table_dir)
            .map_err(|err| anyhow!("Unable to clear out old lookup tables: {}", err))?;
    }

    // Helper function for copying a file and checking for errors
    let copy_lookup_table = |sub_path: &str| -> Result<(), AppError> {
        let to_path = lookup_table_dir.join(sub_path);
        fs::create_dir_all(&to_path.parent().unwrap()).map_err(|err| {
            anyhow!(
                "Unable to create directory for lookup table '{}': {}",
                to_path.to_string_lossy(),
                err
            )
        })?;

        let from_path = dat_context.ffxi_path.join(sub_path);
        fs::copy(&from_path, lookup_table_dir.join(sub_path)).map_err(|err| {
            anyhow!(
                "Unable to copy lookup table file '{}': {}",
                from_path.to_string_lossy(),
                err
            )
        })?;

        Ok(())
    };

    // Handle first non-numbered tables
    copy_lookup_table("VTABLE.DAT")?;
    copy_lookup_table("FTABLE.DAT")?;

    // Handle remaining numbered tables in each corresponding ROM folder
    for rom_id in 2u8.. {
        let vtable_sub_path = format!("ROM{}/VTABLE{}.DAT", rom_id, rom_id);

        let vtable_dat_path = dat_context.ffxi_path.join(&vtable_sub_path);
        if !vtable_dat_path.exists() {
            // Break out when no more lookup tables can be found
            break;
        }
        copy_lookup_table(&vtable_sub_path)?;

        let ftable_sub_path = format!("ROM{}/FTABLE{}.DAT", rom_id, rom_id);
        copy_lookup_table(&ftable_sub_path)?;
    }

    // Dump zones mapping file
    let zone_map_file = lookup_table_dir.join(ZONE_MAPPING_FILE);
    let zone_file = File::create(zone_map_file)
        .map_err(|err| anyhow!("Unable to open zone mapping file: {}", err))?;

    let sorted_zones: BTreeMap<_, _> = dat_context.zone_id_to_name.iter().collect();
    serde_yaml::to_writer(zone_file.make_writer(), &sorted_zones)
        .map_err(|err| anyhow!("Unable to write zone mapping file: {}", err))?;

    Ok(())
}

#[tauri::command]
pub async fn compare_entity_name_files(
    old_path: PathBuf,
    new_path: PathBuf,
) -> Result<EntityDiffResult, AppError> {
    Ok(entity_diff::compare_entity_name_files(old_path, new_path)?)
}

#[tauri::command]
pub async fn compare_item_files(
    old_path: PathBuf,
    new_path: PathBuf,
) -> Result<EntityDiffResult, AppError> {
    Ok(entity_diff::compare_item_files(old_path, new_path)?)
}

#[tauri::command]
pub async fn compare_spell_files(
    old_path: PathBuf,
    new_path: PathBuf,
) -> Result<SpellDiffResult, AppError> {
    Ok(entity_diff::compare_spell_files(old_path, new_path)?)
}

#[tauri::command]
pub async fn save_entity_name_diff(
    rows: Vec<EntityDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
) -> Result<EntityDiffSaveResult, AppError> {
    Ok(entity_diff::save_entity_name_diff(
        rows,
        out_yaml_path,
        out_dat_path,
    )?)
}

#[tauri::command]
pub async fn save_item_diff(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<EntityDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
) -> Result<EntityDiffSaveResult, AppError> {
    Ok(entity_diff::save_item_diff(
        old_path,
        new_path,
        rows,
        out_yaml_path,
        out_dat_path,
    )?)
}

#[tauri::command]
pub async fn save_spell_diff(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<SpellDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
) -> Result<EntityDiffSaveResult, AppError> {
    Ok(entity_diff::save_spell_diff(
        old_path,
        new_path,
        rows,
        out_yaml_path,
        out_dat_path,
    )?)
}

#[tauri::command]
pub async fn compare_entity_name_folders(
    custom_dir: PathBuf,
    old_retail_dir: PathBuf,
    new_retail_dir: PathBuf,
    state: AppState<'_>,
) -> Result<FolderDiffResult, AppError> {
    let mut result =
        entity_diff::compare_entity_name_folders(custom_dir, old_retail_dir, new_retail_dir)?;

    let dat_context = { state.read().dat_context.clone() };

    if let Some(dat_context) = dat_context {
        let mut name_by_path: HashMap<String, String> = HashMap::new();
        let mut zone_path_keys: HashSet<String> = HashSet::new();

        let mut append_zone_infos = |zone_infos: Vec<ZoneInfo>| {
            for zone_info in zone_infos {
                let key = normalize_compare_key_from_str(&zone_info.dat_path);
                zone_path_keys.insert(key.clone());
                name_by_path.insert(key, zone_info.name);
            }
        };

        append_zone_infos(
            dat_query::get_zone_infos_for_type(DatDescriptor::EntityNames(0), dat_context.clone())
                .await,
        );
        append_zone_infos(
            dat_query::get_zone_infos_for_type(DatDescriptor::ZoneData(0), dat_context.clone())
                .await,
        );
        append_zone_infos(
            dat_query::get_zone_infos_for_type(DatDescriptor::Dialog(0), dat_context.clone()).await,
        );
        append_zone_infos(
            dat_query::get_zone_infos_for_type(DatDescriptor::Dialog2(0), dat_context.clone())
                .await,
        );
        append_zone_infos(
            dat_query::get_zone_infos_for_type(DatDescriptor::Events(0), dat_context.clone()).await,
        );

        for descriptors in [
            dat_query::MISC_DATS,
            dat_query::STANDALONE_DATS,
            dat_query::MISSION_DATS,
            dat_query::QUEST_DATS,
            dat_query::ITEM_DATS,
            dat_query::GLOBAL_DIALOG_DATS,
        ] {
            merge_descriptor_names(&mut name_by_path, descriptors, dat_context.as_ref());
        }

        let annotate_entry = |entry: &mut entity_diff::FolderDiffEntry| {
            let key = normalize_compare_key_from_str(&entry.relative_path);
            entry.zone_name = name_by_path.get(&key).cloned();
            entry.diff_tool = if zone_path_keys.contains(&key) {
                DiffToolKind::Entity
            } else {
                DiffToolKind::Item
            };
        };

        for entry in &mut result.changed_files {
            annotate_entry(entry);
        }
        for entry in &mut result.all_files {
            annotate_entry(entry);
        }
    }

    Ok(result)
}

fn normalize_compare_key_from_str(path_like: &str) -> String {
    let components = Path::new(path_like)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>();

    let rom_start = components.iter().position(|component| {
        let upper = component.to_ascii_uppercase();
        upper == "ROM"
            || (upper.starts_with("ROM")
                && upper
                    .chars()
                    .skip(3)
                    .all(|character| character.is_ascii_digit()))
    });

    let normalized = if let Some(start) = rom_start {
        components[start..].join("/")
    } else {
        components.join("/")
    };

    normalized.to_ascii_lowercase()
}

fn merge_descriptor_names(
    names_by_path: &mut HashMap<String, String>,
    descriptors: &[DatDescriptorInfo],
    dat_context: &DatContext,
) {
    for descriptor_info in descriptors {
        let descriptor = descriptor_info.descriptor;
        let Ok(dat_path) = descriptor.use_dat_with(RelativeDatPathResolver { dat_context }) else {
            continue;
        };

        let Some(name) = descriptor_type_name(descriptor) else {
            continue;
        };

        names_by_path.insert(normalize_compare_key_from_str(&dat_path), name);
    }
}

fn descriptor_type_name(descriptor: DatDescriptor) -> Option<String> {
    let value = serde_json::to_value(descriptor).ok()?;
    value
        .get("type")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[derive(Clone, Copy)]
struct RelativeDatPathResolver<'a> {
    dat_context: &'a DatContext,
}

impl<'a> DatUsage<String> for RelativeDatPathResolver<'a> {
    fn use_dat<T: DatFormat + Serialize + for<'de> serde::Deserialize<'de>>(
        self,
        dat: Dat<T>,
    ) -> Result<String> {
        let dat_id = DatId::from(dat);
        Ok(dat_id
            .get_relative_dat_path(self.dat_context)?
            .to_string_lossy()
            .into_owned())
    }
}

// Dummy command just to create types for events
#[tauri::command]
#[specta::specta]
#[allow(unused)]
pub async fn dummy_event_type_gen() -> Result<(FileNotification, DatProcessorMessage), AppError> {
    Err(anyhow!("N/A"))?
}
