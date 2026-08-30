from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from tcpipe.db import open_db
from tcpipe.resources import schema_sql
from tcpipe.writer import claim_next_job, enqueue_job

try:  # pypdf is an optional extra: only PDF routes need it
    import pypdf  # noqa: F401

    HAVE_PYPDF = True
except ImportError:  # pragma: no cover - depends on install profile
    HAVE_PYPDF = False


def create_seeded_db(path: Path):
    raw = sqlite3.connect(path)
    raw.executescript(schema_sql())
    raw.close()
    con = open_db(path, required_schema_version="2.2.0")
    con.execute(
        "INSERT INTO mission VALUES (?,?,?,?,?,?,?,?,?)",
        ("M-TEST", "parsing_capability", "Test", "Test problem", "Tests pass", 1, 0, 1,
         "2026-08-19T00:00:00Z"),
    )
    con.execute(
        """INSERT INTO source
           (source_id,legal_name,source_kind,official_website,discovered_via,intake_state,
            legal_review_state,created_at_utc) VALUES (?,?,?,?,?,?,?,?)""",
        ("SRC-T", "Test Source", "registry", "https://example.invalid", "seed", "confirmed",
         "pending", "2026-08-19T00:00:00Z"),
    )
    con.execute(
        """INSERT INTO route
           (route_id,source_id,route_url,route_kind,acquisition_method,volatility_class,
            refetch_days,created_at_utc)
           VALUES (?,?,?,?,?,?,?,?)""",
        ("RT-T", "SRC-T", "https://example.invalid/list", "html_list", "http", "monthly",
         30, "2026-08-19T00:00:00Z"),
    )
    con.execute(
        "INSERT INTO artifact VALUES (?,?,?,?,?)",
        ("a" * 64, 1, "text/html", "/artifacts/a", "2026-08-19T00:00:00Z"),
    )
    con.execute(
        "INSERT INTO adapter VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("test__html", "1.0.0", "rules", "b" * 64, None, None, "human", 1, None,
         "2026-08-19T00:00:00Z"),
    )
    con.execute(
        "INSERT INTO adapter_fixture VALUES (?,?,?,?,?,?,?,?)",
        ("FIX-1", "test__html", "1.0.0", "a" * 64, "c" * 64, "exhaustive_audit", 1,
         "2026-08-19T00:00:00Z"),
    )
    con.execute(
        "UPDATE route SET active_adapter_id='test__html',active_adapter_version='1.0.0' "
        "WHERE route_id='RT-T'"
    )
    enqueue_job(
        con, job_id="J-1", mission_id="M-TEST", kind="parse", params={}, git_commit="abc123",
        idempotency_key="test-job",
    )
    claim_next_job(con, "worker-1", now="2026-08-19T00:00:01Z")
    return con
