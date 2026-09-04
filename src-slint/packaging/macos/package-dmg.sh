#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  printf '%s\n' 'macOS arm64 packaging must run on Darwin arm64.' >&2
  exit 1
fi

crate_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$crate_root/Cargo.toml" | head -n 1)"
output_dir="${MMSTOPWATCH_PACKAGE_DIR:-$crate_root/target/packages}"
app_name="mmStopWatch Native.app"
app_output="$output_dir/$app_name"
dmg_output="$output_dir/mmstopwatch-native_${version}_arm64.dmg"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

test -n "$version"
for command in cargo hdiutil install ditto plutil sed shasum; do
  command -v "$command" >/dev/null
done
test -f "$crate_root/assets/icons/icon.icns"
test -f "$crate_root/packaging/macos/Info.plist"
test ! -e "$app_output"
test ! -e "$dmg_output"

cargo build --manifest-path "$crate_root/Cargo.toml" --release --locked
binary="$crate_root/target/release/mmstopwatch-slint"
test -x "$binary"

app_bundle="$stage/$app_name"
mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources"
install -m755 "$binary" "$app_bundle/Contents/MacOS/mmstopwatch"
sed "s/@VERSION@/$version/g" "$crate_root/packaging/macos/Info.plist" > "$app_bundle/Contents/Info.plist"
install -m644 "$crate_root/assets/icons/icon.icns" "$app_bundle/Contents/Resources/icon.icns"
/usr/bin/plutil -lint "$app_bundle/Contents/Info.plist" >/dev/null
test -x "$app_bundle/Contents/MacOS/mmstopwatch"
test -f "$app_bundle/Contents/Resources/icon.icns"

mkdir -p "$output_dir"
ditto "$app_bundle" "$app_output"
hdiutil create -volname "mmStopWatch Native $version" -srcfolder "$app_output" -format UDZO "$dmg_output" >/dev/null
test -f "$dmg_output"
(
  cd "$output_dir"
  shasum -a 256 "$(basename "$dmg_output")" > SHA256SUMS-macos.txt
)
