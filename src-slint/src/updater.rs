use semver::Version;
use serde::Deserialize;
use std::collections::HashMap;

pub const UPDATE_ENDPOINT: &str =
    "https://github.com/LucasHefi/mmStopWatch/releases/latest/download/latest.json";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateCheck {
    pub version: String,
    pub notes: String,
    pub download_url: Option<String>,
    pub sha256: Option<String>,
    pub available: bool,
}

#[derive(Debug, Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    platforms: HashMap<String, PlatformArtifact>,
}

#[derive(Debug, Deserialize)]
struct PlatformArtifact {
    url: String,
    sha256: String,
}

pub fn check(current_version: &str) -> Result<UpdateCheck, String> {
    let response = minreq::get(UPDATE_ENDPOINT)
        .with_timeout(10)
        .send()
        .map_err(|error| format!("server aktualizací není dostupný: {error}"))?;
    if response.status_code != 200 {
        return Err(format!(
            "server aktualizací vrátil stav {}",
            response.status_code
        ));
    }
    parse_manifest(
        response.as_str().map_err(|error| error.to_string())?,
        current_version,
    )
}

fn parse_manifest(raw: &str, current_version: &str) -> Result<UpdateCheck, String> {
    let manifest: UpdateManifest =
        serde_json::from_str(raw).map_err(|error| format!("neplatný update manifest: {error}"))?;
    let current = normalized_version(current_version)?;
    let remote = normalized_version(&manifest.version)?;
    let artifact = platform_keys()
        .iter()
        .find_map(|key| manifest.platforms.get(*key));
    if let Some(artifact) = artifact {
        validate_artifact(artifact)?;
    }
    Ok(UpdateCheck {
        version: manifest.version,
        notes: manifest.notes,
        download_url: artifact.map(|artifact| artifact.url.clone()),
        sha256: artifact.map(|artifact| artifact.sha256.clone()),
        available: remote > current,
    })
}

fn validate_artifact(artifact: &PlatformArtifact) -> Result<(), String> {
    let Some(release_asset) = artifact
        .url
        .strip_prefix("https://github.com/LucasHefi/mmStopWatch/releases/download/")
    else {
        return Err("update manifest obsahuje nepovolenou URL instalátoru".into());
    };
    let mut path_parts = release_asset.split('/');
    let tag = path_parts.next().unwrap_or_default();
    let asset = path_parts.next().unwrap_or_default();
    if tag.is_empty()
        || asset.is_empty()
        || path_parts.next().is_some()
        || release_asset.chars().any(char::is_whitespace)
        || asset.contains('?')
        || asset.contains('#')
    {
        return Err("update manifest obsahuje nepovolenou URL instalátoru".into());
    }
    if artifact.sha256.len() != 64 || !artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err("update manifest obsahuje neplatný sha256 checksum".into());
    }
    Ok(())
}

fn normalized_version(value: &str) -> Result<Version, String> {
    Version::parse(value.trim().trim_start_matches('v'))
        .map_err(|error| format!("neplatná verze „{value}“: {error}"))
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn platform_keys() -> &'static [&'static str] {
    &["linux-x86_64", "linux-x86_64-gnu"]
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn platform_keys() -> &'static [&'static str] {
    &["windows-x86_64", "windows-x86_64-msvc"]
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn platform_keys() -> &'static [&'static str] {
    &["darwin-aarch64", "macos-aarch64", "darwin-aarch64-app"]
}

#[cfg(not(any(
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "aarch64")
)))]
fn platform_keys() -> &'static [&'static str] {
    &["unsupported"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_github_manifest_and_compares_prereleases() {
        let key = platform_keys()[0];
        let raw = format!(
            r#"{{"version":"1.7.1","notes":"Fixes","platforms":{{"{key}":{{"url":"https://github.com/LucasHefi/mmStopWatch/releases/download/v1.7.1/mmstopwatch-installer","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}}}"#
        );
        let update = parse_manifest(&raw, "1.7.0-rc.5").expect("valid manifest");
        assert!(update.available);
        assert_eq!(
            update.download_url.as_deref(),
            Some(
                "https://github.com/LucasHefi/mmStopWatch/releases/download/v1.7.1/mmstopwatch-installer"
            )
        );
        assert_eq!(
            update.sha256.as_deref(),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
    }

    #[test]
    fn rejects_missing_or_invalid_checksum() {
        let key = platform_keys()[0];
        let missing = format!(
            r#"{{"version":"1.7.1","platforms":{{"{key}":{{"url":"https://github.com/LucasHefi/mmStopWatch/releases/download/v1.7.1/app"}}}}}}"#
        );
        assert!(parse_manifest(&missing, "1.7.0").is_err());

        let invalid_length = format!(
            r#"{{"version":"1.7.1","platforms":{{"{key}":{{"url":"https://github.com/LucasHefi/mmStopWatch/releases/download/v1.7.1/app","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}}}"#
        );
        assert!(parse_manifest(&invalid_length, "1.7.0").is_err());

        let invalid_hex = format!(
            r#"{{"version":"1.7.1","platforms":{{"{key}":{{"url":"https://github.com/LucasHefi/mmStopWatch/releases/download/v1.7.1/app","sha256":"gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg"}}}}}}"#
        );
        assert!(parse_manifest(&invalid_hex, "1.7.0").is_err());
    }

    #[test]
    fn rejects_non_github_release_host() {
        let key = platform_keys()[0];
        let raw = format!(
            r#"{{"version":"1.7.1","platforms":{{"{key}":{{"url":"https://example.test/LucasHefi/mmStopWatch/releases/download/v1.7.1/app","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}}}"#
        );
        assert!(parse_manifest(&raw, "1.7.0").is_err());
    }

    #[test]
    fn rejects_invalid_or_older_versions() {
        assert!(parse_manifest(r#"{"version":"tomorrow"}"#, "1.7.0").is_err());
        let key = platform_keys()[0];
        let raw = format!(
            r#"{{"version":"1.6.0","platforms":{{"{key}":{{"url":"https://github.com/LucasHefi/mmStopWatch/releases/download/v1.6.0/app","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}}}"#
        );
        let update = parse_manifest(&raw, "1.7.0").expect("valid older manifest");
        assert!(!update.available);
    }
}
