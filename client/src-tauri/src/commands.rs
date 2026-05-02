use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs::{self, File},
    path::{Path, PathBuf},
};

use anyhow::{Result, anyhow};
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
    DAT_GENERATION_DIR, LOOKUP_TABLE_DIR, RAW_DATA_DIR, ZONE_MAPPING_FILE,
    app_persistence::PersistenceData,
    dat_query::{self, BrowseInfo, DatDescriptorInfo, TriangleMetadata, ZoneInfo},
    entity_diff::{
        self, AbilityDiffResult, AbilityDiffRow, AbilityDiffSaveResult, AbilityTextPaths,
        DiffToolKind, EntityDiffResult, EntityDiffRow, EntityDiffSaveResult, FolderDiffResult,
        ItemDiffResult, ItemDiffRow, ItemDiffSaveResult, ItemEditorRow, SpellDiffResult,
        SpellDiffRow, SpellDiffSaveResult, SpellTextPaths, ZoneEditorRow,
    },
    errors::AppError,
    state::{AppState, FileNotification},
};
use tauri::ipc::Response;

#[derive(Debug, Clone, Serialize)]
pub struct ItemEditorLoadResult {
    pub english_source_path: String,
    pub japanese_source_path: Option<String>,
    pub english_output_yaml_path: String,
    pub english_output_dat_path: String,
    pub japanese_output_yaml_path: Option<String>,
    pub japanese_output_dat_path: Option<String>,
    pub rows: Vec<ItemEditorRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ItemEditorSaveResult {
    pub written_count: usize,
    pub saved_english: bool,
    pub saved_japanese: bool,
    pub english_out_yaml_path: String,
    pub english_out_dat_path: Option<String>,
    pub japanese_out_yaml_path: Option<String>,
    pub japanese_out_dat_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneEditorLoadResult {
    pub zone_id: ZoneId,
    pub zone_name: String,
    pub source_path: String,
    pub output_yaml_path: String,
    pub output_dat_path: String,
    pub rows: Vec<ZoneEditorRow>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneEditorSaveResult {
    pub written_count: usize,
    pub out_yaml_path: String,
    pub out_dat_path: String,
}

const RETAIL_BASE_DIR: &str = "Retail Base";
const CUSTOM_DIR: &str = "Custom";

fn retail_base_root(project_root: &Path) -> PathBuf {
    project_root.join(RETAIL_BASE_DIR)
}

fn custom_root(project_root: &Path) -> PathBuf {
    project_root.join(CUSTOM_DIR)
}

fn retail_base_path(project_root: &Path, relative_path: &str) -> PathBuf {
    retail_base_root(project_root).join(relative_path)
}

fn custom_path(project_root: &Path, relative_path: &str) -> PathBuf {
    custom_root(project_root).join(relative_path)
}

fn path_is_within_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn rom_relative_path_from_path(path: &Path) -> Option<PathBuf> {
    let components = path.components().collect::<Vec<_>>();
    let rom_start = components.iter().position(|component| {
        let upper = component.as_os_str().to_string_lossy().to_ascii_uppercase();
        upper == "ROM"
            || (upper.starts_with("ROM")
                && upper
                    .chars()
                    .skip(3)
                    .all(|character| character.is_ascii_digit()))
    })?;

    let mut relative = PathBuf::new();
    for component in &components[rom_start..] {
        relative.push(component.as_os_str());
    }

    Some(relative)
}

fn resolve_descriptor_relative_path(
    descriptor: DatDescriptor,
    lang: DatLanguage,
    dat_context: &DatContext,
) -> Result<String, AppError> {
    let resolver = RelativeDatPathResolver { dat_context };

    match lang {
        DatLanguage::English => Ok(descriptor.use_dat_with(resolver)?),
        DatLanguage::Japanese => {
            if !descriptor.has_jp_dat() {
                return Err(anyhow!("No Japanese DAT is mapped for {:?}.", descriptor).into());
            }

            Ok(descriptor.use_jp_dat_with(resolver)?)
        }
    }
}

fn preferred_dat_source_path(
    relative_path: &str,
    dat_context: &DatContext,
    project_root: Option<&PathBuf>,
) -> PathBuf {
    if let Some(project_root) = project_root {
        let custom_path = custom_path(project_root, relative_path);
        if custom_path.is_file() {
            return custom_path;
        }

        let retail_base_path = retail_base_path(project_root, relative_path);
        if retail_base_path.is_file() {
            return retail_base_path;
        }
    }

    dat_context.ffxi_path.join(relative_path)
}

fn required_project_editor_source_path(
    relative_path: &str,
    project_root: &Path,
) -> Result<PathBuf, AppError> {
    let custom_path = custom_path(project_root, relative_path);
    if custom_path.is_file() {
        return Ok(custom_path);
    }

    let retail_base_path = retail_base_path(project_root, relative_path);
    if retail_base_path.is_file() {
        return Ok(retail_base_path);
    }

    Err(anyhow!(
        "The Retail Base DAT copy for {} was not found in the Project Folder. Click \"Make all Base DATs\" first.",
        relative_path
    )
    .into())
}

fn build_output_paths_for_relative_path(
    relative_path: &str,
    project_root: &Path,
) -> Result<(PathBuf, PathBuf), AppError> {
    let relative_path = PathBuf::from(relative_path);
    let file_name = relative_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(anyhow!("Unable to resolve item DAT output filename."))?;
    let parent = relative_path.parent().unwrap_or(Path::new(""));

    let yaml_file_name = Path::new(file_name).with_extension("yml");
    let dat_file_name = Path::new(file_name).with_extension("DAT");

    Ok((
        custom_root(project_root)
            .join("Yaml")
            .join(parent)
            .join(yaml_file_name),
        custom_root(project_root).join(parent).join(dat_file_name),
    ))
}

#[derive(Default)]
struct ItemDiffJapanesePaths {
    old_japanese_path: Option<PathBuf>,
    new_japanese_path: Option<PathBuf>,
    japanese_output_yaml_path: Option<PathBuf>,
    japanese_output_dat_path: Option<PathBuf>,
}

fn dat_relative_identity_key(path: &Path) -> Option<String> {
    let mut relative = rom_relative_path_from_path(path)?;
    relative.set_extension("");
    Some(normalize_compare_key_from_str(&relative.to_string_lossy()))
}

fn item_descriptor_for_selected_path(
    path: &Path,
    dat_context: &DatContext,
) -> Option<DatDescriptor> {
    let selected_key = dat_relative_identity_key(path)?;

    dat_query::ITEM_DATS.iter().find_map(|descriptor_info| {
        let descriptor = descriptor_info.descriptor;
        let relative_path = descriptor
            .use_dat_with(RelativeDatPathResolver { dat_context })
            .ok()?;
        let candidate_key = dat_relative_identity_key(Path::new(&relative_path))?;
        (candidate_key == selected_key).then_some(descriptor)
    })
}

fn paired_path_from_selected_root(
    selected_path: &Path,
    paired_relative_path: &str,
) -> Option<PathBuf> {
    let components = selected_path.components().collect::<Vec<_>>();
    let rom_start = components.iter().position(|component| {
        let upper = component.as_os_str().to_string_lossy().to_ascii_uppercase();
        upper == "ROM"
            || (upper.starts_with("ROM")
                && upper
                    .chars()
                    .skip(3)
                    .all(|character| character.is_ascii_digit()))
    })?;

    let mut root = PathBuf::new();
    for component in &components[..rom_start] {
        root.push(component.as_os_str());
    }

    let mut paired_relative = PathBuf::from(paired_relative_path);
    if let Some(extension) = selected_path.extension() {
        let extension = extension.to_string_lossy();
        if extension.eq_ignore_ascii_case("yml") || extension.eq_ignore_ascii_case("yaml") {
            paired_relative.set_extension(extension.as_ref());
        }
    }

    Some(root.join(paired_relative))
}

fn existing_paired_item_path(
    selected_path: &Path,
    paired_relative_path: &str,
    dat_context: &DatContext,
    project_root: Option<&PathBuf>,
    allow_project_preference: bool,
) -> Option<PathBuf> {
    if let Some(candidate) = paired_path_from_selected_root(selected_path, paired_relative_path) {
        if candidate.is_file() {
            return Some(candidate);
        }

        if selected_path
            .extension()
            .map(|extension| {
                let extension = extension.to_string_lossy();
                extension.eq_ignore_ascii_case("yml") || extension.eq_ignore_ascii_case("yaml")
            })
            .unwrap_or(false)
        {
            let mut dat_candidate = candidate;
            dat_candidate.set_extension("DAT");
            if dat_candidate.is_file() {
                return Some(dat_candidate);
            }
        }
    }

    if allow_project_preference {
        let candidate = preferred_dat_source_path(paired_relative_path, dat_context, project_root);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let retail_candidate = dat_context.ffxi_path.join(paired_relative_path);
    retail_candidate.is_file().then_some(retail_candidate)
}

fn resolve_item_diff_japanese_paths(
    old_path: &Path,
    new_path: &Path,
    dat_context: Option<&DatContext>,
    project_root: Option<&PathBuf>,
) -> Result<ItemDiffJapanesePaths, AppError> {
    let Some(dat_context) = dat_context else {
        return Ok(ItemDiffJapanesePaths::default());
    };

    let descriptor = item_descriptor_for_selected_path(old_path, dat_context)
        .or_else(|| item_descriptor_for_selected_path(new_path, dat_context));
    let Some(descriptor) = descriptor else {
        return Ok(ItemDiffJapanesePaths::default());
    };
    if !descriptor.has_jp_dat() {
        return Ok(ItemDiffJapanesePaths::default());
    }

    let japanese_relative =
        resolve_descriptor_relative_path(descriptor, DatLanguage::Japanese, dat_context)?;
    let old_japanese_path = existing_paired_item_path(
        old_path,
        &japanese_relative,
        dat_context,
        project_root,
        true,
    );
    let new_japanese_path = existing_paired_item_path(
        new_path,
        &japanese_relative,
        dat_context,
        project_root,
        false,
    );

    let (japanese_output_yaml_path, japanese_output_dat_path) =
        if old_japanese_path.is_some() || new_japanese_path.is_some() {
            if let Some(project_root) = project_root {
                let (yaml_path, dat_path) =
                    build_output_paths_for_relative_path(&japanese_relative, project_root)?;
                (Some(yaml_path), Some(dat_path))
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

    Ok(ItemDiffJapanesePaths {
        old_japanese_path,
        new_japanese_path,
        japanese_output_yaml_path,
        japanese_output_dat_path,
    })
}

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
pub async fn load_persistence_data<'a>(state: AppState<'a>) -> Result<PersistenceData, AppError> {
    Ok(state.read().persistence.clone())
}

#[tauri::command]
#[specta::specta]
pub async fn resolve_dat_descriptor_path(
    descriptor: DatDescriptor,
    lang: Option<DatLanguage>,
    state: AppState<'_>,
) -> Result<String, AppError> {
    let (dat_context, project_path) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state.project_path.clone(),
        )
    };

    let relative_path = resolve_descriptor_relative_path(
        descriptor,
        lang.unwrap_or(DatLanguage::English),
        &dat_context,
    )?;

    let retail_path = dat_context.ffxi_path.join(&relative_path);

    // Prefer an already-copied DAT in the project folder so editor
    // selections reopen the editable file instead of re-targeting retail.
    if let Some(project_root) = project_path {
        let custom_dat_path = custom_path(&project_root, &relative_path);
        if custom_dat_path.is_file() {
            return Ok(custom_dat_path.display().to_string());
        }

        let retail_base_dat_path = retail_base_path(&project_root, &relative_path);
        if retail_base_dat_path.is_file() {
            return Ok(retail_base_dat_path.display().to_string());
        }
    }

    Ok(retail_path.display().to_string())
}

fn copy_dat_to_output_root(
    source_path: PathBuf,
    output_root: PathBuf,
) -> Result<PathBuf, AppError> {
    let is_dat = source_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("dat"))
        .unwrap_or(false);
    if !is_dat {
        return Err(
            anyhow!("Only DAT files can be copied into the project folder output tree.").into(),
        );
    }

    let rom_relative_path = rom_relative_path_from_path(&source_path)
        .ok_or(anyhow!("Selected DAT must live under a ROM folder."))?;
    let destination_path = output_root.join(rom_relative_path);

    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
    }

    if source_path != destination_path {
        fs::copy(&source_path, &destination_path).map_err(anyhow::Error::from)?;
    }

    Ok(destination_path)
}

fn copy_retail_base_to_custom(
    relative_path: &str,
    project_root: &Path,
) -> Result<PathBuf, AppError> {
    let source_path = retail_base_path(project_root, relative_path);
    if !source_path.is_file() {
        return Err(anyhow!(
            "Retail Base DAT copy for {} was not found. Re-sync the base DATs first.",
            relative_path
        )
        .into());
    }

    let destination_path = custom_path(project_root, relative_path);
    if let Some(parent) = destination_path.parent() {
        fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
    }
    fs::copy(source_path, &destination_path).map_err(anyhow::Error::from)?;

    Ok(destination_path)
}

fn reset_data_menu_section_to_retail_base(
    relative_path: &str,
    project_root: &Path,
    section_type: &str,
) -> Result<PathBuf, AppError> {
    let source_path = retail_base_path(project_root, relative_path);
    if !source_path.is_file() {
        return Err(anyhow!(
            "Retail Base DAT copy for {} was not found. Re-sync the base DATs first.",
            relative_path
        )
        .into());
    }

    let destination_path = custom_path(project_root, relative_path);
    Ok(entity_diff::reset_menu_section_to_retail_base(
        source_path,
        destination_path,
        section_type,
    )?)
}

#[tauri::command]
#[specta::specta]
pub async fn copy_item_dats_to_project(
    lang: Option<DatLanguage>,
    state: AppState<'_>,
) -> Result<Vec<String>, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let mut copied_paths = Vec::new();

