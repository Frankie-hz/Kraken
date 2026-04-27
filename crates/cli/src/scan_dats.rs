use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

use anyhow::Result;
use dats::base::{DatId, DatPath};
use dats::context::DatContext;

use dats::dat_format::DatFormat;
use dats::formats::{
    dialog::Dialog, dmsg_table::DmsgTable, entity_names::EntityNames, events::Events,
    item_info::ItemInfoTable, menu_table::MenuTable, old_data_menu_table::OldDataMenuTable,
    status_info::StatusInfoTable, xistring_table::XiStringTable,
};

pub fn scan_dats(ffxi_path: PathBuf) -> Result<()> {
    println!("Scanning FFXI DATs: {}", ffxi_path.display());

    let dat_context = Arc::new(DatContext::from_ffxi_path(ffxi_path.clone())?);

    dat_context
        .id_map
        .iter()
        .collect::<BTreeMap<_, _>>()
        .into_iter()
        .for_each(|(dat_id, dat_path)| {
            try_decode(&ffxi_path, dat_id, dat_path);
        });

    Ok(())
}

macro_rules! try_decoding_with_formats {
    ($id_var:expr, $path_var:expr, $($format_type:ident),+,) => {
        $(
            if $format_type::check_path(&$path_var).is_ok() {
                println!(
                    "{}: {:?} - {}",
                    stringify!($format_type),
                    $id_var,
                    $path_var.display()
                );
                return;
            }
        )*
    };
}

fn try_decode(ffxi_path: &PathBuf, dat_id: &DatId, dat_path: &DatPath) {
    try_decoding_with_formats!(
        dat_id,
        ffxi_path.join(dat_path.to_path()),
        DmsgTable,
        Dialog,
        EntityNames,
        Events,
        ItemInfoTable,
        OldDataMenuTable,
        MenuTable,
        StatusInfoTable,
        XiStringTable,
    );
}
