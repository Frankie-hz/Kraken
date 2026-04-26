use std::io::BufWriter;
use std::path::Path;
use std::{path::PathBuf, sync::Arc};

use anyhow::Result;
use dats::base::{DatId, DatPath};
use dats::context::DatContext;

use dats::dat_format::DatFormat;
use dats::formats::{
    dialog::Dialog, dmsg_table::DmsgTable, entity_names::EntityNames, events::Events,
    item_info::ItemInfoTable, menu_table::MenuTable, status_info::StatusInfoTable,
    xistring_table::XiStringTable,
};

pub fn export_dat(
    ffxi_path: PathBuf,
    dat_path: Option<PathBuf>,
    dat_id: Option<DatId>,
    out_path: Option<PathBuf>,
) -> Result<()> {
    let (ffxi_path, sub_path) =
        if let Some((prefix, suffix)) = split_pathbuf_at_dir(&ffxi_path, "FINAL FANTASY XI") {
            (prefix, Some(suffix))
        } else {
            (ffxi_path, None)
        };

    if sub_path.is_none() && dat_id.is_none() && dat_path.is_none() {
        eprintln!("Need to specify either path to the DAT or the DAT id.");
        return Ok(());
    }

    let dat_context = Arc::new(DatContext::from_ffxi_path(ffxi_path.clone())?);

    let Some(dat_path) = sub_path
        .and_then(|p| DatPath::from_path(&p).ok())
        .or_else(|| DatPath::from_path(&dat_path?).ok())
        .or_else(|| DatPath::from_path(&dat_context.get_dat_path(dat_id?).ok()?).ok())
    else {
        eprintln!("Did not find a matching DAT to export.");
        return Ok(());
    };

    let dat_path = ffxi_path.join(dat_path.to_path());

    if !dat_path.exists() {
        eprintln!("DAT file not found at: {}", dat_path.display());
        return Ok(());
    }

    let out_path = out_path.unwrap_or_else(|| {
        let mut path = dat_path.clone();
        path = std::env::current_dir()
            .unwrap()
            .join(path.strip_prefix(ffxi_path).unwrap().to_path_buf());
        path.set_extension("yml");
        path
    });

    println!("Writing exported DAT to: {}", out_path.display());
    try_decode(&dat_path, out_path, dat_context.as_ref())?;

    Ok(())
}

fn try_decode(
    dat_path: &PathBuf,
    out_path: PathBuf,
    dat_context: &DatContext,
) -> anyhow::Result<()> {
    if let Ok(data) = DmsgTable::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    if let Ok(data) = Dialog::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    if let Ok(data) = EntityNames::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    if let Ok(data) = Events::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    if let Ok(data) = ItemInfoTable::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    if let Ok(data) = MenuTable::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    if let Ok(data) = StatusInfoTable::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    if let Ok(data) = XiStringTable::from_path(dat_path) {
        let _ = std::fs::create_dir_all(&out_path.parent().unwrap());
        let file = std::fs::File::create(&out_path).unwrap();
        serde_yaml::to_writer(BufWriter::new(file), &data)?;
        return Ok(());
    }

    eprintln!("Failed to find a suitable DAT format.");
    Ok(())
}

fn split_pathbuf_at_dir(path: &Path, dir_name: &str) -> Option<(PathBuf, PathBuf)> {
    let mut prefix_path = PathBuf::new();
    let mut found_dir = false;

    for component in path.components() {
        let component_str = component.as_os_str().to_string_lossy();

        if found_dir {
            let suffix_path: PathBuf = path.strip_prefix(&prefix_path).ok()?.to_path_buf();
            return Some((prefix_path, suffix_path));
        } else {
            prefix_path.push(component);
            if component_str == dir_name {
                found_dir = true;
            }
        }
    }

    if found_dir {
        Some((
            prefix_path.parent()?.to_path_buf(),
            PathBuf::from(path.file_name()?),
        ))
    } else {
        None
    }
}