    for descriptor_info in dat_query::ITEM_DATS {
        let requested_languages = match lang {
            Some(lang) => vec![lang],
            None => {
                let mut langs = vec![DatLanguage::English];
                if descriptor_info.descriptor.has_jp_dat() {
                    langs.push(DatLanguage::Japanese);
                }
                langs
            }
        };

        for requested_lang in requested_languages {
            if matches!(requested_lang, DatLanguage::Japanese)
                && !descriptor_info.descriptor.has_jp_dat()
            {
                continue;
            }

            let relative_path = resolve_descriptor_relative_path(
                descriptor_info.descriptor,
                requested_lang,
                &dat_context,
            )?;
            let retail_path = dat_context.ffxi_path.join(&relative_path);
            let copied_path =
                copy_dat_to_output_root(retail_path, retail_base_root(&project_root))?;
            copied_paths.push(copied_path.display().to_string());
        }
    }

    copied_paths.sort();
    Ok(copied_paths)
}

#[tauri::command]
pub async fn reset_item_editor_data_to_retail_base(
    descriptor: DatDescriptor,
    state: AppState<'_>,
) -> Result<Vec<String>, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let mut reset_paths = Vec::new();

    let english_relative =
        resolve_descriptor_relative_path(descriptor, DatLanguage::English, &dat_context)?;
    reset_paths.push(copy_retail_base_to_custom(
        &english_relative,
        &project_root,
    )?);

    if descriptor.has_jp_dat() {
        let japanese_relative =
            resolve_descriptor_relative_path(descriptor, DatLanguage::Japanese, &dat_context)?;
        reset_paths.push(copy_retail_base_to_custom(
            &japanese_relative,
            &project_root,
        )?);
    }

    Ok(reset_paths
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

#[tauri::command]
pub async fn are_all_item_dats_made_in_project(state: AppState<'_>) -> Result<bool, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    for descriptor_info in dat_query::ITEM_DATS {
        let mut langs = vec![DatLanguage::English];
        if descriptor_info.descriptor.has_jp_dat() {
            langs.push(DatLanguage::Japanese);
        }

        for lang in langs {
            let relative_path =
                resolve_descriptor_relative_path(descriptor_info.descriptor, lang, &dat_context)?;
            if !retail_base_path(&project_root, &relative_path).is_file() {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn copy_zone_entity_dat_to_project(
    zone_id: ZoneId,
    state: AppState<'_>,
) -> Result<String, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let relative_path = resolve_descriptor_relative_path(
        DatDescriptor::EntityNames(zone_id),
        DatLanguage::English,
        &dat_context,
    )?;
    let copied_path = copy_dat_to_output_root(
        dat_context.ffxi_path.join(relative_path),
        retail_base_root(&project_root),
    )?;

    Ok(copied_path.display().to_string())
}

#[tauri::command]
pub async fn reset_zone_entity_dat_to_retail_base(
    zone_id: ZoneId,
    state: AppState<'_>,
) -> Result<String, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let relative_path = resolve_descriptor_relative_path(
        DatDescriptor::EntityNames(zone_id),
        DatLanguage::English,
        &dat_context,
    )?;
    let reset_path = copy_retail_base_to_custom(&relative_path, &project_root)?;

    Ok(reset_path.display().to_string())
}

#[tauri::command]
pub async fn is_zone_entity_dat_made_in_project(
    zone_id: ZoneId,
    state: AppState<'_>,
) -> Result<bool, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let relative_path = resolve_descriptor_relative_path(
        DatDescriptor::EntityNames(zone_id),
        DatLanguage::English,
        &dat_context,
    )?;

    Ok(retail_base_path(&project_root, &relative_path).is_file())
}

fn spell_editor_relative_paths(
    dat_context: &DatContext,
) -> Result<(String, SpellTextPaths), AppError> {
    let data_menu = resolve_descriptor_relative_path(
        DatDescriptor::DataMenu,
        DatLanguage::English,
        dat_context,
    )?;
    let spell_names_en = resolve_descriptor_relative_path(
        DatDescriptor::SpellNames,
        DatLanguage::English,
        dat_context,
    )?;
    let spell_names_jp = resolve_descriptor_relative_path(
        DatDescriptor::SpellNames,
        DatLanguage::Japanese,
        dat_context,
    )?;
    let spell_descriptions_en = resolve_descriptor_relative_path(
        DatDescriptor::SpellDescriptions,
        DatLanguage::English,
        dat_context,
    )?;
    let spell_descriptions_jp = resolve_descriptor_relative_path(
        DatDescriptor::SpellDescriptions,
        DatLanguage::Japanese,
        dat_context,
    )?;

    Ok((
        data_menu,
        SpellTextPaths {
            spell_names_en: PathBuf::from(spell_names_en),
            spell_names_jp: PathBuf::from(spell_names_jp),
            spell_descriptions_en: PathBuf::from(spell_descriptions_en),
            spell_descriptions_jp: PathBuf::from(spell_descriptions_jp),
        },
    ))
}

fn spell_editor_text_paths_at_root(
    dat_context: &DatContext,
    root: &Path,
) -> Result<SpellTextPaths, AppError> {
    let (_, relative_paths) = spell_editor_relative_paths(dat_context)?;
    Ok(SpellTextPaths {
        spell_names_en: root.join(relative_paths.spell_names_en),
        spell_names_jp: root.join(relative_paths.spell_names_jp),
        spell_descriptions_en: root.join(relative_paths.spell_descriptions_en),
        spell_descriptions_jp: root.join(relative_paths.spell_descriptions_jp),
    })
}

fn spell_text_paths_complete(paths: &SpellTextPaths) -> bool {
    paths.spell_names_en.is_file()
        && paths.spell_names_jp.is_file()
        && paths.spell_descriptions_en.is_file()
        && paths.spell_descriptions_jp.is_file()
}

fn spell_editor_source_text_paths(
    dat_context: &DatContext,
    project_root: &Path,
    source_path: &Path,
) -> Result<SpellTextPaths, AppError> {
    let custom_paths = spell_editor_text_paths_at_root(dat_context, &custom_root(project_root))?;
    let retail_base_paths =
        spell_editor_text_paths_at_root(dat_context, &retail_base_root(project_root))?;

    if path_is_within_root(source_path, &custom_root(project_root))
        && spell_text_paths_complete(&custom_paths)
    {
        return Ok(custom_paths);
    }

    if spell_text_paths_complete(&retail_base_paths) {
        return Ok(retail_base_paths);
    }

    if spell_text_paths_complete(&custom_paths) {
        return Ok(custom_paths);
    }

    Ok(retail_base_paths)
}

fn ensure_custom_spell_text_paths(
    dat_context: &DatContext,
    project_root: &Path,
) -> Result<SpellTextPaths, AppError> {
    let (_, relative_paths) = spell_editor_relative_paths(dat_context)?;
    let relative_paths = [
        relative_paths.spell_names_en,
        relative_paths.spell_names_jp,
        relative_paths.spell_descriptions_en,
        relative_paths.spell_descriptions_jp,
    ];

    for relative_path in &relative_paths {
        let destination_path = custom_path(project_root, &relative_path.to_string_lossy());
        if destination_path.is_file() {
            continue;
        }

        let source_path = retail_base_path(project_root, &relative_path.to_string_lossy());
        let source_path = if source_path.is_file() {
            source_path
        } else {
            dat_context.ffxi_path.join(relative_path)
        };

        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }
        fs::copy(source_path, destination_path).map_err(anyhow::Error::from)?;
    }

    spell_editor_text_paths_at_root(dat_context, &custom_root(project_root))
}

