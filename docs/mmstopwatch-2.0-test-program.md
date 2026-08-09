# mmStopWatch 2.0 — testovací program

Acceptance program pro aktuální 2.0 stabilizační build. Výsledek každého bodu zapisujte jako PASS, FAIL nebo BLOCKED a u FAIL přiložte log, screenshot a platformu.

## 1. Automatické release gate

Spusťte z kořene repozitáře:

- TypeScript: npm run typecheck — bez chyb.
- Unit/integrace: npm test — všechny testy PASS.
- Frontend build: npm run build — Vite build PASS.
- Rust/Tauri: npm run tauri:check — cargo check --locked PASS.
- Whitespace: git diff --check — bez výstupu.
- Dependency audit: npm audit --audit-level=high — bez high/critical nálezu, případná výjimka musí být zdokumentovaná.

Automatický běh všech gate v jednom kroku: npm run verify:2.0

CI-like běh: git diff --check && npm run typecheck && npm test && npm run build && npm run tauri:check

## 2. Datová integrita a recovery

### 2.1 Timer lifecycle
- Otevřít Markdown poznámku a ověřit načtený celkový čas.
- Start, po 5 s Pause, Resume, po 5 s Finish/Save.
- Uložená doba musí odpovídat work segmentům; pauza se nesmí přičíst.
- Opakované kliknutí Start nesmí resetovat start timestamp.
- Po chybě zápisu musí karta zůstat dostupná pro opakování.

### 2.2 Recovery po pádu
1. Spustit timer a počkat alespoň na checkpoint (10 s).
2. Ukončit proces bez close dialogu (kill/force quit).
3. Spustit aplikaci znovu.
4. Ověřit recovery overlay s názvem poznámky, délkou a časem checkpointu.
5. Restore obnoví timer jako PAUSED a nesmí automaticky pokračovat.
6. Discard odstraní pouze checkpoint a nezmění Markdown.
7. Ověřit minimalizaci/visibilitychange a návrat.

### 2.3 Konflikt s Obsidianem
1. Připravit poznámku, spustit timer a nechat načíst obsah.
2. Změnit stejný soubor v Obsidianu před dokončením timeru.
3. Dokončit timer.
4. Očekávat FileConflictError a journal stav conflict.
5. Cizí změna musí zůstat zachovaná; žádný tichý overwrite.

### 2.4 Atomic write a idempotence
- Po zápisu nezůstane .mmst-tmp soubor.
- Při chybě zápisu zůstane originální Markdown beze změny.
- Opakovaný save se stejným operation ID nepřidá duplicitní activity entry.
- Ověřit config.json, activity.json a deleted_sessions.json v .mmST-{nick}.

## 3. Security boundary

- Projects\Note.md se normalizuje na Projects/Note.md.
- Odmítnout absolutní Unix/Windows/UNC cesty, traversal, a/../note.md, a/./note.md, encoded %2e%2e, null byte a control characters.
- Profilový klíč odmítne slash, backslash, .., control characters a délku nad 80 znaků.
- Vybraný vault je absolutní existující adresář; autorizace proběhne před skenem.
- Symlink/junction escape ověřit ručně na každé podporované platformě.
- Tauri capabilities nesmí obsahovat $HOME/**, D:/** ani celý disk.
- Legacy greet není aplikační API; před produkcí jej odstranit v samostatném hardening tasku.

## 4. Control plane, CLI a MCP

1. Spustit MMSTOPWATCH_CONTROL_PLANE_TOKEN=test-token npm run control-plane:dev.
2. Ověřit bind pouze na 127.0.0.1 a token pouze ve stderr.
3. Bez tokenu očekávat HTTP 401.
4. Status s Bearer tokenem očekávat 200.
5. Capabilities musí obsahovat pouze status a capabilities.
6. Notes, stats a report preview očekávají 501, dokud nejsou skutečné handlery registrovány.
7. Oversized POST očekává 413; cizí Host 400; cizí Origin 403.
8. npm run cli -- --json status vrací requestId a neobsahuje token.
9. npm run mcp:stdio musí projít initialize, notifications/initialized a tools/list; discovery obsahuje pouze implementované nástroje.

## 5. Accessibility and UX

- Ikonová tlačítka mají aria-label nebo viditelný text/title.
- Modaly lze zavřít Escape a focus je po otevření použitelný.
- Recovery overlay lze projít klávesnicí; stav není sdělený jen barvou.
- Reduced motion nesmí skrýt ovládací prvky.
- Drag and drop musí mít keyboard alternativu před stabilním 2.0 releasem.
- Save, Retry a Conflict stav musí být viditelný, ne pouze v konzoli.

## 6. Výkonový smoke test

- Fixture s 5 000 Markdown soubory: změřit první scan.
- Opakovaný refresh bez změn používá mtime/size cache a znovu neparsuje soubory.
- Změna jediného souboru z Obsidianu znovu parsuje pouze tento soubor.
- U 50 timer karet existuje jeden scheduler, nikoliv jeden requestAnimationFrame na kartu.
- Skryté okno používá pomalejší ticker a idle CPU zůstává nízké.

## 7. Release matrix

| Platforma | Fresh install | Existing vault | Timer/recovery | Atomic/conflict | Control plane | Uninstall |
|---|---|---|---|---|---|---|
| Windows 11 | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| macOS | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |
| Ubuntu | [ ] | [ ] | [ ] | [ ] | [ ] | [ ] |

Updater je BLOCKED, dokud server neposkytne podepsané artefakty a platné latest.json. Potom ověřit update, restart, rollback a uninstall.

## 8. Evidence template

- Build/version:
- OS + version:
- Vault fixture:
- Test section/case:
- Result:
- Reproduction steps:
- Expected / actual:
- Log or screenshot:
- Backup taken:
