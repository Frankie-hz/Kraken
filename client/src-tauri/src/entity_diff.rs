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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpellDiffRow {
    pub row: u32,
    pub old_index: Option<u32>,
    pub old_name: Option<String>,
    pub old_mp_cost: Option<u32>,
    pub old_cast_time: Option<u32>,
    pub old_recast_time: Option<u32>,
    pub old_level_required: Option<HashMap<String, u32>>,
    pub new_index: Option<u32>,
    pub new_name: Option<String>,
    pub new_mp_cost: Option<u32>,
    pub new_cast_time: Option<u32>,
    pub new_recast_time: Option<u32>,
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
pub struct EntityDiffSaveResult {
    pub written_count: usize,
    pub kept_old_count: usize,
    pub kept_new_count: usize,
    pub out_yaml_path: String,
    pub out_dat_path: Option<String>,
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

pub fn compare_item_files(old_path: PathBuf, new_path: PathBuf) -> Result<EntityDiffResult> {
    let old_data = load_item_table(&old_path)?;
    let new_data = load_item_table(&new_path)?;

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

                    let old_id = get_item_id(old_item);
                    let old_name = get_item_name(old_item);
                    let old_stack_size = get_item_stack_size(old_item);
                    let old_flags = get_item_flags(old_item);
                    let old_jobs = get_item_jobs(old_item);
                    let old_description = get_item_description(old_item);
                    let new_id = get_item_id(new_item);
                    let new_name = get_item_name(new_item);
                    let new_stack_size = get_item_stack_size(new_item);
                    let new_flags = get_item_flags(new_item);
                    let new_jobs = get_item_jobs(new_item);
                    let new_description = get_item_description(new_item);

                    let is_changed = old_id != new_id
                        || old_name != new_name
                        || old_stack_size != new_stack_size
                        || old_flags != new_flags
                        || old_jobs != new_jobs
                        || old_description != new_description;
                    if is_changed {
                        changed_count += 1;
                    }

                    EntityDiffRow {
                        row: idx as u32,
                        old_id,
                        old_name,
                        old_stack_size,
                        old_flags,
                        old_jobs,
                        old_description,
                        new_id,
                        new_name,
                        new_stack_size,
                        new_flags,
                        new_jobs,
                        new_description,
                        target_id: new_id.or(old_id),
                        choice: EntityDiffChoice::New,
                    }
                }
                AlignOp::Delete(old_idx) => {
                    let old_item = &old_data.items[*old_idx];
                    let old_id = get_item_id(old_item);
                    let old_name = get_item_name(old_item);
                    let old_stack_size = get_item_stack_size(old_item);
                    let old_flags = get_item_flags(old_item);
                    let old_jobs = get_item_jobs(old_item);
                    let old_description = get_item_description(old_item);
                    changed_count += 1;

                    EntityDiffRow {
                        row: idx as u32,
                        old_id,
                        old_name,
                        old_stack_size,
                        old_flags,
                        old_jobs,
                        old_description,
                        new_id: None,
                        new_name: None,
                        new_stack_size: None,
                        new_flags: None,
                        new_jobs: None,
                        new_description: None,
                        target_id: old_id,
                        choice: EntityDiffChoice::Old,
                    }
                }
                AlignOp::Insert(new_idx) => {
                    let new_item = &new_data.items[*new_idx];
                    let new_id = get_item_id(new_item);
                    let new_name = get_item_name(new_item);
                    let new_stack_size = get_item_stack_size(new_item);
                    let new_flags = get_item_flags(new_item);
                    let new_jobs = get_item_jobs(new_item);
                    let new_description = get_item_description(new_item);
                    changed_count += 1;

                    EntityDiffRow {
                        row: idx as u32,
                        old_id: None,
                        old_name: None,
                        old_stack_size: None,
                        old_flags: None,
                        old_jobs: None,
                        old_description: None,
                        new_id,
                        new_name,
                        new_stack_size,
                        new_flags,
                        new_jobs,
                        new_description,
                        target_id: new_id,
                        choice: EntityDiffChoice::New,
                    }
                }
            };
            row
        })
        .collect::<Vec<_>>();

    Ok(EntityDiffResult {
        rows,
        old_count: old_data.items.len(),
        new_count: new_data.items.len(),
        changed_count,
    })
}

