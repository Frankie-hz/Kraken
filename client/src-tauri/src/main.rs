// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_persistence;
mod cli;
mod commands;
mod dat_query;
mod entity_diff;
mod errors;
mod state;

use cli::check_cli;
use parking_lot::RwLock;
use state::AppStateData;
use tauri::{Manager, image::Image};
use tracing_subscriber::EnvFilter;

// #[cfg(debug_assertions)]
// use specta::collect_types;
// #[cfg(debug_assertions)]
// use tauri_specta::ts;

pub const RAW_DATA_DIR: &'static str = "raw_data";
pub const LOOKUP_TABLE_DIR: &'static str = "lookup_tables";
pub const DAT_GENERATION_DIR: &'static str = "generated_dats";
pub const ZONE_MAPPING_FILE: &'static str = "zones.yml";

fn main() {
    check_cli();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let specta_builder =
        tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
            commands::dummy_event_type_gen,
            commands::select_ffxi_folder,
            commands::select_project_folder,
            commands::load_persistence_data,
            commands::resolve_dat_descriptor_path,
            commands::copy_item_dats_to_project,
            commands::get_misc_dats,
            commands::get_standalone_string_dats,
            commands::get_mission_dats,
            commands::get_quest_dats,
            commands::get_item_dats,
            commands::get_global_dialog_dats,
            commands::browse_dats,
            commands::get_triangle_metadata,
            commands::get_zones_for_type,
            commands::zone_to_wavefront,
            commands::all_zones_to_wavefront,
            commands::get_working_files,
            commands::make_all_dats,
            commands::make_dat,
            commands::make_yaml,
            commands::copy_lookup_tables,
        ]);

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(specta_builder.invoke_handler())
        .invoke_handler(tauri::generate_handler![
            commands::select_ffxi_folder,
            commands::select_project_folder,
            commands::load_persistence_data,
            commands::resolve_dat_descriptor_path,
            commands::copy_item_dats_to_project,
            commands::are_all_item_dats_made_in_project,
            commands::copy_spell_dat_to_project,
            commands::is_spell_dat_made_in_project,
            commands::load_item_editor_data,
            commands::browse_dats,
            commands::get_zones_for_type,
            commands::get_zone_model,
            commands::zone_to_wavefront,
            commands::all_zones_to_wavefront,
            commands::get_triangle_metadata,
            commands::get_misc_dats,
            commands::get_standalone_string_dats,
            commands::get_mission_dats,
            commands::get_quest_dats,
            commands::get_item_dats,
            commands::get_global_dialog_dats,
            commands::get_working_files,
            commands::make_all_dats,
            commands::make_dat,
            commands::make_yaml,
            commands::copy_lookup_tables,
            commands::compare_entity_name_files,
            commands::compare_item_files,
            commands::compare_spell_files,
            commands::save_entity_name_diff,
            commands::save_item_diff,
            commands::save_item_editor_data,
            commands::save_spell_diff,
            commands::compare_entity_name_folders,
        ])
        .setup(|app| {
            let app_state = RwLock::new(AppStateData::new(app));
            app.manage(app_state);

            let window = app.get_webview_window("main").unwrap();
            let app_icon = Image::from_bytes(include_bytes!("../icons/icon.png"))
                .expect("failed to load app icon");
            window.set_icon(app_icon).expect("failed to set app icon");

            #[cfg(debug_assertions)]
            {
                window.open_devtools();
                window.close_devtools();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
