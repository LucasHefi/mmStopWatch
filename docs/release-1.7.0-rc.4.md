# mmStopWatch 1.7.0-rc.4 release-candidate gate

Candidate tag: `v1.7.0-rc.4`
Supersedes: `v1.7.0-rc.3` (hardening changes and test artifacts refreshed)
Release type: GitHub prerelease for testing only

## Windows MSI compatibility

Tauri's MSI backend requires a numeric-only prerelease identifier no greater than 65535. The RC4 workflow derives a Windows-only bundle version from the public package version (`1.7.0-rc.4` → `1.7.0-4`), writes an ignored temporary Tauri config overlay, and passes it only to the Windows bundle job. The release metadata records both the public version and the bundle version. Linux/macOS builds use the public version unchanged.

## Required evidence

The authoritative evidence is the GitHub Actions workflow for tag `v1.7.0-rc.4`:

- verify: Windows, Ubuntu and macOS tests/build/Tauri checks
- package: Linux `.deb`/AppImage, macOS `.dmg`/`.app`, Windows NSIS/MSI
- metadata and checksums for each platform
- release asset staging and prerelease readback

A local Linux PASS is supplementary and does not close the native platform gates.

## Remaining open gates

- updater `latest.json`, signing/public-key verification and rollback
- install/startup/uninstall smoke on physical target environments
- real timer/note/profile/config mutation backend handlers
- owner approval for external publication

Do not claim this candidate is production-ready until the RC4 workflow and release artifacts are freshly read back.
