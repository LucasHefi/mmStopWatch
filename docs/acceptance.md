# mmStopWatch 1.7.4 acceptance checklist

Výsledek každého bodu je `PASS`, `FAIL` nebo `BLOCKED`; evidence musí obsahovat command/log, platformu a případně screenshot.

## Automated gates

```bash
cargo fmt --manifest-path src-slint/Cargo.toml -- --check
cargo test --manifest-path src-slint/Cargo.toml --locked
cargo clippy --manifest-path src-slint/Cargo.toml --all-targets --locked -- -D warnings
cargo build --manifest-path src-slint/Cargo.toml --release --locked
bash src-slint/packaging/check-assets.sh
git diff --check
```

## Functional smoke

- [ ] fresh start without vault shows onboarding;
- [ ] selected existing vault indexes Markdown notes;
- [ ] start/pause/resume/save writes only the expected `Timework` delta;
- [ ] repeated save does not duplicate activity;
- [ ] external note change yields visible conflict and preserves external content;
- [ ] forced process exit restores checkpoint as paused;
- [ ] profiles, settings and `activity.json` survive restart;
- [ ] reports, statistics, notifications and Obsidian deep-link work on a fixture vault;
- [ ] 15 supported languages load without falling back to source key names.

## Platform matrix

| Platform | Build | Install/start | Existing vault | Recovery/conflict | Uninstall |
| --- | --- | --- | --- | --- | --- |
| Linux x86_64 | [ ] | [ ] | [ ] | [ ] | [ ] |
| Windows x86_64 | [ ] | [ ] | [ ] | [ ] | [ ] |
| macOS arm64 | [ ] | [ ] | [ ] | [ ] | [ ] |

## Updater

- [ ] public `latest.json` is JSON, not HTML;
- [ ] manifest version and platform asset URLs point to this exact GitHub Release;
- [ ] malformed host/version/checksum/asset is rejected;
- [ ] valid update opens the manual installer URL;
- [ ] app does not claim automatic install, restart, signing or notarization.

## Evidence template

- Build/version:
- Commit/tag:
- OS + architecture:
- Case:
- Result:
- Command/log/screenshot:
- Expected / actual:
