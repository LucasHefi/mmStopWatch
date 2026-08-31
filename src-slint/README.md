# mmStopWatch Native (Slint)

Samostatná nativní varianta bez Reactu, DOM, WebView a JavaScript runtime. Čte stejné Markdown poznámky a zapisuje celkový čas do stejného frontmatter pole `Timework`.

Aktuální refaktor používá rozložení původní aplikace: časovače vlevo a virtuální seznam poznámek vpravo, v úzkém okně pak lehký mobilní drawer. Zachovává animované ambientní pozadí, glow karet, setiny, vlastní odhady a průběh, ale vykresluje je přímo přes Slint software renderer. Umí převzít existující `.mmST-{nick}/config.json`, zapisuje kompatibilní `activity.json`, nabízí tříkrokový onboarding, nové poznámky, připnutí, řaditelné karty i tabulku, statistiky s rozpadem frontmatter polí, reporty, kompletní limitní upozornění a nativní nastavení. Rozhraní používá všech 15 původních jazykových katalogů. Při zavření s aktivními časovači vyžádá uložení nebo potvrzené zahození.

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

## Instalační balíčky

Linuxový `.deb` a SHA-256 kontrolní součet vytvoří `src-slint/packaging/linux/package-deb.sh`. Windows instalátor používá NSIS definici `src-slint/packaging/windows/mmstopwatch.nsi`. Tagy `slint-v*` ověřuje samostatný Linux/Windows release workflow.

Ruční kontrola aktualizace přijímá pouze validní JSON manifest s novější semver verzí, artefaktem pro aktuální platformu a neprázdným podpisem. Produkční URL momentálně vrací HTML webu místo `latest.json`; klient proto instalaci bezpečně nenabídne, dokud release server nezačne publikovat podepsaný manifest.

Nativní varianta používá softwarový renderer, virtuální seznam poznámek a omezenou frekvenci dekorativní animace. Plynulý 50ms tick aktualizuje pouze řádky časomír, které skutečně běží; monotónní hodiny proto zůstávají přesné nezávisle na rychlosti vykreslování. Rozpracované časomíry se každých pět sekund checkpointují a po restartu se bezpečně obnoví v pauze.

## Naměřená release spotřeba

Měřeno na Linuxu s 44 načtenými Markdown soubory pomocí údajů procesu a `/proc/<pid>/smaps_rollup`:

| Stav | RSS | PSS | CPU |
| --- | ---: | ---: | ---: |
| Animované pozadí, žádný timer | 27,5 MB | 18,0 MB | 5,1 % jednoho jádra |
| Animované pozadí, čtyři 50ms timery | 34,6 MB | 24,7 MB | 17,9 % jednoho jádra |

Paměť tak zůstává přibližně na čtvrtině cílového maxima 100 MB. GPU renderer FemtoVG byl při vývoji porovnán a záměrně odmítnut: snížil aktivní CPU jen mírně, ale kvůli mapování grafického ovladače zvýšil RSS na přibližně 189 MB.

V obou případech zůstal swap na nule. Síťová vrstva nemá žádný periodický polling a inicializuje se pouze po ruční kontrole aktualizace.

Osmdesátisekundový soak se čtyřmi timery zůstal od 30. do 80. sekundy stabilní na 34,5 MB RSS bez růstu privátních alokací. Samostatný zátěžový test indexu s 2 000 Markdown soubory použil 29,6 MB RSS / 20,1 MB PSS a žádný swap.

Pro automatickou vizuální kontrolu lze nastavit `MMSTOPWATCH_SNAPSHOT=/tmp/mmstopwatch.pam`; aplikace po prvním vykreslení uloží snímek a sama se ukončí. `MMSTOPWATCH_PREVIEW_TIMER=1` přidá do tohoto diagnostického snímku běžící časomíru.

Panel pro regresní snímek lze zvolit přes `MMSTOPWATCH_PREVIEW_PANEL=settings|stats|new-note|close-guard|onboarding`. Rozměr, jazyk a kompaktní drawer lze ověřit pomocí `MMSTOPWATCH_PREVIEW_WIDTH`, `MMSTOPWATCH_PREVIEW_HEIGHT` a `MMSTOPWATCH_PREVIEW_LANGUAGE`. Úplný seznam požadované parity a aktuální stav je v [PARITY.md](PARITY.md); položky označené jako `Partial` nebo `Missing` nejsou považovány za dokončené.
