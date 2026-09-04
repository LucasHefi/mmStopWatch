use crate::database;
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use walkdir::{DirEntry, WalkDir};

const INDEX_SCHEMA_VERSION: i64 = 2;

#[derive(Clone, Debug)]
pub struct Note {
    pub path: PathBuf,
    pub name: String,
    pub relative_path: String,
    pub duration_ms: u64,
    pub preview: String,
    pub tags: Vec<String>,
    pub time_estimate_minutes: Option<u64>,
    pub fields: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Default)]
pub struct NoteScan {
    pub notes: Vec<Note>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct FileSignature {
    len: i64,
    modified_ns: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct IndexMetrics {
    pub scanned_files: usize,
    pub cache_hits: usize,
    pub parsed_files: usize,
    pub deleted_files: usize,
    pub elapsed: Duration,
}

/// Persistent incremental vault index. Markdown remains the source of truth;
/// SQLite stores a rebuildable projection in the application data directory.
/// A refresh walks metadata for reconciliation but reads and parses only new
/// or changed notes. The complete note set is materialized once from SQLite so
/// the existing native UI and statistics can keep their stable Rust API.
#[derive(Debug)]
pub struct NoteIndex {
    options_signature: String,
    database_directory: Option<PathBuf>,
    database_path: Option<PathBuf>,
    connection: Option<Connection>,
    metrics: IndexMetrics,
    revision: u64,
}

impl Default for NoteIndex {
    fn default() -> Self {
        Self {
            options_signature: String::new(),
            database_directory: database::data_directory(),
            database_path: None,
            connection: None,
            metrics: IndexMetrics::default(),
            revision: 0,
        }
    }
}

impl NoteIndex {
    pub fn cache_hits(&self) -> usize {
        self.metrics.cache_hits
    }

    pub fn metrics(&self) -> IndexMetrics {
        self.metrics
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    #[cfg(test)]
    fn with_database_directory(directory: PathBuf) -> Self {
        Self {
            database_directory: Some(directory),
            ..Self::default()
        }
    }

    pub fn scan(
        &mut self,
        root: &Path,
        key: &str,
        estimate_key: &str,
        field_keys: &[String],
    ) -> io::Result<NoteScan> {
        validate_key(key)?;
        validate_key(estimate_key)?;
        for field in field_keys {
            validate_key(field)?;
        }
        if !root.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "vybraná složka neexistuje",
            ));
        }

        let root = root.canonicalize()?;
        let options_signature = format!(
            "{key}\u{1f}{estimate_key}\u{1f}{}",
            field_keys.join("\u{1e}")
        );
        self.ensure_database(&root, &options_signature)?;
        let mut connection = self
            .connection
            .take()
            .ok_or_else(|| io::Error::other("databázový index není otevřený"))?;
        let result = reconcile_database(&mut connection, &root, key, estimate_key, field_keys);
        self.connection = Some(connection);
        let (scan, metrics, revision) = result?;
        self.options_signature = options_signature;
        self.metrics = metrics;
        self.revision = revision;
        Ok(scan)
    }

    pub fn refresh_paths(
        &mut self,
        root: &Path,
        key: &str,
        estimate_key: &str,
        field_keys: &[String],
        paths: &[PathBuf],
    ) -> io::Result<NoteScan> {
        validate_key(key)?;
        validate_key(estimate_key)?;
        for field in field_keys {
            validate_key(field)?;
        }
        let root = root.canonicalize()?;
        let options_signature = format!(
            "{key}\u{1f}{estimate_key}\u{1f}{}",
            field_keys.join("\u{1e}")
        );
        if self.options_signature != options_signature || self.connection.is_none() {
            return self.scan(&root, key, estimate_key, field_keys);
        }
        self.ensure_database(&root, &options_signature)?;
        let mut connection = self
            .connection
            .take()
            .ok_or_else(|| io::Error::other("databázový index není otevřený"))?;
        let result =
            refresh_database_paths(&mut connection, &root, key, estimate_key, field_keys, paths);
        self.connection = Some(connection);
        let (scan, metrics, revision) = result?;
        self.metrics = metrics;
        self.revision = revision;
        Ok(scan)
    }

    fn ensure_database(&mut self, root: &Path, options_signature: &str) -> io::Result<()> {
        let directory = self
            .database_directory
            .as_ref()
            .ok_or_else(|| io::Error::other("není dostupná lokální složka pro databázový index"))?;
        fs::create_dir_all(directory)?;
        let database_path = database::path_for_vault(directory, root);
        if self.database_path.as_ref() != Some(&database_path) || self.connection.is_none() {
            self.connection = None;
            self.connection = Some(match database::open(&database_path) {
                Ok(connection) => connection,
                Err(error) if database_path.exists() => {
                    database::quarantine(&database_path)?;
                    database::open(&database_path).map_err(|_| error)?
                }
                Err(error) => return Err(error),
            });
            self.database_path = Some(database_path.clone());
        }
        let initialization = self
            .connection
            .as_mut()
            .ok_or_else(|| io::Error::other("databázový index není otevřený"))
            .and_then(|connection| initialize_database(connection, root, options_signature));
        if initialization.is_err() {
            self.connection = None;
            database::quarantine(&database_path)?;
            let mut connection = database::open(&database_path)?;
            initialize_database(&mut connection, root, options_signature)?;
            self.connection = Some(connection);
        }
        Ok(())
    }
}

