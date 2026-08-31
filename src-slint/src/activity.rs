use crate::config::AppConfig;
use chrono::{DateTime, Days, Local, TimeZone};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ActivityEntry {
    pub timestamp: i64,
    pub duration_ms: u64,
    #[serde(rename = "notePath")]
    pub note_path: String,
    #[serde(rename = "noteName")]
    pub note_name: String,
    pub saved_at: i64,
    pub end_timestamp: i64,
    pub operation_id: String,
}

#[derive(Default, Deserialize, Serialize)]
struct ActivityHistory {
    entries: Vec<ActivityEntry>,
}

pub fn load_activity(config: &AppConfig) -> Vec<ActivityEntry> {
    let Some(path) = config
        .storage_dir()
        .map(|directory| directory.join("activity.json"))
    else {
        return Vec::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ActivityHistory>(&raw).ok())
        .map(|history| history.entries)
        .unwrap_or_default()
}

pub fn append_activity(
    config: &AppConfig,
    duration_ms: u64,
    note_path: &Path,
    note_name: &str,
    operation_id: &str,
) -> io::Result<()> {
    if duration_ms == 0 {
        return Ok(());
    }
    let Some(directory) = config.storage_dir() else {
        return Ok(());
    };
    fs::create_dir_all(&directory)?;
    let path = directory.join("activity.json");
    let mut history = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<ActivityHistory>(&raw).ok())
        .unwrap_or_default();
    if history
        .entries
        .iter()
        .any(|entry| entry.operation_id == operation_id)
    {
        return Ok(());
    }

    history.entries.extend(split_at_local_midnights(
        duration_ms,
        note_path.to_string_lossy().into_owned(),
        note_name.to_owned(),
        operation_id.to_owned(),
    ));
    write_json_atomically(&path, &history)
}

fn split_at_local_midnights(
    duration_ms: u64,
    note_path: String,
    note_name: String,
    operation_id: String,
) -> Vec<ActivityEntry> {
    let saved_at = Local::now();
    let start_ms = saved_at
        .timestamp_millis()
        .saturating_sub(duration_ms.min(i64::MAX as u64) as i64);
    let mut cursor = Local
        .timestamp_millis_opt(start_ms)
        .single()
        .unwrap_or(saved_at);
    let mut entries = Vec::new();
    while cursor.date_naive() < saved_at.date_naive() {
        let Some(next_date) = cursor.date_naive().checked_add_days(Days::new(1)) else {
            break;
        };
        let Some(next_midnight) = local_midnight(next_date) else {
            break;
        };
        entries.push(entry_for_range(
            cursor,
            next_midnight,
            &note_path,
            &note_name,
            saved_at.timestamp_millis(),
            &operation_id,
        ));
        cursor = next_midnight;
    }
    entries.push(entry_for_range(
        cursor,
        saved_at,
        &note_path,
        &note_name,
        saved_at.timestamp_millis(),
        &operation_id,
    ));
    entries
}

fn local_midnight(date: chrono::NaiveDate) -> Option<DateTime<Local>> {
    let naive = date.and_hms_opt(0, 0, 0)?;
    Local
        .from_local_datetime(&naive)
        .earliest()
        .or_else(|| Local.from_local_datetime(&naive).latest())
}

fn entry_for_range(
    start: DateTime<Local>,
    end: DateTime<Local>,
    note_path: &str,
    note_name: &str,
    saved_at: i64,
    operation_id: &str,
) -> ActivityEntry {
    ActivityEntry {
        timestamp: start.timestamp_millis(),
        duration_ms: end
            .timestamp_millis()
            .saturating_sub(start.timestamp_millis()) as u64,
        note_path: note_path.to_owned(),
        note_name: note_name.to_owned(),
        saved_at,
        end_timestamp: end.timestamp_millis(),
        operation_id: operation_id.to_owned(),
    }
}

fn write_json_atomically(path: &Path, value: &impl Serialize) -> io::Result<()> {
    let temporary = path.with_extension("tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(value).map_err(io::Error::other)?,
    )?;
    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::copy(&temporary, path)?;
        return fs::remove_file(temporary);
    }
    fs::rename(temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midnight_split_preserves_exact_duration() {
        let entries = split_at_local_midnights(
            30 * 60 * 60 * 1_000,
            "/vault/note.md".into(),
            "note".into(),
            "operation".into(),
        );
        assert!(entries.len() >= 2);
        assert_eq!(
            entries.iter().map(|entry| entry.duration_ms).sum::<u64>(),
            30 * 60 * 60 * 1_000
        );
        assert!(
            entries
                .iter()
                .all(|entry| entry.operation_id == "operation")
        );
    }
}
