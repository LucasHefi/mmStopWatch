use std::{io, process::Command};

pub fn open_url(url: &str) -> io::Result<()> {
    platform_open(url)
}

#[cfg(target_os = "linux")]
fn platform_open(url: &str) -> io::Result<()> {
    Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
fn platform_open(url: &str) -> io::Result<()> {
    Command::new("open").arg(url).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn platform_open(url: &str) -> io::Result<()> {
    Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn()
        .map(|_| ())
}

pub fn obsidian_url(vault: &str, relative_path: &str) -> String {
    format!(
        "obsidian://open?vault={}&file={}",
        percent_encode(vault),
        percent_encode(relative_path)
    )
}

fn percent_encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(char::from(byte));
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_safe_obsidian_url() {
        assert_eq!(
            obsidian_url("My Vault", "Project/článek.md"),
            "obsidian://open?vault=My%20Vault&file=Project%2F%C4%8Dl%C3%A1nek.md"
        );
    }
}
