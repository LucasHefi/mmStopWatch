use crate::{config::AppConfig, database};
use chrono::{DateTime, Days, Local, TimeZone};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Deserializer, Serialize, de};
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const ACTIVITY_SCHEMA_VERSION: i64 = 1;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ActivityEntry {
    #[serde(deserialize_with = "deserialize_timestamp_ms")]
    pub timestamp: i64,
    #[serde(deserialize_with = "deserialize_duration_ms")]
    pub duration_ms: u64,
    #[serde(rename = "notePath")]
    pub note_path: String,
    #[serde(rename = "noteName")]
    pub note_name: String,
    #[serde(default, alias = "savedAt")]
    pub saved_at: i64,
    #[serde(default, alias = "endTimestamp")]
    pub end_timestamp: i64,
    #[serde(default, alias = "operationId")]
    pub operation_id: String,
}

fn deserialize_timestamp_ms<'de, D>(deserializer: D) -> Result<i64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum TimestampValue {
        Integer(i64),
        Float(f64),
    }

    match TimestampValue::deserialize(deserializer)? {
        TimestampValue::Integer(value) => Ok(value),
        TimestampValue::Float(value) if value.is_finite() => {
            Ok(value.round().clamp(i64::MIN as f64, i64::MAX as f64) as i64)
        }
        TimestampValue::Float(_) => Err(de::Error::custom("timestamp musí být konečné číslo")),
    }
}