pub fn save_item_diff(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<EntityDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
) -> Result<EntityDiffSaveResult> {
    let old_data = load_item_table(&old_path)?;
    let new_data = load_item_table(&new_path)?;

    let old_entries = align_entries_from_items(&old_data.items);
    let new_entries = align_entries_from_items(&new_data.items);
    let operations = align_operations(&old_entries, &new_entries);

    let row_lookup = rows
        .into_iter()
        .map(|row| (row.row, row))
        .collect::<HashMap<_, _>>();

    let mut merged_items = Vec::with_capacity(operations.len());
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

        let requested_choice = row.map(|row| row.choice).unwrap_or_else(|| match op {
            AlignOp::Delete(_) => EntityDiffChoice::Old,
            _ => EntityDiffChoice::New,
        });

        let (mut selected_item, effective_choice) = match requested_choice {
            EntityDiffChoice::Old => {
                if let Some(item) = old_item {
                    (item, EntityDiffChoice::Old)
                } else if let Some(item) = new_item {
                    (item, EntityDiffChoice::New)
                } else {
                    continue;
                }
            }
            EntityDiffChoice::New => {
                if let Some(item) = new_item {
                    (item, EntityDiffChoice::New)
                } else if let Some(item) = old_item {
                    (item, EntityDiffChoice::Old)
                } else {
                    continue;
                }
            }
        };

        let chosen_id = row
            .and_then(|row| match effective_choice {
                EntityDiffChoice::Old => row.old_id,
                EntityDiffChoice::New => row.new_id,
            })
            .or_else(|| get_item_id(&selected_item));
        if let Some(chosen_id) = chosen_id {
            set_item_id(&mut selected_item, chosen_id);
        }

        let chosen_name = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_name.clone(),
            EntityDiffChoice::New => row.new_name.clone(),
        });
        if let Some(name) = chosen_name {
            set_item_name(&mut selected_item, name);
        }

        let chosen_stack_size = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_stack_size,
            EntityDiffChoice::New => row.new_stack_size,
        });
        if let Some(stack_size) = chosen_stack_size {
            set_item_stack_size(&mut selected_item, stack_size);
        }

        let chosen_flags = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_flags.clone(),
            EntityDiffChoice::New => row.new_flags.clone(),
        });
        if let Some(flags) = chosen_flags {
            set_item_flags(&mut selected_item, &flags);
        }

        let chosen_jobs = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_jobs.clone(),
            EntityDiffChoice::New => row.new_jobs.clone(),
        });
        if let Some(jobs) = chosen_jobs {
            set_item_jobs(&mut selected_item, &jobs);
        }

        let chosen_description = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_description.clone(),
            EntityDiffChoice::New => row.new_description.clone(),
        });
        if let Some(description) = chosen_description {
            set_item_description(&mut selected_item, description);
        }

        match effective_choice {
            EntityDiffChoice::Old => kept_old_count += 1,
            EntityDiffChoice::New => kept_new_count += 1,
        }
        merged_items.push(selected_item);
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

    Ok(EntityDiffSaveResult {
        written_count: merged.items.len(),
        kept_old_count,
        kept_new_count,
        out_yaml_path: out_yaml_path.display().to_string(),
        out_dat_path: written_dat,
    })
}