fn ability_editor_relative_paths(
    dat_context: &DatContext,
) -> Result<(String, AbilityTextPaths), AppError> {
    let data_menu = resolve_descriptor_relative_path(
        DatDescriptor::DataMenu,
        DatLanguage::English,
        dat_context,
    )?;
    let ability_names_en = resolve_descriptor_relative_path(
        DatDescriptor::AbilityNames,
        DatLanguage::English,
        dat_context,
    )?;
    let ability_names_jp = resolve_descriptor_relative_path(
        DatDescriptor::AbilityNames,
        DatLanguage::Japanese,
        dat_context,
    )?;
    let ability_descriptions_en = resolve_descriptor_relative_path(
        DatDescriptor::AbilityDescriptions,
        DatLanguage::English,
        dat_context,
    )?;
    let ability_descriptions_jp = resolve_descriptor_relative_path(
        DatDescriptor::AbilityDescriptions,
        DatLanguage::Japanese,
        dat_context,
    )?;

    Ok((
        data_menu,
        AbilityTextPaths {
            ability_names_en: PathBuf::from(ability_names_en),
            ability_names_jp: PathBuf::from(ability_names_jp),
            ability_descriptions_en: PathBuf::from(ability_descriptions_en),
            ability_descriptions_jp: PathBuf::from(ability_descriptions_jp),
        },
    ))
}

