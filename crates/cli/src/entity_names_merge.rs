use std::{
    collections::{BTreeSet, HashMap},
    fs::{self, File},
    io::BufWriter,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, anyhow};
use dats::{dat_format::DatFormat, formats::entity_names::EntityNames};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EntityNamesYaml {
    names: Vec<EntityNameYaml>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EntityNameYaml {
    id: u32,
    name: String,
}

#[derive(Debug, Clone, Serialize)]
struct EntityNameChange {
    source_id: u32,
    target_id: u32,
    previous_name: String,
    migrated_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct UnmappedEditedEntry {
    id: u32,
    name: String,
}

#[derive(Debug, Serialize)]
struct EntityNameMergeReport {
    source_path: String,
    target_path: String,
    baseline_path: Option<String>,
    source_entries: usize,
    target_entries: usize,
    paired_entries: usize,
    source_unmatched: usize,
    target_unmatched: usize,
    transfer_mode: String,
    edited_entries_considered: usize,
    applied_changes: usize,
    already_matching: usize,
    unmapped_edited_entries: usize,
    changes: Vec<EntityNameChange>,
    unmapped_edited: Vec<UnmappedEditedEntry>,
}

#[derive(Debug, Clone)]
struct AlignSourceEntry {
    id: u32,
    name: String,
    source_idx: Option<usize>,
}

#[derive(Debug)]
struct AlignmentResult {
    old_to_new: Vec<Option<usize>>,
    paired: usize,
    old_unmatched: usize,
    new_unmatched: usize,
}

#[derive(Debug)]
struct MergeStats {
    transfer_mode: &'static str,
    paired_entries: usize,
    source_unmatched: usize,
    target_unmatched: usize,
    edited_entries_considered: usize,
    applied_changes: usize,
    already_matching: usize,
    changes: Vec<EntityNameChange>,
    unmapped_edited: Vec<UnmappedEditedEntry>,
}

pub fn migrate_entity_names(
    edited_path: PathBuf,
    retail_path: PathBuf,
    baseline_retail_path: Option<PathBuf>,
    out_path: Option<PathBuf>,
    report_path: Option<PathBuf>,
    out_dat_path: Option<PathBuf>,
) -> Result<()> {
    let old_edited = load_entity_names(&edited_path)
        .with_context(|| format!("Failed to load edited file: {}", edited_path.display()))?;
    let mut new_retail = load_entity_names(&retail_path)
        .with_context(|| format!("Failed to load retail file: {}", retail_path.display()))?;

    ensure_zone_overlap(
        "old edited file",
        &old_edited,
        "new retail file",
        &new_retail,
    )?;

    let old_retail = baseline_retail_path
        .as_ref()
        .map(load_entity_names)
        .transpose()
        .with_context(|| {
            baseline_retail_path
                .as_ref()
                .map(|path| format!("Failed to load baseline retail file: {}", path.display()))
                .unwrap_or_else(|| "Failed to load baseline retail file.".to_string())
        })?;

    if let Some(old_retail_data) = &old_retail {
        ensure_zone_overlap(
            "old retail file",
            old_retail_data,
            "new retail file",
            &new_retail,
        )?;
    }

    let source_entries = old_edited.names.len();
    let target_entries = new_retail.names.len();
    let stats = merge_into_target(&old_edited, old_retail.as_ref(), &mut new_retail);

    let out_path = out_path.unwrap_or_else(|| default_merged_path(&retail_path));
    write_yaml(&out_path, &new_retail)?;

    let report_path = report_path.unwrap_or_else(|| default_report_path(&out_path));
    let report = EntityNameMergeReport {
        source_path: edited_path.display().to_string(),
        target_path: retail_path.display().to_string(),
        baseline_path: baseline_retail_path
            .as_ref()
            .map(|path| path.display().to_string()),
        source_entries,
        target_entries,
        paired_entries: stats.paired_entries,
        source_unmatched: stats.source_unmatched,
        target_unmatched: stats.target_unmatched,
        transfer_mode: stats.transfer_mode.to_string(),
        edited_entries_considered: stats.edited_entries_considered,
        applied_changes: stats.applied_changes,
        already_matching: stats.already_matching,
        unmapped_edited_entries: stats.unmapped_edited.len(),
        changes: stats.changes.clone(),
        unmapped_edited: stats.unmapped_edited.clone(),
    };
    write_report(&report_path, &report)?;

    if let Some(out_dat_path) = out_dat_path {
        write_dat(&out_dat_path, &new_retail)?;
        println!("Wrote merged DAT to: {}", out_dat_path.display());
    }

    println!("Wrote merged YAML to: {}", out_path.display());
    println!("Wrote merge report to: {}", report_path.display());
    println!(
        "Mode: {} | edited considered: {} | applied: {} | unchanged: {} | unmapped edited: {}",
        stats.transfer_mode,
        stats.edited_entries_considered,
        stats.applied_changes,
        stats.already_matching,
        stats.unmapped_edited.len()
    );

    Ok(())
}

fn merge_into_target(
    old_edited: &EntityNamesYaml,
    old_retail: Option<&EntityNamesYaml>,
    new_retail: &mut EntityNamesYaml,
) -> MergeStats {
    let (align_entries, edited_flags, transfer_mode) =
        build_alignment_source(old_edited, old_retail, old_retail.is_some());

    let alignment = align_entity_lists(&align_entries, &new_retail.names);

    let mut edited_entries_considered = 0;
    let mut applied_changes = 0;
    let mut already_matching = 0;
    let mut changes = vec![];
    let mut unmapped_edited = vec![];

    for (old_idx, target_idx) in alignment.old_to_new.iter().enumerate() {
        if !edited_flags[old_idx] {
            continue;
        }

        let Some(source_idx) = align_entries[old_idx].source_idx else {
            continue;
        };

        edited_entries_considered += 1;
        let source_entry = &old_edited.names[source_idx];

        if let Some(target_idx) = target_idx {
            let target_entry = &mut new_retail.names[*target_idx];
            if target_entry.name != source_entry.name {
                changes.push(EntityNameChange {
                    source_id: source_entry.id,
                    target_id: target_entry.id,
                    previous_name: target_entry.name.clone(),
                    migrated_name: source_entry.name.clone(),
                });

                target_entry.name = source_entry.name.clone();
                applied_changes += 1;
            } else {
                already_matching += 1;
            }
        } else {
            unmapped_edited.push(UnmappedEditedEntry {
                id: source_entry.id,
                name: source_entry.name.clone(),
            });
        }
    }

    MergeStats {
        transfer_mode,
        paired_entries: alignment.paired,
        source_unmatched: alignment.old_unmatched,
        target_unmatched: alignment.new_unmatched,
        edited_entries_considered,
        applied_changes,
        already_matching,
        changes,
        unmapped_edited,
    }
}

fn build_alignment_source(
    old_edited: &EntityNamesYaml,
    old_retail: Option<&EntityNamesYaml>,
    edited_only_mode: bool,
) -> (Vec<AlignSourceEntry>, Vec<bool>, &'static str) {
    if let Some(old_retail) = old_retail {
        let mut source_idx_by_id: HashMap<u32, usize> = HashMap::new();
        for (idx, entry) in old_edited.names.iter().enumerate() {
            source_idx_by_id.entry(entry.id).or_insert(idx);
        }

        let mut align_entries = Vec::with_capacity(old_retail.names.len());
        let mut edited_flags = Vec::with_capacity(old_retail.names.len());
        let mut seen_source_ids = BTreeSet::new();

        for baseline in &old_retail.names {
            let source_idx = source_idx_by_id.get(&baseline.id).copied();
            if source_idx.is_some() {
                seen_source_ids.insert(baseline.id);
            }

            align_entries.push(AlignSourceEntry {
                id: baseline.id,
                name: baseline.name.clone(),
                source_idx,
            });

            let is_edited = source_idx
                .map(|idx| old_edited.names[idx].name != baseline.name)
                .unwrap_or(false);
            edited_flags.push(is_edited);
        }

        for (idx, source_entry) in old_edited.names.iter().enumerate() {
            if seen_source_ids.contains(&source_entry.id) {
                continue;
            }

            align_entries.push(AlignSourceEntry {
                id: source_entry.id,
                name: source_entry.name.clone(),
                source_idx: Some(idx),
            });
            edited_flags.push(true);
        }

        return (
            align_entries,
            edited_flags,
            if edited_only_mode {
                "edited_only_with_baseline"
            } else {
                "all_entries"
            },
        );
    }

    let align_entries = old_edited
        .names
        .iter()
        .enumerate()
        .map(|(idx, entry)| AlignSourceEntry {
            id: entry.id,
            name: entry.name.clone(),
            source_idx: Some(idx),
        })
        .collect::<Vec<_>>();
    let edited_flags = vec![true; align_entries.len()];

    (align_entries, edited_flags, "all_entries")
}

fn align_entity_lists(old: &[AlignSourceEntry], new: &[EntityNameYaml]) -> AlignmentResult {
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

    let mut old_to_new = vec![None; n];
    let mut paired = 0;
    let mut old_unmatched = 0;
    let mut new_unmatched = 0;

    let mut i = n;
    let mut j = m;
    while i > 0 || j > 0 {
        let direction = directions[i * width + j];

        if i > 0 && j > 0 && direction == 0 {
            old_to_new[i - 1] = Some(j - 1);
            paired += 1;
            i -= 1;
            j -= 1;
        } else if i > 0 && (j == 0 || direction == 1) {
            old_unmatched += 1;
            i -= 1;
        } else {
            new_unmatched += 1;
            j -= 1;
        }
    }

    AlignmentResult {
        old_to_new,
        paired,
        old_unmatched,
        new_unmatched,
    }
}

fn pair_score(old: &AlignSourceEntry, new: &EntityNameYaml) -> i32 {
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

fn load_entity_names(path: &PathBuf) -> Result<EntityNamesYaml> {
    let bytes = fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "dat" {
        return decode_dat_entity_names(&bytes);
    }

    if let Ok(from_yaml) = serde_yaml::from_slice::<EntityNamesYaml>(&bytes) {
        return Ok(from_yaml);
    }

    decode_dat_entity_names(&bytes).with_context(|| {
        format!(
            "File was neither valid entity-name YAML nor DAT: {}",
            path.display()
        )
    })
}

fn decode_dat_entity_names(bytes: &[u8]) -> Result<EntityNamesYaml> {
    let dat = EntityNames::from_bytes(bytes)?;
    let value = serde_yaml::to_value(dat)?;
    let parsed = serde_yaml::from_value::<EntityNamesYaml>(value)?;
    Ok(parsed)
}

fn write_yaml(path: &PathBuf, data: &EntityNamesYaml) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let file = File::create(path)?;
    serde_yaml::to_writer(BufWriter::new(file), data)?;
    Ok(())
}

fn write_report(path: &PathBuf, report: &EntityNameMergeReport) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let file = File::create(path)?;
    serde_yaml::to_writer(BufWriter::new(file), report)?;
    Ok(())
}

fn write_dat(path: &PathBuf, data: &EntityNamesYaml) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let value = serde_yaml::to_value(data)?;
    let dat: EntityNames = serde_yaml::from_value(value)?;
    let bytes = dat.to_bytes()?;
    fs::write(path, bytes)?;
    Ok(())
}