#[cfg(test)]
pub fn scan_notes_detailed(
    root: &Path,
    key: &str,
    estimate_key: &str,
    field_keys: &[String],
) -> io::Result<NoteScan> {
    let mut index = NoteIndex::with_database_directory(root.join(".mmstopwatch-test-index"));
    index.scan(root, key, estimate_key, field_keys)
}

fn reconcile_database(
    connection: &mut Connection,
    root: &Path,
    key: &str,
    estimate_key: &str,
    field_keys: &[String],
) -> io::Result<(NoteScan, IndexMetrics, u64)> {
    let started = Instant::now();
    let cached = load_signatures(connection)?;
    let mut active = HashSet::with_capacity(cached.len());
    let mut scan_warnings = Vec::new();
    let mut metrics = IndexMetrics::default();
    let mut changed = false;
    let transaction = connection.transaction().map_err(sql_error)?;
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(is_visible_note_entry);

    for entry in walker {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                scan_warnings.push(format!("Nelze projít položku: {error}"));
                continue;
            }
        };
        if !entry.file_type().is_file()
            || !entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            continue;
        }

        metrics.scanned_files += 1;
        let path = entry.path();
        let relative_path = relative_path(root, path);
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                scan_warnings.push(format!(
                    "{}: nelze načíst metadata ({error})",
                    path.display()
                ));
                continue;
            }
        };
        let signature = FileSignature {
            len: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
            modified_ns: modified_ns(metadata.modified().ok()),
        };
        active.insert(relative_path.clone());

        if cached.get(&relative_path) == Some(&signature) {
            metrics.cache_hits += 1;
            continue;
        }

        metrics.parsed_files += 1;
        changed = true;
        match parse_note_file(root, path, key, estimate_key, field_keys) {
            Ok((note, warnings)) => {
                upsert_note(&transaction, &note, signature, &warnings)?;
            }
            Err(error) => {
                transaction
                    .execute(
                        "DELETE FROM notes WHERE relative_path = ?1",
                        params![relative_path],
                    )
                    .map_err(sql_error)?;
                scan_warnings.push(format!("{}: nelze přečíst ({error})", path.display()));
            }
        }
    }

    for relative_path in cached.keys().filter(|path| !active.contains(*path)) {
        metrics.deleted_files += 1;
        changed = true;
        transaction
            .execute(
                "DELETE FROM notes WHERE relative_path = ?1",
                params![relative_path],
            )
            .map_err(sql_error)?;
    }

    let mut revision = meta_u64(&transaction, "revision")?.unwrap_or(0);
    if changed {
        revision = revision.saturating_add(1);
        set_meta(&transaction, "revision", &revision.to_string())?;
    }
    transaction.commit().map_err(sql_error)?;

    let mut scan = load_note_scan(connection)?;
    scan.warnings.extend(scan_warnings);
    metrics.elapsed = started.elapsed();
    Ok((scan, metrics, revision))
}

fn refresh_database_paths(
    connection: &mut Connection,
    root: &Path,
    key: &str,
    estimate_key: &str,
    field_keys: &[String],
    paths: &[PathBuf],
) -> io::Result<(NoteScan, IndexMetrics, u64)> {
    let started = Instant::now();
    let mut metrics = IndexMetrics::default();
    let mut scan_warnings = Vec::new();
    let mut changed = false;
    let unique_paths = paths.iter().collect::<HashSet<_>>();
    let transaction = connection.transaction().map_err(sql_error)?;

    for path in unique_paths {
        let Some(relative) = safe_relative_event_path(root, path) else {
            continue;
        };
        if path
            .extension()
            .is_none_or(|extension| !extension.eq_ignore_ascii_case("md"))
        {
            continue;
        }
        metrics.scanned_files += 1;
        if !path.exists() {
            let deleted = transaction
                .execute(
                    "DELETE FROM notes WHERE relative_path = ?1",
                    params![relative],
                )
                .map_err(sql_error)?;
            if deleted > 0 {
                metrics.deleted_files += deleted;
                changed = true;
            }
            continue;
        }

        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata)
                if metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
            {
                metadata
            }
            Ok(_) => {
                let deleted = transaction
                    .execute(
                        "DELETE FROM notes WHERE relative_path = ?1",
                        params![relative],
                    )
                    .map_err(sql_error)?;
                if deleted > 0 {
                    metrics.deleted_files += deleted;
                    changed = true;
                }
                continue;
            }
            Err(error) => {
                scan_warnings.push(format!(
                    "{}: nelze načíst metadata ({error})",
                    path.display()
                ));
                continue;
            }
        };
        let signature = FileSignature {
            len: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
            modified_ns: modified_ns(metadata.modified().ok()),
        };
        // A watcher event is stronger evidence than mtime + size. Editors can
        // replace a file with identical metadata on coarse-timestamp filesystems,
        // so explicit path refreshes always parse the final Markdown content.
        metrics.parsed_files += 1;
        changed = true;
        match parse_note_file(root, path, key, estimate_key, field_keys) {
            Ok((note, warnings)) => upsert_note(&transaction, &note, signature, &warnings)?,
            Err(error) => {
                transaction
                    .execute(
                        "DELETE FROM notes WHERE relative_path = ?1",
                        params![relative],
                    )
                    .map_err(sql_error)?;
                scan_warnings.push(format!("{}: nelze přečíst ({error})", path.display()));
            }
        }
    }

    let mut revision = meta_u64(&transaction, "revision")?.unwrap_or(0);
    if changed {
        revision = revision.saturating_add(1);
        set_meta(&transaction, "revision", &revision.to_string())?;
    }
    transaction.commit().map_err(sql_error)?;
    let mut scan = load_note_scan(connection)?;
    scan.warnings.extend(scan_warnings);
    metrics.elapsed = started.elapsed();
    Ok((scan, metrics, revision))
}

