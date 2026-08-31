# Slint parity matrix

This file is the acceptance checklist for replacing the React/Tauri shell. A feature is only marked complete after its native implementation, persistence compatibility, and a regression check all pass.

| Area | Original behaviour | Native status | Acceptance check |
| --- | --- | --- | --- |
| Main shell | Timer workspace left, 240–400 px note sidebar right, mobile drawer | Complete (core) | 900×600 and 1280×800 screenshots match hierarchy, spacing and colours |
| Background | Dark zinc canvas, subtle moving beams/dots and card glow | Complete | Animation remains smooth with software renderer and no growing allocations |
| Note index | Recursive Markdown scan, search, preview, parse errors, tags | Complete (core) | Same vault produces the same visible notes and totals |
| Note list | Virtual rows, pinning, edit, preview, Obsidian open, active state | Complete (core) | Every row action works and a large vault keeps stable memory |
| New note | Safe path validation, collision handling, initial time and tags | Complete | New Markdown is compatible with the existing app |
| Timers | Multiple independent monotonic timers, start/pause/discard/save | Complete (core) | Timer drift and duplicate-save tests pass |
| Timer cards | Colour/glow, hundredths, presets, custom estimate, progress, expiry, responsive 1–4 column layouts | Complete (core) | Running card visually matches, wide layouts form the requested grid, and narrow windows fall back without clipping |
| Timer table | Sortable table mode and persisted order | Complete | Mode/order survive restart and match card data |
| Recovery | Checkpoint active timers and restore paused after restart | Complete (core) | Crash/restart scenario restores elapsed value |
| Close guard | Save all, discard all, cancel close | Complete | Active timers cannot be lost accidentally |
| Markdown writes | Atomic frontmatter update preserving body and unrelated fields | Complete (core) | Existing storage compatibility tests pass |
| Activity history | Append operation-safe entries and retain save timestamps | Complete (core) | `activity.json` is interchangeable with React/Tauri |
| Statistics | Overview, all days, breakdown, trends and correlations | Complete (core) | Native totals equal TypeScript fixtures |
| Goals/calendar | Daily target, streak, consistency and heat calendar | Complete (core) | Goal and date-boundary fixtures match |
| Reports | Weekly/monthly Markdown reports and export workflow | Complete (core) | Golden report output matches |
| Settings | General, frontmatter, alerts, goals and vault profiles | Complete (core) | All settings persist in the existing config format |
| Profiles | Detect/create/switch/delete vault profiles | Complete (core) | Existing `.mmST-{nick}` profiles open without migration loss |
| Onboarding | Nick, folder, frontmatter and configuration steps | Complete (core) | Fresh install reaches a working vault without manual files |
| Notifications | Periodic reminder, estimate limit alert, overlay and custom sound | Complete (core) | Enabled/disabled paths and one-shot expiry are tested |
| Languages | Existing 15 language catalogues | Complete (core) | Runtime language switch covers every native screen |
| Updater/integration | Update check/install, native notifications, file/URL opening | Partial (client complete, release server blocked) | Platform boundary checks pass on packaged build |
| Performance | Smooth foreground ticks, low idle work, less than 100 MB release RSS | Complete (Linux validated) | Idle, active timer and large-vault scenarios stay below 100 MB |
| Packaging | Linux/Windows native bundles and release metadata | Complete (build definitions) | Clean release build installs and starts on target platforms |

## Measured native baseline

Release build measured on 2026-08-31 with the software renderer after completion of localization, updater client and packaging, using a 44-note vault:

- idle: 27.5 MB RSS / 18.0 MB PSS, 5.1% of one CPU core;
- four active 50 ms timers: 34.6 MB RSS / 24.7 MB PSS, 17.9% of one CPU core;
- swap usage: 0 MB in both scenarios.

The stripped release binary is 18 MB and the verified Debian package is 6.2 MB. The HTTPS updater and all 15 language catalogues are included in these measurements. The updater has no polling timer and starts network/TLS work only after an explicit user action.

An 80-second four-timer soak stabilized at 34.5 MB RSS / 24.7 MB PSS from the 30-second sample through the final sample, with private dirty memory fixed at 4.7 MB. A separate 2,000-note Markdown vault used 29.6 MB RSS / 20.1 MB PSS and no swap.

## Visual reference

The canonical reference is the running React/Tauri application, not a browser-only Vite page. The latter cannot initialize without the Tauri window metadata. Visual regression snapshots use the same window dimensions and representative running/paused timers.
