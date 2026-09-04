# Slint native application

`src-slint` is the only production desktop target. It is a Rust application with a Slint UI and no browser, WebView, JavaScript or package-manager runtime.

## Local development

```bash
cargo fmt --manifest-path Cargo.toml -- --check
cargo test --manifest-path Cargo.toml --locked
cargo clippy --manifest-path Cargo.toml --all-targets --locked -- -D warnings
cargo run --manifest-path Cargo.toml
```

The application reads and writes Markdown notes in an Obsidian vault. Markdown remains the source of truth; the local SQLite projection is rebuildable and never stored in the synchronized vault.

## Packaging

- Linux amd64: `packaging/linux/package-deb.sh`
- Windows x86_64: `packaging/windows/mmstopwatch.nsi`
- macOS arm64: `packaging/macos/package-dmg.sh`

Every package job generates a SHA-256 checksum and build metadata. The stable release workflow publishes only artifacts that have been checked against those values.

## Release/update boundary

The native app checks the public GitHub Release manifest at:

`https://github.com/LucasHefi/mmStopWatch/releases/latest/download/latest.json`

The check validates HTTPS, the repository URL, semantic versions, the platform key, artifact name, byte size and SHA-256 format. It never silently installs or executes an update; the user opens the verified release download URL explicitly.