fn initialize_database(
    connection: &mut Connection,
    root: &Path,
    options_signature: &str,
) -> io::Result<()> {
    let schema_version = connection
        .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
        .map_err(sql_error)?;
    if schema_version != INDEX_SCHEMA_VERSION {
        connection
            .execute_batch("DROP TABLE IF EXISTS notes; DROP TABLE IF EXISTS meta;")
            .map_err(sql_error)?;
    }
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS notes (
                relative_path TEXT PRIMARY KEY,
                absolute_path TEXT NOT NULL,
                name TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                modified_ns INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                preview TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                estimate_minutes INTEGER,
                fields_json TEXT NOT NULL,
                warnings_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS notes_name_index ON notes(name COLLATE NOCASE);",
        )
        .map_err(sql_error)?;
    connection
        .pragma_update(None, "user_version", INDEX_SCHEMA_VERSION)
        .map_err(sql_error)?;

    let canonical_root = root.to_string_lossy();
    let stored_root = meta_value(connection, "vault_root")?;
    let stored_options = meta_value(connection, "options_signature")?;
    if stored_root.as_deref() != Some(canonical_root.as_ref())
        || stored_options.as_deref() != Some(options_signature)
    {
        let transaction = connection.transaction().map_err(sql_error)?;
        transaction
            .execute("DELETE FROM notes", [])
            .map_err(sql_error)?;
        set_meta(&transaction, "vault_root", canonical_root.as_ref())?;
        set_meta(&transaction, "options_signature", options_signature)?;
        let revision = meta_u64(&transaction, "revision")?
            .unwrap_or(0)
            .saturating_add(1);
        set_meta(&transaction, "revision", &revision.to_string())?;
        transaction.commit().map_err(sql_error)?;
    }
    Ok(())
}

fn load_signatures(connection: &Connection) -> io::Result<HashMap<String, FileSignature>> {
    let mut statement = connection
        .prepare("SELECT relative_path, size_bytes, modified_ns FROM notes")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                FileSignature {
                    len: row.get(1)?,
                    modified_ns: row.get(2)?,
                },
            ))
        })
        .map_err(sql_error)?;
    let mut signatures = HashMap::new();
    for row in rows {
        let (path, signature) = row.map_err(sql_error)?;
        signatures.insert(path, signature);
    }
    Ok(signatures)
}

