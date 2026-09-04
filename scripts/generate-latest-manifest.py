#!/usr/bin/env python3
"""Verify staged installers and generate the strict latest.json release manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import NoReturn


PLATFORMS = {
    "linux": ("mmstopwatch-native-{version}-linux-amd64.deb", "linux-x86_64"),
    "windows": ("mmstopwatch-native-{version}-windows-x86_64.exe", "windows-x86_64"),
    "macos": ("mmstopwatch-native-{version}-macos-arm64.dmg", "macos-aarch64"),
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
TAG_RE = re.compile(r"^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$")
KNOWN_INSTALLER_SUFFIXES = (".appimage", ".deb", ".dmg", ".exe", ".msi", ".rpm")


class ValidationError(RuntimeError):
    """An expected release-input validation failure."""


def fail(message: str) -> "NoReturn":
    raise ValidationError(message)


def sha256(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def verify_platform(stage: Path, platform: str, version: str, repository: str, tag: str) -> dict[str, object]:
    installer_name, platform_key = PLATFORMS[platform]
    installer = stage / installer_name.format(version=version)
    checksum_path = stage / f"SHA256SUMS-{platform}.txt"
    metadata_path = stage / f"BUILD-METADATA-{platform}.json"
    for path in (installer, checksum_path, metadata_path):
        if not path.is_file():
            fail(f"{platform}: missing staged file {path.name}")

    actual_size = installer.stat().st_size
    actual_digest = sha256(installer)
    lines = [line.strip() for line in checksum_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(lines) != 1:
        fail(f"{checksum_path}: expected exactly one checksum line")
    parts = lines[0].split("  ", 1)
    if len(parts) != 2 or not SHA256_RE.fullmatch(parts[0]) or parts[1] != installer.name:
        fail(f"{checksum_path}: expected '<64-hex>  {installer.name}'")
    if parts[0] != actual_digest:
        fail(f"{checksum_path}: digest does not match staged installer {installer.name}")

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"{metadata_path}: invalid JSON: {error}")
    if not isinstance(metadata, dict):
        fail(f"{metadata_path}: expected a JSON object")
    expected = {
        "version": version,
        "installer": installer.name,
        "size": actual_size,
        "sha256": actual_digest,
    }
    for key, expected_value in expected.items():
        if metadata.get(key) != expected_value:
            fail(f"{metadata_path}: field {key!r} does not match staged installer")

    return {
        "url": f"https://github.com/{repository}/releases/download/{tag}/{installer.name}",
        "filename": installer.name,
        "size": actual_size,
        "sha256": actual_digest,
        "platform_key": platform_key,
    }


def generate(args: argparse.Namespace) -> None:
    stage = args.staged_dir.resolve()
    output = args.output.resolve()
    if not stage.is_dir():
        fail(f"staged directory does not exist: {stage}")
    if output.parent != stage:
        fail("latest.json output must be directly inside the staged directory")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repository):
        fail(f"invalid GitHub repository owner/name: {args.repository}")
    if not TAG_RE.fullmatch(args.tag):
        fail(f"invalid release tag: {args.tag}")
    if args.tag != f"v{args.version}" and not args.tag.startswith(f"v{args.version}-"):
        fail(f"release tag {args.tag} does not match package version {args.version}")
    if not args.notes_file.is_file():
        fail(f"release notes file does not exist: {args.notes_file}")
    if output.exists():
        fail(f"refusing to overwrite existing manifest: {output}")

    expected_assets = {
        filename.format(version=args.version) for filename, _ in PLATFORMS.values()
    } | {f"SHA256SUMS-{platform}.txt" for platform in PLATFORMS} | {
        f"BUILD-METADATA-{platform}.json" for platform in PLATFORMS
    }
    actual_assets = {path.name for path in stage.iterdir() if path.is_file()}
    extra = sorted(actual_assets - expected_assets)
    missing = sorted(expected_assets - actual_assets)
    if extra or missing:
        fail(f"staged release assets mismatch: missing={missing}, extra={extra}")
    installer_files = [
        path
        for path in stage.iterdir()
        if path.is_file() and path.suffix.lower() in KNOWN_INSTALLER_SUFFIXES
    ]
    if len(installer_files) != 3:
        fail(f"staged release must contain exactly three installers, found {len(installer_files)}")

    platform_entries = {}
    for platform in PLATFORMS:
        entry = verify_platform(stage, platform, args.version, args.repository, args.tag)
        platform_entries[entry.pop("platform_key")] = entry

    manifest = {
        "schemaVersion": 1,
        "name": args.name,
        "version": args.version,
        "notes": args.notes_file.read_text(encoding="utf-8"),
        "platforms": platform_entries,
    }
    output.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staged-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--notes-file", type=Path, required=True)
    args = parser.parse_args()
    try:
        generate(args)
    except (OSError, ValidationError) as error:
        print(f"latest.json generation failed: {error}", file=sys.stderr)
        return 1
    print(f"generated verified manifest {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
