#!/usr/bin/env bash
set -euo pipefail

crate_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$crate_root/Cargo.toml" | head -n 1)"
architecture="${MMSTOPWATCH_DEB_ARCH:-amd64}"
output_dir="${MMSTOPWATCH_PACKAGE_DIR:-$crate_root/target/packages}"
package_name="mmstopwatch-native_${version}_${architecture}.deb"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

cargo build --manifest-path "$crate_root/Cargo.toml" --release --locked
install -Dm755 "$crate_root/target/release/mmstopwatch-slint" "$stage/usr/bin/mmstopwatch"
install -Dm644 "$crate_root/packaging/mmstopwatch.desktop" "$stage/usr/share/applications/mmstopwatch.desktop"
install -Dm644 "$crate_root/packaging/mmstopwatch.metainfo.xml" "$stage/usr/share/metainfo/mmstopwatch.metainfo.xml"
install -Dm644 "$crate_root/../src-tauri/icons/128x128.png" "$stage/usr/share/icons/hicolor/128x128/apps/mmstopwatch.png"

mkdir -p "$stage/DEBIAN" "$output_dir"
sed -e "s/@VERSION@/$version/g" -e "s/@ARCH@/$architecture/g" \
  "$crate_root/packaging/linux/control.template" > "$stage/DEBIAN/control"
dpkg-deb --root-owner-group --build "$stage" "$output_dir/$package_name"
(
  cd "$output_dir"
  sha256sum "$package_name" > SHA256SUMS-linux.txt
)
