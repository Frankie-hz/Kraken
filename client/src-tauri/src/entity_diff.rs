use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File},
    io::BufWriter,
    path::{Path, PathBuf},
};

use anyhow::Result;
use dats::{
    base::Dat,
    context::DatContext,
    dat_format::DatFormat,
    formats::{
        dmsg_list::DmsgContent, dmsg_table::DmsgTable, entity_names::EntityNames,
        item_info::ItemInfoTable, menu_table::MenuTable,
    },
};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EntityNamesYaml {
    names: Vec<EntityNameYaml>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EntityNameYaml {
    id: u32,
    name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ItemInfoTableYaml {
    items: Vec<Value>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum EntityDiffChoice {
    Old,
    New,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityDiffRow {
    pub row: u32,
    pub old_id: Option<u32>,
    pub old_name: Option<String>,
    pub old_stack_size: Option<u32>,
    pub old_flags: Option<Vec<String>>,
    pub old_jobs: Option<Vec<String>>,
    pub old_description: Option<String>,
    pub new_id: Option<u32>,
    pub new_name: Option<String>,
    pub new_stack_size: Option<u32>,
    pub new_flags: Option<Vec<String>>,
    pub new_jobs: Option<Vec<String>>,
    pub new_description: Option<String>,
    pub target_id: Option<u32>,
    pub choice: EntityDiffChoice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityDiffResult {
    pub rows: Vec<EntityDiffRow>,
    pub old_count: usize,
    pub new_count: usize,
    pub changed_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
struct ItemDiffValues {
    id: Option<u32>,
    stack_size: Option<u32>,
    level: Option<u32>,
    item_type: Option<String>,
    shield_size: Option<u32>,
    max_charges: Option<u32>,
    casting_time: Option<u32>,
    use_delay: Option<u32>,
    reuse_delay: Option<u32>,
    valid_targets: Option<Vec<String>>,
    slots: Option<Vec<String>>,
    icon_bytes: Option<String>,
    flags: Option<Vec<String>>,
    jobs: Option<Vec<String>>,
    en_name: Option<String>,
    en_description: Option<String>,
    jp_name: Option<String>,
    jp_description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDiffRow {
    pub row: u32,
    pub old_id: Option<u32>,
    pub new_id: Option<u32>,
    pub retail_id: Option<u32>,
    pub old_stack_size: Option<u32>,
    pub new_stack_size: Option<u32>,
    pub retail_stack_size: Option<u32>,
    pub old_level: Option<u32>,
    pub new_level: Option<u32>,
    pub retail_level: Option<u32>,
    pub old_item_type: Option<String>,
    pub new_item_type: Option<String>,
    pub retail_item_type: Option<String>,
    pub old_shield_size: Option<u32>,
    pub new_shield_size: Option<u32>,
    pub retail_shield_size: Option<u32>,
    pub old_max_charges: Option<u32>,
    pub new_max_charges: Option<u32>,
    pub retail_max_charges: Option<u32>,
    pub old_casting_time: Option<u32>,
    pub new_casting_time: Option<u32>,
    pub retail_casting_time: Option<u32>,
    pub old_use_delay: Option<u32>,
    pub new_use_delay: Option<u32>,
    pub retail_use_delay: Option<u32>,
    pub old_reuse_delay: Option<u32>,
    pub new_reuse_delay: Option<u32>,
    pub retail_reuse_delay: Option<u32>,
    pub old_valid_targets: Option<Vec<String>>,
    pub new_valid_targets: Option<Vec<String>>,
    pub retail_valid_targets: Option<Vec<String>>,
    pub old_slots: Option<Vec<String>>,
    pub new_slots: Option<Vec<String>>,
    pub retail_slots: Option<Vec<String>>,
    pub old_icon_bytes: Option<String>,
    pub new_icon_bytes: Option<String>,
    pub retail_icon_bytes: Option<String>,
    pub old_flags: Option<Vec<String>>,
    pub new_flags: Option<Vec<String>>,
    pub retail_flags: Option<Vec<String>>,
    pub old_jobs: Option<Vec<String>>,
    pub new_jobs: Option<Vec<String>>,
    pub retail_jobs: Option<Vec<String>>,
    pub old_en_name: Option<String>,
    pub new_en_name: Option<String>,
    pub retail_en_name: Option<String>,
    pub old_en_description: Option<String>,
    pub new_en_description: Option<String>,
    pub retail_en_description: Option<String>,
    pub old_jp_name: Option<String>,
    pub new_jp_name: Option<String>,
    pub retail_jp_name: Option<String>,
    pub old_jp_description: Option<String>,
    pub new_jp_description: Option<String>,
    pub retail_jp_description: Option<String>,
    pub has_japanese: bool,
    pub has_retail_entry: bool,
    pub choice: EntityDiffChoice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDiffResult {
    pub rows: Vec<ItemDiffRow>,
    pub old_count: usize,
    pub new_count: usize,
    pub changed_count: usize,
    pub old_japanese_path: Option<String>,
    pub new_japanese_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemEditorRow {
    pub row: u32,
    pub old_id: Option<u32>,
    pub new_id: Option<u32>,
    pub old_stack_size: Option<u32>,
    pub new_stack_size: Option<u32>,
    pub old_level: Option<u32>,
    pub new_level: Option<u32>,
    pub old_item_type: Option<String>,
    pub new_item_type: Option<String>,
    pub old_shield_size: Option<u32>,
    pub new_shield_size: Option<u32>,
    pub old_max_charges: Option<u32>,
    pub new_max_charges: Option<u32>,
    pub old_casting_time: Option<u32>,
    pub new_casting_time: Option<u32>,
    pub old_use_delay: Option<u32>,
    pub new_use_delay: Option<u32>,
    pub old_reuse_delay: Option<u32>,
    pub new_reuse_delay: Option<u32>,
    pub old_valid_targets: Option<Vec<String>>,
    pub new_valid_targets: Option<Vec<String>>,
    pub old_slots: Option<Vec<String>>,
    pub new_slots: Option<Vec<String>>,
    pub old_weapon_damage: Option<u32>,
    pub new_weapon_damage: Option<u32>,
    pub old_weapon_delay: Option<u32>,
    pub new_weapon_delay: Option<u32>,
    pub old_weapon_dps: Option<u32>,
    pub new_weapon_dps: Option<u32>,
    pub old_weapon_skill_type: Option<String>,
    pub new_weapon_skill_type: Option<String>,
    pub old_weapon_jug_size: Option<u32>,
    pub new_weapon_jug_size: Option<u32>,
    pub old_weapon_emote: Option<u32>,
    pub new_weapon_emote: Option<u32>,
    pub old_icon_bytes: Option<String>,
    pub new_icon_bytes: Option<String>,
    pub old_flags: Option<Vec<String>>,
    pub new_flags: Option<Vec<String>>,
    pub old_jobs: Option<Vec<String>>,
    pub new_jobs: Option<Vec<String>>,
    pub old_en_name: Option<String>,
    pub new_en_name: Option<String>,
    pub old_en_article_type: Option<String>,
    pub new_en_article_type: Option<String>,
    pub old_en_singular_name: Option<String>,
    pub new_en_singular_name: Option<String>,
    pub old_en_plural_name: Option<String>,
    pub new_en_plural_name: Option<String>,
    pub old_en_description: Option<String>,
    pub new_en_description: Option<String>,
    pub old_jp_name: Option<String>,
    pub new_jp_name: Option<String>,
    pub old_jp_description: Option<String>,
    pub new_jp_description: Option<String>,
    pub has_japanese: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneEditorRow {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellDiffRow {
    pub row: u32,
    pub old_index: Option<u32>,
    pub old_name: Option<String>,
    pub old_name_jp: Option<String>,
    pub old_description_en: Option<String>,
    pub old_description_jp: Option<String>,
    pub old_valid_targets: Option<Vec<String>>,
    pub old_mp_cost: Option<u32>,
    pub old_cast_time: Option<u32>,
    pub old_recast_time: Option<u32>,
    pub old_range: Option<String>,
    pub old_aoe_range: Option<String>,
    pub old_area_shape: Option<String>,
    pub old_valid_target_type: Option<String>,
    pub old_level_required: Option<HashMap<String, u32>>,
    pub new_index: Option<u32>,
    pub new_name: Option<String>,
    pub new_name_jp: Option<String>,
    pub new_description_en: Option<String>,
    pub new_description_jp: Option<String>,
    pub new_valid_targets: Option<Vec<String>>,
    pub new_mp_cost: Option<u32>,
    pub new_cast_time: Option<u32>,
    pub new_recast_time: Option<u32>,
    pub new_range: Option<String>,
    pub new_aoe_range: Option<String>,
    pub new_area_shape: Option<String>,
    pub new_valid_target_type: Option<String>,
    pub new_level_required: Option<HashMap<String, u32>>,
    pub target_index: Option<u32>,
    pub choice: EntityDiffChoice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellDiffResult {
    pub rows: Vec<SpellDiffRow>,
    pub old_count: usize,
    pub new_count: usize,
    pub changed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbilityDiffRow {
    pub row: u32,
    pub old_id: Option<u32>,
    pub old_name: Option<String>,
    pub old_name_jp: Option<String>,
    pub old_description_en: Option<String>,
    pub old_description_jp: Option<String>,
    pub old_valid_targets: Option<Vec<String>>,
    pub old_charges_required: Option<u32>,
    pub old_range: Option<String>,
    pub old_aoe_range: Option<String>,
    pub old_area_shape: Option<String>,
    pub old_valid_target_type: Option<String>,
    pub new_id: Option<u32>,
    pub new_name: Option<String>,
    pub new_name_jp: Option<String>,
    pub new_description_en: Option<String>,
    pub new_description_jp: Option<String>,
    pub new_valid_targets: Option<Vec<String>>,
    pub new_charges_required: Option<u32>,
    pub new_range: Option<String>,
    pub new_aoe_range: Option<String>,
    pub new_area_shape: Option<String>,
    pub new_valid_target_type: Option<String>,
    pub target_id: Option<u32>,
    pub choice: EntityDiffChoice,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbilityDiffResult {
    pub rows: Vec<AbilityDiffRow>,
    pub old_count: usize,
    pub new_count: usize,
    pub changed_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityDiffSaveResult {
    pub written_count: usize,
    pub kept_old_count: usize,
    pub kept_new_count: usize,
    pub out_yaml_path: String,
    pub out_dat_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemDiffSaveResult {
    pub written_count: usize,
    pub kept_old_count: usize,
    pub kept_new_count: usize,
    pub out_yaml_path: String,
    pub out_dat_path: Option<String>,
    pub japanese_out_yaml_path: Option<String>,
    pub japanese_out_dat_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellDiffSaveResult {
    pub written_count: usize,
    pub kept_old_count: usize,
    pub kept_new_count: usize,
    pub out_yaml_path: String,
    pub out_dat_path: Option<String>,
    pub spell_names_en_path: Option<String>,
    pub spell_names_jp_path: Option<String>,
    pub spell_descriptions_en_path: Option<String>,
    pub spell_descriptions_jp_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbilityDiffSaveResult {
    pub written_count: usize,
    pub kept_old_count: usize,
    pub kept_new_count: usize,
    pub out_yaml_path: String,
    pub out_dat_path: Option<String>,
    pub ability_names_en_path: Option<String>,
    pub ability_names_jp_path: Option<String>,
    pub ability_descriptions_en_path: Option<String>,
    pub ability_descriptions_jp_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderDiffEntry {
    pub relative_path: String,
    pub zone_name: Option<String>,
    pub diff_tool: DiffToolKind,
    pub custom_path: Option<String>,
    pub old_retail_path: Option<String>,
    pub new_retail_path: Option<String>,
    pub custom_exists: bool,
    pub retail_changed: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum DiffToolKind {
    Entity,
    Item,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderDiffResult {
    pub scanned_count: usize,
    pub retail_changed_count: usize,
    pub all_files: Vec<FolderDiffEntry>,
    pub changed_files: Vec<FolderDiffEntry>,
}

#[derive(Debug, Clone)]
struct AlignEntry {
    id: u32,
    name: String,
}

#[derive(Debug, Clone, Copy)]
enum AlignOp {
    Pair(usize, usize),
    Delete(usize),
    Insert(usize),
}

pub fn compare_entity_name_files(old_path: PathBuf, new_path: PathBuf) -> Result<EntityDiffResult> {
    let old_data = load_entity_names(&old_path)?;
    let new_data = load_entity_names(&new_path)?;

    let old_entries = old_data
        .names
        .iter()
        .map(|entry| AlignEntry {
            id: entry.id,
            name: entry.name.clone(),
        })
        .collect::<Vec<_>>();
    let new_entries = new_data
        .names
        .iter()
        .map(|entry| AlignEntry {
            id: entry.id,
            name: entry.name.clone(),
        })
        .collect::<Vec<_>>();

    let operations = align_operations(&old_entries, &new_entries);

    let mut changed_count = 0usize;
    let rows = operations
        .iter()
        .enumerate()
        .map(|(idx, op)| {
            let row = match op {
                AlignOp::Pair(old_idx, new_idx) => {
                    let old_entry = &old_data.names[*old_idx];
                    let new_entry = &new_data.names[*new_idx];
                    let is_changed =
                        old_entry.id != new_entry.id || old_entry.name != new_entry.name;
                    if is_changed {
                        changed_count += 1;
                    }

                    EntityDiffRow {
                        row: idx as u32,
                        old_id: Some(old_entry.id),
                        old_name: Some(old_entry.name.clone()),
                        old_stack_size: None,
                        old_flags: None,
                        old_jobs: None,
                        old_description: None,
                        new_id: Some(new_entry.id),
                        new_name: Some(new_entry.name.clone()),
                        new_stack_size: None,
                        new_flags: None,
                        new_jobs: None,
                        new_description: None,
                        target_id: Some(new_entry.id),
                        choice: EntityDiffChoice::New,
                    }
                }
                AlignOp::Delete(old_idx) => {
                    let old_entry = &old_data.names[*old_idx];
                    changed_count += 1;

                    EntityDiffRow {
                        row: idx as u32,
                        old_id: Some(old_entry.id),
                        old_name: Some(old_entry.name.clone()),
                        old_stack_size: None,
                        old_flags: None,
                        old_jobs: None,
                        old_description: None,
                        new_id: None,
                        new_name: None,
                        new_stack_size: None,
                        new_flags: None,
                        new_jobs: None,
                        new_description: None,
                        target_id: Some(old_entry.id),
                        choice: EntityDiffChoice::Old,
                    }
                }
                AlignOp::Insert(new_idx) => {
                    let new_entry = &new_data.names[*new_idx];
                    changed_count += 1;

                    EntityDiffRow {
                        row: idx as u32,
                        old_id: None,
                        old_name: None,
                        old_stack_size: None,
                        old_flags: None,
                        old_jobs: None,
                        old_description: None,
                        new_id: Some(new_entry.id),
                        new_name: Some(new_entry.name.clone()),
                        new_stack_size: None,
                        new_flags: None,
                        new_jobs: None,
                        new_description: None,
                        target_id: Some(new_entry.id),
                        choice: EntityDiffChoice::New,
                    }
                }
            };
            row
        })
        .collect::<Vec<_>>();

    Ok(EntityDiffResult {
        rows,
        old_count: old_data.names.len(),
        new_count: new_data.names.len(),
        changed_count,
    })
}

pub fn save_entity_name_diff(
    rows: Vec<EntityDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
) -> Result<EntityDiffSaveResult> {
    let mut merged_names = Vec::with_capacity(rows.len());
    let mut kept_old_count = 0usize;
    let mut kept_new_count = 0usize;

    for row in rows {
        match row.choice {
            EntityDiffChoice::Old => {
                if let Some(name) = row.old_name {
                    let id = row.target_id.or(row.old_id).or(row.new_id);
                    if let Some(id) = id {
                        merged_names.push(EntityNameYaml { id, name });
                        kept_old_count += 1;
                    }
                }
            }
            EntityDiffChoice::New => {
                if let Some(name) = row.new_name {
                    let id = row.target_id.or(row.new_id).or(row.old_id);
                    if let Some(id) = id {
                        merged_names.push(EntityNameYaml { id, name });
                        kept_new_count += 1;
                    }
                }
            }
        }
    }

    let merged = EntityNamesYaml {
        names: merged_names,
    };

    if let Some(parent) = out_yaml_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let yaml_file = File::create(&out_yaml_path)?;
    serde_yaml::to_writer(BufWriter::new(yaml_file), &merged)?;

    let written_dat = if let Some(dat_path) = out_dat_path {
        if let Some(parent) = dat_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let value = serde_yaml::to_value(&merged)?;
        let dat: EntityNames = serde_yaml::from_value(value)?;
        let bytes = dat.to_bytes()?;
        fs::write(&dat_path, bytes)?;

        Some(dat_path.display().to_string())
    } else {
        None
    };

    Ok(EntityDiffSaveResult {
        written_count: merged.names.len(),
        kept_old_count,
        kept_new_count,
        out_yaml_path: out_yaml_path.display().to_string(),
        out_dat_path: written_dat,
    })
}

pub fn load_zone_editor_rows(path: PathBuf) -> Result<Vec<ZoneEditorRow>> {
    Ok(load_entity_names(&path)?
        .names
        .into_iter()
        .map(|entry| ZoneEditorRow {
            id: entry.id,
            name: entry.name,
        })
        .collect())
}

pub fn save_zone_editor_rows(
    rows: Vec<ZoneEditorRow>,
    out_yaml_path: PathBuf,
    out_dat_path: PathBuf,
) -> Result<usize> {
    let mut seen_ids = BTreeSet::new();
    for row in &rows {
        if !seen_ids.insert(row.id) {
            anyhow::bail!("Zone ID {} appears more than once.", row.id);
        }
    }

    let merged = EntityNamesYaml {
        names: rows
            .iter()
            .map(|row| EntityNameYaml {
                id: row.id,
                name: row.name.clone(),
            })
            .collect(),
    };

    if let Some(parent) = out_yaml_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let yaml_file = File::create(&out_yaml_path)?;
    serde_yaml::to_writer(BufWriter::new(yaml_file), &merged)?;

    if let Some(parent) = out_dat_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let value = serde_yaml::to_value(&merged)?;
    let dat: EntityNames = serde_yaml::from_value(value)?;
    fs::write(&out_dat_path, dat.to_bytes()?)?;

    Ok(merged.names.len())
}

fn item_diff_values(english_item: Option<&Value>, japanese_item: Option<&Value>) -> ItemDiffValues {
    ItemDiffValues {
        id: english_item
            .and_then(get_item_id)
            .or_else(|| japanese_item.and_then(get_item_id)),
        stack_size: english_item
            .and_then(get_item_stack_size)
            .or_else(|| japanese_item.and_then(get_item_stack_size)),
        level: english_item
            .and_then(get_item_level)
            .or_else(|| japanese_item.and_then(get_item_level)),
        item_type: english_item
            .and_then(get_item_type)
            .or_else(|| japanese_item.and_then(get_item_type)),
        shield_size: english_item
            .and_then(get_item_shield_size)
            .or_else(|| japanese_item.and_then(get_item_shield_size)),
        max_charges: english_item
            .and_then(get_item_max_charges)
            .or_else(|| japanese_item.and_then(get_item_max_charges)),
        casting_time: english_item
            .and_then(get_item_casting_time)
            .or_else(|| japanese_item.and_then(get_item_casting_time)),
        use_delay: english_item
            .and_then(get_item_use_delay)
            .or_else(|| japanese_item.and_then(get_item_use_delay)),
        reuse_delay: english_item
            .and_then(get_item_reuse_delay)
            .or_else(|| japanese_item.and_then(get_item_reuse_delay)),
        valid_targets: english_item
            .and_then(get_item_valid_targets)
            .or_else(|| japanese_item.and_then(get_item_valid_targets)),
        slots: english_item
            .and_then(get_item_slots)
            .or_else(|| japanese_item.and_then(get_item_slots)),
        icon_bytes: english_item
            .and_then(get_item_icon_bytes)
            .or_else(|| japanese_item.and_then(get_item_icon_bytes)),
        flags: english_item
            .and_then(get_item_flags)
            .or_else(|| japanese_item.and_then(get_item_flags)),
        jobs: english_item
            .and_then(get_item_jobs)
            .or_else(|| japanese_item.and_then(get_item_jobs)),
        en_name: english_item.and_then(get_item_name),
        en_description: english_item.and_then(get_item_description),
        jp_name: japanese_item.and_then(get_item_name),
        jp_description: japanese_item.and_then(get_item_description),
    }
}

fn item_diff_values_match_current_identity(
    current: &ItemDiffValues,
    retail: &ItemDiffValues,
) -> bool {
    current.stack_size == retail.stack_size
        && current.level == retail.level
        && current.item_type == retail.item_type
        && current.shield_size == retail.shield_size
        && current.max_charges == retail.max_charges
        && current.casting_time == retail.casting_time
        && current.use_delay == retail.use_delay
        && current.reuse_delay == retail.reuse_delay
        && current.valid_targets == retail.valid_targets
        && current.slots == retail.slots
        && current.icon_bytes == retail.icon_bytes
        && current.flags == retail.flags
        && current.jobs == retail.jobs
        && current.en_description == retail.en_description
        && current.jp_name == retail.jp_name
        && current.jp_description == retail.jp_description
}

fn item_diff_row_from_values(
    row: u32,
    old: &ItemDiffValues,
    retail: &ItemDiffValues,
    target: &ItemDiffValues,
    has_japanese: bool,
    has_retail_entry: bool,
    choice: EntityDiffChoice,
) -> ItemDiffRow {
    ItemDiffRow {
        row,
        old_id: old.id,
        new_id: target.id,
        retail_id: retail.id,
        old_stack_size: old.stack_size,
        new_stack_size: target.stack_size,
        retail_stack_size: retail.stack_size,
        old_level: old.level,
        new_level: target.level,
        retail_level: retail.level,
        old_item_type: old.item_type.clone(),
        new_item_type: target.item_type.clone(),
        retail_item_type: retail.item_type.clone(),
        old_shield_size: old.shield_size,
        new_shield_size: target.shield_size,
        retail_shield_size: retail.shield_size,
        old_max_charges: old.max_charges,
        new_max_charges: target.max_charges,
        retail_max_charges: retail.max_charges,
        old_casting_time: old.casting_time,
        new_casting_time: target.casting_time,
        retail_casting_time: retail.casting_time,
        old_use_delay: old.use_delay,
        new_use_delay: target.use_delay,
        retail_use_delay: retail.use_delay,
        old_reuse_delay: old.reuse_delay,
        new_reuse_delay: target.reuse_delay,
        retail_reuse_delay: retail.reuse_delay,
        old_valid_targets: old.valid_targets.clone(),
        new_valid_targets: target.valid_targets.clone(),
        retail_valid_targets: retail.valid_targets.clone(),
        old_slots: old.slots.clone(),
        new_slots: target.slots.clone(),
        retail_slots: retail.slots.clone(),
        old_icon_bytes: old.icon_bytes.clone(),
        new_icon_bytes: target.icon_bytes.clone(),
        retail_icon_bytes: retail.icon_bytes.clone(),
        old_flags: old.flags.clone(),
        new_flags: target.flags.clone(),
        retail_flags: retail.flags.clone(),
        old_jobs: old.jobs.clone(),
        new_jobs: target.jobs.clone(),
        retail_jobs: retail.jobs.clone(),
        old_en_name: old.en_name.clone(),
        new_en_name: target.en_name.clone(),
        retail_en_name: retail.en_name.clone(),
        old_en_description: old.en_description.clone(),
        new_en_description: target.en_description.clone(),
        retail_en_description: retail.en_description.clone(),
        old_jp_name: old.jp_name.clone(),
        new_jp_name: target.jp_name.clone(),
        retail_jp_name: retail.jp_name.clone(),
        old_jp_description: old.jp_description.clone(),
        new_jp_description: target.jp_description.clone(),
        retail_jp_description: retail.jp_description.clone(),
        has_japanese,
        has_retail_entry,
        choice,
    }
}

pub fn compare_item_files(
    old_path: PathBuf,
    new_path: PathBuf,
    old_japanese_path: Option<PathBuf>,
    new_japanese_path: Option<PathBuf>,
) -> Result<ItemDiffResult> {
    let old_data = load_item_table(&old_path)?;
    let new_data = load_item_table(&new_path)?;
    let old_japanese_data = old_japanese_path
        .as_ref()
        .map(load_item_table)
        .transpose()?;
    let new_japanese_data = new_japanese_path
        .as_ref()
        .map(load_item_table)
        .transpose()?;

    let old_entries = align_entries_from_items(&old_data.items);
    let new_entries = align_entries_from_items(&new_data.items);

    let operations = align_operations(&old_entries, &new_entries);

    let mut changed_count = 0usize;
    let rows = operations
        .iter()
        .enumerate()
        .map(|(idx, op)| {
            let row = match op {
                AlignOp::Pair(old_idx, new_idx) => {
                    let old_item = &old_data.items[*old_idx];
                    let new_item = &new_data.items[*new_idx];
                    let old_japanese_item = old_japanese_data
                        .as_ref()
                        .and_then(|data| data.items.get(*old_idx));
                    let new_japanese_item = new_japanese_data
                        .as_ref()
                        .and_then(|data| data.items.get(*new_idx));
                    let old_values = item_diff_values(Some(old_item), old_japanese_item);
                    let retail_values = item_diff_values(Some(new_item), new_japanese_item);

                    if !item_diff_values_match_current_identity(&old_values, &retail_values) {
                        changed_count += 1;
                    }

                    item_diff_row_from_values(
                        idx as u32,
                        &old_values,
                        &retail_values,
                        &old_values,
                        old_japanese_item.is_some() || new_japanese_item.is_some(),
                        true,
                        EntityDiffChoice::Old,
                    )
                }
                AlignOp::Delete(old_idx) => {
                    let old_item = &old_data.items[*old_idx];
                    let old_japanese_item = old_japanese_data
                        .as_ref()
                        .and_then(|data| data.items.get(*old_idx));
                    let old_values = item_diff_values(Some(old_item), old_japanese_item);
                    let retail_values = item_diff_values(None, None);
                    changed_count += 1;

                    item_diff_row_from_values(
                        idx as u32,
                        &old_values,
                        &retail_values,
                        &old_values,
                        old_japanese_item.is_some(),
                        false,
                        EntityDiffChoice::Old,
                    )
                }
                AlignOp::Insert(new_idx) => {
                    let new_item = &new_data.items[*new_idx];
                    let new_japanese_item = new_japanese_data
                        .as_ref()
                        .and_then(|data| data.items.get(*new_idx));
                    let old_values = item_diff_values(None, None);
                    let retail_values = item_diff_values(Some(new_item), new_japanese_item);
                    changed_count += 1;

                    item_diff_row_from_values(
                        idx as u32,
                        &old_values,
                        &retail_values,
                        &retail_values,
                        new_japanese_item.is_some(),
                        true,
                        EntityDiffChoice::New,
                    )
                }
            };
            row
        })
        .collect::<Vec<_>>();

    Ok(ItemDiffResult {
        rows,
        old_count: old_data.items.len(),
        new_count: new_data.items.len(),
        changed_count,
        old_japanese_path: old_japanese_path
            .as_ref()
            .map(|path| path.display().to_string()),
        new_japanese_path: new_japanese_path
            .as_ref()
            .map(|path| path.display().to_string()),
    })
}

fn item_editor_row_from_item_diff(row: &ItemDiffRow) -> ItemEditorRow {
    ItemEditorRow {
        row: row.row,
        old_id: row.old_id,
        new_id: row.new_id,
        old_stack_size: row.old_stack_size,
        new_stack_size: row.new_stack_size,
        old_level: row.old_level,
        new_level: row.new_level,
        old_item_type: row.old_item_type.clone(),
        new_item_type: row.new_item_type.clone(),
        old_shield_size: row.old_shield_size,
        new_shield_size: row.new_shield_size,
        old_max_charges: row.old_max_charges,
        new_max_charges: row.new_max_charges,
        old_casting_time: row.old_casting_time,
        new_casting_time: row.new_casting_time,
        old_use_delay: row.old_use_delay,
        new_use_delay: row.new_use_delay,
        old_reuse_delay: row.old_reuse_delay,
        new_reuse_delay: row.new_reuse_delay,
        old_valid_targets: row.old_valid_targets.clone(),
        new_valid_targets: row.new_valid_targets.clone(),
        old_slots: row.old_slots.clone(),
        new_slots: row.new_slots.clone(),
        old_weapon_damage: None,
        new_weapon_damage: None,
        old_weapon_delay: None,
        new_weapon_delay: None,
        old_weapon_dps: None,
        new_weapon_dps: None,
        old_weapon_skill_type: None,
        new_weapon_skill_type: None,
        old_weapon_jug_size: None,
        new_weapon_jug_size: None,
        old_weapon_emote: None,
        new_weapon_emote: None,
        old_icon_bytes: row.old_icon_bytes.clone(),
        new_icon_bytes: row.new_icon_bytes.clone(),
        old_flags: row.old_flags.clone(),
        new_flags: row.new_flags.clone(),
        old_jobs: row.old_jobs.clone(),
        new_jobs: row.new_jobs.clone(),
        old_en_name: row.old_en_name.clone(),
        new_en_name: row.new_en_name.clone(),
        old_en_article_type: None,
        new_en_article_type: None,
        old_en_singular_name: None,
        new_en_singular_name: None,
        old_en_plural_name: None,
        new_en_plural_name: None,
        old_en_description: row.old_en_description.clone(),
        new_en_description: row.new_en_description.clone(),
        old_jp_name: row.old_jp_name.clone(),
        new_jp_name: row.new_jp_name.clone(),
        old_jp_description: row.old_jp_description.clone(),
        new_jp_description: row.new_jp_description.clone(),
        has_japanese: row.has_japanese,
    }
}

pub fn save_item_diff(
    old_path: PathBuf,
    new_path: PathBuf,
    old_japanese_path: Option<PathBuf>,
    new_japanese_path: Option<PathBuf>,
    rows: Vec<ItemDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
    japanese_out_yaml_path: Option<PathBuf>,
    japanese_out_dat_path: Option<PathBuf>,
) -> Result<ItemDiffSaveResult> {
    let old_data = load_item_table(&old_path)?;
    let new_data = load_item_table(&new_path)?;
    let old_japanese_data = old_japanese_path
        .as_ref()
        .map(load_item_table)
        .transpose()?;
    let new_japanese_data = new_japanese_path
        .as_ref()
        .map(load_item_table)
        .transpose()?;

    let old_entries = align_entries_from_items(&old_data.items);
    let new_entries = align_entries_from_items(&new_data.items);
    let operations = align_operations(&old_entries, &new_entries);

    let row_lookup = rows
        .into_iter()
        .map(|row| (row.row, row))
        .collect::<HashMap<_, _>>();

    let mut merged_items = Vec::with_capacity(operations.len());
    let mut merged_japanese_items = Vec::with_capacity(operations.len());
    let mut kept_old_count = 0usize;
    let mut kept_new_count = 0usize;

    for (idx, op) in operations.iter().enumerate() {
        let row = row_lookup.get(&(idx as u32));

        let old_item = match op {
            AlignOp::Pair(old_idx, _) | AlignOp::Delete(old_idx) => {
                old_data.items.get(*old_idx).cloned()
            }
            AlignOp::Insert(_) => None,
        };
        let new_item = match op {
            AlignOp::Pair(_, new_idx) | AlignOp::Insert(new_idx) => {
                new_data.items.get(*new_idx).cloned()
            }
            AlignOp::Delete(_) => None,
        };

        let Some(mut selected_item) = old_item.or(new_item) else {
            continue;
        };

        if let Some(row) = row {
            let editor_row = item_editor_row_from_item_diff(row);
            apply_common_item_editor_updates(&mut selected_item, &editor_row);
            apply_english_item_editor_updates(&mut selected_item, &editor_row);

            match row.choice {
                EntityDiffChoice::Old => kept_old_count += 1,
                EntityDiffChoice::New => kept_new_count += 1,
            }
        } else {
            match op {
                AlignOp::Delete(_) => kept_old_count += 1,
                _ => kept_new_count += 1,
            }
        }
        merged_items.push(selected_item);

        let old_japanese_item = match op {
            AlignOp::Pair(old_idx, _) | AlignOp::Delete(old_idx) => old_japanese_data
                .as_ref()
                .and_then(|data| data.items.get(*old_idx))
                .cloned(),
            AlignOp::Insert(_) => None,
        };
        let new_japanese_item = match op {
            AlignOp::Pair(_, new_idx) | AlignOp::Insert(new_idx) => new_japanese_data
                .as_ref()
                .and_then(|data| data.items.get(*new_idx))
                .cloned(),
            AlignOp::Delete(_) => None,
        };

        if let Some(mut selected_japanese_item) = old_japanese_item.or(new_japanese_item) {
            if let Some(row) = row {
                let editor_row = item_editor_row_from_item_diff(row);
                apply_common_item_editor_updates(&mut selected_japanese_item, &editor_row);
                apply_japanese_item_editor_updates(&mut selected_japanese_item, &editor_row);
            }
            merged_japanese_items.push(selected_japanese_item);
        }
    }

    let merged = ItemInfoTableYaml {
        items: merged_items,
    };

    if let Some(parent) = out_yaml_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let yaml_file = File::create(&out_yaml_path)?;
    serde_yaml::to_writer(BufWriter::new(yaml_file), &merged)?;

    let written_dat = if let Some(dat_path) = out_dat_path {
        if let Some(parent) = dat_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let value = serde_yaml::to_value(&merged)?;
        let dat: ItemInfoTable = serde_yaml::from_value(value)?;
        let bytes = dat.to_bytes()?;
        ItemInfoTable::from_bytes(&bytes)
            .map_err(|err| anyhow::anyhow!("Generated item DAT failed verification: {err}"))?;
        fs::write(&dat_path, bytes)?;

        Some(dat_path.display().to_string())
    } else {
        None
    };

    let (japanese_out_yaml_path, japanese_out_dat_path) =
        if let Some(japanese_out_yaml_path) = japanese_out_yaml_path {
            let merged_japanese = ItemInfoTableYaml {
                items: merged_japanese_items,
            };
            if let Some(parent) = japanese_out_yaml_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let yaml_file = File::create(&japanese_out_yaml_path)?;
            serde_yaml::to_writer(BufWriter::new(yaml_file), &merged_japanese)?;

            let written_japanese_dat = if let Some(dat_path) = japanese_out_dat_path {
                if let Some(parent) = dat_path.parent() {
                    fs::create_dir_all(parent)?;
                }

                let value = serde_yaml::to_value(&merged_japanese)?;
                let dat: ItemInfoTable = serde_yaml::from_value(value)?;
                let bytes = dat.to_bytes()?;
                ItemInfoTable::from_bytes(&bytes).map_err(|err| {
                    anyhow::anyhow!("Generated Japanese item DAT failed verification: {err}")
                })?;
                fs::write(&dat_path, bytes)?;

                Some(dat_path.display().to_string())
            } else {
                None
            };

            (
                Some(japanese_out_yaml_path.display().to_string()),
                written_japanese_dat,
            )
        } else {
            (None, None)
        };

    Ok(ItemDiffSaveResult {
        written_count: merged.items.len(),
        kept_old_count,
        kept_new_count,
        out_yaml_path: out_yaml_path.display().to_string(),
        out_dat_path: written_dat,
        japanese_out_yaml_path,
        japanese_out_dat_path,
    })
}

pub fn load_item_editor_rows(
    english_path: PathBuf,
    japanese_path: Option<PathBuf>,
) -> Result<Vec<ItemEditorRow>> {
    let english_data = load_item_table(&english_path)?;
    let japanese_data = japanese_path.as_ref().map(load_item_table).transpose()?;

    let row_count = english_data.items.len().max(
        japanese_data
            .as_ref()
            .map(|data| data.items.len())
            .unwrap_or(0),
    );

    let mut rows = Vec::with_capacity(row_count);
    for row_idx in 0..row_count {
        let english_item = english_data.items.get(row_idx);
        let japanese_item = japanese_data
            .as_ref()
            .and_then(|data| data.items.get(row_idx));

        let old_id = english_item
            .and_then(get_item_id)
            .or_else(|| japanese_item.and_then(get_item_id));
        let old_stack_size = english_item
            .and_then(get_item_stack_size)
            .or_else(|| japanese_item.and_then(get_item_stack_size));
        let old_level = english_item
            .and_then(get_item_level)
            .or_else(|| japanese_item.and_then(get_item_level));
        let old_item_type = english_item
            .and_then(get_item_type)
            .or_else(|| japanese_item.and_then(get_item_type));
        let old_shield_size = english_item
            .and_then(get_item_shield_size)
            .or_else(|| japanese_item.and_then(get_item_shield_size));
        let old_max_charges = english_item
            .and_then(get_item_max_charges)
            .or_else(|| japanese_item.and_then(get_item_max_charges));
        let old_casting_time = english_item
            .and_then(get_item_casting_time)
            .or_else(|| japanese_item.and_then(get_item_casting_time));
        let old_use_delay = english_item
            .and_then(get_item_use_delay)
            .or_else(|| japanese_item.and_then(get_item_use_delay));
        let old_reuse_delay = english_item
            .and_then(get_item_reuse_delay)
            .or_else(|| japanese_item.and_then(get_item_reuse_delay));
        let old_valid_targets = english_item
            .and_then(get_item_valid_targets)
            .or_else(|| japanese_item.and_then(get_item_valid_targets));
        let old_slots = english_item
            .and_then(get_item_slots)
            .or_else(|| japanese_item.and_then(get_item_slots));
        let old_weapon_damage = english_item
            .and_then(get_item_weapon_damage)
            .or_else(|| japanese_item.and_then(get_item_weapon_damage));
        let old_weapon_delay = english_item
            .and_then(get_item_weapon_delay)
            .or_else(|| japanese_item.and_then(get_item_weapon_delay));
        let old_weapon_dps = english_item
            .and_then(get_item_weapon_dps)
            .or_else(|| japanese_item.and_then(get_item_weapon_dps));
        let old_weapon_skill_type = english_item
            .and_then(get_item_weapon_skill_type)
            .or_else(|| japanese_item.and_then(get_item_weapon_skill_type));
        let old_weapon_jug_size = english_item
            .and_then(get_item_weapon_jug_size)
            .or_else(|| japanese_item.and_then(get_item_weapon_jug_size));
        let old_weapon_emote = english_item
            .and_then(get_item_weapon_emote)
            .or_else(|| japanese_item.and_then(get_item_weapon_emote));
        let old_icon_bytes = english_item
            .and_then(get_item_icon_bytes)
            .or_else(|| japanese_item.and_then(get_item_icon_bytes));
        let old_flags = english_item
            .and_then(get_item_flags)
            .or_else(|| japanese_item.and_then(get_item_flags));
        let old_jobs = english_item
            .and_then(get_item_jobs)
            .or_else(|| japanese_item.and_then(get_item_jobs));
        let old_en_name = english_item.and_then(get_item_name);
        let old_en_article_type =
            english_item.and_then(|item| get_item_string_field(item, "article_type"));
        let old_en_singular_name =
            english_item.and_then(|item| get_item_string_field(item, "singular_name"));
        let old_en_plural_name =
            english_item.and_then(|item| get_item_string_field(item, "plural_name"));
        let old_en_description = english_item.and_then(get_item_description);
        let old_jp_name = japanese_item.and_then(get_item_name);
        let old_jp_description = japanese_item.and_then(get_item_description);

        rows.push(ItemEditorRow {
            row: row_idx as u32,
            old_id,
            new_id: old_id,
            old_stack_size,
            new_stack_size: old_stack_size,
            old_level,
            new_level: old_level,
            old_item_type: old_item_type.clone(),
            new_item_type: old_item_type,
            old_shield_size,
            new_shield_size: old_shield_size,
            old_max_charges,
            new_max_charges: old_max_charges,
            old_casting_time,
            new_casting_time: old_casting_time,
            old_use_delay,
            new_use_delay: old_use_delay,
            old_reuse_delay,
            new_reuse_delay: old_reuse_delay,
            old_valid_targets: old_valid_targets.clone(),
            new_valid_targets: old_valid_targets,
            old_slots: old_slots.clone(),
            new_slots: old_slots,
            old_weapon_damage,
            new_weapon_damage: old_weapon_damage,
            old_weapon_delay,
            new_weapon_delay: old_weapon_delay,
            old_weapon_dps,
            new_weapon_dps: old_weapon_dps,
            old_weapon_skill_type: old_weapon_skill_type.clone(),
            new_weapon_skill_type: old_weapon_skill_type,
            old_weapon_jug_size,
            new_weapon_jug_size: old_weapon_jug_size,
            old_weapon_emote,
            new_weapon_emote: old_weapon_emote,
            old_icon_bytes: old_icon_bytes.clone(),
            new_icon_bytes: old_icon_bytes,
            old_flags: old_flags.clone(),
            new_flags: old_flags,
            old_jobs: old_jobs.clone(),
            new_jobs: old_jobs,
            old_en_name: old_en_name.clone(),
            new_en_name: old_en_name,
            old_en_article_type: old_en_article_type.clone(),
            new_en_article_type: old_en_article_type,
            old_en_singular_name: old_en_singular_name.clone(),
            new_en_singular_name: old_en_singular_name,
            old_en_plural_name: old_en_plural_name.clone(),
            new_en_plural_name: old_en_plural_name,
            old_en_description: old_en_description.clone(),
            new_en_description: old_en_description,
            old_jp_name: old_jp_name.clone(),
            new_jp_name: old_jp_name,
            old_jp_description: old_jp_description.clone(),
            new_jp_description: old_jp_description,
            has_japanese: japanese_item.is_some(),
        });
    }

    Ok(rows)
}

pub fn save_item_editor_rows(
    english_source_path: PathBuf,
    japanese_source_path: Option<PathBuf>,
    rows: Vec<ItemEditorRow>,
    save_english: bool,
    save_japanese: bool,
    english_out_yaml_path: PathBuf,
    english_out_dat_path: Option<PathBuf>,
    japanese_out_yaml_path: Option<PathBuf>,
    japanese_out_dat_path: Option<PathBuf>,
) -> Result<usize> {
    let mut english_data = if save_english {
        Some(load_item_table(&english_source_path)?)
    } else {
        None
    };
    let mut japanese_data = if save_japanese {
        japanese_source_path
            .as_ref()
            .map(load_item_table)
            .transpose()?
    } else {
        None
    };

    for row in &rows {
        let row_idx = row.row as usize;

        if let Some(english_items) = english_data.as_mut() {
            let Some(english_item) = english_items.items.get_mut(row_idx) else {
                return Err(anyhow::anyhow!(
                    "English item row {} is out of range for {:?}.",
                    row.row,
                    english_source_path
                ));
            };

            apply_common_item_editor_updates(english_item, row);
            apply_english_item_editor_updates(english_item, row);
        }

        if let Some(japanese_items) = japanese_data.as_mut() {
            let Some(japanese_item) = japanese_items.items.get_mut(row_idx) else {
                return Err(anyhow::anyhow!(
                    "Japanese item row {} is out of range for {:?}.",
                    row.row,
                    japanese_source_path
                ));
            };

            apply_common_item_editor_updates(japanese_item, row);
            apply_japanese_item_editor_updates(japanese_item, row);
        }
    }

    if let Some(english_items) = english_data.as_ref() {
        write_item_table(english_items, english_out_yaml_path, english_out_dat_path)?;
    }

    if let Some(japanese_items) = japanese_data.as_ref() {
        if let Some(japanese_yaml_path) = japanese_out_yaml_path {
            write_item_table(japanese_items, japanese_yaml_path, japanese_out_dat_path)?;
        }
    }

    Ok(english_data
        .as_ref()
        .map(|items| items.items.len())
        .or_else(|| japanese_data.as_ref().map(|items| items.items.len()))
        .unwrap_or(0))
}

pub fn compare_spell_files_with_text_paths(
    old_path: PathBuf,
    new_path: PathBuf,
    spell_text_paths: Option<SpellTextPaths>,
) -> Result<SpellDiffResult> {
    let old_data = load_spell_table(&old_path)?;
    let new_data = load_spell_table(&new_path)?;
    let spell_text = load_spell_text_tables(&old_path, &new_path, spell_text_paths.as_ref());

    let old_spells = get_spell_entries(&old_data)?.to_vec();
    let new_spells = get_spell_entries(&new_data)?.to_vec();

    let old_entries = align_entries_from_spells(&old_spells);
    let new_entries = align_entries_from_spells(&new_spells);
    let operations = align_operations(&old_entries, &new_entries);

    let mut changed_count = 0usize;
    let rows = operations
        .iter()
        .enumerate()
        .map(|(idx, op)| {
            let row = match op {
                AlignOp::Pair(old_idx, new_idx) => {
                    let old_spell = &old_spells[*old_idx];
                    let new_spell = &new_spells[*new_idx];

                    let old_index = get_spell_index(old_spell);
                    let old_name = resolve_spell_name(old_spell, &spell_text);
                    let old_name_jp = lookup_spell_text(&spell_text.spell_names_jp, old_spell);
                    let old_description_en =
                        lookup_spell_text(&spell_text.spell_descriptions_en, old_spell);
                    let old_description_jp =
                        lookup_spell_text(&spell_text.spell_descriptions_jp, old_spell);
                    let old_valid_targets = get_spell_valid_targets(old_spell);
                    let old_mp_cost = get_spell_mp_cost(old_spell);
                    let old_cast_time = get_spell_cast_time(old_spell);
                    let old_recast_time = get_spell_recast_time(old_spell);
                    let old_range = get_spell_range(old_spell);
                    let old_aoe_range = get_spell_aoe_range(old_spell);
                    let old_area_shape = get_spell_area_shape(old_spell);
                    let old_valid_target_type = get_spell_valid_target_type(old_spell);
                    let old_level_required = get_spell_level_required(old_spell);

                    let new_index = get_spell_index(new_spell);
                    let new_name = resolve_spell_name(new_spell, &spell_text);
                    let new_name_jp = lookup_spell_text(&spell_text.spell_names_jp, new_spell);
                    let new_description_en =
                        lookup_spell_text(&spell_text.spell_descriptions_en, new_spell);
                    let new_description_jp =
                        lookup_spell_text(&spell_text.spell_descriptions_jp, new_spell);
                    let new_valid_targets = get_spell_valid_targets(new_spell);
                    let new_mp_cost = get_spell_mp_cost(new_spell);
                    let new_cast_time = get_spell_cast_time(new_spell);
                    let new_recast_time = get_spell_recast_time(new_spell);
                    let new_range = get_spell_range(new_spell);
                    let new_aoe_range = get_spell_aoe_range(new_spell);
                    let new_area_shape = get_spell_area_shape(new_spell);
                    let new_valid_target_type = get_spell_valid_target_type(new_spell);
                    let new_level_required = get_spell_level_required(new_spell);

                    let is_changed = old_index != new_index
                        || old_name != new_name
                        || old_name_jp != new_name_jp
                        || old_description_en != new_description_en
                        || old_description_jp != new_description_jp
                        || old_valid_targets != new_valid_targets
                        || old_mp_cost != new_mp_cost
                        || old_cast_time != new_cast_time
                        || old_recast_time != new_recast_time
                        || old_range != new_range
                        || old_aoe_range != new_aoe_range
                        || old_area_shape != new_area_shape
                        || old_valid_target_type != new_valid_target_type
                        || old_level_required != new_level_required;
                    if is_changed {
                        changed_count += 1;
                    }

                    SpellDiffRow {
                        row: idx as u32,
                        old_index,
                        old_name,
                        old_name_jp,
                        old_description_en,
                        old_description_jp,
                        old_valid_targets,
                        old_mp_cost,
                        old_cast_time,
                        old_recast_time,
                        old_range,
                        old_aoe_range,
                        old_area_shape,
                        old_valid_target_type,
                        old_level_required,
                        new_index,
                        new_name,
                        new_name_jp,
                        new_description_en,
                        new_description_jp,
                        new_valid_targets,
                        new_mp_cost,
                        new_cast_time,
                        new_recast_time,
                        new_range,
                        new_aoe_range,
                        new_area_shape,
                        new_valid_target_type,
                        new_level_required,
                        target_index: new_index.or(old_index),
                        choice: EntityDiffChoice::New,
                    }
                }
                AlignOp::Delete(old_idx) => {
                    let old_spell = &old_spells[*old_idx];
                    changed_count += 1;

                    let old_index = get_spell_index(old_spell);
                    SpellDiffRow {
                        row: idx as u32,
                        old_index,
                        old_name: resolve_spell_name(old_spell, &spell_text),
                        old_name_jp: lookup_spell_text(&spell_text.spell_names_jp, old_spell),
                        old_description_en: lookup_spell_text(
                            &spell_text.spell_descriptions_en,
                            old_spell,
                        ),
                        old_description_jp: lookup_spell_text(
                            &spell_text.spell_descriptions_jp,
                            old_spell,
                        ),
                        old_valid_targets: get_spell_valid_targets(old_spell),
                        old_mp_cost: get_spell_mp_cost(old_spell),
                        old_cast_time: get_spell_cast_time(old_spell),
                        old_recast_time: get_spell_recast_time(old_spell),
                        old_range: get_spell_range(old_spell),
                        old_aoe_range: get_spell_aoe_range(old_spell),
                        old_area_shape: get_spell_area_shape(old_spell),
                        old_valid_target_type: get_spell_valid_target_type(old_spell),
                        old_level_required: get_spell_level_required(old_spell),
                        new_index: None,
                        new_name: None,
                        new_name_jp: None,
                        new_description_en: None,
                        new_description_jp: None,
                        new_valid_targets: None,
                        new_mp_cost: None,
                        new_cast_time: None,
                        new_recast_time: None,
                        new_range: None,
                        new_aoe_range: None,
                        new_area_shape: None,
                        new_valid_target_type: None,
                        new_level_required: None,
                        target_index: old_index,
                        choice: EntityDiffChoice::Old,
                    }
                }
                AlignOp::Insert(new_idx) => {
                    let new_spell = &new_spells[*new_idx];
                    changed_count += 1;

                    let new_index = get_spell_index(new_spell);
                    SpellDiffRow {
                        row: idx as u32,
                        old_index: None,
                        old_name: None,
                        old_name_jp: None,
                        old_description_en: None,
                        old_description_jp: None,
                        old_valid_targets: None,
                        old_mp_cost: None,
                        old_cast_time: None,
                        old_recast_time: None,
                        old_range: None,
                        old_aoe_range: None,
                        old_area_shape: None,
                        old_valid_target_type: None,
                        old_level_required: None,
                        new_index,
                        new_name: resolve_spell_name(new_spell, &spell_text),
                        new_name_jp: lookup_spell_text(&spell_text.spell_names_jp, new_spell),
                        new_description_en: lookup_spell_text(
                            &spell_text.spell_descriptions_en,
                            new_spell,
                        ),
                        new_description_jp: lookup_spell_text(
                            &spell_text.spell_descriptions_jp,
                            new_spell,
                        ),
                        new_valid_targets: get_spell_valid_targets(new_spell),
                        new_mp_cost: get_spell_mp_cost(new_spell),
                        new_cast_time: get_spell_cast_time(new_spell),
                        new_recast_time: get_spell_recast_time(new_spell),
                        new_range: get_spell_range(new_spell),
                        new_aoe_range: get_spell_aoe_range(new_spell),
                        new_area_shape: get_spell_area_shape(new_spell),
                        new_valid_target_type: get_spell_valid_target_type(new_spell),
                        new_level_required: get_spell_level_required(new_spell),
                        target_index: new_index,
                        choice: EntityDiffChoice::New,
                    }
                }
            };
            row
        })
        .collect::<Vec<_>>();

    Ok(SpellDiffResult {
        rows,
        old_count: old_spells.len(),
        new_count: new_spells.len(),
        changed_count,
    })
}

pub fn save_spell_diff_with_text_paths(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<SpellDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
    spell_text_paths: Option<SpellTextPaths>,
) -> Result<SpellDiffSaveResult> {
    let old_data = load_spell_table(&old_path)?;
    let new_data = load_spell_table(&new_path)?;
    let mut spell_names_en = spell_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.spell_names_en))
        .transpose()?;
    let mut spell_names_jp = spell_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.spell_names_jp))
        .transpose()?;
    let mut spell_descriptions_en = spell_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.spell_descriptions_en))
        .transpose()?;
    let mut spell_descriptions_jp = spell_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.spell_descriptions_jp))
        .transpose()?;

    let old_spells = get_spell_entries(&old_data)?.to_vec();
    let new_spells = get_spell_entries(&new_data)?.to_vec();

    let old_entries = align_entries_from_spells(&old_spells);
    let new_entries = align_entries_from_spells(&new_spells);
    let operations = align_operations(&old_entries, &new_entries);

    let row_lookup = rows
        .into_iter()
        .map(|row| (row.row, row))
        .collect::<HashMap<_, _>>();

    let mut merged_spells = Vec::with_capacity(operations.len());
    let mut kept_old_count = 0usize;
    let mut kept_new_count = 0usize;

    for (idx, op) in operations.iter().enumerate() {
        let row = row_lookup.get(&(idx as u32));

        let old_spell = match op {
            AlignOp::Pair(old_idx, _) | AlignOp::Delete(old_idx) => {
                old_spells.get(*old_idx).cloned()
            }
            AlignOp::Insert(_) => None,
        };
        let new_spell = match op {
            AlignOp::Pair(_, new_idx) | AlignOp::Insert(new_idx) => {
                new_spells.get(*new_idx).cloned()
            }
            AlignOp::Delete(_) => None,
        };

        let requested_choice = row.map(|row| row.choice).unwrap_or_else(|| match op {
            AlignOp::Delete(_) => EntityDiffChoice::Old,
            _ => EntityDiffChoice::New,
        });

        let (mut selected_spell, effective_choice) = match requested_choice {
            EntityDiffChoice::Old => {
                if let Some(spell) = old_spell {
                    (spell, EntityDiffChoice::Old)
                } else if let Some(spell) = new_spell {
                    (spell, EntityDiffChoice::New)
                } else {
                    continue;
                }
            }
            EntityDiffChoice::New => {
                if let Some(spell) = new_spell {
                    (spell, EntityDiffChoice::New)
                } else if let Some(spell) = old_spell {
                    (spell, EntityDiffChoice::Old)
                } else {
                    continue;
                }
            }
        };

        if let Some(target_index) = row
            .and_then(|row| row.target_index)
            .or_else(|| {
                row.and_then(|row| match effective_choice {
                    EntityDiffChoice::Old => row.old_index,
                    EntityDiffChoice::New => row.new_index,
                })
            })
            .or_else(|| get_spell_index(&selected_spell))
        {
            set_spell_index(&mut selected_spell, target_index);
        }
        let target_text_id =
            get_spell_index(&selected_spell).or_else(|| row.and_then(|row| row.target_index));

        let chosen_valid_targets = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_valid_targets.clone(),
            EntityDiffChoice::New => row.new_valid_targets.clone(),
        });
        if let Some(valid_targets) = chosen_valid_targets {
            set_spell_valid_targets(&mut selected_spell, &valid_targets);
        }

        if let Some(text_id) = target_text_id {
            if let (Some(row), Some(table)) = (row, spell_names_en.as_mut()) {
                if let Some(name) = row.new_name.clone() {
                    set_dmsg_first_string(table, text_id, name);
                }
            }
            if let (Some(row), Some(table)) = (row, spell_names_jp.as_mut()) {
                if let Some(name) = row.new_name_jp.clone() {
                    set_dmsg_first_string(table, text_id, name);
                }
            }
            if let (Some(row), Some(table)) = (row, spell_descriptions_en.as_mut()) {
                if let Some(description) = row.new_description_en.clone() {
                    set_dmsg_first_string(table, text_id, description);
                }
            }
            if let (Some(row), Some(table)) = (row, spell_descriptions_jp.as_mut()) {
                if let Some(description) = row.new_description_jp.clone() {
                    set_dmsg_first_string(table, text_id, description);
                }
            }
        }

        let chosen_mp_cost = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_mp_cost,
            EntityDiffChoice::New => row.new_mp_cost,
        });
        if let Some(mp_cost) = chosen_mp_cost {
            set_spell_mp_cost(&mut selected_spell, mp_cost);
        }

        let chosen_cast_time = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_cast_time,
            EntityDiffChoice::New => row.new_cast_time,
        });
        if let Some(cast_time) = chosen_cast_time {
            set_spell_cast_time(&mut selected_spell, cast_time);
        }

        let chosen_recast_time = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_recast_time,
            EntityDiffChoice::New => row.new_recast_time,
        });
        if let Some(recast_time) = chosen_recast_time {
            set_spell_recast_time(&mut selected_spell, recast_time);
        }

        let chosen_range = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_range.clone(),
            EntityDiffChoice::New => row.new_range.clone(),
        });
        if let Some(range) = chosen_range {
            set_spell_range(&mut selected_spell, range);
        }

        let chosen_aoe_range = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_aoe_range.clone(),
            EntityDiffChoice::New => row.new_aoe_range.clone(),
        });
        if let Some(aoe_range) = chosen_aoe_range {
            set_spell_aoe_range(&mut selected_spell, aoe_range);
        }

        let chosen_area_shape = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_area_shape.clone(),
            EntityDiffChoice::New => row.new_area_shape.clone(),
        });
        if let Some(area_shape) = chosen_area_shape {
            set_spell_area_shape(&mut selected_spell, area_shape);
        }

        let chosen_valid_target_type = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_valid_target_type.clone(),
            EntityDiffChoice::New => row.new_valid_target_type.clone(),
        });
        if let Some(valid_target_type) = chosen_valid_target_type {
            set_spell_valid_target_type(&mut selected_spell, valid_target_type);
        }

        let chosen_level_required = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_level_required.clone(),
            EntityDiffChoice::New => row.new_level_required.clone(),
        });
        if let Some(level_required) = chosen_level_required {
            set_spell_level_required(&mut selected_spell, &level_required);
        }

        match effective_choice {
            EntityDiffChoice::Old => kept_old_count += 1,
            EntityDiffChoice::New => kept_new_count += 1,
        }
        merged_spells.push(selected_spell);
    }

    let merged_count = merged_spells.len();
    let mut output_data =
        load_existing_menu_output(&out_yaml_path, out_dat_path.as_deref())?.unwrap_or(new_data);
    set_spell_entries(&mut output_data, merged_spells)?;
    let written_dat =
        write_menu_table_outputs(&output_data, &out_yaml_path, out_dat_path.as_deref())?;

    let mut spell_names_en_path = None;
    let mut spell_names_jp_path = None;
    let mut spell_descriptions_en_path = None;
    let mut spell_descriptions_jp_path = None;

    if let Some(paths) = spell_text_paths {
        if let Some(table) = spell_names_en {
            write_dmsg_table(&paths.spell_names_en, &table)?;
            spell_names_en_path = Some(paths.spell_names_en.display().to_string());
        }
        if let Some(table) = spell_names_jp {
            write_dmsg_table(&paths.spell_names_jp, &table)?;
            spell_names_jp_path = Some(paths.spell_names_jp.display().to_string());
        }
        if let Some(table) = spell_descriptions_en {
            write_dmsg_table(&paths.spell_descriptions_en, &table)?;
            spell_descriptions_en_path = Some(paths.spell_descriptions_en.display().to_string());
        }
        if let Some(table) = spell_descriptions_jp {
            write_dmsg_table(&paths.spell_descriptions_jp, &table)?;
            spell_descriptions_jp_path = Some(paths.spell_descriptions_jp.display().to_string());
        }
    }

    Ok(SpellDiffSaveResult {
        written_count: merged_count,
        kept_old_count,
        kept_new_count,
        out_yaml_path: out_yaml_path.display().to_string(),
        out_dat_path: written_dat,
        spell_names_en_path,
        spell_names_jp_path,
        spell_descriptions_en_path,
        spell_descriptions_jp_path,
    })
}

