#!/usr/bin/env python3
"""Build the MLS Assist Chrome extension as a reproducible, root-level ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
PACKAGE_FILES = (
    "manifest.json",
    "background.js",
    "destination_teach_navigation_guard.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.js",
    "mls-popup.js",
    "mls-popup.css",
    "offscreen.html",
    "offscreen.js",
    "feat_codes_driver.js",
    "ext_reviews_reader.js",
    "write_safety_guard.js",
    "review_screen.js",
    "teach_destination_memory.js",
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
    "icon-128.png",
)


def manifest_version() -> str:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = str(manifest.get("version", "")).strip()
    if not re.fullmatch(r"\d+(?:\.\d+){0,3}", version):
        raise ValueError(f"manifest.json has an invalid Chrome extension version: {version!r}")
    return version


def checked_sources() -> list[tuple[str, bytes]]:
    root = ROOT.resolve()
    sources: list[tuple[str, bytes]] = []
    for name in PACKAGE_FILES:
        source = ROOT / name
        if source.is_symlink():
            raise ValueError(f"refusing to package symlink: {name}")
        resolved = source.resolve(strict=True)
        if resolved.parent != root or not resolved.is_file():
            raise ValueError(f"package entry must be a regular root file: {name}")
        sources.append((name, resolved.read_bytes()))
    return sources


def build(output: Path) -> tuple[Path, str]:
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".tmp")
    temporary.unlink(missing_ok=True)

    try:
        with zipfile.ZipFile(
            temporary,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=True,
        ) as archive:
            for name, data in checked_sources():
                entry = zipfile.ZipInfo(name, date_time=FIXED_TIMESTAMP)
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                archive.writestr(
                    entry,
                    data,
                    compress_type=zipfile.ZIP_DEFLATED,
                    compresslevel=9,
                )
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)

    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    return output, digest


def parse_args() -> argparse.Namespace:
    version = manifest_version()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / f"MLS_Assist_v{version}.zip",
        help="output ZIP path (default: repository root, named from manifest version)",
    )
    return parser.parse_args()


def main() -> int:
    try:
        args = parse_args()
        output, digest = build(args.output)
    except (OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print(f"Built {output}")
    print(f"SHA256 {digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
