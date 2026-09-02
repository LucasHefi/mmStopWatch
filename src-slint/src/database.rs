use rusqlite::Connection;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DATABASE_DIRECTORY_NAME: &str = "mmstopwatch-native/indexes";

pub fn data_directory() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let base = std::env::var_os("LOCALAPPDATA")
        .or_else(|| std::env::var_os("APPDATA"))
        .map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library/Application Support"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share")));

    base.map(|path| path.join(DATABASE_DIRECTORY_NAME))
}

pub fn path_for_vault(directory: &Path, root: &Path) -> PathBuf {
    directory.join(format!("notes-{:016x}.sqlite3", stable_path_hash(root)))
}

pub fn open(path: &Path) -> io::Result<Connection> {
    let connection = Connection::open(path).map_err(sql_error)?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(sql_error)?;
    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(sql_error)?;
    connection
        .pragma_update(None, "synchronous", "NORMAL")
        .map_err(sql_error)?;
    connection
        .pragma_update(None, "foreign_keys", true)
        .map_err(sql_error)?;
    Ok(connection)
}

pub fn quarantine(path: &Path) -> io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let quarantine = path.with_extension(format!("corrupt-{timestamp}.sqlite3"));
    fs::rename(path, quarantine)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", path.to_string_lossy()));
        if sidecar.exists() {
            let _ = fs::remove_file(sidecar);
        }
    }
    Ok(())
}

pub fn sql_error(error: rusqlite::Error) -> io::Error {
    io::Error::other(format!("lokální databáze: {error}"))
}

fn stable_path_hash(path: &Path) -> u64 {
    path.to_string_lossy()
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}