pub fn compare_ability_files_with_text_paths(
    old_path: PathBuf,
    new_path: PathBuf,
    ability_text_paths: Option<AbilityTextPaths>,
) -> Result<AbilityDiffResult> {
    let old_data = load_spell_table(&old_path)?;
    let new_data = load_spell_table(&new_path)?;
    let ability_text = load_ability_text_tables(&old_path, &new_path, ability_text_paths.as_ref());

    let old_abilities = get_ability_entries(&old_data)?.to_vec();
    let new_abilities = get_ability_entries(&new_data)?.to_vec();

    let old_entries = align_entries_from_abilities(&old_abilities);
    let new_entries = align_entries_from_abilities(&new_abilities);
    let operations = align_operations(&old_entries, &new_entries);

    let mut changed_count = 0usize;
    let rows = operations
        .iter()
        .enumerate()
        .map(|(idx, op)| match op {
            AlignOp::Pair(old_idx, new_idx) => {
                let old_ability = &old_abilities[*old_idx];
                let new_ability = &new_abilities[*new_idx];

                let old_id = get_ability_id(old_ability);
                let old_name = lookup_ability_text(&ability_text.ability_names_en, old_ability);
                let old_name_jp = lookup_ability_text(&ability_text.ability_names_jp, old_ability);
                let old_description_en =
                    lookup_ability_text(&ability_text.ability_descriptions_en, old_ability);
                let old_description_jp =
                    lookup_ability_text(&ability_text.ability_descriptions_jp, old_ability);
                let old_valid_targets = get_ability_valid_targets(old_ability);
                let old_charges_required = get_ability_charges_required(old_ability);
                let old_range = get_ability_range(old_ability);
                let old_aoe_range = get_ability_aoe_range(old_ability);
                let old_area_shape = get_ability_area_shape(old_ability);
                let old_valid_target_type = get_ability_valid_target_type(old_ability);

                let new_id = get_ability_id(new_ability);
                let new_name = lookup_ability_text(&ability_text.ability_names_en, new_ability);
                let new_name_jp = lookup_ability_text(&ability_text.ability_names_jp, new_ability);
                let new_description_en =
                    lookup_ability_text(&ability_text.ability_descriptions_en, new_ability);
                let new_description_jp =
                    lookup_ability_text(&ability_text.ability_descriptions_jp, new_ability);
                let new_valid_targets = get_ability_valid_targets(new_ability);
                let new_charges_required = get_ability_charges_required(new_ability);
                let new_range = get_ability_range(new_ability);
                let new_aoe_range = get_ability_aoe_range(new_ability);
                let new_area_shape = get_ability_area_shape(new_ability);
                let new_valid_target_type = get_ability_valid_target_type(new_ability);

                let is_changed = old_id != new_id
                    || old_name != new_name
                    || old_name_jp != new_name_jp
                    || old_description_en != new_description_en
                    || old_description_jp != new_description_jp
                    || old_valid_targets != new_valid_targets
                    || old_charges_required != new_charges_required
                    || old_range != new_range
                    || old_aoe_range != new_aoe_range
                    || old_area_shape != new_area_shape
                    || old_valid_target_type != new_valid_target_type;
                if is_changed {
                    changed_count += 1;
                }

                AbilityDiffRow {
                    row: idx as u32,
                    old_id,
                    old_name,
                    old_name_jp,
                    old_description_en,
                    old_description_jp,
                    old_valid_targets,
                    old_charges_required,
                    old_range,
                    old_aoe_range,
                    old_area_shape,
                    old_valid_target_type,
                    new_id,
                    new_name,
                    new_name_jp,
                    new_description_en,
                    new_description_jp,
                    new_valid_targets,
                    new_charges_required,
                    new_range,
                    new_aoe_range,
                    new_area_shape,
                    new_valid_target_type,
                    target_id: new_id.or(old_id),
                    choice: EntityDiffChoice::New,
                }
            }
            AlignOp::Delete(old_idx) => {
                let old_ability = &old_abilities[*old_idx];
                changed_count += 1;

                let old_id = get_ability_id(old_ability);
                AbilityDiffRow {
                    row: idx as u32,
                    old_id,
                    old_name: lookup_ability_text(&ability_text.ability_names_en, old_ability),
                    old_name_jp: lookup_ability_text(&ability_text.ability_names_jp, old_ability),
                    old_description_en: lookup_ability_text(
                        &ability_text.ability_descriptions_en,
                        old_ability,
                    ),
                    old_description_jp: lookup_ability_text(
                        &ability_text.ability_descriptions_jp,
                        old_ability,
                    ),
                    old_valid_targets: get_ability_valid_targets(old_ability),
                    old_charges_required: get_ability_charges_required(old_ability),
                    old_range: get_ability_range(old_ability),
                    old_aoe_range: get_ability_aoe_range(old_ability),
                    old_area_shape: get_ability_area_shape(old_ability),
                    old_valid_target_type: get_ability_valid_target_type(old_ability),
                    new_id: None,
                    new_name: None,
                    new_name_jp: None,
                    new_description_en: None,
                    new_description_jp: None,
                    new_valid_targets: None,
                    new_charges_required: None,
                    new_range: None,
                    new_aoe_range: None,
                    new_area_shape: None,
                    new_valid_target_type: None,
                    target_id: old_id,
                    choice: EntityDiffChoice::Old,
                }
            }
            AlignOp::Insert(new_idx) => {
                let new_ability = &new_abilities[*new_idx];
                changed_count += 1;

                let new_id = get_ability_id(new_ability);
                AbilityDiffRow {
                    row: idx as u32,
                    old_id: None,
                    old_name: None,
                    old_name_jp: None,
                    old_description_en: None,
                    old_description_jp: None,
                    old_valid_targets: None,
                    old_charges_required: None,
                    old_range: None,
                    old_aoe_range: None,
                    old_area_shape: None,
                    old_valid_target_type: None,
                    new_id,
                    new_name: lookup_ability_text(&ability_text.ability_names_en, new_ability),
                    new_name_jp: lookup_ability_text(&ability_text.ability_names_jp, new_ability),
                    new_description_en: lookup_ability_text(
                        &ability_text.ability_descriptions_en,
                        new_ability,
                    ),
                    new_description_jp: lookup_ability_text(
                        &ability_text.ability_descriptions_jp,
                        new_ability,
                    ),
                    new_valid_targets: get_ability_valid_targets(new_ability),
                    new_charges_required: get_ability_charges_required(new_ability),
                    new_range: get_ability_range(new_ability),
                    new_aoe_range: get_ability_aoe_range(new_ability),
                    new_area_shape: get_ability_area_shape(new_ability),
                    new_valid_target_type: get_ability_valid_target_type(new_ability),
                    target_id: new_id,
                    choice: EntityDiffChoice::New,
                }
            }
        })
        .collect::<Vec<_>>();

    Ok(AbilityDiffResult {
        rows,
        old_count: old_abilities.len(),
        new_count: new_abilities.len(),
        changed_count,
    })
}