fn deserialize_duration_ms<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum DurationValue {
        Integer(u64),
        Float(f64),
    }

    match DurationValue::deserialize(deserializer)? {
        DurationValue::Integer(value) => Ok(value),
        DurationValue::Float(value) if value.is_finite() && value >= 0.0 => {
            Ok(value.round().min(u64::MAX as f64) as u64)
        }
        DurationValue::Float(_) => Err(de::Error::custom("duration_ms musí být nezáporné číslo")),
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ActivitySummary {
    pub count: usize,
    pub total_ms: u64,
    pub average_ms: u64,
    pub longest_ms: u64,
    pub first_timestamp: Option<i64>,
    pub last_timestamp: Option<i64>,
}

#[derive(Default, Deserialize, Serialize)]
struct ActivityHistory {
    entries: Vec<ActivityEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SourceSignature {
    size_bytes: i64,
    modified_ns: i64,
}

struct ProjectionContext {
    activity_path: PathBuf,
    database_path: PathBuf,
    profile_key: String,
}

pub fn load_activity(config: &AppConfig) -> Vec<ActivityEntry> {
    load_activity_range(config, None, None)
}

pub fn load_activity_range(
    config: &AppConfig,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> Vec<ActivityEntry> {
    try_load_activity_range(config, from_timestamp, to_timestamp, None).unwrap_or_else(|_| {
        read_history_for_config(config)
            .map(|history| {
                history
                    .entries
                    .into_iter()
                    .filter(|entry| {
                        from_timestamp.is_none_or(|from| entry.timestamp >= from)
                            && to_timestamp.is_none_or(|to| entry.timestamp < to)
                    })
                    .collect()
            })
            .unwrap_or_default()
    })
}

pub fn activity_summary(
    config: &AppConfig,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> ActivitySummary {
    try_activity_summary(config, from_timestamp, to_timestamp, None)
        .unwrap_or_else(|_| summarize(&load_activity_range(config, from_timestamp, to_timestamp)))
}

pub fn append_activity(
    config: &AppConfig,
    duration_ms: u64,
    note_path: &Path,
    note_name: &str,
    operation_id: &str,
) -> io::Result<()> {
    append_activity_with_database(
        config,
        duration_ms,
        note_path,
        note_name,
        operation_id,
        None,
    )
}

fn append_activity_with_database(
    config: &AppConfig,
    duration_ms: u64,
    note_path: &Path,
    note_name: &str,
    operation_id: &str,
    database_directory: Option<&Path>,
) -> io::Result<()> {
    if duration_ms == 0 {
        return Ok(());
    }
    let Some(directory) = config.storage_dir() else {
        return Ok(());
    };
    fs::create_dir_all(&directory)?;
    let path = directory.join("activity.json");
    let mut history = read_history(&path).unwrap_or_default();
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
    write_json_atomically(&path, &history)?;

    // JSON is the portable source of truth. A projection failure must not make
    // a successfully persisted timer look failed; the next read repairs it.
    let _ = synchronize_projection(config, &history, database_directory);
    Ok(())
}

fn try_load_activity_range(
    config: &AppConfig,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    database_directory: Option<&Path>,
) -> io::Result<Vec<ActivityEntry>> {
    let context = projection_context(config, database_directory)?;
    let mut connection = open_initialized_projection(&context.database_path)?;
    synchronize_if_changed(&mut connection, &context)?;
    query_entries(
        &connection,
        &context.profile_key,
        from_timestamp,
        to_timestamp,
    )
}

fn try_activity_summary(
    config: &AppConfig,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
    database_directory: Option<&Path>,
) -> io::Result<ActivitySummary> {
    let context = projection_context(config, database_directory)?;
    let mut connection = open_initialized_projection(&context.database_path)?;
    synchronize_if_changed(&mut connection, &context)?;
    connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(duration_ms), 0),
                    COALESCE(AVG(duration_ms), 0), COALESCE(MAX(duration_ms), 0),
                    MIN(timestamp), MAX(timestamp)
             FROM activity_entries
             WHERE profile_key = ?1
               AND (?2 IS NULL OR timestamp >= ?2)
               AND (?3 IS NULL OR timestamp < ?3)",
            params![context.profile_key, from_timestamp, to_timestamp],
            |row| {
                Ok(ActivitySummary {
                    count: usize::try_from(row.get::<_, i64>(0)?.max(0)).unwrap_or(usize::MAX),
                    total_ms: u64::try_from(row.get::<_, i64>(1)?.max(0)).unwrap_or(u64::MAX),
                    average_ms: row.get::<_, f64>(2)?.max(0.0) as u64,
                    longest_ms: u64::try_from(row.get::<_, i64>(3)?.max(0)).unwrap_or(u64::MAX),
                    first_timestamp: row.get(4)?,
                    last_timestamp: row.get(5)?,
                })
            },
        )
        .map_err(database::sql_error)
}

fn projection_context(
    config: &AppConfig,
    database_directory: Option<&Path>,
) -> io::Result<ProjectionContext> {
    let root = config
        .vault_path
        .as_deref()
        .ok_or_else(|| io::Error::other("není vybraný vault"))?
        .canonicalize()?;
    let storage_directory = config
        .storage_dir()
        .ok_or_else(|| io::Error::other("není vybraný profil"))?;
    let database_directory = database_directory
        .map(Path::to_path_buf)
        .or_else(database::data_directory)
        .ok_or_else(|| io::Error::other("není dostupná lokální složka pro databázi"))?;
    fs::create_dir_all(&database_directory)?;
    let profile_key = storage_directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(".mmST-default")
        .to_owned();
    Ok(ProjectionContext {
        activity_path: storage_directory.join("activity.json"),
        database_path: database::path_for_vault(&database_directory, &root),
        profile_key,
    })
}

fn open_projection_database(path: &Path) -> io::Result<Connection> {
    match database::open(path) {
        Ok(connection) => Ok(connection),
        Err(error) if path.exists() => {
            database::quarantine(path)?;
            database::open(path).map_err(|_| error)
        }
        Err(error) => Err(error),
    }
}

fn open_initialized_projection(path: &Path) -> io::Result<Connection> {
    let mut connection = open_projection_database(path)?;
    if initialize_activity_schema(&mut connection).is_ok() {
        return Ok(connection);
    }
    drop(connection);
    database::quarantine(path)?;
    let mut connection = database::open(path)?;
    initialize_activity_schema(&mut connection)?;
    Ok(connection)
}

fn initialize_activity_schema(connection: &mut Connection) -> io::Result<()> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS activity_projection_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(database::sql_error)?;
    let stored_version = connection
        .query_row(
            "SELECT value FROM activity_projection_meta WHERE key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(database::sql_error)?
        .and_then(|value| value.parse::<i64>().ok());
    if stored_version != Some(ACTIVITY_SCHEMA_VERSION) {
        connection
            .execute_batch(
                "DROP TABLE IF EXISTS activity_entries;
                 DROP TABLE IF EXISTS activity_sources;",
            )
            .map_err(database::sql_error)?;
    }
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS activity_entries (
                profile_key TEXT NOT NULL,
                entry_order INTEGER NOT NULL,
                timestamp INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                note_path TEXT NOT NULL,
                note_name TEXT NOT NULL,
                saved_at INTEGER NOT NULL,
                end_timestamp INTEGER NOT NULL,
                operation_id TEXT NOT NULL,
                PRIMARY KEY(profile_key, entry_order)
            );
            CREATE INDEX IF NOT EXISTS activity_timestamp_index
                ON activity_entries(profile_key, timestamp);
            CREATE INDEX IF NOT EXISTS activity_note_index
                ON activity_entries(profile_key, note_path);
            CREATE INDEX IF NOT EXISTS activity_operation_index
                ON activity_entries(profile_key, operation_id);
            CREATE TABLE IF NOT EXISTS activity_sources (
                profile_key TEXT PRIMARY KEY,
                size_bytes INTEGER NOT NULL,
                modified_ns INTEGER NOT NULL
            );",
        )
        .map_err(database::sql_error)?;
    connection
        .execute(
            "INSERT INTO activity_projection_meta(key, value) VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![ACTIVITY_SCHEMA_VERSION.to_string()],
        )
        .map_err(database::sql_error)?;
    Ok(())
}

fn synchronize_if_changed(
    connection: &mut Connection,
    context: &ProjectionContext,
) -> io::Result<()> {
    let signature = source_signature(&context.activity_path)?;
    let stored = connection
        .query_row(
            "SELECT size_bytes, modified_ns FROM activity_sources WHERE profile_key = ?1",
            params![context.profile_key],
            |row| {
                Ok(SourceSignature {
                    size_bytes: row.get(0)?,
                    modified_ns: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(database::sql_error)?;
    if stored == Some(signature) {
        return Ok(());
    }
    let history = read_history(&context.activity_path)?;
    replace_projection(connection, &context.profile_key, &history, signature)
}

fn synchronize_projection(
    config: &AppConfig,
    history: &ActivityHistory,
    database_directory: Option<&Path>,
) -> io::Result<()> {
    let context = projection_context(config, database_directory)?;
    let mut connection = open_initialized_projection(&context.database_path)?;
    let signature = source_signature(&context.activity_path)?;
    replace_projection(&mut connection, &context.profile_key, history, signature)
}

fn replace_projection(
    connection: &mut Connection,
    profile_key: &str,
    history: &ActivityHistory,
    signature: SourceSignature,
) -> io::Result<()> {
    let transaction = connection.transaction().map_err(database::sql_error)?;
    transaction
        .execute(
            "DELETE FROM activity_entries WHERE profile_key = ?1",
            params![profile_key],
        )
        .map_err(database::sql_error)?;
    {
        let mut statement = transaction
            .prepare_cached(
                "INSERT INTO activity_entries (
                    profile_key, entry_order, timestamp, duration_ms, note_path,
                    note_name, saved_at, end_timestamp, operation_id
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )
            .map_err(database::sql_error)?;
        for (index, entry) in history.entries.iter().enumerate() {
            statement
                .execute(params![
                    profile_key,
                    i64::try_from(index).unwrap_or(i64::MAX),
                    entry.timestamp,
                    i64::try_from(entry.duration_ms).unwrap_or(i64::MAX),
                    entry.note_path,
                    entry.note_name,
                    entry.saved_at,
                    entry.end_timestamp,
                    entry.operation_id,
                ])
                .map_err(database::sql_error)?;
        }
    }
    transaction
        .execute(
            "INSERT INTO activity_sources(profile_key, size_bytes, modified_ns)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(profile_key) DO UPDATE SET
                size_bytes = excluded.size_bytes,
                modified_ns = excluded.modified_ns",
            params![profile_key, signature.size_bytes, signature.modified_ns],
        )
        .map_err(database::sql_error)?;
    transaction.commit().map_err(database::sql_error)
}

fn query_entries(
    connection: &Connection,
    profile_key: &str,
    from_timestamp: Option<i64>,
    to_timestamp: Option<i64>,
) -> io::Result<Vec<ActivityEntry>> {
    let mut statement = connection
        .prepare(
            "SELECT timestamp, duration_ms, note_path, note_name, saved_at,
                    end_timestamp, operation_id
             FROM activity_entries
             WHERE profile_key = ?1
               AND (?2 IS NULL OR timestamp >= ?2)
               AND (?3 IS NULL OR timestamp < ?3)
             ORDER BY entry_order",
        )
        .map_err(database::sql_error)?;
    let rows = statement
        .query_map(params![profile_key, from_timestamp, to_timestamp], |row| {
            Ok(ActivityEntry {
                timestamp: row.get(0)?,
                duration_ms: u64::try_from(row.get::<_, i64>(1)?.max(0)).unwrap_or(u64::MAX),
                note_path: row.get(2)?,
                note_name: row.get(3)?,
                saved_at: row.get(4)?,
                end_timestamp: row.get(5)?,
                operation_id: row.get(6)?,
            })
        })
        .map_err(database::sql_error)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(database::sql_error)
}

fn read_history_for_config(config: &AppConfig) -> io::Result<ActivityHistory> {
    let path = config
        .storage_dir()
        .ok_or_else(|| io::Error::other("není vybraný profil"))?
        .join("activity.json");
    read_history(&path)
}

fn read_history(path: &Path) -> io::Result<ActivityHistory> {
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(ActivityHistory::default()),
        Err(error) => Err(error),
    }
}

fn source_signature(path: &Path) -> io::Result<SourceSignature> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(SourceSignature {
            size_bytes: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
            modified_ns: modified_ns(metadata.modified().ok()),
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(SourceSignature {
            size_bytes: 0,
            modified_ns: 0,
        }),
        Err(error) => Err(error),
    }
}

fn modified_ns(modified: Option<SystemTime>) -> i64 {
    modified
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|value| i64::try_from(value.as_nanos()).ok())
        .unwrap_or(0)
}

fn summarize(entries: &[ActivityEntry]) -> ActivitySummary {
    let total_ms = entries.iter().fold(0_u64, |total, entry| {
        total.saturating_add(entry.duration_ms)
    });
    ActivitySummary {
        count: entries.len(),
        total_ms,
        average_ms: total_ms.checked_div(entries.len() as u64).unwrap_or(0),
        longest_ms: entries
            .iter()
            .map(|entry| entry.duration_ms)
            .max()
            .unwrap_or(0),
        first_timestamp: entries.iter().map(|entry| entry.timestamp).min(),
        last_timestamp: entries.iter().map(|entry| entry.timestamp).max(),
    }
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

    fn fixture() -> (PathBuf, PathBuf, AppConfig) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("mmst-activity-{nonce}"));
        let database_directory = root.join("database");
        fs::create_dir_all(root.join(".mmST-test")).expect("create activity fixture");
        let config = AppConfig {
            vault_path: Some(root.clone()),
            nick: Some("test".into()),
            ..AppConfig::default()
        };
        (root, database_directory, config)
    }

    fn entry(timestamp: i64, duration_ms: u64, operation_id: &str) -> ActivityEntry {
        ActivityEntry {
            timestamp,
            duration_ms,
            note_path: "/vault/note.md".into(),
            note_name: "Note".into(),
            saved_at: timestamp + duration_ms as i64,
            end_timestamp: timestamp + duration_ms as i64,
            operation_id: operation_id.into(),
        }
    }

    #[test]
    fn loads_legacy_entries_without_recovery_metadata() {
        let history: ActivityHistory = serde_json::from_str(
            r#"{"entries":[{"timestamp":1000.6,"duration_ms":500.6,"notePath":"note.md","noteName":"Note"}]}"#,
        )
        .expect("legacy activity should remain readable");
        assert_eq!(history.entries.len(), 1);
        assert_eq!(history.entries[0].timestamp, 1_001);
        assert_eq!(history.entries[0].duration_ms, 501);
        assert_eq!(history.entries[0].saved_at, 0);
        assert_eq!(history.entries[0].end_timestamp, 0);
        assert!(history.entries[0].operation_id.is_empty());
    }

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

    #[test]
    fn imports_legacy_json_and_queries_ranges_and_summary() {
        let (root, database_directory, config) = fixture();
        let history = ActivityHistory {
            entries: vec![entry(1_000, 500, "a"), entry(2_000, 1_500, "b")],
        };
        write_json_atomically(&root.join(".mmST-test/activity.json"), &history)
            .expect("write legacy ledger");

        let range =
            try_load_activity_range(&config, Some(1_500), Some(3_000), Some(&database_directory))
                .expect("query projection range");
        assert_eq!(range.len(), 1);
        assert_eq!(range[0].operation_id, "b");
        let summary = try_activity_summary(&config, None, None, Some(&database_directory))
            .expect("query projection summary");
        assert_eq!(summary.count, 2);
        assert_eq!(summary.total_ms, 2_000);
        assert_eq!(summary.average_ms, 1_000);
        assert_eq!(summary.longest_ms, 1_500);
        assert_eq!(summary.first_timestamp, Some(1_000));
        assert_eq!(summary.last_timestamp, Some(2_000));

        fs::remove_dir_all(root).expect("remove activity fixture");
    }

    #[test]
    fn projection_keeps_profile_statistics_isolated() {
        let (root, database_directory, alpha) = fixture();
        let beta = AppConfig {
            vault_path: Some(root.clone()),
            nick: Some("beta".into()),
            ..AppConfig::default()
        };
        fs::create_dir_all(root.join(".mmST-beta")).expect("create second profile");
        write_json_atomically(
            &root.join(".mmST-test/activity.json"),
            &ActivityHistory {
                entries: vec![entry(1_000, 500, "alpha")],
            },
        )
        .expect("write alpha ledger");
        write_json_atomically(
            &root.join(".mmST-beta/activity.json"),
            &ActivityHistory {
                entries: vec![entry(2_000, 2_500, "beta")],
            },
        )
        .expect("write beta ledger");

        let alpha_summary =
            try_activity_summary(&alpha, None, None, Some(&database_directory)).unwrap();
        let beta_summary =
            try_activity_summary(&beta, None, None, Some(&database_directory)).unwrap();
        assert_eq!((alpha_summary.count, alpha_summary.total_ms), (1, 500));
        assert_eq!((beta_summary.count, beta_summary.total_ms), (1, 2_500));

        fs::remove_dir_all(root).expect("remove activity fixture");
    }

    #[test]
    fn external_json_change_rebuilds_projection_without_duplicates() {
        let (root, database_directory, config) = fixture();
        let path = root.join(".mmST-test/activity.json");
        write_json_atomically(
            &path,
            &ActivityHistory {
                entries: vec![entry(1_000, 500, "same")],
            },
        )
        .expect("write first ledger");
        let first = try_load_activity_range(&config, None, None, Some(&database_directory))
            .expect("initial import");
        assert_eq!(first.len(), 1);

        write_json_atomically(
            &path,
            &ActivityHistory {
                entries: vec![entry(1_000, 500, "same"), entry(3_000, 750, "new")],
            },
        )
        .expect("write external change");
        let second = try_load_activity_range(&config, None, None, Some(&database_directory))
            .expect("refresh changed projection");
        assert_eq!(second.len(), 2);
        assert_eq!(
            second
                .iter()
                .filter(|item| item.operation_id == "same")
                .count(),
            1
        );

        fs::remove_dir_all(root).expect("remove activity fixture");
    }

    #[test]
    fn repeated_projection_sync_is_idempotent() {
        let (root, database_directory, config) = fixture();
        let history = ActivityHistory {
            entries: vec![entry(1_000, 500, "same")],
        };
        write_json_atomically(&root.join(".mmST-test/activity.json"), &history)
            .expect("write ledger");
        synchronize_projection(&config, &history, Some(&database_directory)).expect("first sync");
        synchronize_projection(&config, &history, Some(&database_directory)).expect("second sync");
        let entries = try_load_activity_range(&config, None, None, Some(&database_directory))
            .expect("load projection");
        assert_eq!(entries.len(), 1);

        fs::remove_dir_all(root).expect("remove activity fixture");
    }

    #[test]
    fn append_keeps_operation_id_idempotent_in_json_and_projection() {
        let (root, database_directory, config) = fixture();
        for _ in 0..2 {
            append_activity_with_database(
                &config,
                1_000,
                &root.join("note.md"),
                "Note",
                "operation-once",
                Some(&database_directory),
            )
            .expect("append activity");
        }
        let history = read_history(&root.join(".mmST-test/activity.json")).expect("read ledger");
        assert_eq!(history.entries.len(), 1);
        let projection = try_load_activity_range(&config, None, None, Some(&database_directory))
            .expect("read projection");
        assert_eq!(projection.len(), 1);
        assert_eq!(projection[0].operation_id, "operation-once");

        fs::remove_dir_all(root).expect("remove activity fixture");
    }
}
