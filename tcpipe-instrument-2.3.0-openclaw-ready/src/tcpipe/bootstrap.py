"""Create and seed a governed database — importable, not a script.

This used to be `scripts/bootstrap.py`, invoked by the CLI through ``subprocess`` with a
hand-built ``PYTHONPATH``. That works in a checkout and cannot work once installed: the
scripts directory is not part of the wheel, so ``tcpipe init`` died on its first command.
Creating a database is core behaviour, so it belongs in the package. `scripts/bootstrap.py`
remains as a thin wrapper for repo workflows.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional

from .db import assert_db_integrity, open_db
from .resources import (
    MISSIONS,
    MISSIONS_SCHEMA,
    UNIVERSE_SCHEMA,
    UNIVERSE_SEED,
    data_path,
    schema_sql,
)

SCHEMA_VERSION = "2.3.0"
SEED_TIME = "2026-08-19T00:00:00Z"


class BootstrapError(RuntimeError):
    pass


def load_and_validate(document_name: str, schema_name: str) -> dict:
    from jsonschema import Draft202012Validator, FormatChecker

    document = json.loads(data_path(document_name).read_text(encoding="utf-8"))
    schema = json.loads(data_path(schema_name).read_text(encoding="utf-8"))
    Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)
    return document


def create_database(path: Path) -> None:
    """Apply the DDL to a new file. Refuses to touch an existing database."""
    path = Path(path)
    if path.exists():
        raise BootstrapError(f"refusing to overwrite existing database: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    try:
        con.executescript(schema_sql())
    finally:
        con.close()


def seed_database(path: Path) -> dict:
    """Load the validated mission registry and draft source universe."""
    missions = load_and_validate(MISSIONS, MISSIONS_SCHEMA)
    universe = load_and_validate(UNIVERSE_SEED, UNIVERSE_SCHEMA)

    source_ids = [source["source_id"] for source in universe["sources"]]
    route_ids = [route["route_id"] for route in universe["routes"]]
    if len(source_ids) != len(set(source_ids)) or len(route_ids) != len(set(route_ids)):
        raise BootstrapError("duplicate source_id or route_id in universe seed")
    unknown = sorted({route["source_id"] for route in universe["routes"]} - set(source_ids))
    if unknown:
        raise BootstrapError(f"routes reference unknown sources: {unknown}")

    con = open_db(path, required_schema_version=SCHEMA_VERSION)
    con.execute("BEGIN IMMEDIATE")
    try:
        for mission in missions["missions"]:
            con.execute(
                "INSERT INTO mission VALUES (?,?,?,?,?,?,?,?,?)",
                (mission["mission_id"], mission["track"], mission["title"],
                 mission["problem"], mission["done_when"], mission["priority"],
                 int(mission["blocks_production"]), 1, SEED_TIME),
            )
        universe_row = universe["universe"]
        con.execute(
            "INSERT INTO source_universe VALUES (?,?,?,?,?,?)",
            (universe_row["universe_id"], universe_row["version"],
             universe_row["scope_statement"], universe_row["status"],
             universe_row["created_at_utc"], universe_row.get("frozen_at_utc")),
        )
        for source in universe["sources"]:
            con.execute(
                """INSERT INTO source
                   (source_id,legal_name,acronym,source_kind,country_iso2,official_website,
                    discovered_via,intake_state,terms_url,license_basis,allowed_purpose,
                    retention_period,legal_review_state,last_legal_review_utc,created_at_utc)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(source.get(name) for name in (
                    "source_id", "legal_name", "acronym", "source_kind", "country_iso2",
                    "official_website", "discovered_via", "intake_state", "terms_url",
                    "license_basis", "allowed_purpose", "retention_period",
                    "legal_review_state", "last_legal_review_utc", "created_at_utc")),
            )
            con.execute(
                """INSERT INTO universe_source
                   (universe_id,source_id,eligibility,exclusion_reason) VALUES (?,?,?,?)""",
                (universe_row["universe_id"], source["source_id"], source["eligibility"],
                 source.get("exclusion_reason")),
            )
        for route in universe["routes"]:
            con.execute(
                """INSERT INTO route
                   (route_id,source_id,route_url,scheme_scope,route_kind,acquisition_method,
                    access_class,policy_state,robots_state,robots_snapshot_sha,crawl_delay_s,
                    volatility_class,refetch_days,created_at_utc)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                tuple(route.get(name) for name in (
                    "route_id", "source_id", "route_url", "scheme_scope", "route_kind",
                    "acquisition_method", "access_class", "policy_state", "robots_state",
                    "robots_snapshot_sha", "crawl_delay_s", "volatility_class",
                    "refetch_days", "created_at_utc")),
            )
            con.execute(
                """INSERT INTO universe_route
                   (universe_id,route_id,eligibility,exclusion_reason,expected_records,
                    expected_basis,expected_as_of_utc) VALUES (?,?,?,?,?,?,?)""",
                (universe_row["universe_id"], route["route_id"], route["eligibility"],
                 route.get("exclusion_reason"), route.get("expected_records"),
                 route.get("expected_basis"), route.get("expected_as_of_utc")),
            )
        con.execute("COMMIT")
        assert_db_integrity(con)
        counts = {
            table: con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in ("mission", "source", "route")
        }
        return counts
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def bootstrap(db_path: Path, *, artifacts: Optional[Path] = None) -> dict:
    """Create, seed and verify a database; optionally prepare the artifact directory."""
    db_path = Path(db_path).expanduser().resolve()
    create_database(db_path)
    counts = seed_database(db_path)
    report = {"database": str(db_path), "schema_version": SCHEMA_VERSION, "seeded": counts}
    if artifacts is not None:
        artifact_root = Path(artifacts).expanduser().resolve()
        artifact_root.mkdir(parents=True, exist_ok=True)
        report["artifact_store"] = str(artifact_root)
    return report