pub fn save_ability_diff_with_text_paths(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<AbilityDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
    ability_text_paths: Option<AbilityTextPaths>,
) -> Result<AbilityDiffSaveResult> {
    let old_data = load_spell_table(&old_path)?;
    let new_data = load_spell_table(&new_path)?;
    let mut ability_names_en = ability_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.ability_names_en))
        .transpose()?;
    let mut ability_names_jp = ability_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.ability_names_jp))
        .transpose()?;
    let mut ability_descriptions_en = ability_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.ability_descriptions_en))
        .transpose()?;
    let mut ability_descriptions_jp = ability_text_paths
        .as_ref()
        .map(|paths| load_dmsg_table(&paths.ability_descriptions_jp))
        .transpose()?;

    let old_abilities = get_ability_entries(&old_data)?.to_vec();
    let new_abilities = get_ability_entries(&new_data)?.to_vec();

    let old_entries = align_entries_from_abilities(&old_abilities);
    let new_entries = align_entries_from_abilities(&new_abilities);
    let operations = align_operations(&old_entries, &new_entries);

    let row_lookup = rows
        .into_iter()
        .map(|row| (row.row, row))
        .collect::<HashMap<_, _>>();

    let mut merged_abilities = Vec::with_capacity(operations.len());
    let mut kept_old_count = 0usize;
    let mut kept_new_count = 0usize;

    for (idx, op) in operations.iter().enumerate() {
        let row = row_lookup.get(&(idx as u32));

        let old_ability = match op {
            AlignOp::Pair(old_idx, _) | AlignOp::Delete(old_idx) => {
                old_abilities.get(*old_idx).cloned()
            }
            AlignOp::Insert(_) => None,
        };
        let new_ability = match op {
            AlignOp::Pair(_, new_idx) | AlignOp::Insert(new_idx) => {
                new_abilities.get(*new_idx).cloned()
            }
            AlignOp::Delete(_) => None,
        };

        let requested_choice = row.map(|row| row.choice).unwrap_or_else(|| match op {
            AlignOp::Delete(_) => EntityDiffChoice::Old,
            _ => EntityDiffChoice::New,
        });

        let (mut selected_ability, effective_choice) = match requested_choice {
            EntityDiffChoice::Old => {
                if let Some(ability) = old_ability {
                    (ability, EntityDiffChoice::Old)
                } else if let Some(ability) = new_ability {
                    (ability, EntityDiffChoice::New)
                } else {
                    continue;
                }
            }
            EntityDiffChoice::New => {
                if let Some(ability) = new_ability {
                    (ability, EntityDiffChoice::New)
                } else if let Some(ability) = old_ability {
                    (ability, EntityDiffChoice::Old)
                } else {
                    continue;
                }
            }
        };

        if let Some(target_id) = row
            .and_then(|row| row.target_id)
            .or_else(|| {
                row.and_then(|row| match effective_choice {
                    EntityDiffChoice::Old => row.old_id,
                    EntityDiffChoice::New => row.new_id,
                })
            })
            .or_else(|| get_ability_id(&selected_ability))
        {
            set_ability_id(&mut selected_ability, target_id);
        }
        let target_text_id =
            get_ability_id(&selected_ability).or_else(|| row.and_then(|row| row.target_id));

        let chosen_valid_targets = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_valid_targets.clone(),
            EntityDiffChoice::New => row.new_valid_targets.clone(),
        });
        if let Some(valid_targets) = chosen_valid_targets {
            set_ability_valid_targets(&mut selected_ability, &valid_targets);
        }

        if let Some(text_id) = target_text_id {
            if let (Some(row), Some(table)) = (row, ability_names_en.as_mut()) {
                if let Some(name) = row.new_name.clone() {
                    set_dmsg_first_string(table, text_id, name);
                }
            }
            if let (Some(row), Some(table)) = (row, ability_names_jp.as_mut()) {
                if let Some(name) = row.new_name_jp.clone() {
                    set_dmsg_first_string(table, text_id, name);
                }
            }
            if let (Some(row), Some(table)) = (row, ability_descriptions_en.as_mut()) {
                if let Some(description) = row.new_description_en.clone() {
                    set_dmsg_first_string(table, text_id, description);
                }
            }
            if let (Some(row), Some(table)) = (row, ability_descriptions_jp.as_mut()) {
                if let Some(description) = row.new_description_jp.clone() {
                    set_dmsg_first_string(table, text_id, description);
                }
            }
        }

        if let Some(charges_required) = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_charges_required,
            EntityDiffChoice::New => row.new_charges_required,
        }) {
            set_ability_charges_required(&mut selected_ability, charges_required);
        }

        if let Some(range) = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_range.clone(),
            EntityDiffChoice::New => row.new_range.clone(),
        }) {
            set_ability_range(&mut selected_ability, range);
        }

        if let Some(aoe_range) = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_aoe_range.clone(),
            EntityDiffChoice::New => row.new_aoe_range.clone(),
        }) {
            set_ability_aoe_range(&mut selected_ability, aoe_range);
        }

        if let Some(area_shape) = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_area_shape.clone(),
            EntityDiffChoice::New => row.new_area_shape.clone(),
        }) {
            set_ability_area_shape(&mut selected_ability, area_shape);
        }

        if let Some(valid_target_type) = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_valid_target_type.clone(),
            EntityDiffChoice::New => row.new_valid_target_type.clone(),
        }) {
            set_ability_valid_target_type(&mut selected_ability, valid_target_type);
        }

        match effective_choice {
            EntityDiffChoice::Old => kept_old_count += 1,
            EntityDiffChoice::New => kept_new_count += 1,
        }
        merged_abilities.push(selected_ability);
    }

    let merged_count = merged_abilities.len();
    let mut output_data =
        load_existing_menu_output(&out_yaml_path, out_dat_path.as_deref())?.unwrap_or(new_data);
    set_ability_entries(&mut output_data, merged_abilities)?;
    let written_dat =
        write_menu_table_outputs(&output_data, &out_yaml_path, out_dat_path.as_deref())?;

    let mut ability_names_en_path = None;
    let mut ability_names_jp_path = None;
    let mut ability_descriptions_en_path = None;
    let mut ability_descriptions_jp_path = None;

    if let Some(paths) = ability_text_paths {
        if let Some(table) = ability_names_en {
            write_dmsg_table(&paths.ability_names_en, &table)?;
            ability_names_en_path = Some(paths.ability_names_en.display().to_string());
        }
        if let Some(table) = ability_names_jp {
            write_dmsg_table(&paths.ability_names_jp, &table)?;
            ability_names_jp_path = Some(paths.ability_names_jp.display().to_string());
        }
        if let Some(table) = ability_descriptions_en {
            write_dmsg_table(&paths.ability_descriptions_en, &table)?;
            ability_descriptions_en_path =
                Some(paths.ability_descriptions_en.display().to_string());
        }
        if let Some(table) = ability_descriptions_jp {
            write_dmsg_table(&paths.ability_descriptions_jp, &table)?;
            ability_descriptions_jp_path =
                Some(paths.ability_descriptions_jp.display().to_string());
        }
    }

    Ok(AbilityDiffSaveResult {
        written_count: merged_count,
        kept_old_count,
        kept_new_count,
        out_yaml_path: out_yaml_path.display().to_string(),
        out_dat_path: written_dat,
        ability_names_en_path,
        ability_names_jp_path,
        ability_descriptions_en_path,
        ability_descriptions_jp_path,
    })
}

