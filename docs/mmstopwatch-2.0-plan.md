# mmStopWatch 2.0 — kompletní implementační plán

> Stav: implementační plán uložený před zahájením migrace.
> Datum: 2026-08-09
> Výchozí verze: 1.7.0-rc.5
> Cíl: stabilní, bezpečná a profesionální local-first desktopová aplikace pro time tracking nad Markdown/Obsidian vaultem.

## 1. Produktová vize

mmStopWatch 2.0 bude Focus Workspace, který propojí přesný a obnovitelný TimerEngine, auditovatelný session ledger, bezpečný zápis do Markdownu, rychlý inkrementální NoteIndex, přehledné Focus/Explore UI a lokální opt-in control plane.

Základní pořadí priorit:

1. Datová integrita a recovery.
2. Bezpečnost souborů a konfigurace.
3. Výkon a škálování pro velké vaulty.
4. Jednoduchý hlavní pracovní tok.
5. Accessibility a UI polish.
6. Integrace, release a updater hardening.

## 2. Architektonické zásady

- UI nesmí být zdrojem pravdy pro timer, persistence ani bezpečnost.
- TimerEngine, persistence, path policy a statistiky musí být testovatelné bez Reactu a Tauri runtime.
- Markdown zůstává uživatelsky čitelnou projekcí; session/activity ledger uchovává jednotlivá měření.
- Každá mutace je validovaná, idempotentní a má viditelný výsledek.
- Externí změna poznámky se nikdy tiše nepřepíše.
- Control plane inzeruje pouze skutečně implementované capabilities.
- Výchozí aplikace je local-first, bez účtu, cloudu a telemetry.

## 3. Cílový datový model

### TimerSession

- id, notePath, profileId, status, createdAt, startedAt, endedAt
- totalDurationMs, baseDurationMs, estimateMinutes
- saveState: pending, saved, failed, conflict, recovery
- operationId a revision

### TimerSegment

- id, sessionId, kind: work nebo pause
- startedAt, endedAt, durationMs
- monotonicStart a monotonicEnd, pokud jsou dostupné

### Operation

- id, kind, status, createdAt, completedAt
- targetPath, expectedFingerprint, actualFingerprint
- retryCount, errorCode a payloadVersion

### RecoveryCheckpoint

- sessionId, capturedAt, elapsedMs, pausedOffsetMs
- timerStatus, lastKnownWallClock a schemaVersion

## 4. Fáze 0 — plán a baseline

- [x] Zmapovat aplikaci, data flow a AGENTS.md.
- [x] Sepsat a uložit tento plán.
- [ ] Zaznamenat baseline: testy, typecheck, frontend build a Tauri check.
- [ ] Udržovat změny rozdělené podle fází a po každé fázi spustit odpovídající testy.
- [ ] Zachovat zpětnou kompatibilitu se stávajícími config/activity soubory.

Akceptace: plán existuje v docs/mmstopwatch-2.0-plan.md a žádná změna datového formátu nevznikne bez migrace a rollbacku.

## 5. Fáze 1 — datová integrita, atomic write, conflict detection, recovery

### Safe file writer

- [ ] Vytvořit safeFileWriter jako čistě použitelnou službu.
- [ ] Podporovat read, fingerprint, write temp a rename.
- [ ] Temporary soubor ukládat ve stejné složce jako cíl.
- [ ] Před commit zkontrolovat očekávaný fingerprint.
- [ ] Při konfliktu vracet typed FILE_CONFLICT.
- [ ] Zajistit, aby temporary soubory nebyly načítány jako poznámky.

### Operation journal

- [ ] Každé save, update a delete zapsat jako pending operation.
- [ ] Po úspěšném Markdown a activity zápisu označit operaci jako committed.
- [ ] Po chybě zachovat operaci jako retryable/failed.
- [ ] Retry nesmí vytvořit duplicitní activity díky operationId.

