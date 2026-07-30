# mmStopWatch 1.7.0-rc.1 release-candidate gate

Candidate tag: `v1.7.0-rc.1`
Release type: GitHub prerelease for testing only

## Fresh local evidence

Run from the repository root:

```text
npm test
npm run build
npm run tauri:check
npx tsc --noEmit --incremental false
git diff --check
```

The candidate was locally verified on Linux with 120/120 Vitest tests passing, frontend build passing, locked Rust check passing and TypeScript no-emit check passing. The MCP focused suite covers initialize/initialized lifecycle, protocol pinning, no-ID notifications, invalid arguments, tool discovery truthfulness, transport redaction, closed-session behavior, real localhost status flow and EOF cleanup.

## Smoke boundaries

The development control plane is a separately started localhost process:

```text
MMSTOPWATCH_CONTROL_PLANE_TOKEN=<local-secret> npm run control-plane:dev
MMSTOPWATCH_CONTROL_PLANE_TOKEN=<local-secret> npm run mcp:stdio
MMSTOPWATCH_CONTROL_PLANE_TOKEN=<local-secret> npm run cli -- status --json
```

The token must be supplied through the environment or a local config file. Do not put it in command arguments, examples committed to the repository, stdout, MCP responses or bug reports.

MCP currently advertises only the API-backed `status` and `capabilities` tools. Notes, stats, reports, timers, profiles/config and notification mutation groups remain explicit open scope until their application handlers exist; planned schemas are not advertised as available capabilities.

## CI/platform gates

The GitHub workflow must produce fresh matching-runner evidence for:

- Ubuntu: `.deb`, AppImage and control-plane/MCP/CLI smoke
- macOS: `.dmg`, `.app`, startup and uninstall smoke
- Windows: NSIS, MSI, npm/direct-node CLI launch, install/startup/uninstall smoke

A local Linux build does not close Windows/macOS gates. Record the workflow run URL, commit, tag, artifact names, checksums and relevant smoke logs before publishing any claim of cross-platform readiness.

## Updater and rollback

OPEN until production-owned evidence exists:

- signed updater metadata at the configured endpoint
- matching release version and artifact checksums
- signature/public-key verification
- install and update from the previous stable version
- rollback to the previous stable version after a failed update
- owner approval for external publication

Rollback procedure for this candidate is intentionally manual: stop the candidate application, reinstall the previous stable package, and restore the previous updater metadata. Do not claim automatic rollback until a real updater smoke test proves it.

## Publication boundary

Creating a local tag or GitHub prerelease is a publication side effect. Before publication, verify the final diff, remove any agent/session artifacts, run the canonical gates again and confirm that no credentials are present in staged files or release assets.
