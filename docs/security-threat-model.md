# mmStopWatch security model — Slint Native

Status: stable local-first desktop boundary

## Trust boundaries

| Boundary | Trust level | Required controls |
| --- | --- | --- |
| Slint UI → Rust services | local application | typed state transitions, validated input, visible error states |
| Rust services → selected vault | user data | canonical root containment, relative Markdown path policy, symlink escape rejection |
| Rust services → local SQLite index | rebuildable cache | schema/version validation, corruption quarantine, Markdown remains source of truth |
| Explicit update check → GitHub | untrusted remote input | HTTPS allowlist, strict JSON, semver, platform entry, URL and SHA-256 validation |
| Downloaded installer → operating system | external artifact | user-visible manual installation, checksum comparison, no silent execution |

## Invariants

1. No remote control plane, telemetry, account or background network polling is packaged.
2. Only the user-selected vault is readable/writable; relative note paths cannot escape it.
3. External Markdown changes are detected before a write; no silent overwrite is allowed.
4. Corrupt config/index/activity data fails visibly or rebuilds from the authoritative source; it is never replaced by an empty success state.
5. Update metadata is data, not authority: HTML, malformed JSON, wrong host, invalid version, missing platform asset or malformed checksum is rejected.
6. Update action opens a URL only after the manifest passes validation; the app does not auto-install or restart.
7. Secrets, private keys, tokens and passwords never appear in source, release assets or logs.

## Release boundary

GitHub Release assets are checksummed but this project does not claim OS code-signing or notarization for `v1.7.3`. Users must compare the published checksum before manually running an installer. Future signing/notarization work is a separate release gate, not implied by a checksum.
