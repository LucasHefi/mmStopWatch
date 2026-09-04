# mmStopWatch

[![Version](https://img.shields.io/badge/version-1.7.1-2563eb)](CHANGELOG.md)
[![CI](https://github.com/LucasHefi/mmStopWatch/actions/workflows/slint-native-release.yml/badge.svg?branch=main)](https://github.com/LucasHefi/mmStopWatch/actions/workflows/slint-native-release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-2024-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Slint](https://img.shields.io/badge/UI-Slint-2379F4)](https://slint.dev/)

Nativní local-first stopky pro Markdown poznámky a Obsidian vaulty. Aplikace zapisuje čas do frontmatter pole `Timework`, uchovává kompatibilní historii aktivit a pracuje přímo se zvoleným vaultem.

## Produktová hranice

Stable produkt je jediná nativní Slint aplikace v `src-slint/`. Nepoužívá React, Vite, DOM, WebView, Tauri ani JavaScript runtime. Data zůstávají lokální a bez účtu, cloudu a telemetrie.

## Funkce

- více nezávislých monotónních časomír s pause/resume/save/discard;
- checkpoint recovery po neočekávaném ukončení bez automatického pokračování;
- bezpečný atomický zápis Markdownu s detekcí externího konfliktu;
- rychlý obnovitelný SQLite index nad Markdown zdrojem pravdy;
- vyhledávání, preview, tagy, pinning, nové poznámky a Obsidian deep-link;
- profily vaultů, onboarding, cíle, odhady, statistiky, kalendář, reporty a notifikace;
- 15 vestavěných jazykových katalogů;
- softwarový renderer s omezenou dekorativní animací a virtualizovaným seznamem.

## Rychlý start

Požadavky: Rust stable, Cargo a na Linuxu `libfontconfig1-dev` a `libxkbcommon-dev`.

```bash
cargo run --manifest-path src-slint/Cargo.toml --release
```

Vault lze předat jako první argument:

```bash
cargo run --manifest-path src-slint/Cargo.toml --release -- /cesta/k/vaultu
```

## Lokální ověření

```bash
cargo fmt --manifest-path src-slint/Cargo.toml -- --check
cargo test --manifest-path src-slint/Cargo.toml --locked
cargo clippy --manifest-path src-slint/Cargo.toml --all-targets --locked -- -D warnings
cargo build --manifest-path src-slint/Cargo.toml --release --locked
bash src-slint/packaging/check-assets.sh
bash src-slint/packaging/linux/package-deb.sh
```

`target/` a balíčky jsou generované artefakty; do Git historie nepatří.

## Distribuce

Tag `v1.7.1` a další stable tagy spouštějí [Slint release workflow](.github/workflows/slint-native-release.yml). Workflow ověřuje Rust, sestaví a publikuje platformní instalační balíčky:

- Linux x86_64: `.deb`;
- Windows x86_64: per-user NSIS `.exe`;
- macOS arm64: `.dmg` s `.app`, pokud macOS runner projde svými gates.

Každý GitHub Release obsahuje jednoznačné názvy, checksumy SHA-256, build metadata a `latest.json`. Chybějící nebo duplicitní asset je hard failure. Artefakty nejsou commitovány do repozitáře.

Balíčky nejsou v tomto release vydávány jako podepsané/notarizované OS instalátory. Checksumy chrání stažený obsah před tichou změnou; Windows SmartScreen a macOS Gatekeeper mohou před prvním spuštěním zobrazit varování.

## Aktualizace

Aplikace provádí pouze explicitní kontrolu veřejného GitHub Release manifestu. Manifest se validuje jako JSON, semver, HTTPS GitHub URL, platformní asset a přesný SHA-256 checksum. Tlačítko otevře stažení instalačního balíčku v systémovém prohlížeči; instalaci uživatel spouští ručně. Aplikace sama balíček nestahuje, neinstaluje ani nerestartuje.

## Data a bezpečnost

- Markdown soubory jsou jediný zdroj pravdy.
- `config.json` a `activity.json` se ukládají do `.mmST-{nick}` ve zvoleném vaultu.
- SQLite index je obnovitelná lokální cache mimo synchronizovaný vault.
- Cesty jsou validované proti zvolenému rootu; traversal, absolutní/UNC cesty, control znaky a symlink escape jsou odmítnuty.
- Aplikace neposílá data na vzdálený server kromě explicitní kontroly release manifestu.

Podrobnosti jsou v [bezpečnostním modelu](docs/security-threat-model.md) a [acceptance checklistu](docs/acceptance.md).

## Licence

MIT © [Lukáš Hefner](https://mediamaker.cz)
