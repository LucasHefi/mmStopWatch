# mmStopWatch Native (Slint)

Samostatná nativní varianta bez Reactu, DOM, WebView a JavaScript runtime. Čte stejné Markdown poznámky a zapisuje celkový čas do stejného frontmatter pole `Timework`.

Aktuální refaktor používá rozložení původní aplikace: časovače vlevo a virtuální seznam poznámek vpravo. Zachovává animované ambientní pozadí, glow karet, setiny, odhady a průběh, ale vykresluje je přímo přes Slint software renderer. Umí převzít existující `.mmST-{nick}/config.json`, zapisuje kompatibilní `activity.json`, nabízí onboarding, nové poznámky, připnutí, základní statistiky a nativní nastavení. Při zavření s aktivními časovači vyžádá uložení nebo potvrzené zahození.

## Spuštění

```bash
cargo run --manifest-path src-slint/Cargo.toml --release
```

Vault lze předat také přímo jako první argument:

```bash
cargo run --manifest-path src-slint/Cargo.toml --release -- /cesta/k/vaultu
```

## Ověření

```bash
cargo test --manifest-path src-slint/Cargo.toml
cargo build --manifest-path src-slint/Cargo.toml --release
```

Nativní varianta používá softwarový renderer, virtuální seznam poznámek a omezenou frekvenci dekorativní animace. Plynulý 50ms tick aktualizuje pouze řádky časomír, které skutečně běží; monotónní hodiny proto zůstávají přesné nezávisle na rychlosti vykreslování. Rozpracované časomíry se každých pět sekund checkpointují a po restartu se bezpečně obnoví v pauze.

## Naměřená release spotřeba

Měřeno na Linuxu po 12 sekundách se 42 načtenými Markdown soubory pomocí údajů procesu a `/proc/<pid>/smaps_rollup`:

| Stav | RSS | PSS | CPU |
| --- | ---: | ---: | ---: |
| Animované pozadí, žádný timer | 24,6 MB | 15,0 MB | 3,9 % jednoho jádra |
| Animované pozadí, jeden běžící timer | 24,5 MB | 14,9 MB | 6,1 % jednoho jádra |

Paměť tak zůstává přibližně na čtvrtině cílového maxima 100 MB. GPU renderer FemtoVG byl při vývoji porovnán a záměrně odmítnut: snížil aktivní CPU jen mírně, ale kvůli mapování grafického ovladače zvýšil RSS na přibližně 189 MB.

Pro automatickou vizuální kontrolu lze nastavit `MMSTOPWATCH_SNAPSHOT=/tmp/mmstopwatch.pam`; aplikace po prvním vykreslení uloží snímek a sama se ukončí. `MMSTOPWATCH_PREVIEW_TIMER=1` přidá do tohoto diagnostického snímku běžící časomíru.

Panel pro regresní snímek lze zvolit přes `MMSTOPWATCH_PREVIEW_PANEL=settings|stats|new-note|close-guard|onboarding`. Úplný seznam požadované parity a aktuální stav je v [PARITY.md](PARITY.md); položky označené jako `Partial` nebo `Missing` nejsou považovány za dokončené.
