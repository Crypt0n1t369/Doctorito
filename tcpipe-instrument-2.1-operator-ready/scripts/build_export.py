#!/usr/bin/env python3
"""Build a clean, reproducible, checksummed handoff archive."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = frozenset({
    ".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "build", "work", ".claude", ".venv", "venv", ".tox", ".idea", ".vscode",
})
EXCLUDED_NAMES = frozenset({".DS_Store", ".coverage"})
ZIP_TIME = (2026, 8, 20, 0, 0, 0)


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    return (
        path.is_file()
        and not path.is_symlink()
        and path.name not in EXCLUDED_NAMES
        and path.suffix != ".pyc"
        and not any(
            part in EXCLUDED_DIRS or part.endswith(".egg-info") for part in rel.parts
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--skip-verify", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "HANDOFF-MANIFEST.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    top = f"tcpipe-instrument-{version}-openclaw-ready"
    output = (args.output or ROOT.parent / f"{top}.zip").expanduser().resolve()
    if output == ROOT or ROOT in output.parents:
        raise SystemExit("export archive must be written outside the project folder")
    if not args.skip_verify:
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/verify_bundle.py")], cwd=ROOT, check=True,
            env={**os.environ, "PYTHONPATH": str(ROOT / "src"),
                 "PYTHONDONTWRITEBYTECODE": "1"},
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path in sorted((item for item in ROOT.rglob("*") if included(item))):
            rel = path.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo(f"{top}/{rel}", date_time=ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (path.stat().st_mode & 0xFFFF) << 16
            zf.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED,
                        compresslevel=9)
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    checksum = output.with_suffix(output.suffix + ".sha256")
    checksum.write_text(f"{digest}  {output.name}\n", encoding="utf-8")
    print(json.dumps({
        "archive": str(output), "sha256": digest, "checksum": str(checksum),
        "bytes": output.stat().st_size,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
