#!/usr/bin/env python3
"""Generate and verify the checksum and build metadata for one native package."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import NoReturn


PLATFORMS = {
    "linux": (".deb", "mmstopwatch-native_{version}_amd64.deb"),
    "windows": (".exe", "mmStopWatch-Native-{version}-setup.exe"),
    "macos": (".dmg", "mmstopwatch-native_{version}_arm64.dmg"),
}
INSTALLER_SUFFIXES = tuple(suffix for suffix, _ in PLATFORMS.values())
KNOWN_INSTALLER_SUFFIXES = (".appimage", ".deb", ".dmg", ".exe", ".msi", ".rpm")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ValidationError(RuntimeError):
    """An expected release-input validation failure."""


def fail(message: str) -> "NoReturn":
    raise ValidationError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def installer_for(package_dir: Path, platform: str, version: str) -> Path:
    suffix, expected_name_template = PLATFORMS[platform]
    files = [path for path in package_dir.iterdir() if path.is_file()]
    installer_files = [path for path in files if path.suffix.lower() in KNOWN_INSTALLER_SUFFIXES]
    unexpected = [path for path in installer_files if path.suffix.lower() != suffix]
    if unexpected:
        fail(f"{platform}: unexpected installer input(s): {', '.join(path.name for path in unexpected)}")
    if len(installer_files) != 1:
        fail(f"{platform}: expected exactly one {suffix} installer, found {len(installer_files)}")
    installer = installer_files[0]
    expected_name = expected_name_template.format(version=version)
    if installer.name != expected_name:
        fail(f"{platform}: expected installer {expected_name}, found {installer.name}")
    return installer


def checksum_path(package_dir: Path, platform: str) -> Path:
    return package_dir / f"SHA256SUMS-{platform}.txt"


def metadata_path(package_dir: Path, platform: str) -> Path:
    return package_dir / f"BUILD-METADATA-{platform}.json"


def read_checksum(path: Path, installer_name: str) -> str:
    lines = [
        line.rstrip("\r\n")
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if len(lines) != 1:
        fail(f"{path}: expected exactly one non-empty checksum line")
    parts = lines[0].split("  ", 1)
    if len(parts) != 2 or not SHA256_RE.fullmatch(parts[0]) or parts[1] != installer_name:
        fail(f"{path}: expected '<64-hex>  {installer_name}'")
    return parts[0]


def load_metadata(path: Path, platform: str, version: str, installer: Path, digest: str) -> dict[str, object]:
    if not path.is_file():
        fail(f"{platform}: missing {path.name}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"{path}: invalid JSON: {error}")
    if not isinstance(value, dict):
        fail(f"{path}: expected a JSON object")
    expected = {
        "version": version,
        "platform": platform,
        "installer": installer.name,
        "size": installer.stat().st_size,
        "sha256": digest,
    }
    for key, expected_value in expected.items():
        if value.get(key) != expected_value:
            fail(f"{path}: field {key!r} does not describe the actual installer")
    return value


def write_json(path: Path, value: dict[str, object]) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def generate(args: argparse.Namespace) -> None:
    package_dir = args.package_dir.resolve()
    if not package_dir.is_dir():
        fail(f"package directory does not exist: {package_dir}")
    installer = installer_for(package_dir, args.platform, args.version)
    digest = sha256(installer)
    checksum = checksum_path(package_dir, args.platform)
    if checksum.exists():
        recorded = read_checksum(checksum, installer.name)
        if recorded != digest:
            fail(f"{checksum}: digest does not match {installer.name}")
    if args.check_only:
        if not checksum.exists():
            fail(f"{args.platform}: missing {checksum.name}")
        load_metadata(metadata_path(package_dir, args.platform), args.platform, args.version, installer, digest)
        return

    checksum.write_text(f"{digest}  {installer.name}\n", encoding="utf-8")
    metadata = {
        "name": args.name,
        "version": args.version,
        "platform": args.platform,
        "installer": installer.name,
        "size": installer.stat().st_size,
        "sha256": digest,
        "files": [installer.name],
        "commit": args.commit,
        "ref": args.ref,
        "runner": args.runner,
    }
    write_json(metadata_path(package_dir, args.platform), metadata)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--platform", choices=sorted(PLATFORMS), required=True)
    result.add_argument("--package-dir", type=Path, required=True)
    result.add_argument("--version", required=True)
    result.add_argument("--name", default="mmstopwatch-native")
    result.add_argument("--commit", default=None)
    result.add_argument("--ref", default=None)
    result.add_argument("--runner", default=None)
    result.add_argument("--check-only", action="store_true")
    return result


def main() -> int:
    args = parser().parse_args()
    try:
        generate(args)
    except (OSError, ValidationError) as error:
        print(f"release metadata validation failed: {error}", file=sys.stderr)
        return 1
    print(f"validated {args.platform} package metadata in {args.package_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
