# Changelog

## [1.6.0] - 2026-07-24
### Added
- Cross-platform packaging targets for Linux (`.deb`, AppImage), macOS (`.dmg`, `.app`) and Windows (NSIS, MSI)
- GitHub Actions verification matrix for Linux, macOS and Windows
- Release checksum and build metadata generation
- Runtime vault authorization through Tauri filesystem scope
- Versioned application contracts, safe command envelopes and path-policy test seams for the control-plane roadmap
- Read-only authenticated localhost control-plane boundary for development

### Changed
- Release metadata is aligned at version 1.6.0 across npm, Tauri and Cargo
- Static read/write access to `$HOME/**` and `D:/**` was removed; only the selected vault is authorized at runtime
- Added platform-specific build commands and automated tag-based release packaging

### Open release gate
- The configured updater endpoint still requires production-side JSON metadata and smoke verification before updater functionality can be declared ready.

---

## [1.5.2] - 2026-07-15
### Fixed
- Repeated timer start is now idempotent and no longer resets the monotonic start timestamp
- Vault profile switching preserves explicit zero values and other intentional falsey settings
- Empty inline frontmatter arrays such as `tags: []` now parse as empty arrays
- Updated frontend dependencies to remove all reported npm audit vulnerabilities

### Changed
- Added deterministic Vite vendor chunking; the largest production chunk is reduced from 621.43 kB to approximately 220 kB
- Unified all `@tauri-apps/plugin-fs` consumers on static imports to eliminate mixed-import build warnings
- Added regression coverage for timer pause/resume/stop, persistence failure, multi-profile persistence, and frontmatter edge cases
- Version bumped to 1.5.2 for stable testing

---

## [1.5.1] - 2026-06-16
### Added
- **Vault profiles** - Save and switch between multiple Obsidian vault profiles (Settings → Vaults) with per-vault settings, auto-profile creation on folder select
- **Obsidian vault auto-detection** - Automatic vault name from `.obsidian/app.json` on folder selection, manual fallback
- **Stats by tags & frontmatter fields** - Configurable field extraction (project, client, type), per-field breakdown with progress bars, top 10 ranking
- **Weekly & monthly Markdown reports** - Generate time reports as Obsidian-compatible .md files directly into vault
- **Estimate accuracy stats** - Plan vs reality: average overrun/saving, met/missed count, trend over period
- **Note creation modal** - Create .md notes with frontmatter, tags, collision detection, auto-open in Obsidian
- **In-place session edit** - Edit title and duration with live preview via EditModal
- **Note content preview** - PreviewModal showing first ~120 characters of note content
- **Open note in Obsidian** - Deep link `obsidian://open` button for current note
- **Pin/unpin notes** - Pin notes to top of sidebar, persisted in MDConfig
- **Timer discard with 10s undo** - Undo timer discard with elapsed time restoration
- **Configurable auto-refresh polling** - Note list refresh at configurable intervals (0/1/2/5/10/15/30 min)
- **Periodic OS notifications** - Configurable periodic notifications for running timers (0/5/10/15/30/60/120 min)
- **Color-coded timers** - 20-color palette auto-assigned per timer for visual distinction
- **View mode toggle** - Card/table/grid layouts (list, grid-2, grid-3, grid-4) with persistence
- **Drag-and-drop layout persistence** - Reorder timers via DnD with persistent order in config
- **Round times config option** - Round recorded times to whole minutes (Settings → General)
- **Auto-update HTTP version check** - Check for new version via HTTP endpoint with release page link
- **Animated SVG background** - Gradient beams animation via framer-motion
- **Show all timers in main view** - Display IDLE/PAUSED/RUNNING timers instead of only running
- **i18n: New translations** - Keys for vault profiles, stats fields, reports, and new UI (cs + en)
### Fixed
- **Zustand selector stabilization** - Infinite re-render loop from `selectRunningTimers` fixed via `useShallow` memoization
- **Timer blank on mount** - `useTimerTick` initializes `elapsed` from `pausedOffset` instead of `0`, fixing empty display on first open and after undo
- **Tauri window permissions** - Added missing `core:window:allow-set-title` and `core:window:allow-destroy`
- **Timer not created on sidebar click** - `openNote()` now calls `addTimer()` from `timersStore` when clicking session
- **TimerGrid table view invalid HTML** - `DndContext` moved outside `<table>`, `SortableContext` wraps only `<tbody>`
- **Session restore loses elapsed time** - `undoDelete()` passes `timerState` with correct `elapsed`/`pausedOffset` to `openNote()`
- **Progress bar hidden without time estimate** - Display logic fixed for timers without estimate
- **Added time resets to 0 on pause** - Added time display freezes at accumulated value instead of resetting
### Changed
- Sidebar breakpoint: 1024px → 800px
- TimerGrid: removed `max-w-2xl` constraint for full-width cards
- SecondaryTimerCard hover: `scale` → `translateY` to prevent grid layout shift
- StatsModal split into sub-components (Overview, AllDays, Calendar, Breakdown, Trends)
- OnboardingWizard split into step components
- Removed redundant "Načíst složku" button from right panel (folder selection stays in Settings)
- Added unit tests for stats service
- Version bumped to 1.5.1

