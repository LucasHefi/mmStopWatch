use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TimerLayout {
    pub mode: String,
    pub order: Vec<String>,
}

impl Default for TimerLayout {
    fn default() -> Self {
        Self {
            mode: "list".into(),
            order: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Notifications {
    pub enabled: bool,
    pub interval_minutes: u32,
}

impl Default for Notifications {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_minutes: 60,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TimerCheckpoint {
    pub note_path: String,
    pub name: String,
    pub elapsed_ms: u64,
    pub color_argb: u32,
    #[serde(default)]
    pub base_elapsed_ms: u64,
    #[serde(default)]
    pub time_estimate_minutes: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(rename = "notesFolder", alias = "vault_path")]
    pub vault_path: Option<PathBuf>,
    pub frontmatter_key: String,
    pub time_estimate_key: String,
    pub time_format: String,
    pub language: String,
    pub nick: Option<String>,
    pub onboarding_complete: bool,
    pub pinned_notes: Vec<String>,
    pub daily_goal_ms: u64,
    pub auto_refresh_interval: u32,
    pub obsidian_vault: String,
    pub stats_field_keys: Vec<String>,
    pub timer_view_mode: String,
    pub timer_layout: TimerLayout,
    pub notifications: Notifications,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            vault_path: None,
            frontmatter_key: "Timework".into(),
            time_estimate_key: "timeEstimate".into(),
            time_format: "HH:mm:ss".into(),
            language: "cs".into(),
            nick: None,
            onboarding_complete: false,
            pinned_notes: Vec::new(),
            daily_goal_ms: 28_800_000,
            auto_refresh_interval: 10,
            obsidian_vault: String::new(),
            stats_field_keys: vec!["project".into(), "client".into(), "type".into()],
            timer_view_mode: "cards".into(),
            timer_layout: TimerLayout::default(),
            notifications: Notifications::default(),
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

    pub fn adopt_vault(&mut self, vault: PathBuf) -> io::Result<()> {
        if let Some(mut imported) = load_vault_profile(&vault) {
            imported.vault_path = Some(vault);
            *self = imported;
        } else {
            self.vault_path = Some(vault);
        }
        self.save()
    }

    pub fn storage_dir(&self) -> Option<PathBuf> {
        let root = self.vault_path.as_ref()?;
        if let Some(nick) = self.nick.as_deref().filter(|nick| valid_profile_key(nick)) {
            return Some(root.join(format!(".mmST-{nick}")));
        }
        discover_profile_dirs(root).into_iter().next()
    }

    pub fn save_profile(&self) -> io::Result<()> {
        let Some(directory) = self.storage_dir() else {
            return Ok(());
        };
        fs::create_dir_all(&directory)?;
        let path = directory.join("config.json");
        let mut document = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .filter(serde_json::Value::is_object)
            .unwrap_or_else(|| serde_json::json!({}));
        let known = serde_json::to_value(self).map_err(io::Error::other)?;
        if let (Some(target), Some(source)) = (document.as_object_mut(), known.as_object()) {
            for (key, value) in source {
                target.insert(key.clone(), value.clone());
            }
        }
        write_json(&path, &document)
    }

    pub fn available_profiles(&self) -> Vec<AppConfig> {
        let Some(vault) = self.vault_path.as_deref() else {
            return Vec::new();
        };
        discover_profile_dirs(vault)
            .into_iter()
            .filter_map(|directory| load_profile_directory(vault, &directory))
            .collect()
    }

    pub fn switch_profile(&mut self, nick: &str) -> io::Result<()> {
        let vault = self
            .vault_path
            .clone()
            .ok_or_else(|| io::Error::other("není vybraný vault"))?;
        let profile = self
            .available_profiles()
            .into_iter()
            .find(|profile| profile.nick.as_deref() == Some(nick))
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "profil neexistuje"))?;
        *self = profile;
        self.vault_path = Some(vault);
        self.save()
    }
}

fn load_vault_profile(vault: &Path) -> Option<AppConfig> {
    for directory in discover_profile_dirs(vault) {
        if let Some(config) = load_profile_directory(vault, &directory) {
            return Some(config);
        }
    }
    None
}

fn load_profile_directory(vault: &Path, directory: &Path) -> Option<AppConfig> {
    let raw = fs::read_to_string(directory.join("config.json")).ok()?;
    let mut config = serde_json::from_str::<AppConfig>(&raw).ok()?;
    config.vault_path = Some(vault.to_path_buf());
    if config.nick.is_none() {
        config.nick = directory
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix(".mmST-"))
            .map(str::to_owned);
    }
    Some(config)
}

fn discover_profile_dirs(vault: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(vault) else {
        return Vec::new();
    };
    let mut directories = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(".mmST-"))
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    directories.sort();
    directories
}

fn valid_profile_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn imports_existing_react_vault_configuration() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let vault = std::env::temp_dir().join(format!("mmst-config-{nonce}"));
        let profile = vault.join(".mmST-lhefn");
        fs::create_dir_all(&profile).expect("profile directory");
        fs::write(
            profile.join("config.json"),
            r#"{"notesFolder":"D:\\old-path","nick":"lhefn","frontmatterKey":"Work","timeEstimateKey":"estimate","dailyGoalMs":7200000,"unknownFutureField":true}"#,
        )
        .expect("config fixture");

        let imported = load_vault_profile(&vault).expect("import profile");
        assert_eq!(imported.nick.as_deref(), Some("lhefn"));
        assert_eq!(imported.frontmatter_key, "Work");
        assert_eq!(imported.time_estimate_key, "estimate");
        assert_eq!(imported.daily_goal_ms, 7_200_000);
        let mut imported = imported;
        imported.vault_path = Some(vault.clone());
        imported.language = "de".into();
        imported.save_profile().expect("merge profile config");
        let merged: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(profile.join("config.json")).expect("read merged config"),
        )
        .expect("parse merged config");
        assert_eq!(merged["language"], "de");
        assert_eq!(merged["unknownFutureField"], true);
        let mut second = imported.clone();
        second.nick = Some("second".into());
        second.save_profile().expect("create second profile");
        let profiles = imported.available_profiles();
        assert_eq!(profiles.len(), 2);
        assert!(
            profiles
                .iter()
                .any(|profile| profile.nick.as_deref() == Some("second"))
        );
        fs::remove_dir_all(vault).expect("remove fixture");
    }
}
