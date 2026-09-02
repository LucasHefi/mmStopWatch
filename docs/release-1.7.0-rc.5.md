# mmStopWatch 1.7.0-rc.5 release-candidate gate

Candidate tag: `v1.7.0-rc.5`
Supersedes: `v1.7.0-rc.4` (Debian launcher now uses the installed binary path explicitly)
Release type: GitHub prerelease for testing only

## Linux launcher compatibility

The Debian desktop entry invokes `/usr/bin/mmstopwatch` explicitly. This prevents a stale executable with the same name earlier in the user's `PATH` from being launched instead of the installed package binary.

## Required evidence

The authoritative evidence is the GitHub Actions workflow for tag `v1.7.0-rc.5`:

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

Do not claim this candidate is production-ready until the RC5 workflow and release artifacts are freshly read back.
