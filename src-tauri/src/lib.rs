use std::path::PathBuf;

use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn authorize_folder<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    let folder = PathBuf::from(path.trim());
    if !folder.is_absolute() {
        return Err("Notes folder must be an absolute path".to_owned());
    }
    if !folder.is_dir() {
        return Err("Notes folder does not exist or is not a directory".to_owned());
    }

    let canonical = folder
        .canonicalize()
        .map_err(|_| "Notes folder could not be resolved".to_owned())?;
    app.fs_scope()
        .allow_directory(canonical, true)
        .map_err(|_| "Notes folder could not be authorized".to_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![greet, authorize_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
