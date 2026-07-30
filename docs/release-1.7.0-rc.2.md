# mmStopWatch 1.7.0-rc.2 release-candidate gate

Candidate tag: `v1.7.0-rc.2`
Supersedes: `v1.7.0-rc.1` (the first RC passed Ubuntu/macOS verification but exposed a Windows-only `spawn EINVAL` in the MCP process smoke test)
Release type: GitHub prerelease for testing only

## Fix in this candidate

The Windows MCP process smoke test now starts `npm.cmd` through the Windows command interpreter (`ComSpec /d /s /c`). Unix runners continue to spawn `npm` directly. This keeps the test aligned with Node's Windows child-process executable rules without changing the MCP protocol or production adapter.

## Fresh local evidence

Run from the repository root:

```text
npm test
npm run build
npm run tauri:check
npx tsc --noEmit --incremental false
git diff --check
npm pack --dry-run
```

The authoritative RC2 evidence is the GitHub Actions workflow for tag `v1.7.0-rc.2`. The local Linux gate is supplementary and does not close Windows/macOS packaging or install smoke.

## Remaining open gates

- Windows and macOS package, startup and uninstall smoke
- GitHub Actions artifact and checksum readback
- updater `latest.json`, signing/public-key verification and rollback
- owner approval for external publication
- real timer/note/profile/config mutation backend handlers

Do not claim this candidate is production-ready until the RC2 workflow and release artifacts are freshly read back.
