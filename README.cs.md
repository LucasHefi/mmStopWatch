# mmStopWatch

[![Verze](https://img.shields.io/badge/version-1.7.5-2563eb)](CHANGELOG.md)
[![CI](https://github.com/LucasHefi/mmStopWatch/actions/workflows/slint-native-release.yml/badge.svg?branch=main)](https://github.com/LucasHefi/mmStopWatch/actions/workflows/slint-native-release.yml)
[![Licence: MIT](https://img.shields.io/badge/license-MIT-22c55e.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-2024-000000?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Slint](https://img.shields.io/badge/UI-Slint-2379F4)](https://slint.dev/)

[English](README.md) · [Čeština](README.cs.md)

Nativní local-first měření času pro Markdown poznámky a Obsidian vaulty. Aplikace zapisuje naměřený čas do frontmatter pole `Timework`, uchovává kompatibilní historii aktivit a pracuje přímo se zvoleným vaultem.

## Produktová hranice

Stabilní produkt je jediná nativní Slint aplikace v `src-slint/`. Nepoužívá React, Vite, DOM, WebView, Tauri ani JavaScript runtime. Data zůstávají lokální, bez účtu, cloudové služby a telemetrie.

## Funkce

- více nezávislých monotónních časomír s možností pauzy, pokračování, uložení a zahození;
- obnova z checkpointu po neočekávaném ukončení bez automatického pokračování;
- bezpečný atomický zápis Markdownu s detekcí externího konfliktu;
- rychlý obnovitelný SQLite index nad Markdown zdrojem pravdy;
- vyhledávání, náhledy, tagy, připnutí, nové poznámky a Obsidian deep-linky;
- profily vaultů, onboarding, cíle, odhady, statistiky, kalendář, reporty a notifikace;
- 15 vestavěných jazykových katalogů;
- softwarový renderer s omezenou dekorativní animací a virtualizovaným seznamem.

## Ukázky obrazovek

Níže jsou skutečné snapshoty nativní Slint aplikace z demonstračního vaultu. Všechny názvy projektů, profily, časy, tagy i historie aktivit jsou **fiktivní**; nebyla použita žádná uživatelská data.

### Časomíry v kartách

Praktický příklad: několik souběžných pracovních bloků pro fiktivní projekty **Atlas** a **Comet**, s odhady, průběhem a ovládáním pro pozastavení, uložení nebo zahození časomíry.

![Časomíry mmStopWatch s fiktivními projekty Atlas a Comet](docs/screenshots/demo-dashboard.png)

### Tabulkový přehled časomír

Praktický příklad: rychlé řazení více časomír podle názvu profilu, odhadu, celkového času nebo aktivního stavu.

![Tabulkový přehled časomír mmStopWatch s fiktivními daty](docs/screenshots/demo-table.png)

### Statistiky a rozpad podle polí

Praktický příklad: porovnání fiktivních klientů, projektů a typů práce; zobrazení lze také přepnout na poznámky, dny, kalendář nebo trendy.

![Statistiky mmStopWatch s rozpadem podle fiktivních klientů, projektů a typů práce](docs/screenshots/demo-stats-breakdown.png)

### Nastavení profilu a vaultu

Praktický příklad: konfigurace profilu `demo`, jazyka, intervalu automatického obnovení, umístění poznámek a ruční kontroly aktualizací.

![Nastavení mmStopWatch s fiktivním profilem demo](docs/screenshots/demo-settings.png)

Obrázky jsou uložené ve složce [`docs/screenshots/`](docs/screenshots/).

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

`target/` a balíčky jsou generované artefakty a nepatří do historie Gitu.

## Distribuce

Tag `v1.7.5` a následující stable tagy spouštějí [Slint release workflow](.github/workflows/slint-native-release.yml). Workflow ověří Rust a sestaví a publikuje instalační balíčky pro jednotlivé platformy:

- Linux x86_64: `.deb`;
- Windows x86_64: per-user NSIS `.exe`;
- macOS arm64: `.dmg` obsahující `.app`, pokud macOS runner projde svými gates.

Každý GitHub Release obsahuje jednoznačné názvy assetů, SHA-256 checksumy, build metadata a `latest.json`. Chybějící nebo duplicitní asset je hard failure. Artefakty se do repozitáře necommitují.

Instalátory v tomto release nejsou vydávány jako OS-podepsané ani notarizované balíčky. Checksumy chrání stažený obsah před tichou změnou; Windows SmartScreen a macOS Gatekeeper mohou před prvním spuštěním zobrazit varování.

## Aktualizace

Aplikace provádí pouze explicitní kontrolu veřejného GitHub Release manifestu. Manifest se validuje jako JSON s přísným semver, HTTPS GitHub URL, assetem pro danou platformu a přesným SHA-256 checksumem. Tlačítko otevře stažení instalačního balíčku v systémovém prohlížeči; instalaci uživatel spouští ručně. Aplikace sama balíček nestahuje, neinstaluje ani nerestartuje.

## Data a bezpečnost

- Markdown soubory jsou jediný zdroj pravdy.
- `config.json` a `activity.json` se ukládají do `.mmST-{nick}` uvnitř zvoleného vaultu.
- SQLite index je obnovitelná lokální cache mimo synchronizovaný vault.
- Cesty se validují vůči zvolenému rootu; traversal, absolutní/UNC cesty, řídicí znaky a úniky přes symlinky jsou odmítnuty.
- Aplikace neposílá data na vzdálený server kromě explicitní kontroly release manifestu.

Podrobnosti najdete v [bezpečnostním modelu](docs/security-threat-model.md) a [acceptance checklistu](docs/acceptance.md).

## Licence

MIT © [Lukáš Hefner](https://mediamaker.cz)
