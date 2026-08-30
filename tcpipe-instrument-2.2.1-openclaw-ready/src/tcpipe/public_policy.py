"""Fail-closed automated preflight for unauthenticated public routes only."""
from __future__ import annotations

import json
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone

from .artifact_store import ArtifactStore
from .transport import Transport, assert_host_fetchable, persist_host_outcome
from .writer import register_artifact, utc_now

AUTOMATED_REVIEWER = "tcpipe-public-preflight/v1"
PUBLIC_PURPOSE = "factual_public_directory_parsing"
PUBLIC_RETENTION = "governed_source_artifact_retention"


class PublicPreflightError(RuntimeError):
    pass


def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:20].upper()}"


def _valid_until(days: int = 30) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def _store_evidence(con, store: ArtifactStore, data: bytes, content_type: str) -> str:
    if not data:
        data = b'{"robots":"empty response; no rules declared"}\n'
        content_type = "application/json"
    stored = store.put_bytes(data)
    register_artifact(
        con, sha256=stored.sha256, byte_len=stored.byte_len,
        storage_path=stored.storage_path, content_type=content_type,
    )
    return stored.sha256


def public_preflight(con, store: ArtifactStore, transport: Transport, route_id: str) -> dict:
    """Record robots evidence and approve only a plainly public, allowed route."""
    route = con.execute(
        """SELECT r.*,s.legal_review_state FROM route r
             JOIN source s ON s.source_id=r.source_id WHERE r.route_id=?""", (route_id,)
    ).fetchone()
    if route is None:
        raise PublicPreflightError(f"unknown route: {route_id}")
    if route["access_class"] != "public":
        raise PublicPreflightError(
            f"route {route_id} is {route['access_class']}; human approval is required"
        )
    if route["acquisition_method"] == "human_capture":
        raise PublicPreflightError("human-capture routes cannot use automated public preflight")
    if route["legal_review_state"] == "rejected":
        raise PublicPreflightError("a rejected human source decision cannot be overridden")
    human_block = con.execute(
        """SELECT decision,data_categories_json FROM source_policy_review
             WHERE source_id=? AND reviewed_by NOT LIKE 'tcpipe-public-preflight/%'
               AND (decision='rejected' OR json_array_length(data_categories_json)>0)
             ORDER BY reviewed_at_utc DESC LIMIT 1""", (route["source_id"],)
    ).fetchone()
    if human_block is not None:
        raise PublicPreflightError(
            "existing human rejection or sensitive data classification requires human review"
        )

    assert_host_fetchable(con, route["route_url"])
    result = transport.fetch_robots(route["route_url"])
    if result.http_status not in (404, 410):
        persist_host_outcome(con, result)

    if result.http_status in (401, 403):
        raise PublicPreflightError(
            f"robots endpoint returned HTTP {result.http_status}; access review is human-gated"
        )
    if result.http_status not in (200, 404, 410):
        raise PublicPreflightError(
            f"robots preflight did not reach a decision: {result.error or result.outcome}"
        )

    if result.http_status == 200:
        evidence = result.body or b""
        allowed = not evidence or transport.robots_allows(
            evidence, transport.config.user_agent, route["route_url"]
        )
        crawl_delay = transport.robots_crawl_delay(
            evidence, transport.config.user_agent
        ) if evidence else None
        content_type = result.content_type or "text/plain"
    else:
        allowed, crawl_delay = True, None
        evidence = json.dumps({
            "robots_url": result.url, "http_status": result.http_status,
            "decision": "no robots rules published",
            "checked_at_utc": result.requested_at_utc,
        }, sort_keys=True).encode("utf-8")
        content_type = "application/json"

    sha = _store_evidence(con, store, evidence, content_type)
    now = utc_now()
    valid_until = _valid_until()
    source_review_id = _id("SPR-AUTO")
    route_review_id = _id("RPR-AUTO")
    decision = "approved" if allowed else "rejected"
    robots_state = "allowed" if allowed else "disallowed"
    con.execute("BEGIN IMMEDIATE")
    try:
        con.execute(
            """INSERT INTO source_policy_review
               (source_policy_review_id,source_id,decision,terms_url,license_basis,
                allowed_purpose,retention_period,data_categories_json,reviewed_by,
                reviewed_at_utc,valid_until_utc,evidence_artifact_sha)
               SELECT ?,source_id,'approved',terms_url,'public_web',?,?,'[]',?,?,?,?
                 FROM source WHERE source_id=?""",
            (source_review_id, PUBLIC_PURPOSE, PUBLIC_RETENTION, AUTOMATED_REVIEWER,
             now, valid_until, sha, route["source_id"]),
        )
        con.execute(
            """UPDATE source SET license_basis='public_web',allowed_purpose=?,
                 retention_period=?,legal_review_state='approved',last_legal_review_utc=?
               WHERE source_id=?""",
            (PUBLIC_PURPOSE, PUBLIC_RETENTION, now, route["source_id"]),
        )
        con.execute(
            """INSERT INTO route_policy_review
               (route_policy_review_id,route_id,source_policy_review_id,decision,
                robots_state,robots_snapshot_sha,reviewed_by,reviewed_at_utc,valid_until_utc)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (route_review_id, route_id, source_review_id, decision, robots_state, sha,
             AUTOMATED_REVIEWER, now, valid_until),
        )
        con.execute(
            """UPDATE route SET policy_state=?,robots_state=?,robots_snapshot_sha=?,
                 crawl_delay_s=max(crawl_delay_s,?) WHERE route_id=?""",
            (decision, robots_state, sha, max(1.0, float(crawl_delay or 1.0)), route_id),
        )
        host = urllib.parse.urlsplit(route["route_url"]).hostname
        con.execute(
            """INSERT INTO host_state
               (host,robots_sha256,robots_fetched_at_utc,last_outcome,updated_at_utc)
               VALUES (?,?,?,'robots_checked',?)
               ON CONFLICT(host) DO UPDATE SET robots_sha256=excluded.robots_sha256,
                 robots_fetched_at_utc=excluded.robots_fetched_at_utc,
                 updated_at_utc=excluded.updated_at_utc""", (host, sha, now, now),
        )
        con.execute("COMMIT")
    except Exception:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise

    report = {
        "route_id": route_id, "access_class": "public", "decision": decision,
        "robots_state": robots_state, "robots_snapshot_sha": sha,
        "source_policy_review_id": source_review_id,
        "route_policy_review_id": route_review_id,
        "crawl_delay_s": max(1.0, float(crawl_delay or 1.0)),
        "reviewed_by": AUTOMATED_REVIEWER,
    }
    if not allowed:
        raise PublicPreflightError(
            f"robots.txt explicitly prohibits {route['route_url']}; bypass is forbidden"
        )
    return report