fn upsert_note(
    connection: &Connection,
    note: &Note,
    signature: FileSignature,
    warnings: &[String],
) -> io::Result<()> {
    let tags = serde_json::to_string(&note.tags).map_err(io::Error::other)?;
    let fields = serde_json::to_string(&note.fields).map_err(io::Error::other)?;
    let warnings = serde_json::to_string(warnings).map_err(io::Error::other)?;
    connection
        .execute(
            "INSERT INTO notes (
                relative_path, absolute_path, name, size_bytes, modified_ns,
                duration_ms, preview, tags_json, estimate_minutes, fields_json,
                warnings_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(relative_path) DO UPDATE SET
                absolute_path = excluded.absolute_path,
                name = excluded.name,
                size_bytes = excluded.size_bytes,
                modified_ns = excluded.modified_ns,
                duration_ms = excluded.duration_ms,
                preview = excluded.preview,
                tags_json = excluded.tags_json,
                estimate_minutes = excluded.estimate_minutes,
                fields_json = excluded.fields_json,
                warnings_json = excluded.warnings_json",
            params![
                note.relative_path,
                note.path.to_string_lossy(),
                note.name,
                signature.len,
                signature.modified_ns,
                i64::try_from(note.duration_ms).unwrap_or(i64::MAX),
                note.preview,
                tags,
                note.time_estimate_minutes
                    .and_then(|value| i64::try_from(value).ok()),
                fields,
                warnings,
            ],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn load_note_scan(connection: &Connection) -> io::Result<NoteScan> {
    let mut statement = connection
        .prepare(
            "SELECT absolute_path, name, relative_path, duration_ms, preview,
                    tags_json, estimate_minutes, fields_json, warnings_json
             FROM notes
             ORDER BY name COLLATE NOCASE, relative_path COLLATE NOCASE",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let tags_json = row.get::<_, String>(5)?;
            let fields_json = row.get::<_, String>(7)?;
            let warnings_json = row.get::<_, String>(8)?;
            let duration = row.get::<_, i64>(3)?.max(0) as u64;
            let estimate = row
                .get::<_, Option<i64>>(6)?
                .and_then(|value| u64::try_from(value).ok());
            Ok((
                Note {
                    path: PathBuf::from(row.get::<_, String>(0)?),
                    name: row.get(1)?,
                    relative_path: row.get(2)?,
                    duration_ms: duration,
                    preview: row.get(4)?,
                    tags: serde_json::from_str(&tags_json).unwrap_or_default(),
                    time_estimate_minutes: estimate,
                    fields: serde_json::from_str(&fields_json).unwrap_or_default(),
                },
                serde_json::from_str::<Vec<String>>(&warnings_json).unwrap_or_default(),
            ))
        })
        .map_err(sql_error)?;
    let mut scan = NoteScan::default();
    for row in rows {
        let (note, warnings) = row.map_err(sql_error)?;
        scan.notes.push(note);
        scan.warnings.extend(warnings);
    }
    Ok(scan)
}

fn meta_value(connection: &Connection, key: &str) -> io::Result<Option<String>> {
    connection
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql_error)
}

fn meta_u64(connection: &Connection, key: &str) -> io::Result<Option<u64>> {
    Ok(meta_value(connection, key)?.and_then(|value| value.parse().ok()))
}

fn set_meta(connection: &Connection, key: &str, value: &str) -> io::Result<()> {
    connection
        .execute(
            "INSERT INTO meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(sql_error)?;
    Ok(())
}

fn relative_path(root: &Path, path: &Path) -> String {
    portable_path_string(path.strip_prefix(root).unwrap_or(path))
}

fn safe_relative_event_path(root: &Path, path: &Path) -> Option<String> {
    let normalized_path = if path.exists() {
        path.canonicalize().ok()?
    } else {
        let parent = path.parent()?.canonicalize().ok()?;
        parent.join(path.file_name()?)
    };
    let relative = normalized_path.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty()
        || !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return None;
    }
    Some(portable_path_string(relative))
}

fn portable_path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn modified_ns(modified: Option<SystemTime>) -> i64 {
    modified
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .and_then(|value| i64::try_from(value.as_nanos()).ok())
        .unwrap_or(0)
}

fn sql_error(error: rusqlite::Error) -> io::Error {
    database::sql_error(error)
}

fn parse_note_file(
    root: &Path,
    path: &Path,
    key: &str,
    estimate_key: &str,
    field_keys: &[String],
) -> io::Result<(Note, Vec<String>)> {
    let content = fs::read_to_string(path)?;
    let (frontmatter, body) = split_frontmatter(&content);
    let mut warnings = Vec::new();
    if (content.starts_with("---\n") || content.starts_with("---\r\n")) && frontmatter.is_none() {
        warnings.push(format!(
            "{}: frontmatter nemá ukončovací ---",
            path.display()
        ));
    }
    let raw_duration = frontmatter.and_then(|yaml| frontmatter_value(yaml, key));
    let duration_ms = raw_duration.and_then(parse_time_ms).unwrap_or(0);
    if raw_duration.is_some() && parse_time_ms(raw_duration.unwrap_or_default()).is_none() {
        warnings.push(format!("{}: pole {key} nemá platný čas", path.display()));
    }
    let raw_estimate = frontmatter.and_then(|yaml| frontmatter_value(yaml, estimate_key));
    let time_estimate_minutes = raw_estimate
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|minutes| *minutes > 0);
    if raw_estimate.is_some()
        && raw_estimate
            .and_then(|value| value.parse::<u64>().ok())
            .is_none()
    {
        warnings.push(format!(
            "{}: pole {estimate_key} nemá platný počet minut",
            path.display()
        ));
    }
    let tags = frontmatter
        .map(|yaml| frontmatter_values(yaml, "tags"))
        .unwrap_or_default();
    let fields = field_keys
        .iter()
        .filter_map(|field| {
            let values = frontmatter
                .map(|yaml| frontmatter_values(yaml, field))
                .unwrap_or_default();
            (!values.is_empty()).then(|| (field.clone(), values))
        })
        .collect();
    let relative_path = portable_path_string(path.strip_prefix(root).unwrap_or(path));
    let name = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Poznámka")
        .to_owned();
    Ok((
        Note {
            path: path.to_path_buf(),
            name,
            relative_path,
            duration_ms,
            preview: make_preview(body),
            tags,
            time_estimate_minutes,
            fields,
        },
        warnings,
    ))
}

