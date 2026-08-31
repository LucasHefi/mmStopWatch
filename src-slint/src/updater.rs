use semver::Version;
use serde::Deserialize;
use std::collections::HashMap;

pub const UPDATE_ENDPOINT: &str = "https://mediamaker.cz/mmstopwatch/release/latest.json";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpdateCheck {
    pub version: String,
    pub notes: String,
    pub download_url: Option<String>,
    pub signature: Option<String>,
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
    #[serde(default)]
    signature: String,
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
    Ok(UpdateCheck {
        version: manifest.version,
        notes: manifest.notes,
        download_url: artifact.map(|artifact| artifact.url.clone()),
        signature: artifact
            .map(|artifact| artifact.signature.trim().to_owned())
            .filter(|signature| !signature.is_empty()),
        available: remote > current,
    })
}

fn normalized_version(value: &str) -> Result<Version, String> {
    Version::parse(value.trim().trim_start_matches('v'))
        .map_err(|error| format!("neplatná verze „{value}“: {error}"))
}

#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn platform_keys() -> [&'static str; 2] {
    ["linux-x86_64", "linux-x86_64-gnu"]
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn platform_keys() -> [&'static str; 2] {
    ["windows-x86_64", "windows-x86_64-msvc"]
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn platform_keys() -> [&'static str; 2] {
    ["darwin-aarch64", "darwin-aarch64-app"]
}

#[cfg(not(any(
    all(target_os = "linux", target_arch = "x86_64"),
    all(target_os = "windows", target_arch = "x86_64"),
    all(target_os = "macos", target_arch = "aarch64")
)))]
fn platform_keys() -> [&'static str; 2] {
    ["unsupported", "unsupported"]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tauri_compatible_manifest_and_compares_prereleases() {
        let key = platform_keys()[0];
        let raw = format!(
            r#"{{"version":"1.7.1","notes":"Fixes","platforms":{{"{key}":{{"url":"https://example.test/app","signature":"signed"}}}}}}"#
        );
        let update = parse_manifest(&raw, "1.7.0-rc.5").expect("valid manifest");
        assert!(update.available);
        assert_eq!(
            update.download_url.as_deref(),
            Some("https://example.test/app")
        );
        assert_eq!(update.signature.as_deref(), Some("signed"));
    }

    #[test]
    fn rejects_invalid_or_older_versions() {
        assert!(parse_manifest(r#"{"version":"tomorrow"}"#, "1.7.0").is_err());
        let update =
            parse_manifest(r#"{"version":"1.6.0"}"#, "1.7.0").expect("valid older manifest");
        assert!(!update.available);
    }
}
