use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TimerCheckpoint {
    pub note_path: String,
    pub name: String,
    pub elapsed_ms: u64,
    pub color_argb: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct AppConfig {
    pub vault_path: Option<PathBuf>,
    pub frontmatter_key: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            vault_path: None,
            frontmatter_key: "Timework".into(),
        }
    }
}

impl AppConfig {
    pub fn load() -> Self {
        let Some(path) = config_path() else {
            return Self::default();
        };
        fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) -> io::Result<()> {
        let path =
            config_path().ok_or_else(|| io::Error::other("není dostupná složka konfigurace"))?;
        write_json(&path, self)
    }
}

pub fn load_timer_checkpoints() -> Vec<TimerCheckpoint> {
    let Some(path) = recovery_path() else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_timer_checkpoints(checkpoints: &[TimerCheckpoint]) -> io::Result<()> {
    let path = recovery_path()
        .ok_or_else(|| io::Error::other("není dostupná složka pro obnovu časomír"))?;
    write_json(&path, &checkpoints)
}

fn write_json(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("konfigurační soubor nemá nadřazenou složku"))?;
    fs::create_dir_all(parent)?;
    let encoded = serde_json::to_vec_pretty(value).map_err(io::Error::other)?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, encoded)?;
    replace_file(&temporary, path)
}

fn replace_file(temporary: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    if destination.exists() {
        fs::copy(temporary, destination)?;
        return fs::remove_file(temporary);
    }
    fs::rename(temporary, destination)
}

fn config_path() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA").map(PathBuf::from);
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")));

    base.map(|path| path.join("mmstopwatch-native").join("config.json"))
}

fn recovery_path() -> Option<PathBuf> {
    config_path().map(|path| path.with_file_name("timers.json"))
}