### Recovery

- [ ] Checkpoint po startu, pause, resume, změně visibility, před ukončením a periodicky.
- [ ] Po startu vyhledat neuzavřené session.
- [ ] Zobrazit recovery dialog s poznámkou, elapsed časem a časem checkpointu.
- [ ] Akce: Obnovit, Dokončit a uložit, Zahodit, Prohlédnout.
- [ ] Recovery musí být idempotentní.

### Akceptace fáze 1

- Selhání zápisu neztratí timer ani operaci.
- Externí změna Markdownu vyvolá konflikt.
- Dvojité kliknutí na save vytvoří právě jednu persistenci.
- Simulovaný pád lze po restartu obnovit.
- Existují unit testy pro writer, fingerprint, journal a recovery.

## 6. Fáze 2 — TimerEngine, centrální ticker a checkpointy

- [ ] Vytvořit čistý TimerEngine bez React závislosti.
- [ ] Přesunout výpočty elapsed z React hooků do engine.
- [ ] Použít stavy IDLE, RUNNING, PAUSED, STOPPING, SAVE_PENDING, SAVED, SAVE_FAILED a RECOVERY_REQUIRED.
- [ ] Zachovat adapter pro současný timersStore.
- [ ] Používat performance.now pro monotonic elapsed a Date.now pouze pro persistované timestampy.
- [ ] Zavést work/pause segmenty.
- [ ] Použít jeden scheduler pro všechny running timery.
- [ ] Při skrytém okně přepnout na úsporný režim.
- [ ] Detekovat sleep/wake a výrazný časový skok.
- [ ] Přidat injektovatelný clock pro deterministické testy.

Akceptace: 50 timerů nepoužívá 50 animation loopů a timer testy pokrývají lifecycle, failure, duplicate stop, recovery a sleep/wake.

## 7. Fáze 3 — filesystem security, config persistence a control plane

### Filesystem security

- [ ] Zapojit validateRelativeNotePath do externích relativních cest.
- [ ] Přidat canonical containment check proti autorizovanému vault rootu.
- [ ] Ošetřit symlink/junction escape.
- [ ] Povolit pro note commands pouze Markdown cíle.
- [ ] Sanitizovat nick/profile key: whitelist, maximální délka, zákaz traversal a control znaků.
- [ ] Ignorovat .mmST, .obsidian a temporary soubory v indexu.

### Tauri a konfigurace

- [ ] Auditovat capabilities a přidat jen nezbytná rename/stat/watch permissiony.
- [ ] Zachovat runtime authorization selected folder.
- [ ] Legacy greet buď odstranit, nebo ponechat pouze jako zdokumentovaný scaffold.
- [ ] Vést všechny config mutace přes jednotný persistence orchestrator.
- [ ] Persistovat jazyk stejně jako ostatní nastavení.
- [ ] Validovat a migrovat config version.
- [ ] Při poškozeném configu nabídnout restore/defaults místo tichého resetu.

### Control plane

- [ ] Capability registry bude jediný zdroj pravdy pro HTTP, MCP a CLI.
- [ ] Control plane bude v desktopu defaultně vypnutý.
- [ ] Zachovat loopback bind, Bearer token, constant-time compare, timeouty a max body.
- [ ] Nepublikovat 501 routy jako implementované capabilities.
- [ ] Read-only notes, stats a report handlers přidat až po adapteru na skutečné služby.
- [ ] Před mutacemi vyžadovat revision, idempotency key a explicitní confirmation.

Akceptace: traversal, absolutní, UNC, encoded-dot, null-byte a symlink útoky jsou testované; každá config změna přežije restart; capabilities odpovídají skutečným handlerům.

## 8. Fáze 4 — výkonový NoteIndex a inkrementální refresh

