# mmStopWatch 1.7.2 — stable Slint release

## Scope

`v1.7.2` is the corrected stable release of the standalone Slint application. The former browser implementation is not part of this release and is no longer built by CI.

## Included

- native Slint UI and Rust application;
- Markdown/Obsidian vault compatibility, profiles and `Timework` frontmatter;
- timer lifecycle, checkpoint recovery and conflict-safe atomic writes;
- incremental note index, statistics, reports, notifications and 15 languages;
- Linux x86_64 `.deb`, Windows x86_64 NSIS installer and macOS arm64 `.dmg` when the corresponding tag job passes;
- SHA-256 checksums, build metadata and a strict `latest.json` manifest.

## Update behavior

The application checks the GitHub Release manifest only after an explicit user action. It verifies the manifest shape, semver, platform key, HTTPS GitHub download URL and SHA-256 format, then opens the installer URL in the system browser. It does not download, install or restart itself. OS code-signing/notarization is not claimed by this release.

## Verification boundary

The release is complete only when the tag workflow is successful and its release URL, asset names, checksums and manifest have been read back from GitHub. A local Linux build does not prove Windows or macOS installation. Missing credentials, runner support, asset or manifest keeps the corresponding gate BLOCKED.