fn ability_editor_text_paths_at_root(
    dat_context: &DatContext,
    root: &Path,
) -> Result<AbilityTextPaths, AppError> {
    let (_, relative_paths) = ability_editor_relative_paths(dat_context)?;
    Ok(AbilityTextPaths {
        ability_names_en: root.join(relative_paths.ability_names_en),
        ability_names_jp: root.join(relative_paths.ability_names_jp),
        ability_descriptions_en: root.join(relative_paths.ability_descriptions_en),
        ability_descriptions_jp: root.join(relative_paths.ability_descriptions_jp),
    })
}

fn ability_text_paths_complete(paths: &AbilityTextPaths) -> bool {
    paths.ability_names_en.is_file()
        && paths.ability_names_jp.is_file()
        && paths.ability_descriptions_en.is_file()
        && paths.ability_descriptions_jp.is_file()
}

fn ability_editor_source_text_paths(
    dat_context: &DatContext,
    project_root: &Path,
    source_path: &Path,
) -> Result<AbilityTextPaths, AppError> {
    let custom_paths = ability_editor_text_paths_at_root(dat_context, &custom_root(project_root))?;
    let retail_base_paths =
        ability_editor_text_paths_at_root(dat_context, &retail_base_root(project_root))?;

    if path_is_within_root(source_path, &custom_root(project_root))
        && ability_text_paths_complete(&custom_paths)
    {
        return Ok(custom_paths);
    }

    if ability_text_paths_complete(&retail_base_paths) {
        return Ok(retail_base_paths);
    }

    if ability_text_paths_complete(&custom_paths) {
        return Ok(custom_paths);
    }

    Ok(retail_base_paths)
}