- [ ] Vytvořit NoteIndex s relativePath, name, mtimeMs, size, duration, tags, fields a parseStatus.
- [ ] První scan může být full scan; další scan parsuje pouze změněné soubory.
- [ ] Přidat index revision a cache parseru.
- [ ] Invalidní soubory zobrazit s důvodem místo tichého přeskočení.
- [ ] Použít Tauri fs watch, pokud je dostupný, s debounce 200–500 ms.
- [ ] Polling ponechat jako fallback.
- [ ] Při přepnutí profilu watcher odregistrovat.
- [ ] Virtualizovat dlouhý sidebar a lazy načítat preview.

Akceptace: 5 000 souborů se po změně jedné poznámky neparsuje celé a běžná změna se projeví do 500 ms.

## 9. Fáze 5 — Focus Workspace, command palette a accessibility

- [ ] Přidat Focus mode jako výchozí režim a zachovat Explore mode.
- [ ] Navigator: Today, Pinned, Recent, All notes a Saved views.
- [ ] Focus panel: poznámka, current session, total note time, estimate a primary action.
- [ ] Context panel: preview, tags, frontmatter a session timeline.
- [ ] Jasně odlišit current session a total note time.
- [ ] Primární akce: Pause, Resume, Finish and Save.
- [ ] Přidat Ctrl/Cmd+K command palette.
- [ ] Přidat full keyboard flow, focus trap, Escape handling a visible focus.
- [ ] Přidat WCAG AA contrast, reduced motion a keyboard alternativu k DnD.
- [ ] Stav komunikovat textem/iconou, ne pouze barvou.

Akceptace: nový uživatel zvládne první start/finish bez dokumentace a hlavní tok je ovladatelný klávesnicí.

## 10. Fáze 6 — testy, build a testovací release artefakty

- [ ] Unit testy: time, parser, path policy, fingerprint, writer, TimerEngine, migrace a statistiky.
- [ ] Store testy: adapter, recovery, config persistence a profily.
- [ ] Boundary testy: Tauri capabilities, control plane, MCP, CLI a updater metadata.
- [ ] Component testy: onboarding, focus actions, dialogy a keyboard behavior.
- [ ] Smoke test: fresh start, vault select, note open, timer start, save, conflict a recovery.
- [ ] npm test, typecheck, build, cargo check --locked a git diff --check.
- [ ] Synchronized version v2.0.0 ve všech manifestech, changelog a release notes.
- [ ] Signed installers, checksum metadata, updater latest.json a rollback smoke.

## 11. Výkonové cíle

- Start bez vaultu pod 1,5 s.
- První scan 5 000 Markdown souborů pod 2 s v běžném SSD prostředí.
- Změna jedné poznámky v UI pod 500 ms.
- 50 timerů bez viditelného janku.
- Idle CPU bez aktivního timeru pod 1–2 %.
- Žádný silent overwrite externí změny.
- Každá mutace je idempotentní a retryable.

## 12. Definition of Done

- Datová migrace ze současné verze proběhne bez ztráty součtů.
- Recovery po simulovaném pádu funguje.
- Atomic writer a conflict detection mají regression testy.
- Timer engine je čistý a UI používá centrální ticker.
- Cesty a capabilities jsou auditované.
- NoteIndex nepřeskenuje nezměněné soubory.
- Focus Workspace a accessibility smoke testy projdou.
- Build a testovací release artefakty jsou vytvořené a ověřené.
- README, CHANGELOG a release notes popisují skutečný stav.

## 13. Implementační pořadí

1. Fáze 0: plán a baseline.
2. Fáze 1: safe writer, journal a recovery.
3. Fáze 2: TimerEngine a store adapter.
4. Fáze 3: security, config a control plane.
5. Fáze 4: NoteIndex, watcher a performance.
6. Fáze 5: Focus Workspace, UI a accessibility.
7. Fáze 6: testy, build a release.

Každá fáze končí testy a kontrolou diffu. Další fáze se nepovažuje za dokončenou, pokud předchozí nemá akceptační testy.
