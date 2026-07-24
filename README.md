# mmStopWatch

A lightweight desktop stopwatch that integrates directly with Markdown notes (Obsidian-style). Track time in frontmatter fields, manage sessions, and keep everything in your notes folder.

## Features
- Precise timer with pause/resume and persistent session history
- Markdown frontmatter updates in an explicitly selected notes/vault folder
- Multiple vault profiles, tags, estimates, statistics and Markdown reports
- Obsidian deep links, native notifications and configurable refresh behavior
- Runtime filesystem authorization limited to the selected vault
- Cross-platform Tauri desktop bundles for Windows, Linux and macOS

## Installation & Build
```bash
npm install
npm run tauri build
```
The default Tauri configuration enables all bundle targets supported by the host OS.

For an explicit target on the matching host:

```bash
npm run tauri:build:linux    # .deb and AppImage
npm run tauri:build:macos    # .dmg and .app
npm run tauri:build:windows  # NSIS and MSI
```

Artifacts are written below `src-tauri/target/release/bundle/`. Tagged CI releases also include `SHA256SUMS.txt` and `BUILD-METADATA.json` next to the bundles.

### CI and releases

Every pull request and push to `main` runs tests, the frontend build and `cargo check` on Linux, macOS and Windows. A tag such as `v1.6.0` additionally builds the three platform bundles and publishes a GitHub release through `.github/workflows/verify-and-release.yml`.

### Local control plane (development)

The read-only localhost API can be started explicitly with:

```bash
npm run control-plane:dev
```

It binds only to `127.0.0.1`, requires a bearer token printed to stderr, and currently exposes versioned status/capability endpoints. It is not automatically started or packaged into the desktop app yet; MCP and CLI clients remain a later control-plane slice.

## Usage
1. Open Settings → Select your notes folder (e.g. Obsidian vault)
2. Click a note in right panel to load its time into timer
3. Start continues from loaded time; session time tracks separately from 0
4. Stop saves total time to selected note (overwrites)
5. View/edit sessions from the list (icons for edit/delete)

Configure frontmatter key and time format in Settings.

## Development
```bash
npm run tauri dev
npm run test
npm run build
npm run tauri:check
```

## Configuration
- Notes folder path and vault profiles
- Frontmatter key (default: `Timework`)
- Time format (`HH:mm:ss` or seconds)
- Daily goals, estimates, tags, notifications and report settings

The app stores profile data under `.mmST-{nick}` inside the selected vault. It does not grant static access to the user's home directory or Windows drive; the selected vault is authorized through the Tauri runtime scope.

## License
MIT © [Lukáš Hefner](https://mediamaker.cz)

See CHANGELOG.md for release history.
