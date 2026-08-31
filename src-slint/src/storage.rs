use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use walkdir::{DirEntry, WalkDir};

#[derive(Clone, Debug)]
pub struct Note {
    pub path: PathBuf,
    pub name: String,
    pub relative_path: String,
    pub duration_ms: u64,
    pub preview: String,
}

pub fn scan_notes(root: &Path, key: &str) -> io::Result<Vec<Note>> {
    validate_key(key)?;
    if !root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "vybraná složka neexistuje",
        ));
    }

    let mut notes = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(is_visible_note_entry);

    for entry in walker.filter_map(Result::ok) {
        if !entry.file_type().is_file()
            || !entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let (frontmatter, body) = split_frontmatter(&content);
        let duration_ms = frontmatter
            .and_then(|yaml| frontmatter_value(yaml, key))
            .and_then(parse_time_ms)
            .unwrap_or(0);
        let relative_path = entry
            .path()
            .strip_prefix(root)
            .unwrap_or(entry.path())
            .to_string_lossy()
            .into_owned();
        let name = entry
            .path()
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("Poznámka")
            .to_owned();
        notes.push(Note {
            path: entry.path().to_path_buf(),
            name,
            relative_path,
            duration_ms,
            preview: make_preview(body),
        });
    }
    notes.sort_by_key(|note| note.name.to_lowercase());
    Ok(notes)
}

pub fn write_total_duration(path: &Path, key: &str, total_ms: u64) -> io::Result<()> {
    validate_key(key)?;
    let content = fs::read_to_string(path)?;
    let updated = update_frontmatter(&content, key, &format_time(total_ms));
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

        let notes = scan_notes(&vault, "Timework").expect("scan temporary vault");
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
}