fn load_entity_names(path: &PathBuf) -> Result<EntityNamesYaml> {
    let bytes = fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "dat" {
        return decode_entity_names_dat(&bytes);
    }

    if let Ok(parsed) = serde_yaml::from_slice::<EntityNamesYaml>(&bytes) {
        return Ok(parsed);
    }

    decode_entity_names_dat(&bytes)
}

fn decode_entity_names_dat(bytes: &[u8]) -> Result<EntityNamesYaml> {
    let dat = EntityNames::from_bytes(bytes)?;
    let value = serde_yaml::to_value(dat)?;
    let parsed = serde_yaml::from_value::<EntityNamesYaml>(value)?;
    Ok(parsed)
}

fn load_item_table(path: &PathBuf) -> Result<ItemInfoTableYaml> {
    let bytes = fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "dat" {
        return decode_item_dat(&bytes);
    }

    if let Ok(parsed) = serde_yaml::from_slice::<ItemInfoTableYaml>(&bytes) {
        return Ok(parsed);
    }

    decode_item_dat(&bytes)
}

fn load_spell_table(path: &PathBuf) -> Result<Value> {
    let bytes = fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "dat" {
        return decode_spell_dat(&bytes);
    }

    if let Ok(parsed) = serde_yaml::from_slice::<Value>(&bytes) {
        return Ok(parsed);
    }

    decode_spell_dat(&bytes)
}

