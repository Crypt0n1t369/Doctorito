#!/usr/bin/env python3
"""Regenerate HANDOFF-MANIFEST.json from the complete bundle tree."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "HANDOFF-MANIFEST.json"


#: Directories that are transient tooling/runtime state — never bundle contents. ``dist``
#: is intentionally tracked because the handoff promises installable artifacts.
EXCLUDED_DIRS = frozenset({
    ".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "build", "work", ".claude", ".venv", "venv", ".tox", ".idea", ".vscode",
})


def _excluded(rel_parts) -> bool:
    return any(part in EXCLUDED_DIRS or part.endswith(".egg-info") for part in rel_parts)


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    return (
        path.is_file()
        and not path.is_symlink()
        and path != MANIFEST
        and not _excluded(rel.parts)
        and path.suffix != ".pyc"
        and path.name not in (".DS_Store", ".coverage")
    )


def main() -> int:
    files = {}
    for path in sorted((p for p in ROOT.rglob("*") if included(p)), key=lambda p: str(p)):
        data = path.read_bytes()
        files[str(path.relative_to(ROOT))] = {
            "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()
        }
    manifest = {
        "bundle": "tcpipe-handoff",
        "version": "2.2.1",
        "authority": "FOUNDATION-2.1.md and executable tests",
        "expected_audit_findings_hash_on_v2_pack":
            "bd8d706fa67b7b38f3c5e249dbe0a3496e220466ded85f08fd8cc91f4cefeba9",
        "schema_version": "2.2.0",
        "files": files,
        "verification_command":
            "PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 scripts/verify_bundle.py",
        "historical_or_suspended": [
            "ARCHITECTURE-training-centre-pipeline.md",
            "QA-VERIFICATION-REGIME.md",
            "V3-NORMATIVE-SPECIFICATION.md Parts 4, 7, 12 and 13",
            "config-sources.SPEC-and-SEED.yaml"
        ]
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"wrote {MANIFEST.name} with {len(files)} tracked files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
