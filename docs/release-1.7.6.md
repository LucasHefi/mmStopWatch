# mmStopWatch 1.7.6 — MCP compatibility patch release

## Scope

`v1.7.6` is a patch release of the standalone Slint application. It keeps the local-first Markdown/Obsidian data boundary and adds the verified MCP lifecycle and Hermes handshake corrections.

## Fixed

- MCP stdio `initialize` now requires a valid JSON-RPC request ID; id-less initialize messages remain silent and cannot unlock a session.
- Hermes MCP clients using handshake version `2025-11-25` are accepted while the server continues to advertise protocol version `2025-06-18`.
- MCP server and control-plane status metadata report version `1.7.6` consistently with the native application package.

## Included

- native Slint UI and Rust application;
- Markdown/Obsidian vault compatibility, profiles and `Timework` frontmatter;
- timer lifecycle, checkpoint recovery and conflict-safe atomic writes;
- incremental note index, statistics, reports, notifications and 15 languages;
- Linux x86_64 `.deb`, Windows x86_64 NSIS installer and macOS arm64 `.dmg` when the corresponding tag job passes;
- SHA-256 checksums, build metadata and a strict `latest.json` manifest.

## Verification boundary

The release is complete only when the `v1.7.6` tag workflow is successful and its release URL, asset names, checksums and manifest have been read back from GitHub. A local Linux build does not prove Windows or macOS installation. This release does not claim OS code-signing, notarization, automatic installation, automatic restart or production deployment.