fn load_existing_menu_output(
    out_yaml_path: &Path,
    out_dat_path: Option<&Path>,
) -> Result<Option<Value>> {
    if out_yaml_path.is_file() {
        return load_spell_table(&out_yaml_path.to_path_buf()).map(Some);
    }

    if let Some(out_dat_path) = out_dat_path {
        if out_dat_path.is_file() {
            return load_spell_table(&out_dat_path.to_path_buf()).map(Some);
        }
    }

    Ok(None)
}

fn write_menu_table_outputs(
    data: &Value,
    out_yaml_path: &Path,
    out_dat_path: Option<&Path>,
) -> Result<Option<String>> {
    if let Some(parent) = out_yaml_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let yaml_file = File::create(out_yaml_path)?;
    serde_yaml::to_writer(BufWriter::new(yaml_file), data)?;

    if let Some(dat_path) = out_dat_path {
        if let Some(parent) = dat_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let dat: MenuTable = serde_yaml::from_value(data.clone())?;
        let bytes = dat.to_bytes()?;
        fs::write(dat_path, bytes)?;
        Ok(Some(dat_path.display().to_string()))
    } else {
        Ok(None)
    }
}

fn load_dmsg_table(path: &PathBuf) -> Result<DmsgTable> {
    let is_yaml = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "yml" | "yaml"))
        .unwrap_or(false);

    if is_yaml {
        let file = File::open(path)?;
        return Ok(serde_yaml::from_reader(file)?);
    }

    let bytes = fs::read(path)?;
    DmsgTable::from_bytes(&bytes)
}

