# Slint parity matrix

This file is the acceptance checklist for replacing the React/Tauri shell. A feature is only marked complete after its native implementation, persistence compatibility, and a regression check all pass.

| Area | Original behaviour | Native status | Acceptance check |
| --- | --- | --- | --- |
| Main shell | Timer workspace left, 240–400 px note sidebar right, mobile drawer | Partial | 900×600 and 1280×800 screenshots match hierarchy, spacing and colours |
| Background | Dark zinc canvas, subtle moving beams/dots and card glow | In progress | Animation remains smooth with software renderer and no growing allocations |
| Note index | Recursive Markdown scan, search, preview, parse errors, tags | Partial | Same vault produces the same visible notes and totals |
| Note list | Virtual rows, pinning, edit, preview, Obsidian open, active state | Partial | Every row action works and a large vault keeps stable memory |
| New note | Safe path validation, collision handling, initial time and tags | Complete | New Markdown is compatible with the existing app |
| Timers | Multiple independent monotonic timers, start/pause/discard/save | Complete (core) | Timer drift and duplicate-save tests pass |
| Timer cards | Colour/glow, hundredths, presets, custom estimate, progress, expiry | In progress | Running card visually matches and all controls work |
| Timer table | Sortable table mode and persisted order | Partial | Mode/order survive restart and match card data |
| Recovery | Checkpoint active timers and restore paused after restart | Complete (core) | Crash/restart scenario restores elapsed value |
| Close guard | Save all, discard all, cancel close | Complete | Active timers cannot be lost accidentally |
| Markdown writes | Atomic frontmatter update preserving body and unrelated fields | Complete (core) | Existing storage compatibility tests pass |
| Activity history | Append operation-safe entries and retain save timestamps | Complete (core) | `activity.json` is interchangeable with React/Tauri |
| Statistics | Overview, all days, breakdown, trends and correlations | Partial | Native totals equal TypeScript fixtures |
| Goals/calendar | Daily target, streak, heat calendar | Missing | Goal and date-boundary fixtures match |
| Reports | Weekly/monthly Markdown reports and export workflow | Partial | Golden report output matches |
| Settings | General, frontmatter, alerts, goals and vault profiles | Partial | All settings persist in the existing config format |
| Profiles | Detect/create/switch/delete vault profiles | Missing | Existing `.mmST-{nick}` profiles open without migration loss |
| Onboarding | Nick, folder, frontmatter and configuration steps | Partial | Fresh install reaches a working vault without manual files |
| Notifications | Periodic reminder, estimate limit alert, overlay and custom sound | Partial | Enabled/disabled paths and one-shot expiry are tested |
| Languages | Existing 15 language catalogues | Missing | Runtime language switch covers every native screen |
| Updater/integration | Update check/install, native notifications, file/URL opening | Missing | Platform boundary checks pass on packaged build |
| Performance | Smooth foreground ticks, low idle work, less than 100 MB release RSS | Partial | Idle, active timer and large-vault scenarios stay below 100 MB |
| Packaging | Linux/Windows native bundles and release metadata | Missing | Clean release build installs and starts on target platforms |

## Visual reference

The canonical reference is the running React/Tauri application, not a browser-only Vite page. The latter cannot initialize without the Tauri window metadata. Visual regression snapshots use the same window dimensions and representative running/paused timers.
