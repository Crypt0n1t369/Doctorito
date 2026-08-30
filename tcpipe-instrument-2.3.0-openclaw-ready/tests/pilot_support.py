"""Build a fully approved pilot route so end-to-end tests exercise the real guards.

Nothing here bypasses a control: the policy reviews, robots artifact, adapter fixture and
job lease are all genuinely inserted, because the schema refuses the fetch otherwise. What
it does bypass is the *network* — artifacts come from ``tests/fixtures`` instead of a live
site, which is the same thing a replay does.
"""
from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .support import ROOT
from tcpipe.artifact_store import ArtifactStore
from tcpipe.db import open_db
from tcpipe.resources import adapter_path, schema_sql
from tcpipe.pipeline import RouteContext
from tcpipe.writer import claim_next_job, enqueue_job, finalize_fetch_attempt, register_artifact

FIXTURES = ROOT / "tests" / "fixtures"
EARLY = "2020-01-01T00:00:00Z"


def ts(moment: datetime) -> str:
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class PilotRoute:
    """One approved route plus the artifact store its runs read from."""

    def __init__(self, directory: Path, *, route_kind: str = "html_list",
                 refetch_days: int = 30, adapter_id: str = "gwo__download",
                 acquisition_method: str = "official_download"):
        self.directory = Path(directory)
        self.db_path = self.directory / "pilot.db"
        self.store = ArtifactStore(self.directory / "artifacts")
        self.adapter_id = adapter_id
        self.adapter_version = "1.0.0"
        self.route_kind = route_kind

        raw = sqlite3.connect(self.db_path)
        raw.executescript(schema_sql())
        raw.close()
        self.con = open_db(self.db_path, required_schema_version="2.3.0")

        self.con.execute(
            "INSERT INTO mission VALUES ('M-PILOT','parsing_capability','Pilot','p','done',1,0,1,?)",
            (EARLY,),
        )
        self.con.execute(
            """INSERT INTO source
               (source_id,legal_name,source_kind,country_iso2,official_website,discovered_via,
                intake_state,terms_url,license_basis,allowed_purpose,retention_period,
                legal_review_state,last_legal_review_utc,created_at_utc)
               VALUES ('SRC-P','Pilot Association','association',NULL,
                       'https://assoc.invalid/','seed','confirmed','https://assoc.invalid/terms',
                       'permission','training-centre directory research','90 days',
                       'approved',?,?)""",
            (EARLY, EARLY),
        )
        self.con.execute(
            """INSERT INTO route
               (route_id,source_id,route_url,route_kind,acquisition_method,volatility_class,
                access_class,refetch_days,crawl_delay_s,policy_state,robots_state,robots_snapshot_sha,
                created_at_utc)
               VALUES ('RT-P','SRC-P','https://assoc.invalid/partners',?,?, 'monthly','public',?,5,
                       'pending','unknown',NULL,?)""",
            (route_kind, acquisition_method, refetch_days, EARLY),
        )

        # robots artifact, then the reviews that pin it
        robots = b"User-agent: *\nAllow: /\nCrawl-delay: 5\n"
        stored = self.store.put_bytes(robots)
        register_artifact(self.con, sha256=stored.sha256, byte_len=stored.byte_len,
                          storage_path=stored.storage_path, content_type="text/plain")
        self.robots_sha = stored.sha256

        self.con.execute(
            """UPDATE route SET policy_state='approved',robots_state='allowed',
                 robots_snapshot_sha=? WHERE route_id='RT-P'""", (self.robots_sha,))
        self.con.execute(
            """INSERT INTO source_policy_review
               (source_policy_review_id,source_id,decision,terms_url,license_basis,
                allowed_purpose,retention_period,data_categories_json,reviewed_by,reviewed_at_utc)
               VALUES ('SPR-P','SRC-P','approved','https://assoc.invalid/terms','permission',
                       'training-centre directory research','90 days',
                       '["public organisation data"]','legal-reviewer',?)""", (EARLY,))
        self.con.execute(
            """INSERT INTO route_policy_review
               (route_policy_review_id,route_id,source_policy_review_id,decision,robots_state,
                robots_snapshot_sha,reviewed_by,reviewed_at_utc)
               VALUES ('RPR-P','RT-P','SPR-P','approved','allowed',?,'route-reviewer',?)""",
            (self.robots_sha, EARLY))

        self.con.execute(
            "INSERT INTO adapter VALUES (?,?, 'rules', ?, NULL, ?, 'human', 1, NULL, ?)",
            (adapter_id, self.adapter_version,
             hashlib.sha256(adapter_path(adapter_id).read_bytes()).hexdigest(),
             f"tmpl-{adapter_id}", EARLY),
        )

    # -- artifacts -------------------------------------------------------------------

    def store_fixture(self, name: str, content_type: str) -> str:
        stored = self.store.put_bytes((FIXTURES / name).read_bytes())
        register_artifact(self.con, sha256=stored.sha256, byte_len=stored.byte_len,
                          storage_path=stored.storage_path, content_type=content_type)
        return stored.sha256

    def add_passing_fixture(self, artifact_sha: str, fixture_id: str = "FIX-P") -> None:
        self.con.execute(
            "INSERT INTO adapter_fixture VALUES (?,?,?,?,?, 'exhaustive_audit', 1, ?)",
            (fixture_id, self.adapter_id, self.adapter_version, artifact_sha,
             "c" * 64, EARLY),
        )
        self.con.execute(
            """UPDATE route SET active_adapter_id=?,active_adapter_version=?
               WHERE route_id='RT-P'""", (self.adapter_id, self.adapter_version))

    # -- jobs and fetches ------------------------------------------------------------

    def claim_job(self, job_id: str, *, at: datetime, lease_seconds: int = 86400) -> str:
        enqueue_job(self.con, job_id=job_id, mission_id="M-PILOT", kind="parse", params={},
                    git_commit="pilot", idempotency_key=job_id)
        claim_next_job(self.con, f"worker-{job_id}", now=ts(at), lease_seconds=lease_seconds)
        return job_id

    def record_stored_fetch(self, attempt_id: str, job_id: str, artifact_shas, *,
                            at: datetime, role: str = "response_body",
                            fetch_tier: int = 1) -> str:
        """Record a fetch whose bytes are already in the store (replay of a real fetch)."""
        self.con.execute(
            """INSERT INTO fetch_attempt
               (attempt_id,job_id,route_id,request_url,final_url,http_status,outcome,
                requested_at_utc,fetch_tier,fetcher_version,source_policy_review_id,
                route_policy_review_id,robots_snapshot_sha)
               VALUES (?,?, 'RT-P','https://assoc.invalid/partners',
                       'https://assoc.invalid/partners',200,'content_200',?,?, 'fixture-replay',
                       'SPR-P','RPR-P',?)""",
            (attempt_id, job_id, ts(at), fetch_tier, self.robots_sha),
        )
        for sha in artifact_shas:
            self.con.execute("INSERT INTO fetch_attempt_artifact VALUES (?,?,?)",
                             (attempt_id, sha, role))
        finalize_fetch_attempt(self.con, attempt_id, finalized_at_utc=ts(at))
        return attempt_id

    def context(self, job_id: str) -> RouteContext:
        return RouteContext(
            route_id="RT-P", job_id=job_id, adapter_id=self.adapter_id,
            adapter_version=self.adapter_version, parser_version="tcpipe-adapter/2.2",
            source_policy_review_id="SPR-P", route_policy_review_id="RPR-P",
            robots_snapshot_sha=self.robots_sha,
        )

    def close(self) -> None:
        self.con.close()