fn write_dmsg_table(path: &PathBuf, table: &DmsgTable) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let yaml_path =
        project_yaml_path_for_dat_path(path).unwrap_or_else(|| path.with_extension("yml"));
    if let Some(parent) = yaml_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let yaml_file = File::create(yaml_path)?;
    serde_yaml::to_writer(BufWriter::new(yaml_file), table)?;

    let dat_bytes = table.to_bytes()?;
    fs::write(path, dat_bytes)?;
    Ok(())
}

fn project_yaml_path_for_dat_path(path: &Path) -> Option<PathBuf> {
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

    let mut yaml_path = PathBuf::new();
    for component in &components[..rom_start] {
        yaml_path.push(component.as_os_str());
    }
    yaml_path.push("Yaml");
    for component in &components[rom_start..] {
        yaml_path.push(component.as_os_str());
    }
    yaml_path.set_extension("yml");
    Some(yaml_path)
}

fn decode_spell_dat(bytes: &[u8]) -> Result<Value> {
    let dat = MenuTable::from_bytes(bytes)?;
    Ok(serde_yaml::to_value(dat)?)
}

fn decode_item_dat(bytes: &[u8]) -> Result<ItemInfoTableYaml> {
    let dat = ItemInfoTable::from_bytes(bytes)?;
    let value = serde_yaml::to_value(dat)?;
    let parsed = serde_yaml::from_value::<ItemInfoTableYaml>(value)?;
    Ok(parsed)
}

fn align_entries_from_items(items: &[Value]) -> Vec<AlignEntry> {
    items
        .iter()
        .map(|item| AlignEntry {
            id: get_item_id(item).unwrap_or(0),
            name: get_item_name(item).unwrap_or_default(),
        })
        .collect()
}

fn align_entries_from_spells(spells: &[Value]) -> Vec<AlignEntry> {
    spells
        .iter()
        .map(|spell| AlignEntry {
            id: get_spell_index(spell).unwrap_or(0),
            name: get_spell_name(spell).unwrap_or_default(),
        })
        .collect()
}

fn align_entries_from_abilities(abilities: &[Value]) -> Vec<AlignEntry> {
    abilities
        .iter()
        .map(|ability| AlignEntry {
            id: get_ability_id(ability).unwrap_or(0),
            name: String::new(),
        })
        .collect()
}

fn get_item_id(item: &Value) -> Option<u32> {
    let mapping = item.as_mapping()?;
    let id_key = Value::String("id".to_string());
    let id_value = mapping.get(&id_key)?;
    let id_u64 = id_value.as_u64()?;
    u32::try_from(id_u64).ok()
}

fn set_item_id(item: &mut Value, id: u32) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let id_key = Value::String("id".to_string());
    mapping.insert(id_key, Value::Number(id.into()));
    true
}

fn get_item_name(item: &Value) -> Option<String> {
    get_item_string_field(item, "name")
}

fn set_item_name(item: &mut Value, name: String) -> bool {
    set_item_string_field(item, "name", name)
}

fn get_item_stack_size(item: &Value) -> Option<u32> {
    let mapping = item.as_mapping()?;
    let key = Value::String("stack_size".to_string());
    let value = mapping.get(&key)?;
    let stack_u64 = value.as_u64()?;
    u32::try_from(stack_u64).ok()
}

fn set_item_stack_size(item: &mut Value, stack_size: u32) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let key = Value::String("stack_size".to_string());
    mapping.insert(key, Value::Number(stack_size.into()));
    true
}

fn get_equipment_u32_field(item: &Value, field: &str) -> Option<u32> {
    let mapping = item.as_mapping()?;
    let equipment = mapping
        .get(Value::String("equipment".to_string()))?
        .as_mapping()?;
    let value = equipment.get(Value::String(field.to_string()))?;
    u32::try_from(value.as_u64()?).ok()
}

fn set_equipment_u32_field(item: &mut Value, field: &str, value: u32) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let Some(equipment) = mapping.get_mut(Value::String("equipment".to_string())) else {
        return false;
    };
    let Some(equipment_mapping) = equipment.as_mapping_mut() else {
        return false;
    };

    equipment_mapping.insert(
        Value::String(field.to_string()),
        Value::Number(value.into()),
    );
    true
}

fn get_item_level(item: &Value) -> Option<u32> {
    get_equipment_u32_field(item, "level")
}

fn get_item_type(item: &Value) -> Option<String> {
    let mapping = item.as_mapping()?;
    let value = mapping.get(Value::String("item_type".to_string()))?;
    value.as_str().map(|value| value.to_string())
}

fn set_item_type(item: &mut Value, item_type: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    mapping.insert(
        Value::String("item_type".to_string()),
        Value::String(item_type),
    );
    true
}

fn get_item_valid_targets(item: &Value) -> Option<Vec<String>> {
    let mapping = item.as_mapping()?;
    let targets = mapping.get(Value::String("valid_targets".to_string()))?;
    value_string_list(targets)
}

fn set_item_valid_targets(item: &mut Value, valid_targets: &[String]) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    mapping.insert(
        Value::String("valid_targets".to_string()),
        string_list_value(valid_targets),
    );
    true
}

fn get_item_slots(item: &Value) -> Option<Vec<String>> {
    let mapping = item.as_mapping()?;
    let equipment = mapping.get(Value::String("equipment".to_string()))?;
    let equipment_mapping = equipment.as_mapping()?;
    let slots = equipment_mapping.get(Value::String("slots".to_string()))?;
    value_string_list(slots)
}

fn set_item_slots(item: &mut Value, slots: &[String]) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    let Some(equipment) = mapping.get_mut(Value::String("equipment".to_string())) else {
        return false;
    };
    let Some(equipment_mapping) = equipment.as_mapping_mut() else {
        return false;
    };

    equipment_mapping.insert(Value::String("slots".to_string()), string_list_value(slots));
    true
}

fn get_weapon_u32_field(item: &Value, field: &str) -> Option<u32> {
    let mapping = item.as_mapping()?;
    let weapon = mapping.get(Value::String("weapon".to_string()))?;
    let weapon_mapping = weapon.as_mapping()?;
    let value = weapon_mapping.get(Value::String(field.to_string()))?;
    value.as_u64().and_then(|value| u32::try_from(value).ok())
}

fn set_weapon_u32_field(item: &mut Value, field: &str, value: u32) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    let Some(weapon) = mapping.get_mut(Value::String("weapon".to_string())) else {
        return false;
    };
    let Some(weapon_mapping) = weapon.as_mapping_mut() else {
        return false;
    };

    weapon_mapping.insert(
        Value::String(field.to_string()),
        Value::Number(value.into()),
    );
    true
}

fn get_item_weapon_damage(item: &Value) -> Option<u32> {
    get_weapon_u32_field(item, "damage")
}

fn get_item_weapon_delay(item: &Value) -> Option<u32> {
    get_weapon_u32_field(item, "delay")
}

fn get_item_weapon_dps(item: &Value) -> Option<u32> {
    get_weapon_u32_field(item, "dps")
}

fn get_item_weapon_skill_type(item: &Value) -> Option<String> {
    let mapping = item.as_mapping()?;
    let weapon = mapping.get(Value::String("weapon".to_string()))?;
    let weapon_mapping = weapon.as_mapping()?;
    let value = weapon_mapping.get(Value::String("skill_type".to_string()))?;
    value.as_str().map(|value| value.to_string())
}

fn set_item_weapon_skill_type(item: &mut Value, skill_type: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    let Some(weapon) = mapping.get_mut(Value::String("weapon".to_string())) else {
        return false;
    };
    let Some(weapon_mapping) = weapon.as_mapping_mut() else {
        return false;
    };

    weapon_mapping.insert(
        Value::String("skill_type".to_string()),
        Value::String(skill_type),
    );
    true
}

fn get_item_weapon_jug_size(item: &Value) -> Option<u32> {
    get_weapon_u32_field(item, "jug_size")
}

fn get_item_weapon_emote(item: &Value) -> Option<u32> {
    get_weapon_u32_field(item, "emote")
}

#[derive(Debug, Default)]
struct SpellTextTables {
    spell_names_en: HashMap<u32, String>,
    spell_names_jp: HashMap<u32, String>,
    spell_descriptions_en: HashMap<u32, String>,
    spell_descriptions_jp: HashMap<u32, String>,
}

#[derive(Debug, Clone)]
pub struct SpellTextPaths {
    pub spell_names_en: PathBuf,
    pub spell_names_jp: PathBuf,
    pub spell_descriptions_en: PathBuf,
    pub spell_descriptions_jp: PathBuf,
}

#[derive(Debug, Default)]
struct AbilityTextTables {
    ability_names_en: HashMap<u32, String>,
    ability_names_jp: HashMap<u32, String>,
    ability_descriptions_en: HashMap<u32, String>,
    ability_descriptions_jp: HashMap<u32, String>,
}

#[derive(Debug, Clone)]
pub struct AbilityTextPaths {
    pub ability_names_en: PathBuf,
    pub ability_names_jp: PathBuf,
    pub ability_descriptions_en: PathBuf,
    pub ability_descriptions_jp: PathBuf,
}

fn get_item_icon_bytes(item: &Value) -> Option<String> {
    let mapping = item.as_mapping()?;
    let value = mapping.get(Value::String("icon_bytes".to_string()))?;
    value.as_str().map(|value| value.to_string())
}

fn set_item_icon_bytes(item: &mut Value, icon_bytes: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    mapping.insert(
        Value::String("icon_bytes".to_string()),
        Value::String(icon_bytes),
    );
    true
}

fn get_item_shield_size(item: &Value) -> Option<u32> {
    get_equipment_u32_field(item, "shield_size")
}

fn get_item_max_charges(item: &Value) -> Option<u32> {
    get_equipment_u32_field(item, "max_charges")
}

fn get_item_casting_time(item: &Value) -> Option<u32> {
    get_equipment_u32_field(item, "casting_time")
}

fn get_item_use_delay(item: &Value) -> Option<u32> {
    get_equipment_u32_field(item, "use_delay")
}

fn get_item_reuse_delay(item: &Value) -> Option<u32> {
    get_equipment_u32_field(item, "reuse_delay")
}

fn get_item_description(item: &Value) -> Option<String> {
    get_item_string_field(item, "description")
}

fn set_item_description(item: &mut Value, description: String) -> bool {
    set_item_string_field(item, "description", description)
}

fn get_item_string_field(item: &Value, field: &str) -> Option<String> {
    let mapping = item.as_mapping()?;
    let strings_key = Value::String("strings".to_string());
    let strings_value = mapping.get(&strings_key)?;
    let strings_mapping = strings_value.as_mapping()?;
    let value_key = Value::String(field.to_string());
    let value = strings_mapping.get(&value_key)?;
    value.as_str().map(|value| value.to_string())
}