fn ensure_custom_ability_text_paths(
    dat_context: &DatContext,
    project_root: &Path,
) -> Result<AbilityTextPaths, AppError> {
    let (_, relative_paths) = ability_editor_relative_paths(dat_context)?;
    let relative_paths = [
        relative_paths.ability_names_en,
        relative_paths.ability_names_jp,
        relative_paths.ability_descriptions_en,
        relative_paths.ability_descriptions_jp,
    ];

    for relative_path in &relative_paths {
        let destination_path = custom_path(project_root, &relative_path.to_string_lossy());
        if destination_path.is_file() {
            continue;
        }

        let source_path = retail_base_path(project_root, &relative_path.to_string_lossy());
        let source_path = if source_path.is_file() {
            source_path
        } else {
            dat_context.ffxi_path.join(relative_path)
        };

        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent).map_err(anyhow::Error::from)?;
        }
        fs::copy(source_path, destination_path).map_err(anyhow::Error::from)?;
    }

    ability_editor_text_paths_at_root(dat_context, &custom_root(project_root))
}

#[tauri::command]
pub async fn copy_spell_dat_to_project(state: AppState<'_>) -> Result<String, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let (data_menu_relative, text_relative_paths) = spell_editor_relative_paths(&dat_context)?;
    let copied_path = copy_dat_to_output_root(
        dat_context.ffxi_path.join(data_menu_relative),
        retail_base_root(&project_root),
    )?;
    for relative_path in [
        text_relative_paths.spell_names_en,
        text_relative_paths.spell_names_jp,
        text_relative_paths.spell_descriptions_en,
        text_relative_paths.spell_descriptions_jp,
    ] {
        copy_dat_to_output_root(
            dat_context.ffxi_path.join(relative_path),
            retail_base_root(&project_root),
        )?;
    }
    Ok(copied_path.display().to_string())
}

