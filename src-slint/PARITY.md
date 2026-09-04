# Slint parity checklist

This document is the acceptance boundary for the standalone native application. A feature is complete only when the Rust implementation, Markdown compatibility and regression tests agree.

| Area | Stable native behavior | Status | Evidence |
| --- | --- | --- | --- |
| Vault configuration | Reads the existing vault path and profile settings | Complete | `config.rs` tests |
| Activity history | Appends operation-safe entries and preserves timestamps | Complete | `activity.rs` tests |
| Markdown notes | Preserves frontmatter/body and updates only the exact time field | Complete | `storage.rs` tests |
| Persistent index | Rebuilds safely, quarantines corruption and invalidates parser changes | Complete | `storage.rs` tests |
| Timers | Supports start, pause, resume, stop, ordering and recovery | Complete | `timer.rs`, `app_state.rs` tests |
| Statistics | Calendar, streaks, goals, breakdowns and trends use deterministic calculations | Complete | `stats.rs` tests |
| Reports | Produces compatible Markdown reports with goals and estimates | Complete | `report.rs` tests |
| Notifications | Expiration alerts are bounded and claimed once | Complete | `notification.rs` tests |
| Updates | Checks a strict GitHub Release manifest and opens a user-selected download | Complete | `updater.rs` tests |
| Accessibility | UI labels and keyboard paths remain part of the native acceptance pass | Open | `docs/acceptance.md` |
| Cross-platform packaging | Linux amd64, Windows x86_64 and macOS arm64 jobs are defined | Open until CI | `.github/workflows/slint-native-release.yml` |

## Acceptance rule

A release may be tagged only after all automated rows pass and every platform-specific packaging/accessibility row has fresh CI evidence. Local Linux evidence does not substitute for Windows or macOS runtime evidence.