fn parse_tags(value: &str) -> Vec<String> {
    value
        .trim_matches(['[', ']'])
        .split(',')
        .map(|tag| tag.trim().trim_matches(['\'', '"']).trim_start_matches('#'))
        .filter(|tag| !tag.is_empty())
        .take(8)
        .map(str::to_owned)
        .collect()
}

fn frontmatter_values(yaml: &str, key: &str) -> Vec<String> {
    let lines = yaml.lines().collect::<Vec<_>>();
    for (index, line) in lines.iter().enumerate() {
        let Some((candidate, value)) = line.split_once(':') else {
            continue;
        };
        if candidate.trim() != key {
            continue;
        }
        let value = value.trim();
        if !value.is_empty() {
            return parse_tags(value);
        }

        return lines[index + 1..]
            .iter()
            .map(|line| line.trim())
            .take_while(|line| line.is_empty() || line.starts_with('-'))
            .filter_map(|line| line.strip_prefix('-'))
            .map(|value| {
                value
                    .trim()
                    .trim_matches(['\'', '"'])
                    .trim_start_matches('#')
            })
            .filter(|value| !value.is_empty())
            .take(8)
            .map(str::to_owned)
            .collect();
    }
    Vec::new()
}

pub fn write_total_duration(path: &Path, key: &str, total_ms: u64) -> io::Result<()> {
    write_frontmatter_value(path, key, &format_time(total_ms))
}

pub fn write_time_estimate(path: &Path, key: &str, minutes: u64) -> io::Result<()> {
    write_frontmatter_value(path, key, &minutes.to_string())
}

pub fn create_note(
    root: &Path,
    relative_path: &str,
    time_key: &str,
    initial_time: &str,
    tags: &str,
) -> io::Result<PathBuf> {
    validate_key(time_key)?;
    let relative = Path::new(relative_path.trim());
    let safe = !relative.as_os_str().is_empty()
        && !relative.is_absolute()
        && relative
            .extension()
            .is_some_and(|extension| extension == "md")
        && relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)));
    if !safe {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "název musí být bezpečná relativní cesta končící .md",
        ));
    }
    let target = root.join(relative);
    if target.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "poznámka s tímto názvem už existuje",
        ));
    }
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::other("poznámka nemá nadřazenou složku"))?;
    if !parent.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "cílová podsložka neexistuje",
        ));
    }
    let initial_ms = if initial_time.trim().is_empty() {
        0
    } else {
        parse_time_ms(initial_time).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "počáteční čas není platný")
        })?
    };
    let mut content = update_frontmatter("---\n---\n", time_key, &format_time(initial_ms));
    let cleaned_tags = tags
        .split(',')
        .map(str::trim)
        .filter(|tag| !tag.is_empty())
        .collect::<Vec<_>>();
    if !cleaned_tags.is_empty() {
        content = update_frontmatter(&content, "tags", &format!("[{}]", cleaned_tags.join(", ")));
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()?;
    Ok(target)
}

fn write_frontmatter_value(path: &Path, key: &str, value: &str) -> io::Result<()> {
    validate_key(key)?;
    let content = fs::read_to_string(path)?;
    let updated = update_frontmatter(&content, key, value);
    let metadata = fs::metadata(path)?;
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("poznámka nemá nadřazenou složku"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note.md");
    let temporary = parent.join(format!(
        ".{file_name}.mmstopwatch-{}.tmp",
        std::process::id()
    ));

    let result = (|| {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        output.write_all(updated.as_bytes())?;
        output.sync_all()?;
        fs::set_permissions(&temporary, metadata.permissions())?;
        replace_file(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn replace_file(temporary: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        fs::copy(temporary, destination)?;
        fs::remove_file(temporary)
    }
    #[cfg(not(target_os = "windows"))]
    {
        fs::rename(temporary, destination)
    }
}

fn is_visible_note_entry(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return true;
    }
    let name = entry.file_name().to_string_lossy();
    if !entry.file_type().is_dir() {
        return true;
    }
    name != "node_modules" && !name.starts_with('.')
}

fn validate_key(key: &str) -> io::Result<()> {
    let valid = !key.is_empty()
        && key.len() <= 80
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'));
    valid.then_some(()).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "neplatný název frontmatter pole",
        )
    })
}

fn split_frontmatter(content: &str) -> (Option<&str>, &str) {
    let normalized_start = content
        .strip_prefix("---\r\n")
        .or_else(|| content.strip_prefix("---\n"));
    let Some(rest) = normalized_start else {
        return (None, content);
    };
    if let Some(position) = rest.find("\n---\r\n") {
        return (Some(&rest[..position]), &rest[position + 6..]);
    }
    if let Some(position) = rest.find("\n---\n") {
        return (Some(&rest[..position]), &rest[position + 5..]);
    }
    (None, content)
}

