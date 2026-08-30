#!/usr/bin/env python3
"""Verify manifest, schema, seeds, bootstrap and executable controls."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: Kept in step with scripts/build_manifest.py. Built distributions are handoff content;
#: mutable runtime state is not.
EXCLUDED_DIRS = frozenset({
    ".git", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "build", "work", ".claude", ".venv", "venv", ".tox", ".idea", ".vscode",
})


def _excluded(rel_parts) -> bool:
    return any(part in EXCLUDED_DIRS or part.endswith(".egg-info") for part in rel_parts)


def verify_manifest() -> None:
    manifest = json.loads((ROOT / "HANDOFF-MANIFEST.json").read_text(encoding="utf-8"))
    mismatches = []
    actual = {
        str(path.relative_to(ROOT)) for path in ROOT.rglob("*")
        if path.is_file() and not path.is_symlink()
        and path.name not in ("HANDOFF-MANIFEST.json", ".DS_Store", ".coverage")
        and not _excluded(path.relative_to(ROOT).parts) and path.suffix != ".pyc"
    }
    expected_names = set(manifest["files"])
    for name in sorted(actual - expected_names):
        mismatches.append(f"untracked {name}")
    for name in sorted(expected_names - actual):
        mismatches.append(f"missing {name}")
    for name, expected in manifest["files"].items():
        path = ROOT / name
        if not path.is_file():
            mismatches.append(f"missing {name}")
            continue
        data = path.read_bytes()
        if len(data) != expected["bytes"] or hashlib.sha256(data).hexdigest() != expected["sha256"]:
            mismatches.append(f"changed {name}")
    if mismatches:
        raise RuntimeError("manifest mismatch: " + ", ".join(mismatches))


def verify_schema_and_bootstrap() -> None:
    with tempfile.TemporaryDirectory() as directory:
        db = Path(directory) / "pilot.db"
        subprocess.run(
            [sys.executable, str(ROOT / "scripts/bootstrap.py"), "--db", str(db)],
            cwd=ROOT, check=True, env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
            stdout=subprocess.DEVNULL,
        )
        con = sqlite3.connect(db)
        try:
            violations = con.execute("PRAGMA foreign_key_check").fetchall()
            version = con.execute("SELECT schema_version FROM schema_meta").fetchone()[0]
            counts = tuple(con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
                           for table in ("mission", "source", "route"))
        finally:
            con.close()
        if violations or version != "2.2.0" or counts != (5, 5, 5):
            raise RuntimeError(
                f"bootstrap verification failed: version={version}, counts={counts}, violations={violations}"
            )


def verify_operator_surface() -> None:
    required = (
        "AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md",
        "skills/tcpipe-operations/SKILL.md", "openclaw/agent-policy.conf",
        "openclaw/INSTALL.md", "bin/tcpipe-agent", "openclaw/setup-openclaw.sh",
        "openclaw/install-automations.sh",
    )
    missing = [name for name in required if not (ROOT / name).is_file()]
    if missing:
        raise RuntimeError(f"OpenClaw operator surface is incomplete: {missing}")
    for name in ("tcpipe", "bin/tcpipe-agent", "openclaw/setup-openclaw.sh",
                 "openclaw/install-automations.sh"):
        if not os.access(ROOT / name, os.X_OK):
            raise RuntimeError(f"operator executable bit is missing: {name}")
    skill = (ROOT / "skills/tcpipe-operations/SKILL.md").read_text(encoding="utf-8")
    if not skill.startswith("---\nname: tcpipe-operations\ndescription: "):
        raise RuntimeError("tcpipe OpenClaw skill has invalid or missing frontmatter")
    subprocess.run(["sh", "-n", str(ROOT / "bin/tcpipe-agent")], check=True)
    subprocess.run(
        ["bash", "-n", str(ROOT / "openclaw/setup-openclaw.sh"),
         str(ROOT / "openclaw/install-automations.sh")], check=True
    )


def verify_distributions() -> None:
    wheel = ROOT / "dist/tcpipe_foundation-2.2.1-py3-none-any.whl"
    sdist = ROOT / "dist/tcpipe_foundation-2.2.1.tar.gz"
    expected = {wheel, sdist}
    actual = set((ROOT / "dist").glob("tcpipe_foundation-*"))
    if actual != expected:
        raise RuntimeError(
            "distribution set is stale or incomplete: "
            f"expected {[path.name for path in sorted(expected)]}, "
            f"got {[path.name for path in sorted(actual)]}"
        )
    with zipfile.ZipFile(wheel) as archive:
        names = set(archive.namelist())
        required = {
            "tcpipe/data/schema.sql",
            "tcpipe/data/source-universe.seed.json",
            "tcpipe/data/adapters/gwo__download.json",
            "tcpipe_foundation-2.2.1.dist-info/METADATA",
        }
        if not required <= names:
            raise RuntimeError(f"wheel is missing runtime data: {sorted(required - names)}")
        metadata = archive.read("tcpipe_foundation-2.2.1.dist-info/METADATA")
        if b"Version: 2.2.1\n" not in metadata:
            raise RuntimeError("wheel metadata version does not match handoff 2.2.1")
    with tarfile.open(sdist, "r:gz") as archive:
        names = set(archive.getnames())
        if "tcpipe_foundation-2.2.1/src/tcpipe/data/schema.sql" not in names:
            raise RuntimeError("sdist is missing the governed schema")


def verify_tests() -> None:
    subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-v"], cwd=ROOT, check=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "src"), "PYTHONDONTWRITEBYTECODE": "1"},
    )


def main() -> int:
    verify_manifest()
    verify_schema_and_bootstrap()
    verify_operator_surface()
    verify_distributions()
    verify_tests()
    print("bundle verified: manifest, schema 2.2.0, OpenClaw controls, bootstrap and tests")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
