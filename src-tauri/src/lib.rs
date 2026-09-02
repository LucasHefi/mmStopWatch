use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

fn validate_profile_key(value: &str) -> Result<String, String> {
    let key = value.trim();
    if key.is_empty()
        || key.chars().count() > 80
        || key.chars().any(char::is_control)
        || key.contains('/')
        || key.contains('\\')
        || key == "."
        || key == ".."
        || key.contains("..")
    {
        return Err("Profile key contains unsafe characters".to_owned());
    }
    Ok(key.to_owned())
}

#[tauri::command]
fn authorize_folder<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    profile_key: Option<String>,
) -> Result<(), String> {
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
    let scope = app.fs_scope();
    scope
        .allow_directory(&canonical, true)
        .map_err(|_| "Notes folder could not be authorized".to_owned())?;

    // The recursive dynamic scope contains a glob pattern. On Unix a wildcard
    // does not match a hidden component, so authorize the app-owned profile
    // directory with a literal path as well, before it exists. This keeps the
    // vault runtime-scoped without granting static home-directory access.
    if let Some(profile_key) = profile_key {
        let profile_key = validate_profile_key(&profile_key)?;
        let profile_dir = canonical.join(format!(".mmST-{profile_key}"));
        scope
            .allow_directory(profile_dir, true)
            .map_err(|_| "Profile directory could not be authorized".to_owned())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            #[cfg(target_os = "linux")]
            if let Some(main_window) = app.get_webview_window("main") {
                main_window.with_webview(|webview| {
                    use webkit2gtk::{SettingsExt, WebViewExt};

                    if let Some(settings) = webview.inner().settings() {
                        settings.set_enable_encrypted_media(false);
                        settings.set_enable_html5_database(false);
                        settings.set_enable_media_capabilities(false);
                        settings.set_enable_media_stream(false);
                        settings.set_enable_mediasource(false);
                        settings.set_enable_offline_web_application_cache(false);
                        settings.set_enable_page_cache(false);
                        settings.set_enable_webaudio(false);
                        settings.set_enable_webgl(false);
                    }
                })?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![authorize_folder])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
