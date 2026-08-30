"""Locate the instrument's own data files, installed or in a source tree.

Everything the runtime needs — the schema, the JSON contracts, the seeds and the shipped
adapter rules — lives inside the package as package data, and is reached through
``importlib.resources``. Nothing resolves paths relative to the repository layout.

That distinction is the whole point of this module. Code that says
``Path(__file__).parents[2] / "schema.sql"`` works perfectly in a git checkout and fails
the moment it is installed into site-packages, where there is no repository above the
package. The failure is silent until first run, and first run is deployment day.
"""
from __future__ import annotations

from importlib import resources
from pathlib import Path
from typing import Iterator

DATA_PACKAGE = "tcpipe.data"
ADAPTER_PACKAGE = "tcpipe.data.adapters"

SCHEMA_SQL = "schema.sql"
ADAPTER_RULES_SCHEMA = "adapter-rules.schema.json"
MISSIONS = "missions.json"
MISSIONS_SCHEMA = "missions.schema.json"
UNIVERSE_SEED = "source-universe.seed.json"
UNIVERSE_SCHEMA = "source-universe.schema.json"


class ResourceMissing(RuntimeError):
    """A packaged data file is absent — almost always a broken build, not a bad call."""


def data_path(name: str, *, package: str = DATA_PACKAGE) -> Path:
    """Filesystem path to a packaged data file.

    Returns a real path rather than a stream because callers hand these to sqlite and to
    jsonschema, both of which want a path. This is safe for a normal wheel or source
    install; it would need ``as_file`` if the package were ever run from a zipimport.
    """
    try:
        candidate = resources.files(package).joinpath(name)
    except (ModuleNotFoundError, TypeError) as exc:  # pragma: no cover - broken install
        raise ResourceMissing(f"data package {package!r} is not importable: {exc}") from exc
    path = Path(str(candidate))
    if not path.is_file():
        raise ResourceMissing(
            f"packaged data file {name!r} is missing from {package!r} at {path}. "
            "The wheel was probably built without its package data; check that "
            "[tool.setuptools.package-data] still lists this file."
        )
    return path


def read_text(name: str, *, package: str = DATA_PACKAGE) -> str:
    return data_path(name, package=package).read_text(encoding="utf-8")


def schema_sql() -> str:
    """The full DDL for a governed database."""
    return read_text(SCHEMA_SQL)


def adapter_rules_schema_path() -> Path:
    return data_path(ADAPTER_RULES_SCHEMA)


def adapter_path(adapter_id: str) -> Path:
    """Rules document for a shipped adapter, by adapter id."""
    if "/" in adapter_id or "\\" in adapter_id or adapter_id.startswith("."):
        raise ValueError(f"invalid adapter id: {adapter_id!r}")
    return data_path(f"{adapter_id}.json", package=ADAPTER_PACKAGE)


def iter_adapter_paths() -> Iterator[Path]:
    """Every adapter rules document shipped with the package."""
    try:
        entries = resources.files(ADAPTER_PACKAGE).iterdir()
    except (ModuleNotFoundError, TypeError) as exc:  # pragma: no cover
        raise ResourceMissing(f"adapter package is not importable: {exc}") from exc
    for entry in sorted(Path(str(item)) for item in entries):
        if entry.suffix == ".json" and entry.is_file():
            yield entry


def shipped_adapter_ids() -> list[str]:
    return [path.stem for path in iter_adapter_paths()]


def self_check() -> dict:
    """Confirm every required data file is present. Used by ``tcpipe doctor`` and preflight.

    A deployment that is missing its schema should say so on startup, not when an operator
    first tries to create a database.
    """
    report: dict = {"ok": True, "data_package": DATA_PACKAGE, "files": {}, "missing": []}
    for name in (SCHEMA_SQL, ADAPTER_RULES_SCHEMA, MISSIONS, MISSIONS_SCHEMA,
                 UNIVERSE_SEED, UNIVERSE_SCHEMA):
        try:
            path = data_path(name)
            report["files"][name] = {"path": str(path), "bytes": path.stat().st_size}
        except ResourceMissing as exc:
            report["ok"] = False
            report["missing"].append({"name": name, "detail": str(exc)})
    try:
        adapters = shipped_adapter_ids()
        report["adapters"] = adapters
        if not adapters:
            report["ok"] = False
            report["missing"].append({"name": "adapters/*.json",
                                      "detail": "no adapter rules shipped"})
    except ResourceMissing as exc:
        report["ok"] = False
        report["missing"].append({"name": "adapters", "detail": str(exc)})
    return report