---

## [1.5.0] - 2026-05-26
### Added
- **Onboarding wizard** - First-run wizard with nick, folder selection, and basic configuration steps
- **.mmST-{nick} storage** - Config, activity history, and deleted sessions now stored in `{notesFolder}/.mmST-{nick}/` directory
- **Nick property** - User nick gets propagated into folder name for multi-user vault support
- **Settings: Nick input** - Edit nick in Settings → General tab
- **appConfig service** - Centralized file-based config storage with localStorage fallback
- **Multi-nick statistics** - Stats modal now shows user-switching tabs when multiple `.mmST-{nick}` directories exist in the notes folder
- **listAvailableNicks()** - Scans notes folder for `.mmST-*` directories and returns discovered nicks
- **activityService: loadHistoryForNick()** - Read-only loading of activity data for any nick into an in-memory cache (no conflict with active nick's data)
- **i18n: switchNick** - New translation key for nick switcher UI
### Changed
- `activityService.ts` - Saves to `.mmST-{nick}/activity.json` instead of `.mmhistory.json` in vault root
- `sessionStore.ts` - Uses appConfig for config/deleted sessions persistence with file-based storage
- `MDConfig` type now includes `nick?: string` and `onboardingComplete?: boolean`
- i18n: Added `nick` translation key for cs and en
- Version bumped to 1.5.0

---

## [1.4.5] - 2026-05-26
### Added
- **Stats modal redesign** - Fullscreen overlay with responsive layout (max-w-3xl, 90vh scrollable) and 4 view modes: Overview, All Days, Calendar, Breakdown
- **Chart tooltips** - Hover on 7-day bar chart shows animated tooltip with date and formatted time
- **All Days view** - Date range filter (from/to) with scrollable list of all active days, progress bars, and percentage of daily goal
- **Calendar view** - Monthly grid with color intensity (emerald gradient), goal-reached border indicator, tooltip on hover, month navigation, and legend
- **Breakdown view** - Per-note time breakdown (top 15 notes sorted by total) + hourly distribution histogram (24h bar chart)
- **Extended stats** - Streak counter (consecutive days), consistency score (% of days meeting goal), weekly trend comparison with delta (↑↓ percentage)
- **Hourly distribution** - 24-bar chart showing activity intensity by hour of day
- **Reálný čas uložení (saved_at)** - Added `saved_at` field to `ActivityEntry`, logged on every activity save
- **Enhanced MD export** - Added Overview section (total, avg, longest, days tracked), Per-Note Breakdown table, and Saved At column in detailed log; accepts optional filtered entries array
- **New i18n keys** - 30+ new translation keys for all new UI elements (cs + en)
### Changed
- Version bumped to 1.4.5
- `computeAllDays()` - Returns all days in date range with session details
- `computeNoteBreakdown()` - Aggregates time per note across all entries
- `computeWeeklyTrend()` - Compares current vs previous week totals, avg, days above goal, delta %
- `computeStreak()` - Counts consecutive active days (requires today or yesterday)
- `computeConsistency()` - % of days meeting daily goal in given period
- `computeCalendarMonth()` - Generates padded calendar grid with goal percentages
- `computeHourlyDistribution()` - 24h time-of-day activity breakdown
- `exportToMd()` now accepts optional `filteredEntries` parameter for scoped exports

---

## [1.4.3] - 2026-05-26
### Removed
- **PrimaryTimerCard** - Removed unused component and its dependencies (`timerStore`), migrated fully to `SecondaryTimerCard` + `timersStore`
### Changed
- Version bumped to 1.4.3
- Cleaned up imports and dead code in `App.tsx`

---

## [1.4.2] - 2026-05-26
### Added
- **Expiration overlay for secondary timer cards** - Customizable overlay with OK button appears when timer limit is reached
- **Custom expiration message** - Configure custom text message for timer expiration overlay in Settings → Notifications
- **Overlay toggle** - Enable/disable overlay display in Settings → Notifications
### Changed
- Version bumped to 1.4.2
- Enhanced timer expiration notification with visual overlay feedback
- Settings modal: Added overlay toggle and custom message fields to timer limit alert configuration

---

## [1.4.1] - 2026-05-26
### Added
- **Timer limit expiration alerts** - Configure sound and notification alerts when secondary timer cards exceed their time estimate
- **Remaining time countdown** - Shows "zbývá Xm Ys" on timer cards with time estimates
- **Visual expiration indicator** - Pulsing red border and text color when timer exceeds limit
- **Progress percentage display** - 0-100% progress bar with percentage text on timer cards
- **Sound file selector** - Choose custom audio file (MP3/WAV/OGG/M4A/AAC) for expiration alerts in Settings → Notifications
- **Windows notification for expiration** - Option to send native Windows notification when timer limit expires
### Changed
- Version bumped to 1.4.1
- Enhanced SecondaryTimerCard with remaining time countdown and visual progress feedback
- Settings modal: Added "Upozornění" tab with timer limit alert configuration

---

## [1.4.0] - 2026-05-22
### Added
- **Undo toast for deleted sessions** - Animated toast with progress bar appears after session deletion, providing 30s window to undo via undoDelete button
- **Per-note timeEstimate** - Set custom time estimate for each note/poznámku directly on the timer card
- **Time estimate presets** - Quick presets (15, 25, 30, 45, 60, 90, 120 min) for setting time estimates
- **Inline time estimate editor** - Edit time estimate directly on the timer card with pencil icon
- **Time estimate progress bar** - Visual progress indicator showing % complete, remaining time, and completion status
- **Settings: Time Estimate Presets** - Manage global time estimate presets in Settings → Target tab
- **Statistics dashboard** - Daily goal progress bar, 7-day chart, top days ranking
- **Daily goal setting** - Set custom daily time goal in Settings → Target tab
- **Auto-update support** - Tauri updater configured for mediamaker.cz release endpoint
- **Stats button** in sidebar for quick access to statistics

### Fixed
- Null tags crash when editing sessions with missing tags data
- Session count now reflects filtered sessions, not all sessions
- Improved tag handling for Obsidian compatibility

### Changed
- Improved icons: unified all UI to lucide-react (replaced 📊⚙↻⚠✎✕✓ with BarChart3/Settings/RefreshCw/AlertTriangle/Pencil/X/Check)
- Settings modal now has dedicated "Target" tab for goals and time estimates
- Round times replaced with per-note timeEstimate feature
- Version bumped to 1.4.0

---

## [1.3.8] - 2026-05-10
### Fixed
- Various bug fixes and improvements

---

## [1.3.7] - 2026-04-20
### Added
- Multi-language support (15 languages)
- Improved Obsidian integration

---

## [1.3.6] - 2026-03-15
### Fixed
- Notification improvements
- UI polish

---

## [1.3.5] - 2026-02-28
### Added
- Dark theme
- Multiple timer support

---

## [1.3.0] - 2025-12-01
### Added
- Initial Tauri desktop app
- Markdown storage backend
- Obsidian vault support

---