use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, Write},
    path::{Component, Path, PathBuf},
};
use walkdir::{DirEntry, WalkDir};

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
    len: u64,
    modified_ns: u128,
}

#[derive(Clone, Debug)]
struct CachedNote {
    signature: FileSignature,
    note: Note,
    warnings: Vec<String>,
}

/// Incremental vault index. Directory walking and cheap metadata checks still
/// happen on refresh, but unchanged Markdown files are not read or parsed
/// again. This keeps refresh latency predictable for vaults with thousands of
/// notes without introducing a database or another file in the user's vault.
#[derive(Debug, Default)]
pub struct NoteIndex {
    options_signature: String,
    entries: HashMap<PathBuf, CachedNote>,
    cache_hits: usize,
}

impl NoteIndex {
    pub fn cache_hits(&self) -> usize {
        self.cache_hits
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

        let options_signature = format!(
            "{key}\u{1f}{estimate_key}\u{1f}{}",
            field_keys.join("\u{1e}")
        );
        if self.options_signature != options_signature {
            self.entries.clear();
            self.options_signature = options_signature;
        }
        self.cache_hits = 0;

        let mut notes = Vec::new();
        let mut warnings = Vec::new();
        let mut active = HashSet::new();
        let walker = WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(is_visible_note_entry);

        for entry in walker {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    warnings.push(format!("Nelze projít položku: {error}"));
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

            let path = entry.path().to_path_buf();
            active.insert(path.clone());
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    warnings.push(format!(
                        "{}: nelze načíst metadata ({error})",
                        path.display()
                    ));
                    continue;
                }
            };
            let signature = FileSignature {
                len: metadata.len(),
                modified_ns: metadata
                    .modified()
                    .ok()
                    .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |value| value.as_nanos()),
            };

            if let Some(cached) = self.entries.get(&path)
                && cached.signature == signature
            {
                self.cache_hits += 1;
                notes.push(cached.note.clone());
                warnings.extend(cached.warnings.iter().cloned());
                continue;
            }

            match parse_note_file(root, &path, key, estimate_key, field_keys) {
                Ok((note, note_warnings)) => {
                    notes.push(note.clone());
                    warnings.extend(note_warnings.iter().cloned());
                    self.entries.insert(
                        path,
                        CachedNote {
                            signature,
                            note,
                            warnings: note_warnings,
                        },
                    );
                }
                Err(error) => warnings.push(format!("{}: nelze přečíst ({error})", path.display())),
            }
        }
        self.entries.retain(|path, _| active.contains(path));
        notes.sort_by_key(|note| note.name.to_lowercase());
        Ok(NoteScan { notes, warnings })
    }
}

#[cfg(test)]
pub fn scan_notes_detailed(
    root: &Path,
    key: &str,
    estimate_key: &str,
    field_keys: &[String],
) -> io::Result<NoteScan> {
    NoteIndex::default().scan(root, key, estimate_key, field_keys)
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
        .and_then(|yaml| frontmatter_value(yaml, "tags"))
        .map(parse_tags)
        .unwrap_or_default();
    let fields = field_keys
        .iter()
        .filter_map(|field| {
            let values = frontmatter
                .and_then(|yaml| frontmatter_value(yaml, field))
                .map(parse_tags)
                .unwrap_or_default();
            (!values.is_empty()).then(|| (field.clone(), values))
        })
        .collect();
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned();
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
    fn parses_supported_time_formats() {
        assert_eq!(parse_time_ms("01:02:03"), Some(3_723_000));
        assert_eq!(parse_time_ms("12:34"), Some(754_000));
        assert_eq!(parse_time_ms("90"), Some(90_000));
        assert_eq!(parse_time_ms("00:61"), None);
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
        fs::write(&note, "---\nTimework: 00:01:00\n---\nFirst body\n").expect("write fixture");

        let mut index = NoteIndex::default();
        let first = index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("first scan");
        assert_eq!(first.notes[0].duration_ms, 60_000);
        assert_eq!(index.cache_hits(), 0);

        let second = index
            .scan(&vault, "Timework", "timeEstimate", &[])
            .expect("cached scan");
        assert_eq!(second.notes.len(), 1);
        assert_eq!(index.cache_hits(), 1);

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

        fs::remove_dir_all(&vault).expect("remove temporary vault");
    }
}