fn set_item_string_field(item: &mut Value, field: &str, value: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let strings_key = Value::String("strings".to_string());
    let value_key = Value::String(field.to_string());

    if let Some(strings_value) = mapping.get_mut(&strings_key) {
        if let Some(strings_mapping) = strings_value.as_mapping_mut() {
            strings_mapping.insert(value_key, Value::String(value));
            return true;
        }
    }

    let mut strings_mapping = Mapping::new();
    strings_mapping.insert(value_key, Value::String(value));
    mapping.insert(strings_key, Value::Mapping(strings_mapping));
    true
}

fn value_string_list(value: &Value) -> Option<Vec<String>> {
    let sequence = value.as_sequence()?;
    let mut values = sequence
        .iter()
        .filter_map(Value::as_str)
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    Some(values)
}

fn string_list_value(values: &[String]) -> Value {
    let mut normalized = values.to_vec();
    normalized.sort();
    normalized.dedup();

    Value::Sequence(
        normalized
            .into_iter()
            .map(Value::String)
            .collect::<Vec<_>>(),
    )
}

fn get_item_flags(item: &Value) -> Option<Vec<String>> {
    let mapping = item.as_mapping()?;
    let key = Value::String("flags".to_string());
    let flags = mapping.get(&key)?;
    value_string_list(flags)
}

fn set_item_flags(item: &mut Value, flags: &[String]) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let key = Value::String("flags".to_string());
    mapping.insert(key, string_list_value(flags));
    true
}

fn get_item_jobs(item: &Value) -> Option<Vec<String>> {
    let mapping = item.as_mapping()?;
    let equipment_key = Value::String("equipment".to_string());
    let equipment = mapping.get(&equipment_key)?.as_mapping()?;
    let jobs_key = Value::String("jobs".to_string());
    let jobs = equipment.get(&jobs_key)?;
    value_string_list(jobs)
}

fn set_item_jobs(item: &mut Value, jobs: &[String]) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let equipment_key = Value::String("equipment".to_string());
    let jobs_key = Value::String("jobs".to_string());

    let Some(equipment) = mapping.get_mut(&equipment_key) else {
        return false;
    };
    let Some(equipment_mapping) = equipment.as_mapping_mut() else {
        return false;
    };

    equipment_mapping.insert(jobs_key, string_list_value(jobs));
    true
}

fn apply_common_item_editor_updates(item: &mut Value, row: &ItemEditorRow) {
    if let Some(id) = row.new_id {
        set_item_id(item, id);
    }

    if let Some(stack_size) = row.new_stack_size {
        set_item_stack_size(item, stack_size);
    }

    if let Some(level) = row.new_level {
        set_equipment_u32_field(item, "level", level);
    }

    if let Some(item_type) = row.new_item_type.clone() {
        set_item_type(item, item_type);
    }

    if let Some(shield_size) = row.new_shield_size {
        set_equipment_u32_field(item, "shield_size", shield_size);
    }

    if let Some(max_charges) = row.new_max_charges {
        set_equipment_u32_field(item, "max_charges", max_charges);
    }

    if let Some(casting_time) = row.new_casting_time {
        set_equipment_u32_field(item, "casting_time", casting_time);
    }

    if let Some(use_delay) = row.new_use_delay {
        set_equipment_u32_field(item, "use_delay", use_delay);
    }

    if let Some(reuse_delay) = row.new_reuse_delay {
        set_equipment_u32_field(item, "reuse_delay", reuse_delay);
    }

    if let Some(valid_targets) = row.new_valid_targets.as_ref() {
        set_item_valid_targets(item, valid_targets);
    }

    if let Some(slots) = row.new_slots.as_ref() {
        set_item_slots(item, slots);
    }

    if let Some(damage) = row.new_weapon_damage {
        set_weapon_u32_field(item, "damage", damage);
    }

    if let Some(delay) = row.new_weapon_delay {
        set_weapon_u32_field(item, "delay", delay);
    }

    if let Some(dps) = row.new_weapon_dps {
        set_weapon_u32_field(item, "dps", dps);
    }

    if let Some(skill_type) = row.new_weapon_skill_type.clone() {
        set_item_weapon_skill_type(item, skill_type);
    }

    if let Some(jug_size) = row.new_weapon_jug_size {
        set_weapon_u32_field(item, "jug_size", jug_size);
    }

    if let Some(emote) = row.new_weapon_emote {
        set_weapon_u32_field(item, "emote", emote);
    }

    if let Some(icon_bytes) = row.new_icon_bytes.clone() {
        set_item_icon_bytes(item, icon_bytes);
    }

    if let Some(flags) = row.new_flags.as_ref() {
        set_item_flags(item, flags);
    }

    if let Some(jobs) = row.new_jobs.as_ref() {
        set_item_jobs(item, jobs);
    }
}

fn apply_english_item_editor_updates(item: &mut Value, row: &ItemEditorRow) {
    if let Some(name) = row.new_en_name.clone() {
        set_item_name(item, name);
    }

    if let Some(article_type) = row.new_en_article_type.clone() {
        set_item_string_field(item, "article_type", article_type);
    }

    if let Some(singular_name) = row.new_en_singular_name.clone() {
        set_item_string_field(item, "singular_name", singular_name);
    }

    if let Some(plural_name) = row.new_en_plural_name.clone() {
        set_item_string_field(item, "plural_name", plural_name);
    }

    if let Some(description) = row.new_en_description.clone() {
        set_item_description(item, description);
    }
}

fn apply_japanese_item_editor_updates(item: &mut Value, row: &ItemEditorRow) {
    if let Some(name) = row.new_jp_name.clone() {
        set_item_name(item, name);
    }

    if let Some(description) = row.new_jp_description.clone() {
        set_item_description(item, description);
    }
}

fn write_item_table(
    table: &ItemInfoTableYaml,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
) -> Result<()> {
    if let Some(parent) = out_yaml_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let yaml_file = File::create(&out_yaml_path)?;
    serde_yaml::to_writer(BufWriter::new(yaml_file), table)?;

    if let Some(dat_path) = out_dat_path {
        if let Some(parent) = dat_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let value = serde_yaml::to_value(table)?;
        let dat: ItemInfoTable = serde_yaml::from_value(value)?;
        let bytes = dat.to_bytes()?;
        ItemInfoTable::from_bytes(&bytes)
            .map_err(|err| anyhow::anyhow!("Generated item DAT failed verification: {err}"))?;
        fs::write(&dat_path, bytes)?;
    }

    Ok(())
}

fn get_spell_entries(root: &Value) -> Result<&Vec<Value>> {
    root.as_mapping()
        .and_then(|mapping| mapping.get(Value::String("sections".to_string())))
        .and_then(Value::as_sequence)
        .and_then(|sections| {
            sections.iter().find_map(|section| {
                let section_mapping = section.as_mapping()?;
                let section_type = section_mapping
                    .get(Value::String("type".to_string()))?
                    .as_str()?;
                if section_type != "Mgc_" {
                    return None;
                }

                section_mapping
                    .get(Value::String("entries".to_string()))
                    .and_then(Value::as_sequence)
            })
        })
        .ok_or_else(|| anyhow::anyhow!("Could not locate Mgc_ spell entries."))
}

fn set_spell_entries(root: &mut Value, entries: Vec<Value>) -> Result<()> {
    let Some(mapping) = root.as_mapping_mut() else {
        return Err(anyhow::anyhow!("Spell data is not a mapping."));
    };

    let sections_key = Value::String("sections".to_string());
    let Some(sections_value) = mapping.get_mut(&sections_key) else {
        return Err(anyhow::anyhow!("Spell data has no sections."));
    };
    let Some(sections) = sections_value.as_sequence_mut() else {
        return Err(anyhow::anyhow!("Spell sections are not a list."));
    };

    for section in sections {
        let Some(section_mapping) = section.as_mapping_mut() else {
            continue;
        };
        let section_type = section_mapping
            .get(Value::String("type".to_string()))
            .and_then(Value::as_str);
        if section_type != Some("Mgc_") {
            continue;
        }

        section_mapping.insert(
            Value::String("entries".to_string()),
            Value::Sequence(entries),
        );
        return Ok(());
    }

    Err(anyhow::anyhow!("Could not locate Mgc_ spell section."))
}

fn get_ability_entries(root: &Value) -> Result<&Vec<Value>> {
    root.as_mapping()
        .and_then(|mapping| mapping.get(Value::String("sections".to_string())))
        .and_then(Value::as_sequence)
        .and_then(|sections| {
            sections.iter().find_map(|section| {
                let section_mapping = section.as_mapping()?;
                let section_type = section_mapping
                    .get(Value::String("type".to_string()))?
                    .as_str()?;
                if section_type != "Comm" {
                    return None;
                }

                section_mapping
                    .get(Value::String("entries".to_string()))
                    .and_then(Value::as_sequence)
            })
        })
        .ok_or_else(|| anyhow::anyhow!("Could not locate Comm ability entries."))
}

fn set_ability_entries(root: &mut Value, entries: Vec<Value>) -> Result<()> {
    let Some(mapping) = root.as_mapping_mut() else {
        return Err(anyhow::anyhow!("Ability data is not a mapping."));
    };

    let sections_key = Value::String("sections".to_string());
    let Some(sections_value) = mapping.get_mut(&sections_key) else {
        return Err(anyhow::anyhow!("Ability data has no sections."));
    };
    let Some(sections) = sections_value.as_sequence_mut() else {
        return Err(anyhow::anyhow!("Ability sections are not a list."));
    };

    for section in sections {
        let Some(section_mapping) = section.as_mapping_mut() else {
            continue;
        };
        let section_type = section_mapping
            .get(Value::String("type".to_string()))
            .and_then(Value::as_str);
        if section_type != Some("Comm") {
            continue;
        }

        section_mapping.insert(
            Value::String("entries".to_string()),
            Value::Sequence(entries),
        );
        return Ok(());
    }

    Err(anyhow::anyhow!("Could not locate Comm ability section."))
}

fn get_menu_section_entries(root: &Value, section_type: &str) -> Result<Vec<Value>> {
    root.as_mapping()
        .and_then(|mapping| mapping.get(Value::String("sections".to_string())))
        .and_then(Value::as_sequence)
        .and_then(|sections| {
            sections.iter().find_map(|section| {
                let section_mapping = section.as_mapping()?;
                let current_section_type = section_mapping
                    .get(Value::String("type".to_string()))?
                    .as_str()?;
                if current_section_type != section_type {
                    return None;
                }

                section_mapping
                    .get(Value::String("entries".to_string()))
                    .and_then(Value::as_sequence)
                    .cloned()
            })
        })
        .ok_or_else(|| anyhow::anyhow!("Could not locate {section_type} entries."))
}

fn set_menu_section_entries(
    root: &mut Value,
    section_type: &str,
    entries: Vec<Value>,
) -> Result<()> {
    let Some(mapping) = root.as_mapping_mut() else {
        return Err(anyhow::anyhow!("Menu data is not a mapping."));
    };

    let sections_key = Value::String("sections".to_string());
    let Some(sections_value) = mapping.get_mut(&sections_key) else {
        return Err(anyhow::anyhow!("Menu data has no sections."));
    };
    let Some(sections) = sections_value.as_sequence_mut() else {
        return Err(anyhow::anyhow!("Menu sections are not a list."));
    };

    for section in sections {
        let Some(section_mapping) = section.as_mapping_mut() else {
            continue;
        };
        let current_section_type = section_mapping
            .get(Value::String("type".to_string()))
            .and_then(Value::as_str);
        if current_section_type != Some(section_type) {
            continue;
        }

        section_mapping.insert(
            Value::String("entries".to_string()),
            Value::Sequence(entries),
        );
        return Ok(());
    }

    Err(anyhow::anyhow!("Could not locate {section_type} section."))
}

pub fn reset_menu_section_to_retail_base(
    retail_base_dat_path: PathBuf,
    custom_dat_path: PathBuf,
    section_type: &str,
) -> Result<PathBuf> {
    let retail_data = load_spell_table(&retail_base_dat_path)?;
    let retail_entries = get_menu_section_entries(&retail_data, section_type)?;
    let custom_yaml_path = project_yaml_path_for_dat_path(&custom_dat_path)
        .unwrap_or_else(|| custom_dat_path.with_extension("yml"));
    let mut output_data = load_existing_menu_output(&custom_yaml_path, Some(&custom_dat_path))?
        .unwrap_or(retail_data);

    set_menu_section_entries(&mut output_data, section_type, retail_entries)?;
    write_menu_table_outputs(&output_data, &custom_yaml_path, Some(&custom_dat_path))?;

    Ok(custom_dat_path)
}

fn get_spell_u32(item: &Value, key: &str) -> Option<u32> {
    let mapping = item.as_mapping()?;
    let value = mapping.get(Value::String(key.to_string()))?;
    let number = value.as_u64()?;
    u32::try_from(number).ok()
}

fn get_spell_string(item: &Value, key: &str) -> Option<String> {
    let mapping = item.as_mapping()?;
    let value = mapping.get(Value::String(key.to_string()))?;
    value.as_str().map(|value| value.to_string())
}

fn get_spell_index(item: &Value) -> Option<u32> {
    get_spell_u32(item, "index")
}

fn set_spell_index(item: &mut Value, index: u32) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    mapping.insert(
        Value::String("index".to_string()),
        Value::Number(index.into()),
    );
    true
}

fn get_spell_name(item: &Value) -> Option<String> {
    get_spell_string(item, "name")
}

fn get_spell_mp_cost(item: &Value) -> Option<u32> {
    get_spell_u32(item, "mp_cost")
}

fn get_spell_range(item: &Value) -> Option<String> {
    get_spell_string(item, "range")
}

fn get_spell_aoe_range(item: &Value) -> Option<String> {
    get_spell_string(item, "aoe_range")
}

fn get_spell_area_shape(item: &Value) -> Option<String> {
    get_spell_string(item, "area_shape")
}

fn get_spell_valid_target_type(item: &Value) -> Option<String> {
    get_spell_string(item, "valid_target_type")
}

fn get_spell_valid_targets(item: &Value) -> Option<Vec<String>> {
    let mapping = item.as_mapping()?;
    let targets = mapping.get(Value::String("valid_targets".to_string()))?;
    value_string_list(targets)
}

fn set_spell_valid_targets(item: &mut Value, valid_targets: &[String]) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    mapping.insert(
        Value::String("valid_targets".to_string()),
        string_list_value(valid_targets),
    );
    true
}

fn set_spell_u32(item: &mut Value, key: &str, value: u32) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    mapping.insert(Value::String(key.to_string()), Value::Number(value.into()));
    true
}

fn set_spell_string(item: &mut Value, key: &str, value: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    mapping.insert(Value::String(key.to_string()), Value::String(value));
    true
}

fn set_spell_mp_cost(item: &mut Value, mp_cost: u32) -> bool {
    set_spell_u32(item, "mp_cost", mp_cost)
}

