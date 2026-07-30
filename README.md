# mmStopWatch

[![Version](https://img.shields.io/badge/version-1.7.0-rc.1-2563eb?logo=semantic-release&logoColor=white)](CHANGELOG.md)
[![CI](https://github.com/LucasHefi/mmStopWatch/actions/workflows/verify-and-release.yml/badge.svg?branch=main)](https://github.com/LucasHefi/mmStopWatch/actions/workflows/verify-and-release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)

[![React](https://img.shields.io/badge/React-19.1-61DAFB?logo=react&logoColor=111827)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-2021-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Vitest](https://img.shields.io/badge/Vitest-4-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Zustand](https://img.shields.io/badge/Zustand-5-443E38)](https://zustand.docs.pmnd.rs/)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI-2088FF?logo=githubactions&logoColor=white)](https://github.com/LucasHefi/mmStopWatch/actions)

A lightweight local desktop stopwatch that integrates directly with Markdown notes and Obsidian-style vaults. Track time in frontmatter fields, manage sessions, generate reports, and keep the data in your selected notes folder.

## Current status

- **Application version:** `1.7.0-rc.1`
- **Platforms:** Windows, Linux and macOS bundles are configured
- **CI:** pull requests and pushes to `main` run tests, the frontend build and `cargo check` on all three operating systems
- **Releases:** tags matching `v*` build platform installers and publish a GitHub Release
- **Control plane:** an authenticated, read-only localhost development API is available explicitly through `npm run control-plane:dev`
- **MCP:** a stdio JSON-RPC adapter is available through `npm run mcp:stdio`; it exposes only the read-only API boundary and never exposes mutation tools
- **CLI:** the versioned `mmstopwatch` client is available through `npm run cli` or the package `bin`; it supports status, capabilities and the currently declared read-only API routes
- **Updater:** the production `latest.json` metadata and physical smoke verification are still an open release gate
- **RC gate:** the current prerelease evidence and rollback boundary are tracked in [docs/release-1.7.0-rc.1.md](docs/release-1.7.0-rc.1.md)

The version is kept aligned in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.

## Features

- Precise monotonic timer with start, pause, resume, stop and persistent session history
- Markdown frontmatter updates in an explicitly selected notes/vault folder
- Multiple vault profiles with per-vault settings
- Tags, estimates, daily goals, statistics and weekly/monthly Markdown reports
- Obsidian deep links, native notifications and configurable refresh behavior
- Timer cards with color coding, drag-and-drop ordering and multiple view modes
- In-place session editing, note preview, note creation and a short undo window for discarded timers
- Runtime filesystem authorization limited to the selected vault
- Czech and English UI translations plus additional localized UI coverage
- Cross-platform Tauri desktop bundles for Windows, Linux and macOS

## Technology and tools

The badges above are visual shortcuts; the authoritative dependency versions are declared in `package.json` and the Tauri manifests.

| Area | Technology / tool | Version or role |
| --- | --- | --- |
| Desktop shell | Tauri | 2.x |
| Frontend | React + React DOM | 19.1.x |
| Language | TypeScript | 5.8.x, strict mode |
| Build tool | Vite | 7.x |
| Native backend | Rust | 2021 edition |
| State management | Zustand | 5.x |
| Styling | Tailwind CSS | 4.x |
| UI motion | Framer Motion | 12.x |
| Icons | Lucide React | 1.x |
| Drag and drop | `@dnd-kit` | Core 6.x, Sortable 10.x |
| Date handling | date-fns | 4.x |
| Testing | Vitest + Testing Library + jsdom | Vitest 4.x |
| Package manager/runtime | npm + Node.js | Node.js 22 in CI |
| Automation | GitHub Actions | Verify matrix + tagged releases |
| Notes integration | Markdown frontmatter + Obsidian deep links | Local-first storage |

Tauri plugins currently used include filesystem access, dialogs, notifications, opening external links and the updater. Filesystem access is scoped at runtime to the vault selected by the user.

## Installation and build

### Requirements

- Node.js 22 or a compatible current LTS release
- npm
- Rust stable toolchain for Tauri checks and desktop builds
- Tauri v2 platform prerequisites for the operating system being built

Install dependencies and build the desktop application:

```bash
npm install
npm run tauri build
```

The default Tauri configuration enables all bundle targets supported by the host OS. For an explicit target on a matching host:

```bash
npm run tauri:build:linux    # .deb and AppImage
npm run tauri:build:macos    # .dmg and .app
npm run tauri:build:windows  # NSIS and MSI
```

Artifacts are written below `src-tauri/target/release/bundle/`. Tagged CI releases also generate release metadata and publish the platform bundles.

## Development

```bash
npm run dev              # Vite development server
npm run tauri dev        # Tauri desktop development mode
npm run test             # Unit tests
npm run typecheck        # TypeScript check without emitting files
npm run build            # TypeScript check + production frontend build
npm run tauri:check      # Locked Rust/Tauri dependency check
npm run control-plane:dev # Authenticated read-only localhost API
npm run mcp:stdio        # MCP stdio adapter for an already-running API
npm run cli -- --help    # Versioned CLI client and exit-code contract
```

The control plane binds only to `127.0.0.1` and requires a bearer token printed to stderr. The MCP adapter reads `MMSTOPWATCH_CONTROL_PLANE_URL` (default `http://127.0.0.1:9376`) and `MMSTOPWATCH_CONTROL_PLANE_TOKEN` from its environment; it writes JSON-RPC responses only to stdout and diagnostics only to stderr. It pins MCP protocol version `2025-06-18`, requires `initialize` followed by `notifications/initialized`, and advertises only the currently implemented `status` and `capabilities` tools. Use [mcp-config.example.json](mcp-config.example.json) as a client configuration template. The adapter is not automatically started or packaged into the desktop app yet.

The CLI reads `MMSTOPWATCH_CONTROL_PLANE_URL` and `MMSTOPWATCH_CONTROL_PLANE_TOKEN`, or a JSON config passed through `--config`/`MMSTOPWATCH_CONFIG`; see [cli-config.example.json](cli-config.example.json). Tokens are never accepted as command-line arguments. `--json` returns the versioned API envelope, `--request-id` preserves caller correlation, and mutating command groups fail closed until the corresponding API capability and explicit confirmation are present.

## Usage

1. Open **Settings → Select your notes folder** and choose a notes folder or Obsidian vault.
2. Click a note in the right panel to load its recorded time into a timer.
3. Start continues from the loaded time; the current session is tracked separately from zero.
4. Stop saves the total time to the selected note.
5. View and edit sessions from the session list.

Configure the frontmatter key and time format in Settings. Profile data is stored in `.mmST-{nick}` inside the selected vault.

## Roadmap

Roadmap status is based on the shipped release history in `CHANGELOG.md`, the current control-plane implementation and the release workflow. Dates and priorities are intentionally not promised until they are tracked in GitHub Issues or milestones.

### Delivered

- ✅ **1.3.x — Foundation:** Tauri desktop application, Markdown storage backend and Obsidian vault support.
- ✅ **1.4.x — Time management:** goals, estimates, statistics, expiration alerts, undo flows and the first updater integration.
- ✅ **1.5.x — Vault workflow:** onboarding, nick-based vault storage, multiple vault profiles, note creation, previews, reports, richer statistics and expanded localization.
- ✅ **1.6.0 — Release foundation:** Linux/macOS/Windows packaging, cross-platform GitHub Actions verification, release metadata generation, runtime vault authorization and versioned control-plane contracts/test seams.
- ✅ **1.6.0 — Development control plane:** authenticated, read-only localhost status and capability endpoints available through an explicit development command.

### Open release gate

- ⚠️ **Production updater readiness:** publish and verify production-side `latest.json` metadata at the configured updater endpoint, then complete an end-to-end update smoke test before calling the updater production-ready.

### Planned next steps

- ⏳ **Control-plane lifecycle:** decide how the authenticated local API should be started, supervised and packaged with the desktop application.
- ⏳ **Stable client contract:** finish the versioned status/capability contract and safe command envelope needed by external clients.
- ✅ **MCP integration — stdio slice:** JSON-RPC lifecycle (`initialize`, `ping`, `tools/list`, `tools/call`), authenticated API adapter, retry/timeout handling, redacted errors and read-only tool boundary.
- ✅ **CLI integration — versioned read-only slice:** `mmstopwatch` bin/script with config discovery, stable exit codes, request IDs, timeouts, JSON/human output and confirmation gates.
- ⏳ **Control-plane resource handlers:** implement the currently declared notes, stats and report routes before exposing any mutation tools.
- ⏳ **CLI command completion:** wire timers, profiles and config only after matching application-service/API capabilities exist.
- ⏳ **Release acceptance:** complement the automated CI matrix with fresh install, startup, bundle and updater smoke verification on the supported platforms.

## CI and releases

The workflow in `.github/workflows/verify-and-release.yml` runs on pull requests and pushes to `main`:

1. Install Node.js 22 and Rust stable.
2. Run the Vitest suite.
3. Build the frontend.
4. Run `cargo check --locked` through `npm run tauri:check`.

When a tag such as `v1.7.0-rc.1` is pushed, the workflow additionally builds Linux (`.deb`, AppImage), macOS (`.dmg`, `.app`) and Windows (NSIS, MSI) bundles, generates release metadata and publishes a GitHub Release.

## Configuration

- Notes folder path and vault profiles
- Frontmatter key (default: `Timework`)
- Time format (`HH:mm:ss` or seconds)
- Daily goals, estimates, tags, notifications and report settings

The app stores profile data under `.mmST-{nick}` inside the selected vault. It does not grant static access to the user's home directory or Windows drive; the selected vault is authorized through the Tauri runtime scope. The AI control-plane boundary and permission matrix are documented in [docs/security-threat-model.md](docs/security-threat-model.md).

## License

MIT © [Lukáš Hefner](https://mediamaker.cz)

See [CHANGELOG.md](CHANGELOG.md) for release history.
