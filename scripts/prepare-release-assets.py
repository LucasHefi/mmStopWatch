#!/usr/bin/env python3
"""Validate downloaded platform artifacts and stage deterministic release names."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path
from typing import NoReturn


PLATFORMS = {
    "linux": ("mmstopwatch-native-{version}-linux-amd64.deb", ".deb", "linux-x86_64"),
    "windows": ("mmstopwatch-native-{version}-windows-x86_64.exe", ".exe", "windows-x86_64"),
    "macos": ("mmstopwatch-native-{version}-macos-arm64.dmg", ".dmg", "macos-aarch64"),
}
ARTIFACT_DIRS = {platform: f"mmstopwatch-native-{platform}" for platform in PLATFORMS}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
KNOWN_INSTALLER_SUFFIXES = (".appimage", ".deb", ".dmg", ".exe", ".msi", ".rpm")


class ValidationError(RuntimeError):
    """An expected release-input validation failure."""


def fail(message: str) -> "NoReturn":
    raise ValidationError(message)


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def find_one(paths: list[Path], description: str) -> Path:
    if len(paths) != 1:
        fail(f"{description}: expected exactly one file, found {len(paths)}")
    return paths[0]


def validate_source(platform: str, source_dir: Path, version: str) -> tuple[Path, str, dict[str, object]]:
    if not source_dir.is_dir():
        fail(f"{platform}: missing downloaded artifact directory {source_dir}")
    all_files = [path for path in source_dir.rglob("*") if path.is_file()]
    _, suffix, platform_key = PLATFORMS[platform]
    installer_candidates = [path for path in all_files if path.suffix.lower() in KNOWN_INSTALLER_SUFFIXES]
    unexpected = [path for path in installer_candidates if path.suffix.lower() != suffix]
    if unexpected:
        fail(f"{platform}: extra or wrong installer input(s): {', '.join(path.name for path in unexpected)}")
    installer = find_one(installer_candidates, f"{platform} installer")
    expected_original = {
        "linux": f"mmstopwatch-native_{version}_amd64.deb",
        "windows": f"mmStopWatch-Native-{version}-setup.exe",
        "macos": f"mmstopwatch-native_{version}_arm64.dmg",
    }[platform]
    if installer.name != expected_original:
        fail(f"{platform}: expected downloaded installer {expected_original}, found {installer.name}")

    checksum = find_one(
        [path for path in all_files if path.name == f"SHA256SUMS-{platform}.txt"],
        f"{platform} checksum",
    )
    lines = [line.strip() for line in checksum.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(lines) != 1:
        fail(f"{checksum}: expected exactly one checksum line")
    parts = lines[0].split("  ", 1)
    if len(parts) != 2 or not SHA256_RE.fullmatch(parts[0]) or Path(parts[1]).name != installer.name:
        fail(f"{checksum}: checksum must name the only {suffix} installer")
    actual_digest = digest(installer)
    if parts[0] != actual_digest:
        fail(f"{checksum}: digest does not match downloaded {installer.name}")

    metadata_path = find_one(
        [path for path in all_files if path.name == f"BUILD-METADATA-{platform}.json"],
        f"{platform} build metadata",
    )
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        fail(f"{metadata_path}: invalid JSON: {error}")
    if not isinstance(metadata, dict):
        fail(f"{metadata_path}: expected a JSON object")
    expected = {
        "version": version,
        "platform": platform,
        "installer": installer.name,
        "size": installer.stat().st_size,
        "sha256": actual_digest,
    }
    for key, expected_value in expected.items():
        if metadata.get(key) != expected_value:
            fail(f"{metadata_path}: field {key!r} does not match downloaded installer")
    return installer, actual_digest, {**metadata, "platformKey": platform_key}


def prepare(args: argparse.Namespace) -> None:
    source_root = args.artifacts_dir.resolve()
    output_dir = args.output_dir.resolve()
    if not source_root.is_dir():
        fail(f"downloaded artifacts directory does not exist: {source_root}")
    expected_dirs = set(ARTIFACT_DIRS.values())
    actual_dirs = {path.name for path in source_root.iterdir() if path.is_dir()}
    actual_files = [path for path in source_root.iterdir() if path.is_file()]
    if actual_files or actual_dirs != expected_dirs:
        fail(
            "downloaded artifacts must contain exactly the three named platform directories; "
            f"missing={sorted(expected_dirs - actual_dirs)}, extra={sorted(actual_dirs - expected_dirs)}, "
            f"files={[path.name for path in actual_files]}"
        )
    if output_dir.exists() and any(output_dir.iterdir()):
        fail(f"output directory is not empty: {output_dir}")
    output_dir.mkdir(parents=True, exist_ok=True)

    for platform, source_name in ARTIFACT_DIRS.items():
        installer, actual_digest, metadata = validate_source(
            platform, source_root / source_name, args.version
        )
        staged_name = PLATFORMS[platform][0].format(version=args.version)
        shutil.copy2(installer, output_dir / staged_name)
        (output_dir / f"SHA256SUMS-{platform}.txt").write_text(
            f"{actual_digest}  {staged_name}\n", encoding="utf-8"
        )
        metadata.update(
            {
                "installer": staged_name,
                "size": (output_dir / staged_name).stat().st_size,
                "sha256": actual_digest,
            }
        )
        (output_dir / f"BUILD-METADATA-{platform}.json").write_text(
            json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--version", required=True)
    args = parser.parse_args()
    try:
        prepare(args)
    except (OSError, ValidationError) as error:
        print(f"release staging validation failed: {error}", file=sys.stderr)
        return 1
    print(f"staged three validated installers in {args.output_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