fn set_spell_cast_time(item: &mut Value, cast_time: u32) -> bool {
    set_spell_u32(item, "cast_time", cast_time)
}

fn set_spell_recast_time(item: &mut Value, recast_time: u32) -> bool {
    set_spell_u32(item, "recast_time", recast_time)
}

fn set_spell_range(item: &mut Value, range: String) -> bool {
    set_spell_string(item, "range", range)
}

fn set_spell_aoe_range(item: &mut Value, aoe_range: String) -> bool {
    set_spell_string(item, "aoe_range", aoe_range)
}

fn set_spell_area_shape(item: &mut Value, area_shape: String) -> bool {
    set_spell_string(item, "area_shape", area_shape)
}

fn set_spell_valid_target_type(item: &mut Value, valid_target_type: String) -> bool {
    set_spell_string(item, "valid_target_type", valid_target_type)
}

fn get_ability_id(item: &Value) -> Option<u32> {
    get_spell_u32(item, "id")
}

fn set_ability_id(item: &mut Value, id: u32) -> bool {
    set_spell_u32(item, "id", id)
}

fn get_ability_charges_required(item: &Value) -> Option<u32> {
    get_spell_u32(item, "charges_required")
}

fn set_ability_charges_required(item: &mut Value, charges_required: u32) -> bool {
    set_spell_u32(item, "charges_required", charges_required)
}

fn get_ability_range(item: &Value) -> Option<String> {
    get_spell_string(item, "range")
}

fn set_ability_range(item: &mut Value, range: String) -> bool {
    set_spell_string(item, "range", range)
}

fn get_ability_aoe_range(item: &Value) -> Option<String> {
    get_spell_string(item, "aoe_range")
}

fn set_ability_aoe_range(item: &mut Value, aoe_range: String) -> bool {
    set_spell_string(item, "aoe_range", aoe_range)
}

fn get_ability_area_shape(item: &Value) -> Option<String> {
    get_spell_string(item, "area_shape")
}

fn set_ability_area_shape(item: &mut Value, area_shape: String) -> bool {
    set_spell_string(item, "area_shape", area_shape)
}

fn get_ability_valid_target_type(item: &Value) -> Option<String> {
    get_spell_string(item, "valid_target_type")
}

fn set_ability_valid_target_type(item: &mut Value, valid_target_type: String) -> bool {
    set_spell_string(item, "valid_target_type", valid_target_type)
}

fn get_ability_valid_targets(item: &Value) -> Option<Vec<String>> {
    get_spell_valid_targets(item)
}

fn set_ability_valid_targets(item: &mut Value, valid_targets: &[String]) -> bool {
    set_spell_valid_targets(item, valid_targets)
}

fn get_spell_cast_time(item: &Value) -> Option<u32> {
    get_spell_u32(item, "cast_time")
}

fn get_spell_recast_time(item: &Value) -> Option<u32> {
    get_spell_u32(item, "recast_time")
}

fn get_spell_level_required(item: &Value) -> Option<HashMap<String, u32>> {
    let mapping = item.as_mapping()?;
    let level_value = mapping.get(Value::String("level_required".to_string()))?;
    let level_mapping = level_value.as_mapping()?;

    let mut levels = HashMap::new();
    for (job, level) in level_mapping {
        let job_name = job.as_str()?.to_string();
        let level_u32 = u32::try_from(level.as_u64()?).ok()?;
        levels.insert(job_name, level_u32);
    }

    Some(levels)
}

fn set_spell_level_required(item: &mut Value, levels: &HashMap<String, u32>) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let mut level_mapping = Mapping::new();
    let mut entries = levels
        .iter()
        .map(|(job, level)| (job.clone(), *level))
        .collect::<Vec<_>>();
    entries.sort_by(|(a, _), (b, _)| a.cmp(b));

    for (job, level) in entries {
        level_mapping.insert(Value::String(job), Value::Number(level.into()));
    }

    mapping.insert(
        Value::String("level_required".to_string()),
        Value::Mapping(level_mapping),
    );
    true
}

fn lookup_spell_text(table: &HashMap<u32, String>, spell: &Value) -> Option<String> {
    get_spell_index(spell).and_then(|index| table.get(&index).cloned())
}

fn lookup_ability_text(table: &HashMap<u32, String>, ability: &Value) -> Option<String> {
    get_ability_id(ability).and_then(|id| table.get(&id).cloned())
}

fn resolve_spell_name(spell: &Value, spell_text: &SpellTextTables) -> Option<String> {
    lookup_spell_text(&spell_text.spell_names_en, spell)
}

fn load_spell_text_tables(
    old_path: &Path,
    new_path: &Path,
    spell_text_paths: Option<&SpellTextPaths>,
) -> SpellTextTables {
    if let Some(paths) = spell_text_paths {
        let spell_names_en = load_dmsg_table(&paths.spell_names_en)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();
        let spell_names_jp = load_dmsg_table(&paths.spell_names_jp)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();
        let spell_descriptions_en = load_dmsg_table(&paths.spell_descriptions_en)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();
        let spell_descriptions_jp = load_dmsg_table(&paths.spell_descriptions_jp)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();

        if !spell_names_en.is_empty() || !spell_names_jp.is_empty() {
            return SpellTextTables {
                spell_names_en,
                spell_names_jp,
                spell_descriptions_en,
                spell_descriptions_jp,
            };
        }
    }

    let mut candidate_roots = Vec::new();

    if let Some(root) = find_ffxi_root_from_path(new_path) {
        candidate_roots.push(root);
    }
    if let Some(root) = find_ffxi_root_from_path(old_path) {
        if !candidate_roots.contains(&root) {
            candidate_roots.push(root);
        }
    }
    for root in default_ffxi_install_roots() {
        if !candidate_roots.contains(&root) {
            candidate_roots.push(root);
        }
    }

    for root in candidate_roots {
        if let Ok(dat_context) = DatContext::from_ffxi_path(root) {
            let spell_names_en = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55702u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();
            let spell_names_jp = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55582u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();
            let spell_descriptions_en = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55734u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();
            let spell_descriptions_jp = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55614u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();

            if !spell_names_en.is_empty() {
                return SpellTextTables {
                    spell_names_en,
                    spell_names_jp,
                    spell_descriptions_en,
                    spell_descriptions_jp,
                };
            }
        }
    }

    SpellTextTables::default()
}

fn load_ability_text_tables(
    old_path: &Path,
    new_path: &Path,
    ability_text_paths: Option<&AbilityTextPaths>,
) -> AbilityTextTables {
    if let Some(paths) = ability_text_paths {
        let ability_names_en = load_dmsg_table(&paths.ability_names_en)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();
        let ability_names_jp = load_dmsg_table(&paths.ability_names_jp)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();
        let ability_descriptions_en = load_dmsg_table(&paths.ability_descriptions_en)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();
        let ability_descriptions_jp = load_dmsg_table(&paths.ability_descriptions_jp)
            .map(|table| dmsg_first_string_map(&table))
            .unwrap_or_default();

        if !ability_names_en.is_empty() || !ability_names_jp.is_empty() {
            return AbilityTextTables {
                ability_names_en,
                ability_names_jp,
                ability_descriptions_en,
                ability_descriptions_jp,
            };
        }
    }

    let mut candidate_roots = Vec::new();

    if let Some(root) = find_ffxi_root_from_path(new_path) {
        candidate_roots.push(root);
    }
    if let Some(root) = find_ffxi_root_from_path(old_path) {
        if !candidate_roots.contains(&root) {
            candidate_roots.push(root);
        }
    }
    for root in default_ffxi_install_roots() {
        if !candidate_roots.contains(&root) {
            candidate_roots.push(root);
        }
    }

    for root in candidate_roots {
        if let Ok(dat_context) = DatContext::from_ffxi_path(root) {
            let ability_names_en = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55701u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();
            let ability_names_jp = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55581u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();
            let ability_descriptions_en = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55733u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();
            let ability_descriptions_jp = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55613u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();

            if !ability_names_en.is_empty() {
                return AbilityTextTables {
                    ability_names_en,
                    ability_names_jp,
                    ability_descriptions_en,
                    ability_descriptions_jp,
                };
            }
        }
    }

    AbilityTextTables::default()
}

fn find_ffxi_root_from_path(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|ancestor| ancestor.join("VTABLE.DAT").exists())
        .map(Path::to_path_buf)
}

fn normalize_dmsg_editor_string(value: &str) -> String {
    if value == "." {
        "(Empty)".to_string()
    } else {
        value.to_string()
    }
}

fn dmsg_first_string_map(table: &DmsgTable) -> HashMap<u32, String> {
    table
        .lists
        .iter()
        .filter_map(|(id, list)| {
            list.content.iter().find_map(|entry| match entry {
                DmsgContent::String { string } if !string.is_empty() => {
                    Some((*id, normalize_dmsg_editor_string(string)))
                }
                _ => None,
            })
        })
        .collect()
}

fn set_dmsg_first_string(table: &mut DmsgTable, id: u32, value: String) {
    if let Some(list) = table.lists.get_mut(&id) {
        if let Some(entry) = list
            .content
            .iter_mut()
            .find(|entry| matches!(entry, DmsgContent::String { .. }))
        {
            *entry = DmsgContent::String { string: value };
        }
    }
}

fn default_ffxi_install_roots() -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("C:/Program Files (x86)/PlayOnline/SquareEnix/FINAL FANTASY XI"),
        PathBuf::from("C:/Program Files/PlayOnline/SquareEnix/FINAL FANTASY XI"),
    ];

    if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
        roots.push(
            PathBuf::from(program_files_x86)
                .join("PlayOnline")
                .join("SquareEnix")
                .join("FINAL FANTASY XI"),
        );
    }

    if let Ok(program_files) = std::env::var("ProgramFiles") {
        roots.push(
            PathBuf::from(program_files)
                .join("PlayOnline")
                .join("SquareEnix")
                .join("FINAL FANTASY XI"),
        );
    }

    roots
}

fn align_operations(old: &[AlignEntry], new: &[AlignEntry]) -> Vec<AlignOp> {
    let n = old.len();
    let m = new.len();
    let width = m + 1;

    let mut scores = vec![0_i32; (n + 1) * (m + 1)];
    let mut directions = vec![0_u8; (n + 1) * (m + 1)];

    const GAP_PENALTY: i32 = -2;

    for i in 1..=n {
        let idx = i * width;
        scores[idx] = (i as i32) * GAP_PENALTY;
        directions[idx] = 1;
    }

    for j in 1..=m {
        scores[j] = (j as i32) * GAP_PENALTY;
        directions[j] = 2;
    }

    for i in 1..=n {
        for j in 1..=m {
            let diag = scores[(i - 1) * width + (j - 1)] + pair_score(&old[i - 1], &new[j - 1]);
            let up = scores[(i - 1) * width + j] + GAP_PENALTY;
            let left = scores[i * width + (j - 1)] + GAP_PENALTY;

            let (best_score, direction) = if diag >= up && diag >= left {
                (diag, 0)
            } else if up >= left {
                (up, 1)
            } else {
                (left, 2)
            };

            scores[i * width + j] = best_score;
            directions[i * width + j] = direction;
        }
    }

    let mut i = n;
    let mut j = m;
    let mut operations = Vec::with_capacity(n.max(m));

    while i > 0 || j > 0 {
        let direction = directions[i * width + j];

        if i > 0 && j > 0 && direction == 0 {
            operations.push(AlignOp::Pair(i - 1, j - 1));
            i -= 1;
            j -= 1;
        } else if i > 0 && (j == 0 || direction == 1) {
            operations.push(AlignOp::Delete(i - 1));
            i -= 1;
        } else {
            operations.push(AlignOp::Insert(j - 1));
            j -= 1;
        }
    }

    operations.reverse();
    operations
}

fn pair_score(old: &AlignEntry, new: &AlignEntry) -> i32 {
    let mut score = -4;

    if !old.name.is_empty() && old.name == new.name {
        score += 7;
    }

    if old.id == new.id {
        score += 4;
    } else {
        let old_local = (old.id & 0x0FFF) as i32;
        let new_local = (new.id & 0x0FFF) as i32;
        let id_diff = (old_local - new_local).abs();

        if id_diff == 0 {
            score += 3;
        } else if id_diff <= 2 {
            score += 1;
        }
    }

    score
}

pub fn compare_entity_name_folders(
    custom_dir: PathBuf,
    old_retail_dir: PathBuf,
    new_retail_dir: PathBuf,
) -> Result<FolderDiffResult> {
    let custom_files = collect_candidate_files(&custom_dir)?;
    let old_retail_files = collect_candidate_files(&old_retail_dir)?;
    let new_retail_files = collect_candidate_files(&new_retail_dir)?;

    let mut all_files = Vec::new();
    let mut changed_files = Vec::new();
    let mut custom_paths = BTreeSet::new();
    custom_paths.extend(custom_files.keys().cloned());

    for relative_path in &custom_paths {
        let custom_path = custom_files.get(relative_path).cloned();
        let old_path = old_retail_files.get(relative_path);
        let new_path = new_retail_files.get(relative_path);
        let retail_changed = retail_file_changed(old_path, new_path)?;
        let custom_exists = custom_path.is_some();
        let entry = FolderDiffEntry {
            relative_path: relative_path.clone(),
            zone_name: None,
            diff_tool: DiffToolKind::Entity,
            custom_path: custom_path.map(path_to_string),
            old_retail_path: old_path.cloned().map(path_to_string),
            new_retail_path: new_path.cloned().map(path_to_string),
            custom_exists,
            retail_changed,
        };

        all_files.push(entry.clone());
        if retail_changed {
            changed_files.push(entry);
        }
    }

    Ok(FolderDiffResult {
        scanned_count: custom_paths.len(),
        retail_changed_count: changed_files.len(),
        all_files,
        changed_files,
    })
}

fn collect_candidate_files(root: &Path) -> Result<HashMap<String, PathBuf>> {
    if !root.exists() {
        return Ok(HashMap::new());
    }

    let mut files = HashMap::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_map(|entry| entry.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        let Some(ext) = path.extension().and_then(|ext| ext.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        if ext != "dat" {
            continue;
        }

        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let key = normalize_compare_key(relative);
        files.insert(key, path.to_path_buf());
    }

    Ok(files)
}

fn retail_file_changed(old_path: Option<&PathBuf>, new_path: Option<&PathBuf>) -> Result<bool> {
    let changed = match (old_path, new_path) {
        (Some(old_path), Some(new_path)) => {
            let old_bytes = fs::read(old_path)?;
            let new_bytes = fs::read(new_path)?;
            old_bytes != new_bytes
        }
        (None, None) => false,
        _ => true,
    };

    Ok(changed)
}

fn path_to_string(path: PathBuf) -> String {
    path.display().to_string()
}

fn normalize_compare_key(relative_path: &Path) -> String {
    let components = relative_path
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
