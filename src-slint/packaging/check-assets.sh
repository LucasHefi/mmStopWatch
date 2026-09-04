#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

test -f "$root/assets/i18n/translations.ts"
test -f "$root/assets/icons/128x128.png"
test -f "$root/assets/icons/icon.ico"
test -f "$root/assets/icons/icon.icns"
test -f "$root/packaging/macos/Info.plist"
test -f "$root/packaging/macos/package-dmg.sh"
test "$(grep -c '^  [a-z][a-z]: {' "$root/assets/i18n/translations.ts")" -eq 15
grep -Fq 'assets/icons/128x128.png' "$root/packaging/linux/package-deb.sh"
grep -Fq '..\..\assets\icons\icon.ico' "$root/packaging/windows/mmstopwatch.nsi"
grep -Fq 'assets/icons/icon.icns' "$root/packaging/macos/package-dmg.sh"
grep -Fq 'packaging/macos/Info.plist' "$root/packaging/macos/package-dmg.sh"
grep -Fq 'test -x "$crate_root/target/release/mmstopwatch-slint"' "$root/packaging/linux/package-deb.sh"
grep -Fq 'test -x "$binary"' "$root/packaging/macos/package-dmg.sh"
if grep -q '../src/i18n' "$root/packaging/linux/package-deb.sh" "$root/packaging/windows/mmstopwatch.nsi" "$root/packaging/macos/package-dmg.sh" 2>/dev/null; then
  printf 'legacy i18n path found in active Slint packaging sources\n' >&2
  exit 1
fi
grep -Fq 'releases/latest/download/latest.json' "$root/src/updater.rs"
grep -Fq 'is_ascii_hexdigit' "$root/src/updater.rs"
grep -Fq 'update.sha256.is_some()' "$root/src/main.rs"
if grep -Eq '\b(signature|signed)\b|install-update|automatic.{0,10}install' "$root/src/updater.rs" "$root/src/main.rs" "$root/ui/app.slint"; then
  printf 'forbidden unsupported signing/automatic-install wording found in active Slint sources\n' >&2
  exit 1
fi