#[tauri::command]
pub async fn reset_spell_dat_to_retail_base(state: AppState<'_>) -> Result<String, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let (data_menu_relative, text_relative_paths) = spell_editor_relative_paths(&dat_context)?;
    let data_menu_path =
        reset_data_menu_section_to_retail_base(&data_menu_relative, &project_root, "Mgc_")?;

    for relative_path in [
        text_relative_paths.spell_names_en,
        text_relative_paths.spell_names_jp,
        text_relative_paths.spell_descriptions_en,
        text_relative_paths.spell_descriptions_jp,
    ] {
        copy_retail_base_to_custom(&relative_path.to_string_lossy(), &project_root)?;
    }

    Ok(data_menu_path.display().to_string())
}

#[tauri::command]
pub async fn is_spell_dat_made_in_project(state: AppState<'_>) -> Result<bool, AppError> {
    let project_root = {
        let state = state.read();
        state
            .project_path
            .clone()
            .ok_or(anyhow!("No project folder selected."))?
    };

    let dat_context = {
        let state = state.read();
        state
            .dat_context
            .clone()
            .ok_or(anyhow!("No DAT context."))?
    };
    let (data_menu_relative, text_relative_paths) = spell_editor_relative_paths(&dat_context)?;
    Ok(
        retail_base_path(&project_root, &data_menu_relative).is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.spell_names_en)
                .is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.spell_names_jp)
                .is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.spell_descriptions_en)
                .is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.spell_descriptions_jp)
                .is_file(),
    )
}

#[tauri::command]
pub async fn copy_ability_dat_to_project(state: AppState<'_>) -> Result<String, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let (data_menu_relative, text_relative_paths) = ability_editor_relative_paths(&dat_context)?;
    let copied_path = copy_dat_to_output_root(
        dat_context.ffxi_path.join(data_menu_relative),
        retail_base_root(&project_root),
    )?;
    for relative_path in [
        text_relative_paths.ability_names_en,
        text_relative_paths.ability_names_jp,
        text_relative_paths.ability_descriptions_en,
        text_relative_paths.ability_descriptions_jp,
    ] {
        copy_dat_to_output_root(
            dat_context.ffxi_path.join(relative_path),
            retail_base_root(&project_root),
        )?;
    }
    Ok(copied_path.display().to_string())
}

#[tauri::command]
pub async fn reset_ability_dat_to_retail_base(state: AppState<'_>) -> Result<String, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let (data_menu_relative, text_relative_paths) = ability_editor_relative_paths(&dat_context)?;
    let data_menu_path =
        reset_data_menu_section_to_retail_base(&data_menu_relative, &project_root, "Comm")?;

    for relative_path in [
        text_relative_paths.ability_names_en,
        text_relative_paths.ability_names_jp,
        text_relative_paths.ability_descriptions_en,
        text_relative_paths.ability_descriptions_jp,
    ] {
        copy_retail_base_to_custom(&relative_path.to_string_lossy(), &project_root)?;
    }

    Ok(data_menu_path.display().to_string())
}

#[tauri::command]
pub async fn is_ability_dat_made_in_project(state: AppState<'_>) -> Result<bool, AppError> {
    let project_root = {
        let state = state.read();
        state
            .project_path
            .clone()
            .ok_or(anyhow!("No project folder selected."))?
    };

    let dat_context = {
        let state = state.read();
        state
            .dat_context
            .clone()
            .ok_or(anyhow!("No DAT context."))?
    };
    let (data_menu_relative, text_relative_paths) = ability_editor_relative_paths(&dat_context)?;
    Ok(
        retail_base_path(&project_root, &data_menu_relative).is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.ability_names_en)
                .is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.ability_names_jp)
                .is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.ability_descriptions_en)
                .is_file()
            && retail_base_root(&project_root)
                .join(text_relative_paths.ability_descriptions_jp)
                .is_file(),
    )
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
    state: AppState<'_>,
) -> Result<ItemDiffResult, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (state.dat_context.clone(), state.project_path.clone())
    };
    let japanese_paths = resolve_item_diff_japanese_paths(
        &old_path,
        &new_path,
        dat_context.as_ref().map(|context| context.as_ref()),
        project_root.as_ref(),
    )?;

    Ok(entity_diff::compare_item_files(
        old_path,
        new_path,
        japanese_paths.old_japanese_path,
        japanese_paths.new_japanese_path,
    )?)
}