pub fn compare_spell_files(old_path: PathBuf, new_path: PathBuf) -> Result<SpellDiffResult> {
    let old_data = load_spell_table(&old_path)?;
    let new_data = load_spell_table(&new_path)?;
    let (spell_names, ability_names) = load_spell_and_ability_name_maps(&old_path, &new_path);

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
                    let old_name = resolve_spell_name(old_spell, &spell_names, &ability_names);
                    let old_mp_cost = get_spell_mp_cost(old_spell);
                    let old_cast_time = get_spell_cast_time(old_spell);
                    let old_recast_time = get_spell_recast_time(old_spell);
                    let old_level_required = get_spell_level_required(old_spell);

                    let new_index = get_spell_index(new_spell);
                    let new_name = resolve_spell_name(new_spell, &spell_names, &ability_names);
                    let new_mp_cost = get_spell_mp_cost(new_spell);
                    let new_cast_time = get_spell_cast_time(new_spell);
                    let new_recast_time = get_spell_recast_time(new_spell);
                    let new_level_required = get_spell_level_required(new_spell);

                    let is_changed = old_index != new_index
                        || old_mp_cost != new_mp_cost
                        || old_cast_time != new_cast_time
                        || old_recast_time != new_recast_time
                        || old_level_required != new_level_required;
                    if is_changed {
                        changed_count += 1;
                    }

                    SpellDiffRow {
                        row: idx as u32,
                        old_index,
                        old_name,
                        old_mp_cost,
                        old_cast_time,
                        old_recast_time,
                        old_level_required,
                        new_index,
                        new_name,
                        new_mp_cost,
                        new_cast_time,
                        new_recast_time,
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
                        old_name: resolve_spell_name(old_spell, &spell_names, &ability_names),
                        old_mp_cost: get_spell_mp_cost(old_spell),
                        old_cast_time: get_spell_cast_time(old_spell),
                        old_recast_time: get_spell_recast_time(old_spell),
                        old_level_required: get_spell_level_required(old_spell),
                        new_index: None,
                        new_name: None,
                        new_mp_cost: None,
                        new_cast_time: None,
                        new_recast_time: None,
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
                        old_mp_cost: None,
                        old_cast_time: None,
                        old_recast_time: None,
                        old_level_required: None,
                        new_index,
                        new_name: resolve_spell_name(new_spell, &spell_names, &ability_names),
                        new_mp_cost: get_spell_mp_cost(new_spell),
                        new_cast_time: get_spell_cast_time(new_spell),
                        new_recast_time: get_spell_recast_time(new_spell),
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

pub fn save_spell_diff(
    old_path: PathBuf,
    new_path: PathBuf,
    rows: Vec<SpellDiffRow>,
    out_yaml_path: PathBuf,
    out_dat_path: Option<PathBuf>,
) -> Result<EntityDiffSaveResult> {
    let old_data = load_spell_table(&old_path)?;
    let mut new_data = load_spell_table(&new_path)?;

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

        let chosen_name = row.and_then(|row| match effective_choice {
            EntityDiffChoice::Old => row.old_name.clone(),
            EntityDiffChoice::New => row.new_name.clone(),
        });
        if let Some(name) = chosen_name {
            set_spell_name(&mut selected_spell, name);
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
    set_spell_entries(&mut new_data, merged_spells)?;

    if let Some(parent) = out_yaml_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let yaml_file = File::create(&out_yaml_path)?;
    serde_yaml::to_writer(BufWriter::new(yaml_file), &new_data)?;

    let written_dat = if let Some(dat_path) = out_dat_path {
        if let Some(parent) = dat_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let dat: MenuTable = serde_yaml::from_value(new_data)?;
        let bytes = dat.to_bytes()?;
        fs::write(&dat_path, bytes)?;

        Some(dat_path.display().to_string())
    } else {
        None
    };

    Ok(EntityDiffSaveResult {
        written_count: merged_count,
        kept_old_count,
        kept_new_count,
        out_yaml_path: out_yaml_path.display().to_string(),
        out_dat_path: written_dat,
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
    let mapping = item.as_mapping()?;
    let strings_key = Value::String("strings".to_string());
    let strings_value = mapping.get(&strings_key)?;
    let strings_mapping = strings_value.as_mapping()?;
    let name_key = Value::String("name".to_string());
    let name_value = strings_mapping.get(&name_key)?;
    name_value.as_str().map(|name| name.to_string())
}

fn set_item_name(item: &mut Value, name: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let strings_key = Value::String("strings".to_string());
    let name_key = Value::String("name".to_string());

    if let Some(strings_value) = mapping.get_mut(&strings_key) {
        if let Some(strings_mapping) = strings_value.as_mapping_mut() {
            strings_mapping.insert(name_key, Value::String(name));
            return true;
        }
    }

    let mut strings_mapping = Mapping::new();
    strings_mapping.insert(name_key, Value::String(name));
    mapping.insert(strings_key, Value::Mapping(strings_mapping));
    true
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

fn get_item_description(item: &Value) -> Option<String> {
    let mapping = item.as_mapping()?;
    let strings_key = Value::String("strings".to_string());
    let strings_value = mapping.get(&strings_key)?;
    let strings_mapping = strings_value.as_mapping()?;
    let description_key = Value::String("description".to_string());
    let description_value = strings_mapping.get(&description_key)?;
    description_value
        .as_str()
        .map(|description| description.to_string())
}

fn set_item_description(item: &mut Value, description: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };

    let strings_key = Value::String("strings".to_string());
    let description_key = Value::String("description".to_string());

    let Some(strings_value) = mapping.get_mut(&strings_key) else {
        return false;
    };
    let Some(strings_mapping) = strings_value.as_mapping_mut() else {
        return false;
    };

    strings_mapping.insert(description_key, Value::String(description));
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

fn get_spell_id(item: &Value) -> Option<u32> {
    get_spell_u32(item, "id")
}

fn get_spell_mp_cost(item: &Value) -> Option<u32> {
    get_spell_u32(item, "mp_cost")
}

fn set_spell_u32(item: &mut Value, key: &str, value: u32) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    mapping.insert(Value::String(key.to_string()), Value::Number(value.into()));
    true
}

fn set_spell_name(item: &mut Value, name: String) -> bool {
    let Some(mapping) = item.as_mapping_mut() else {
        return false;
    };
    mapping.insert(Value::String("name".to_string()), Value::String(name));
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

fn resolve_spell_name(
    spell: &Value,
    spell_names: &HashMap<u32, String>,
    ability_names: &HashMap<u32, String>,
) -> Option<String> {
    get_spell_name(spell)
        .or_else(|| get_spell_index(spell).and_then(|index| spell_names.get(&index).cloned()))
        .or_else(|| get_spell_id(spell).and_then(|id| spell_names.get(&id).cloned()))
        .or_else(|| get_spell_id(spell).and_then(|id| ability_names.get(&id).cloned()))
}

fn load_spell_and_ability_name_maps(
    old_path: &Path,
    new_path: &Path,
) -> (HashMap<u32, String>, HashMap<u32, String>) {
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
            let spell_names = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55702u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();

            let ability_names = dat_context
                .get_data_from_dat(&Dat::<DmsgTable>::from(55701u32))
                .ok()
                .map(|data| dmsg_first_string_map(&data.dat))
                .unwrap_or_default();

            if !spell_names.is_empty() || !ability_names.is_empty() {
                return (spell_names, ability_names);
            }
        }
    }

    (HashMap::new(), HashMap::new())
}

fn find_ffxi_root_from_path(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|ancestor| ancestor.join("VTABLE.DAT").exists())
        .map(Path::to_path_buf)
}

fn dmsg_first_string_map(table: &DmsgTable) -> HashMap<u32, String> {
    table
        .lists
        .iter()
        .filter_map(|(id, list)| {
            list.content.iter().find_map(|entry| match entry {
                DmsgContent::String { string } if !string.is_empty() => Some((*id, string.clone())),
                _ => None,
            })
        })
        .collect()
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

    if old.name == new.name {
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
