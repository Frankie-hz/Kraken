use std::path::{Path, PathBuf};

use anyhow::{Result, anyhow};
use clap::ValueEnum;
use dats::{
    dat_format::DatFormat,
    formats::item_info::{ItemInfoLayout, ItemInfoTable},
};
use walkdir::WalkDir;

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum ItemLayoutArg {
    Legacy,
    Extended,
}

impl From<ItemLayoutArg> for ItemInfoLayout {
    fn from(value: ItemLayoutArg) -> Self {
        match value {
            ItemLayoutArg::Legacy => ItemInfoLayout::Legacy,
            ItemLayoutArg::Extended => ItemInfoLayout::Extended,
        }
    }
}

pub fn convert_item_layout(
    input: PathBuf,
    output: Option<PathBuf>,
    layout: ItemLayoutArg,
) -> Result<()> {
    let target_layout = ItemInfoLayout::from(layout);

    if input.is_file() {
        let output = output.unwrap_or_else(|| input.clone());
        convert_file(&input, &output, target_layout)?;
        return Ok(());
    }

    if !input.is_dir() {
        return Err(anyhow!("Input path does not exist: {}", input.display()));
    }

    let output_dir = output.unwrap_or_else(|| input.clone());
    let dat_paths: Vec<PathBuf> = WalkDir::new(&input)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("dat"))
        })
        .map(|entry| entry.into_path())
        .collect();

    let mut converted = 0;
    for dat_path in &dat_paths {
        let relative = dat_path.strip_prefix(&input)?;
        let out_path = output_dir.join(relative);

        if !ItemInfoTable::check_path(dat_path).is_ok() {
            println!("Skipping non-item DAT: {}", dat_path.display());
            continue;
        }

        convert_file(dat_path, &out_path, target_layout)?;
        converted += 1;
    }

    println!("Converted {} of {} DATs", converted, dat_paths.len());
    Ok(())
}

fn convert_file(input: &Path, output: &Path, target_layout: ItemInfoLayout) -> Result<()> {
    let mut table = ItemInfoTable::from_path(&input.to_path_buf())
        .map_err(|err| anyhow!("Failed to read {}: {}", input.display(), err))?;

    println!(
        "{}: {:?} -> {:?} ({} items)",
        input.display(),
        table.layout,
        target_layout,
        table.len()
    );

    table.layout = target_layout;
    let bytes = table.to_bytes()?;

    ItemInfoTable::from_bytes(&bytes)
        .map_err(|err| anyhow!("Converted DAT failed to re-parse: {}", err))?;

    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(output, bytes)?;

    Ok(())
}