fn frontmatter_value<'a>(yaml: &'a str, key: &str) -> Option<&'a str> {
    yaml.lines().find_map(|line| {
        let (candidate, value) = line.split_once(':')?;
        (candidate.trim() == key).then(|| value.trim().trim_matches(['\'', '"']))
    })
}

pub fn parse_time_ms(value: &str) -> Option<u64> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if !value.contains(':') {
        return value
            .parse::<u64>()
            .ok()
            .and_then(|seconds| seconds.checked_mul(1_000));
    }
    let parts = value
        .split(':')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    let seconds = match parts.as_slice() {
        [minutes, seconds] if *seconds < 60 => minutes.checked_mul(60)?.checked_add(*seconds)?,
        [hours, minutes, seconds] if *minutes < 60 && *seconds < 60 => hours
            .checked_mul(3_600)?
            .checked_add(minutes.checked_mul(60)?)?
            .checked_add(*seconds)?,
        _ => return None,
    };
    seconds.checked_mul(1_000)
}

pub fn format_time(milliseconds: u64) -> String {
    let seconds = milliseconds / 1_000;
    format!(
        "{:02}:{:02}:{:02}",
        seconds / 3_600,
        seconds / 60 % 60,
        seconds % 60
    )
}

pub fn format_stopwatch(milliseconds: u64) -> String {
    let seconds = milliseconds / 1_000;
    format!(
        "{:02}:{:02}:{:02}.{:02}",
        seconds / 3_600,
        seconds / 60 % 60,
        seconds % 60,
        milliseconds % 1_000 / 10
    )
}

fn update_frontmatter(content: &str, key: &str, value: &str) -> String {
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let (frontmatter, body) = split_frontmatter(content);
    let Some(frontmatter) = frontmatter else {
        return format!("---{newline}{key}: {value}{newline}---{newline}{content}");
    };
    let mut found = false;
    let mut lines = Vec::new();
    for line in frontmatter.lines() {
        let matches = line
            .split_once(':')
            .is_some_and(|(candidate, _)| candidate.trim() == key);
        if matches {
            lines.push(format!("{key}: {value}"));
            found = true;
        } else {
            lines.push(line.to_owned());
        }
    }
    if !found {
        lines.push(format!("{key}: {value}"));
    }
    format!(
        "---{newline}{}{newline}---{newline}{body}",
        lines.join(newline)
    )
}