fn default_merged_path(target_path: &Path) -> PathBuf {
    let parent = target_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = target_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("entity_names");
    parent.join(format!("{stem}.merged.yml"))
}

fn default_report_path(merged_path: &Path) -> PathBuf {
    let parent = merged_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = merged_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("entity_names_merged");
    parent.join(format!("{stem}.merge_report.yml"))
}

fn ensure_zone_overlap(
    left_name: &str,
    left: &EntityNamesYaml,
    right_name: &str,
    right: &EntityNamesYaml,
) -> Result<()> {
    let left_zones = collect_zone_ids(left);
    let right_zones = collect_zone_ids(right);

    if !left_zones.is_empty() && !right_zones.is_empty() && left_zones.is_disjoint(&right_zones) {
        return Err(anyhow!(
            "{} and {} do not appear to reference the same zone IDs: {:?} vs {:?}",
            left_name,
            right_name,
            left_zones,
            right_zones
        ));
    }

    Ok(())
}

fn collect_zone_ids(data: &EntityNamesYaml) -> BTreeSet<u16> {
    data.names
        .iter()
        .filter_map(|entry| {
            if entry.id == 0 {
                None
            } else {
                Some(((entry.id >> 12) & 0x0FFF) as u16)
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{EntityNameYaml, EntityNamesYaml, merge_into_target};

    fn names(ids_and_names: &[(u32, &str)]) -> EntityNamesYaml {
        EntityNamesYaml {
            names: ids_and_names
                .iter()
                .map(|(id, name)| EntityNameYaml {
                    id: *id,
                    name: (*name).to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn aligns_shifted_ids_with_insertions() {
        let old = names(&[(100, "A"), (101, "B"), (102, "C")]);
        let mut new = names(&[(200, "A"), (201, "X"), (202, "B"), (203, "C")]);

        let stats = merge_into_target(&old, None, &mut new);

        let resulting_names = new
            .names
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(resulting_names, vec!["A", "X", "B", "C"]);
        assert_eq!(stats.applied_changes, 0);
        assert_eq!(stats.edited_entries_considered, 3);
    }

    #[test]
    fn baseline_mode_only_carries_actual_edits() {
        let old_retail = names(&[(100, "A"), (101, "B"), (102, "C")]);
        let old_edited = names(&[(100, "A"), (101, "Custom B"), (102, "C")]);
        let mut new_retail = names(&[(300, "A"), (301, "X"), (302, "B"), (303, "C")]);

        let stats = merge_into_target(&old_edited, Some(&old_retail), &mut new_retail);

        let resulting_names = new_retail
            .names
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(resulting_names, vec!["A", "X", "Custom B", "C"]);
        assert_eq!(stats.applied_changes, 1);
        assert_eq!(stats.edited_entries_considered, 1);
    }
}
