# Native packaging

The package scripts build the standalone Slint desktop binary and write artifacts below `target/packages` without modifying the source tree.

## Targets

- Linux amd64: `packaging/linux/package-deb.sh`
- Windows x86_64: `packaging/windows/mmstopwatch.nsi`
- macOS arm64: `packaging/macos/package-dmg.sh`

The desktop packages install the same `mmstopwatch` binary and use the same local Markdown/SQLite data boundary. Package jobs emit a checksum and build metadata file; the release job validates both before publishing.

The release is intentionally transparent about platform signing/notarization: the current workflow publishes unsigned installers with SHA-256 integrity metadata. It does not claim automatic installation or trust a mutable third-party endpoint.