fn make_preview(body: &str) -> String {
    let compact = body
        .split_whitespace()
        .take(24)
        .collect::<Vec<_>>()
        .join(" ");
    if compact.len() > 120 {
        format!("{}…", &compact[..compact.floor_char_boundary(117)])
    } else {
        compact
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temporary_vault() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock must be after unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "mmstopwatch-slint-test-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn normalizes_relative_paths_for_cross_platform_storage() {
        assert_eq!(
            portable_path_string(Path::new(r"Project\Task.md")),
            "Project/Task.md"
        );
        assert_eq!(
            portable_path_string(Path::new("Project/Task.md")),
            "Project/Task.md"
        );
    }

    #[test]
    fn parses_supported_time_formats() {
        assert_eq!(parse_time_ms("01:02:03"), Some(3_723_000));
        assert_eq!(parse_time_ms("12:34"), Some(754_000));
        assert_eq!(parse_time_ms("90"), Some(90_000));
        assert_eq!(parse_time_ms("00:61"), None);
    }

    #[test]
    fn parses_inline_and_block_frontmatter_lists() {
        assert_eq!(
            frontmatter_values("tags: [task, aktrinec]", "tags"),
            ["task", "aktrinec"]
        );
        assert_eq!(
            frontmatter_values(
                "title: Test\ntags:\n  - task\n  - aktrinec\nstatus: active",
                "tags"
            ),
            ["task", "aktrinec"]
        );
    }

    #[test]
    fn updates_only_exact_frontmatter_key_and_preserves_body() {
        let input = "---\ntitle: Test\nTimework-old: 9\nTimework: 00:01:00\n---\n# Body\n";
        let updated = update_frontmatter(input, "Timework", "00:02:03");
        assert!(updated.contains("Timework-old: 9"));
        assert!(updated.contains("Timework: 00:02:03"));
        assert!(updated.ends_with("# Body\n"));
    }

    #[test]
    fn inserts_frontmatter_when_missing() {
        let updated = update_frontmatter("# Note\n", "Timework", "00:00:08");
        assert_eq!(updated, "---\nTimework: 00:00:08\n---\n# Note\n");
    }

    #[test]
    fn scans_and_atomically_updates_a_real_markdown_note() {
        let vault = temporary_vault();
        let nested = vault.join("Project");
        fs::create_dir_all(&nested).expect("create temporary vault");
        let note_path = nested.join("Task.md");
        fs::write(
            &note_path,
            "---\nTimework: 00:01:02\ntags: [test]\n---\n# Important body\n",
        )
        .expect("write temporary note");

        let notes = scan_notes_detailed(&vault, "Timework", "timeEstimate", &[])
            .expect("scan temporary vault")
            .notes;
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].duration_ms, 62_000);
        assert_eq!(notes[0].relative_path, "Project/Task.md");

        write_total_duration(&note_path, "Timework", 125_000).expect("update temporary note");
        let updated = fs::read_to_string(&note_path).expect("read updated note");
        assert!(updated.contains("Timework: 00:02:05"));
        assert!(updated.contains("tags: [test]"));
        assert!(updated.ends_with("# Important body\n"));

        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }

    #[test]
    fn creates_compatible_note_and_rejects_parent_traversal() {
        let vault = temporary_vault();
        fs::create_dir_all(&vault).expect("create temporary vault");
        let created = create_note(&vault, "new.md", "Timework", "00:01:30", "alpha, beta")
            .expect("create note");
        let content = fs::read_to_string(created).expect("read created note");
        assert!(content.contains("Timework: 00:01:30"));
        assert!(content.contains("tags: [alpha, beta]"));
        assert!(create_note(&vault, "../escape.md", "Timework", "", "").is_err());
        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }

    #[test]
    fn detailed_scan_reports_invalid_fields_and_collects_breakdown_values() {
        let vault = temporary_vault();
        fs::create_dir_all(&vault).expect("create temporary vault");
        fs::write(
            vault.join("invalid.md"),
            "---\nTimework: tomorrow\ntimeEstimate: soon\nproject: [alpha, beta]\n---\nBody\n",
        )
        .expect("write fixture");

        let scan = scan_notes_detailed(&vault, "Timework", "timeEstimate", &["project".into()])
            .expect("scan fixture");
        assert_eq!(scan.notes.len(), 1);
        assert_eq!(scan.warnings.len(), 2);
        assert_eq!(scan.notes[0].fields["project"], ["alpha", "beta"]);

        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }

    #[test]
    fn incremental_index_reuses_unchanged_notes_and_reloads_changed_files() {
        let vault = temporary_vault();
        fs::create_dir_all(&vault).expect("create temporary vault");
        let note = vault.join("indexed.md");
        let database_directory = vault.join(".index-test");
        fs::write(&note, "---\nTimework: 00:01:00\n---\nFirst body\n").expect("write fixture");

        let mut index = NoteIndex::with_database_directory(database_directory.clone());
        let first = index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("first scan");
        assert_eq!(first.notes[0].duration_ms, 60_000);
        assert_eq!(index.cache_hits(), 0);
        assert_eq!(index.metrics().parsed_files, 1);
        let first_revision = index.revision();

        drop(index);
        let mut index = NoteIndex::with_database_directory(database_directory);

        let second = index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("persistent cached scan");
        assert_eq!(second.notes.len(), 1);
        assert_eq!(index.cache_hits(), 1);
        assert_eq!(index.metrics().parsed_files, 0);
        assert_eq!(index.revision(), first_revision);

        fs::write(
            &note,
            "---\nTimework: 00:02:00\n---\nA changed and longer body\n",
        )
        .expect("change fixture");
        let third = index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("changed scan");
        assert_eq!(third.notes[0].duration_ms, 120_000);
        assert_eq!(index.cache_hits(), 0);
        assert_eq!(index.metrics().parsed_files, 1);
        assert!(index.revision() > first_revision);

        drop(index);
        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }

    #[test]
    fn persistent_index_removes_deleted_notes_and_invalidates_parser_options() {
        let vault = temporary_vault();
        fs::create_dir_all(&vault).expect("create temporary vault");
        let database_directory = vault.join(".index-test");
        let note = vault.join("indexed.md");
        fs::write(
            &note,
            "---\nTimework: 00:01:00\nOtherTime: 00:03:00\n---\nBody\n",
        )
        .expect("write fixture");
        let mut index = NoteIndex::with_database_directory(database_directory);
        index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("first scan");
        let changed_options = index
            .scan(&vault, "OtherTime", "timeEstimate", &[])
            .expect("scan after parser option change");
        assert_eq!(changed_options.notes[0].duration_ms, 180_000);
        assert_eq!(index.metrics().parsed_files, 1);

        fs::remove_file(&note).expect("remove note");
        let after_delete = index
            .scan(&vault, "OtherTime", "timeEstimate", &[])
            .expect("scan after delete");
        assert!(after_delete.notes.is_empty());
        assert_eq!(index.metrics().deleted_files, 1);

        drop(index);
        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }

    #[test]
    fn path_refresh_updates_only_changed_files_and_keeps_the_rest() {
        let vault = temporary_vault();
        let database_directory = vault.join(".index-test");
        fs::create_dir_all(&vault).expect("create temporary vault");
        let first = vault.join("first.md");
        let second = vault.join("second.md");
        fs::write(&first, "---\nTimework: 00:01:00\n---\nFirst\n").expect("write first");
        fs::write(&second, "---\nTimework: 00:02:00\n---\nSecond\n").expect("write second");
        let mut index = NoteIndex::with_database_directory(database_directory);
        index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("initial scan");

        fs::write(&first, "---\nTimework: 00:03:00\n---\nChanged first\n").expect("change first");
        let updated = index
            .refresh_paths(
                &vault,
                "Timework",
                "timeEstimate",
                &[],
                std::slice::from_ref(&first),
            )
            .expect("path refresh");
        assert_eq!(updated.notes.len(), 2);
        assert_eq!(index.metrics().scanned_files, 1);
        assert_eq!(index.metrics().parsed_files, 1);
        assert_eq!(
            updated
                .notes
                .iter()
                .find(|note| note.path == first)
                .expect("first note")
                .duration_ms,
            180_000
        );

        fs::remove_file(&second).expect("delete second");
        let after_delete = index
            .refresh_paths(
                &vault,
                "Timework",
                "timeEstimate",
                &[],
                std::slice::from_ref(&second),
            )
            .expect("delete path refresh");
        assert_eq!(after_delete.notes.len(), 1);
        assert_eq!(index.metrics().scanned_files, 1);
        assert_eq!(index.metrics().deleted_files, 1);

        drop(index);
        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }

    #[test]
    fn corrupt_database_is_quarantined_and_rebuilt_from_markdown() {
        let vault = temporary_vault();
        let database_directory = vault.join(".index-test");
        fs::create_dir_all(&database_directory).expect("create fixture directories");
        fs::write(
            vault.join("note.md"),
            "---\nTimework: 00:04:00\n---\nBody\n",
        )
        .expect("write fixture note");
        let canonical = vault.canonicalize().expect("canonical vault");
        let database_path = database::path_for_vault(&database_directory, &canonical);
        fs::write(&database_path, b"not a sqlite database").expect("write corrupt database");

        let mut index = NoteIndex::with_database_directory(database_directory.clone());
        let scan = index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("rebuild corrupt cache");
        assert_eq!(scan.notes.len(), 1);
        assert_eq!(scan.notes[0].duration_ms, 240_000);
        assert!(
            fs::read_dir(&database_directory)
                .expect("read index directory")
                .filter_map(Result::ok)
                .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"))
        );

        drop(index);
        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }

    #[test]
    #[ignore = "manual 20k-50k vault performance fixture"]
    fn persistent_index_large_vault_performance_fixture() {
        let note_count = std::env::var("MMSTOPWATCH_PERF_NOTES")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(20_000);
        let vault = temporary_vault();
        let database_directory = vault.join(".index-test");
        fs::create_dir_all(&vault).expect("create temporary vault");
        let fixture_started = Instant::now();
        for index in 0..note_count {
            let directory = vault.join(format!("group-{:03}", index / 500));
            fs::create_dir_all(&directory).expect("create fixture group");
            fs::write(
                directory.join(format!("note-{index:05}.md")),
                format!(
                    "---\nTimework: 00:{:02}:00\ntags: [perf, group-{}]\nproject: p{}\n---\nPerformance fixture {index}\n",
                    index % 60,
                    index / 500,
                    index % 20
                ),
            )
            .expect("write fixture note");
        }

        let mut cold_index = NoteIndex::with_database_directory(database_directory.clone());
        let cold_started = Instant::now();
        let cold = cold_index
            .scan(&vault, "Timework", "timeEstimate", &["project".into()])
            .expect("cold index scan");
        let cold_elapsed = cold_started.elapsed();
        assert_eq!(cold.notes.len(), note_count);
        assert_eq!(cold_index.metrics().parsed_files, note_count);
        drop(cold_index);

        let mut warm_index = NoteIndex::with_database_directory(database_directory);
        let warm_started = Instant::now();
        let warm = warm_index
            .scan(&vault, "Timework", "timeEstimate", &["project".into()])
            .expect("warm index scan");
        let warm_elapsed = warm_started.elapsed();
        assert_eq!(warm.notes.len(), note_count);
        assert_eq!(warm_index.metrics().cache_hits, note_count);
        assert_eq!(warm_index.metrics().parsed_files, 0);
        let changed_path = vault.join("group-000/note-00000.md");
        fs::write(
            &changed_path,
            "---\nTimework: 00:59:00\ntags: [perf, changed]\nproject: p0\n---\nChanged fixture\n",
        )
        .expect("change one fixture note");
        let path_refresh_started = Instant::now();
        let refreshed = warm_index
            .refresh_paths(
                &vault,
                "Timework",
                "timeEstimate",
                &["project".into()],
                std::slice::from_ref(&changed_path),
            )
            .expect("single path refresh");
        let path_refresh_elapsed = path_refresh_started.elapsed();
        assert_eq!(refreshed.notes.len(), note_count);
        assert_eq!(warm_index.metrics().scanned_files, 1);
        assert_eq!(warm_index.metrics().parsed_files, 1);
        eprintln!(
            "large vault: {note_count} notes, fixture {:?}, cold {:?}, warm {:?}, one path {:?}",
            fixture_started.elapsed(),
            cold_elapsed,
            warm_elapsed,
            path_refresh_elapsed
        );

        drop(warm_index);
        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }
}