#[tauri::command]
pub async fn load_item_editor_data(
    descriptor: DatDescriptor,
    state: AppState<'_>,
) -> Result<ItemEditorLoadResult, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let english_relative =
        resolve_descriptor_relative_path(descriptor, DatLanguage::English, &dat_context)?;
    let english_source_path =
        required_project_editor_source_path(&english_relative, &project_root)?;
    let (english_output_yaml_path, english_output_dat_path) =
        build_output_paths_for_relative_path(&english_relative, &project_root)?;

    let (japanese_source_path, japanese_output_yaml_path, japanese_output_dat_path) =
        if descriptor.has_jp_dat() {
            let japanese_relative =
                resolve_descriptor_relative_path(descriptor, DatLanguage::Japanese, &dat_context)?;
            let japanese_source_path =
                required_project_editor_source_path(&japanese_relative, &project_root)?;
            let (japanese_output_yaml_path, japanese_output_dat_path) =
                build_output_paths_for_relative_path(&japanese_relative, &project_root)?;

            (
                Some(japanese_source_path),
                Some(japanese_output_yaml_path),
                Some(japanese_output_dat_path),
            )
        } else {
            (None, None, None)
        };

    let rows = entity_diff::load_item_editor_rows(
        english_source_path.clone(),
        japanese_source_path.clone(),
    )?;

    Ok(ItemEditorLoadResult {
        english_source_path: english_source_path.display().to_string(),
        japanese_source_path: japanese_source_path
            .as_ref()
            .map(|path| path.display().to_string()),
        english_output_yaml_path: english_output_yaml_path.display().to_string(),
        english_output_dat_path: english_output_dat_path.display().to_string(),
        japanese_output_yaml_path: japanese_output_yaml_path
            .as_ref()
            .map(|path| path.display().to_string()),
        japanese_output_dat_path: japanese_output_dat_path
            .as_ref()
            .map(|path| path.display().to_string()),
        rows,
    })
}

#[tauri::command]
pub async fn load_zone_editor_data(
    zone_id: ZoneId,
    state: AppState<'_>,
) -> Result<ZoneEditorLoadResult, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let relative_path = resolve_descriptor_relative_path(
        DatDescriptor::EntityNames(zone_id),
        DatLanguage::English,
        &dat_context,
    )?;
    let source_path = required_project_editor_source_path(&relative_path, &project_root)?;
    let (output_yaml_path, output_dat_path) =
        build_output_paths_for_relative_path(&relative_path, &project_root)?;
    let rows = entity_diff::load_zone_editor_rows(source_path.clone())?;
    let zone_name = dat_context
        .zone_id_to_name
        .get(&zone_id)
        .map(|zone| zone.display_name.clone())
        .unwrap_or_else(|| format!("Zone {zone_id}"));

    Ok(ZoneEditorLoadResult {
        zone_id,
        zone_name,
        source_path: source_path.display().to_string(),
        output_yaml_path: output_yaml_path.display().to_string(),
        output_dat_path: output_dat_path.display().to_string(),
        rows,
    })
}

#[tauri::command]
pub async fn compare_spell_files(
    old_path: PathBuf,
    new_path: PathBuf,
    state: AppState<'_>,
) -> Result<SpellDiffResult, AppError> {
    let spell_text_paths = {
        let state = state.read();
        match (state.dat_context.as_ref(), state.project_path.as_ref()) {
            (Some(dat_context), Some(project_root)) => Some(spell_editor_source_text_paths(
                dat_context,
                project_root,
                &new_path,
            )?),
            _ => None,
        }
    };
    Ok(entity_diff::compare_spell_files_with_text_paths(
        old_path,
        new_path,
        spell_text_paths,
    )?)
}

#[tauri::command]
pub async fn compare_ability_files(
    old_path: PathBuf,
    new_path: PathBuf,
    state: AppState<'_>,
) -> Result<AbilityDiffResult, AppError> {
    let ability_text_paths = {
        let state = state.read();
        match (state.dat_context.as_ref(), state.project_path.as_ref()) {
            (Some(dat_context), Some(project_root)) => Some(ability_editor_source_text_paths(
                dat_context,
                project_root,
                &new_path,
            )?),
            _ => None,
        }
    };
    Ok(entity_diff::compare_ability_files_with_text_paths(
        old_path,
        new_path,
        ability_text_paths,
    )?)
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
    rows: Vec<ItemDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
    save_target: Option<String>,
    state: AppState<'_>,
) -> Result<ItemDiffSaveResult, AppError> {
    let target = save_target
        .unwrap_or_else(|| "both".to_string())
        .to_ascii_lowercase();
    let save_english = target == "both" || target == "english";
    let save_japanese = target == "both" || target == "japanese";

    if !save_english && !save_japanese {
        return Err(anyhow!("Unknown item diff save target: {target}.").into());
    }

    let (dat_context, project_root) = {
        let state = state.read();
        (state.dat_context.clone(), state.project_path.clone())
    };
    let japanese_paths = resolve_item_diff_japanese_paths(
        &old_path,
        &new_path,
        dat_context.as_ref().map(|context| context.as_ref()),
        project_root.as_ref(),
    )?;

    Ok(entity_diff::save_item_diff(
        old_path,
        new_path,
        japanese_paths.old_japanese_path,
        japanese_paths.new_japanese_path,
        rows,
        save_english,
        save_japanese,
        out_yaml_path,
        out_dat_path,
        japanese_paths.japanese_output_yaml_path,
        japanese_paths.japanese_output_dat_path,
    )?)
}

#[tauri::command]
pub async fn save_item_editor_data(
    descriptor: DatDescriptor,
    rows: Vec<ItemEditorRow>,
    save_target: Option<String>,
    state: AppState<'_>,
) -> Result<ItemEditorSaveResult, AppError> {
    let target = save_target
        .unwrap_or_else(|| "both".to_string())
        .to_ascii_lowercase();
    let save_english = target == "both" || target == "english";
    let save_japanese = target == "both" || target == "japanese";

    if !save_english && !save_japanese {
        return Err(anyhow!("Unknown item editor save target: {target}.").into());
    }

    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let english_relative =
        resolve_descriptor_relative_path(descriptor, DatLanguage::English, &dat_context)?;
    let english_source_path =
        preferred_dat_source_path(&english_relative, &dat_context, Some(&project_root));
    let (english_output_yaml_path, english_output_dat_path) =
        build_output_paths_for_relative_path(&english_relative, &project_root)?;

    let has_japanese_dat = descriptor.has_jp_dat();
    if save_japanese && !has_japanese_dat {
        return Err(anyhow!("This item DAT does not have a Japanese pair to save.").into());
    }

    let (japanese_source_path, japanese_output_yaml_path, japanese_output_dat_path) =
        if has_japanese_dat {
            let japanese_relative =
                resolve_descriptor_relative_path(descriptor, DatLanguage::Japanese, &dat_context)?;
            let japanese_source_path =
                preferred_dat_source_path(&japanese_relative, &dat_context, Some(&project_root));
            let (japanese_output_yaml_path, japanese_output_dat_path) =
                build_output_paths_for_relative_path(&japanese_relative, &project_root)?;

            (
                Some(japanese_source_path),
                Some(japanese_output_yaml_path),
                Some(japanese_output_dat_path),
            )
        } else {
            (None, None, None)
        };

    let written_count = entity_diff::save_item_editor_rows(
        english_source_path,
        japanese_source_path,
        rows,
        save_english,
        save_japanese,
        english_output_yaml_path.clone(),
        Some(english_output_dat_path.clone()),
        japanese_output_yaml_path.clone(),
        japanese_output_dat_path.clone(),
    )?;

    Ok(ItemEditorSaveResult {
        written_count,
        saved_english: save_english,
        saved_japanese: save_japanese,
        english_out_yaml_path: if save_english {
            english_output_yaml_path.display().to_string()
        } else {
            String::new()
        },
        english_out_dat_path: if save_english {
            Some(english_output_dat_path.display().to_string())
        } else {
            None
        },
        japanese_out_yaml_path: if save_japanese {
            japanese_output_yaml_path
                .as_ref()
                .map(|path| path.display().to_string())
        } else {
            None
        },
        japanese_out_dat_path: if save_japanese {
            japanese_output_dat_path
                .as_ref()
                .map(|path| path.display().to_string())
        } else {
            None
        },
    })
}

#[tauri::command]
pub async fn save_zone_editor_data(
    zone_id: ZoneId,
    rows: Vec<ZoneEditorRow>,
    state: AppState<'_>,
) -> Result<ZoneEditorSaveResult, AppError> {
    let (dat_context, project_root) = {
        let state = state.read();
        (
            state
                .dat_context
                .clone()
                .ok_or(anyhow!("No DAT context."))?,
            state
                .project_path
                .clone()
                .ok_or(anyhow!("No project folder selected."))?,
        )
    };

    let relative_path = resolve_descriptor_relative_path(
        DatDescriptor::EntityNames(zone_id),
        DatLanguage::English,
        &dat_context,
    )?;
    let (output_yaml_path, output_dat_path) =
        build_output_paths_for_relative_path(&relative_path, &project_root)?;

    let written_count = entity_diff::save_zone_editor_rows(
        rows,
        output_yaml_path.clone(),
        output_dat_path.clone(),
    )?;

    Ok(ZoneEditorSaveResult {
        written_count,
        out_yaml_path: output_yaml_path.display().to_string(),
        out_dat_path: output_dat_path.display().to_string(),
    })
}

#[tauri::command]
pub async fn save_spell_diff(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<SpellDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
    state: AppState<'_>,
) -> Result<SpellDiffSaveResult, AppError> {
    let spell_text_paths = {
        let state = state.read();
        match (state.dat_context.as_ref(), state.project_path.as_ref()) {
            (Some(dat_context), Some(project_root)) => {
                Some(ensure_custom_spell_text_paths(dat_context, project_root)?)
            }
            _ => None,
        }
    };
    Ok(entity_diff::save_spell_diff_with_text_paths(
        old_path,
        new_path,
        rows,
        out_yaml_path,
        out_dat_path,
        spell_text_paths,
    )?)
}

#[tauri::command]
pub async fn save_ability_diff(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<AbilityDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
    state: AppState<'_>,
) -> Result<AbilityDiffSaveResult, AppError> {
    let ability_text_paths = {
        let state = state.read();
        match (state.dat_context.as_ref(), state.project_path.as_ref()) {
            (Some(dat_context), Some(project_root)) => {
                Some(ensure_custom_ability_text_paths(dat_context, project_root)?)
            }
            _ => None,
        }
    };
    Ok(entity_diff::save_ability_diff_with_text_paths(
        old_path,
        new_path,
        rows,
        out_yaml_path,
        out_dat_path,
        ability_text_paths,
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
        let Some(name) = descriptor_type_name(descriptor) else {
            continue;
        };

        if let Ok(dat_path) = descriptor.use_dat_with(RelativeDatPathResolver { dat_context }) {
            names_by_path.insert(normalize_compare_key_from_str(&dat_path), name.clone());
        }

        if descriptor.has_jp_dat() {
            if let Ok(jp_dat_path) =
                descriptor.use_jp_dat_with(RelativeDatPathResolver { dat_context })
            {
                names_by_path.insert(
                    normalize_compare_key_from_str(&jp_dat_path),
                    format!("{name} (JP)"),
                );
            }
        }
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
