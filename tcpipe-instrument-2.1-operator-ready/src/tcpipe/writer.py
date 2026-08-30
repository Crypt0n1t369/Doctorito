"""Transactional writer boundary for queue and route-run state.

OS-level privilege separation remains a deployment concern. This module supplies the
single deterministic mutation path and uses ``BEGIN IMMEDIATE`` as SQLite's writer claim.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Optional

from .terminal_state import TerminalInputs, calculate_terminal_state


class WriterConflict(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _utc_after(value: str, seconds: int) -> str:
    if seconds <= 0:
        raise ValueError("lease seconds must be positive")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("UTC timestamp must include an offset or Z")
    return (parsed.astimezone(timezone.utc) + timedelta(seconds=seconds)).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def _parse_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("UTC timestamp must include an offset or Z")
    return parsed.astimezone(timezone.utc)


def _json(value: Mapping[str, Any] | list[Any]) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def artifact_set_hash(artifacts: list[tuple[str, str]]) -> str:
    """Hash an unordered ``(role, sha256)`` set using an unambiguous encoding."""
    if not artifacts:
        raise ValueError("at least one parse artifact is required")
    canonical = b"".join(
        len(role.encode("utf-8")).to_bytes(4, "big")
        + role.encode("utf-8")
        + bytes.fromhex(digest)
        for role, digest in sorted(set(artifacts))
    )
    return hashlib.sha256(canonical).hexdigest()


def freeze_universe(
    con: sqlite3.Connection, universe_id: str, *, frozen_at_utc: Optional[str] = None
) -> None:
    """Freeze an eligible, policy-approved denominator; schema triggers enforce readiness."""
    frozen_at_utc = frozen_at_utc or utc_now()
    con.execute("BEGIN IMMEDIATE")
    try:
        changed = con.execute(
            """UPDATE source_universe SET status='frozen', frozen_at_utc=?
               WHERE universe_id=? AND status='draft'""",
            (frozen_at_utc, universe_id),
        ).rowcount
        if changed != 1:
            raise WriterConflict(f"universe {universe_id} is missing or not draft")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise


def enqueue_job(
    con: sqlite3.Connection,
    *,
    job_id: str,
    mission_id: str,
    kind: str,
    params: Mapping[str, Any],
    git_commit: str,
    idempotency_key: str,
    priority: int = 100,
    max_attempts: int = 3,
    actor: str = "operator",
) -> bool:
    """Enqueue idempotently. Returns False when the idempotency key already exists."""
    now = utc_now()
    con.execute("BEGIN IMMEDIATE")
    try:
        existing = con.execute(
            "SELECT job_id FROM job_queue WHERE idempotency_key = ?", (idempotency_key,)
        ).fetchone()
        if existing:
            con.execute("COMMIT")
            return False
        con.execute(
            """INSERT INTO job_queue
               (job_id,mission_id,kind,params_json,priority,max_attempts,git_commit,
                idempotency_key,created_at_utc,updated_at_utc)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                job_id,
                mission_id,
                kind,
                _json(dict(params)),
                priority,
                max_attempts,
                git_commit,
                idempotency_key,
                now,
                now,
            ),
        )
        con.execute(
            "INSERT INTO job_event(job_id,event_kind,actor,detail_json,occurred_at_utc) "
            "VALUES (?,?,?,?,?)",
            (job_id, "enqueued", actor, "{}", now),
        )
        con.execute("COMMIT")
        return True
    except Exception:
        con.execute("ROLLBACK")
        raise


def claim_next_job(
    con: sqlite3.Connection,
    worker_id: str,
    *,
    now: Optional[str] = None,
    lease_seconds: int = 300,
) -> Optional[sqlite3.Row]:
    """Atomically claim the next eligible job; safe across multiple worker processes."""
    now = now or utc_now()
    lease_expires = _utc_after(now, lease_seconds)
    con.execute("BEGIN IMMEDIATE")
    try:
        row = con.execute(
            """SELECT * FROM job_queue
               WHERE status = 'queued' AND attempt_count < max_attempts
                 AND (not_before_utc IS NULL OR julianday(not_before_utc) <= julianday(?))
               ORDER BY priority, created_at_utc, job_id LIMIT 1""",
            (now,),
        ).fetchone()
        if row is None:
            con.execute("COMMIT")
            return None
        changed = con.execute(
            """UPDATE job_queue SET status='running', attempt_count=attempt_count+1,
                 claimed_by=?, claimed_at_utc=?, started_at_utc=COALESCE(started_at_utc,?),
                 lease_expires_at_utc=?, updated_at_utc=?
               WHERE job_id=? AND status='queued'""",
            (worker_id, now, now, lease_expires, now, row["job_id"]),
        ).rowcount
        if changed != 1:
            raise WriterConflict(f"job {row['job_id']} was claimed concurrently")
        con.execute(
            "INSERT INTO job_event(job_id,event_kind,actor,detail_json,occurred_at_utc) "
            "VALUES (?,?,?,?,?)",
            (row["job_id"], "claimed", worker_id, "{}", now),
        )
        claimed = con.execute("SELECT * FROM job_queue WHERE job_id=?", (row["job_id"],)).fetchone()
        con.execute("COMMIT")
        return claimed
    except Exception:
        con.execute("ROLLBACK")
        raise


def claim_job(
    con: sqlite3.Connection,
    job_id: str,
    worker_id: str,
    *,
    now: Optional[str] = None,
    lease_seconds: int = 300,
) -> sqlite3.Row:
    """Atomically claim one named queued job.

    Interactive/operator commands create their own acquisition job and must claim that
    exact row. Using :func:`claim_next_job` here is unsafe when a backlog exists: an older
    or higher-priority row may be claimed while the new acquisition remains queued, and
    the fetch-attempt guard then (correctly) rejects the unleased job.
    """
    now = now or utc_now()
    lease_expires = _utc_after(now, lease_seconds)
    con.execute("BEGIN IMMEDIATE")
    try:
        row = con.execute(
            """SELECT * FROM job_queue
               WHERE job_id=? AND status='queued' AND attempt_count < max_attempts
                 AND (not_before_utc IS NULL OR julianday(not_before_utc) <= julianday(?))""",
            (job_id, now),
        ).fetchone()
        if row is None:
            raise WriterConflict(f"job {job_id} is not eligible to be claimed")
        changed = con.execute(
            """UPDATE job_queue SET status='running', attempt_count=attempt_count+1,
                 claimed_by=?, claimed_at_utc=?, started_at_utc=COALESCE(started_at_utc,?),
                 lease_expires_at_utc=?, updated_at_utc=?
               WHERE job_id=? AND status='queued'""",
            (worker_id, now, now, lease_expires, now, job_id),
        ).rowcount
        if changed != 1:
            raise WriterConflict(f"job {job_id} was claimed concurrently")
        con.execute(
            "INSERT INTO job_event(job_id,event_kind,actor,detail_json,occurred_at_utc) "
            "VALUES (?,?,?,?,?)",
            (job_id, "claimed", worker_id, "{}", now),
        )
        claimed = con.execute("SELECT * FROM job_queue WHERE job_id=?", (job_id,)).fetchone()
        con.execute("COMMIT")
        return claimed
    except Exception:
        con.execute("ROLLBACK")
        raise


def heartbeat_job(
    con: sqlite3.Connection,
    job_id: str,
    worker_id: str,
    *,
    now: Optional[str] = None,
    lease_seconds: int = 300,
) -> None:
    """Extend a live lease. Expired or foreign leases cannot be resurrected."""
    now = now or utc_now()
    lease_expires = _utc_after(now, lease_seconds)
    con.execute("BEGIN IMMEDIATE")
    try:
        changed = con.execute(
            """UPDATE job_queue SET lease_expires_at_utc=
                 CASE WHEN julianday(lease_expires_at_utc)>julianday(?)
                   THEN lease_expires_at_utc ELSE ? END,updated_at_utc=?
               WHERE job_id=? AND status='running' AND claimed_by=?
                 AND julianday(lease_expires_at_utc)>julianday(?)""",
            (lease_expires, lease_expires, now, job_id, worker_id, now),
        ).rowcount
        if changed != 1:
            raise WriterConflict(f"job {job_id} has no live lease owned by {worker_id}")
        con.execute(
            "INSERT INTO job_event(job_id,event_kind,actor,detail_json,occurred_at_utc) "
            "VALUES (?,?,?,?,?)",
            (job_id, "heartbeat", worker_id, "{}", now),
        )
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise


def recover_expired_jobs(
    con: sqlite3.Connection, *, now: Optional[str] = None, actor: str = "lease-reaper"
) -> tuple[int, int]:
    """Requeue retryable expired leases and fail jobs whose attempt budget is exhausted."""
    now = now or utc_now()
    requeued = failed = 0
    con.execute("BEGIN IMMEDIATE")
    try:
        rows = con.execute(
            """SELECT job_id,attempt_count,max_attempts FROM job_queue
               WHERE status='running' AND julianday(lease_expires_at_utc)<=julianday(?)
               ORDER BY job_id""",
            (now,),
        ).fetchall()
        for row in rows:
            if row["attempt_count"] < row["max_attempts"]:
                status, event, finished_at, detail = "queued", "retry_scheduled", None, {
                    "reason": "worker_lease_expired",
                    "attempt_count": row["attempt_count"],
                }
                requeued += 1
            else:
                status, event, finished_at, detail = "failed", "failed", now, {
                    "reason": "worker_lease_expired_attempts_exhausted",
                    "attempt_count": row["attempt_count"],
                }
                failed += 1
            con.execute(
                """UPDATE job_queue SET status=?,claimed_by=NULL,claimed_at_utc=NULL,
                     lease_expires_at_utc=NULL,finished_at_utc=?,outcome_detail_json=?,
                     updated_at_utc=? WHERE job_id=? AND status='running'""",
                (status, finished_at, _json(detail), now, row["job_id"]),
            )
            con.execute(
                "INSERT INTO job_event(job_id,event_kind,actor,detail_json,occurred_at_utc) "
                "VALUES (?,?,?,?,?)",
                (row["job_id"], event, actor, _json(detail), now),
            )
        con.execute("COMMIT")
        return requeued, failed
    except Exception:
        con.execute("ROLLBACK")
        raise


def finish_job(
    con: sqlite3.Connection,
    job_id: str,
    *,
    succeeded: bool,
    actor: str,
    detail: Mapping[str, Any],
) -> None:
    now = utc_now()
    status, event = ("succeeded", "succeeded") if succeeded else ("failed", "failed")
    con.execute("BEGIN IMMEDIATE")
    try:
        changed = con.execute(
            """UPDATE job_queue SET status=?, claimed_by=NULL, claimed_at_utc=NULL,
                 lease_expires_at_utc=NULL,
                 finished_at_utc=?, outcome_detail_json=?, updated_at_utc=?
               WHERE job_id=? AND status='running' AND claimed_by=?
                 AND julianday(lease_expires_at_utc)>julianday(?)""",
            (status, now, _json(dict(detail)), now, job_id, actor, now),
        ).rowcount
        if changed != 1:
            raise WriterConflict(f"job {job_id} is not running")
        con.execute(
            "INSERT INTO job_event(job_id,event_kind,actor,detail_json,occurred_at_utc) "
            "VALUES (?,?,?,?,?)",
            (job_id, event, actor, _json(dict(detail)), now),
        )
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise


def register_artifact(
    con: sqlite3.Connection,
    *,
    sha256: str,
    byte_len: int,
    storage_path: str,
    content_type: Optional[str],
    first_seen_at_utc: Optional[str] = None,
) -> None:
    """Register content-addressed metadata idempotently.

    The row is immutable, so a second registration of the same digest must agree on every
    stored field. Disagreement is surfaced rather than silently keeping the first write.
    """
    first_seen_at_utc = first_seen_at_utc or utc_now()
    con.execute(
        """INSERT OR IGNORE INTO artifact
           (sha256,byte_len,content_type,storage_path,first_seen_at_utc)
           VALUES (?,?,?,?,?)""",
        (sha256, byte_len, content_type, storage_path, first_seen_at_utc),
    )
    row = con.execute(
        "SELECT byte_len,storage_path,content_type FROM artifact WHERE sha256=?", (sha256,)
    ).fetchone()
    if (
        row is None
        or row["byte_len"] != byte_len
        or row["storage_path"] != storage_path
        or row["content_type"] != content_type
    ):
        raise WriterConflict(f"artifact metadata conflicts for {sha256}")


def finalize_fetch_attempt(
    con: sqlite3.Connection, attempt_id: str, *, finalized_at_utc: Optional[str] = None
) -> None:
    """Finalize only after the schema confirms required artifact roles are linked."""
    finalized_at_utc = finalized_at_utc or utc_now()
    changed = con.execute(
        """UPDATE fetch_attempt SET is_finalized=1, finalized_at_utc=?
           WHERE attempt_id=? AND is_finalized=0""",
        (finalized_at_utc, attempt_id),
    ).rowcount
    if changed != 1:
        raise WriterConflict(f"fetch attempt {attempt_id} is missing or already finalized")


def finalize_parse_run(
    con: sqlite3.Connection,
    parse_run_id: str,
    *,
    status: str = "parsed",
    finished_at_utc: Optional[str] = None,
) -> int:
    """Seal a parse after validating its exact input set and record evidence."""
    if status not in ("parsed", "quarantined_schema_drift", "failed"):
        raise ValueError(f"invalid final parse status: {status!r}")
    finished_at_utc = finished_at_utc or utc_now()
    con.execute("BEGIN IMMEDIATE")
    try:
        row = con.execute("SELECT * FROM parse_run WHERE parse_run_id=?", (parse_run_id,)).fetchone()
        if row is None or row["status"] != "running":
            raise WriterConflict(f"parse run {parse_run_id} is missing or not running")
        artifacts = [
            (item["role"], item["artifact_sha256"])
            for item in con.execute(
                """SELECT role,artifact_sha256 FROM parse_run_artifact
                   WHERE parse_run_id=? ORDER BY role,artifact_sha256""",
                (parse_run_id,),
            )
        ]
        actual_hash = artifact_set_hash(artifacts)
        if actual_hash != row["artifact_set_hash"]:
            raise WriterConflict(
                f"parse run {parse_run_id} artifact set hash differs: "
                f"stored={row['artifact_set_hash']} actual={actual_hash}"
            )
        record_count = con.execute(
            "SELECT count(*) FROM source_record WHERE parse_run_id=?", (parse_run_id,)
        ).fetchone()[0]
        if status == "parsed":
            records_without_evidence = con.execute(
                """SELECT count(*) FROM source_record sr
                   WHERE sr.parse_run_id=? AND NOT EXISTS (
                     SELECT 1 FROM field_observation fo
                      WHERE fo.source_record_id=sr.source_record_id)""",
                (parse_run_id,),
            ).fetchone()[0]
            if records_without_evidence:
                raise WriterConflict(
                    f"parse run {parse_run_id} has {records_without_evidence} record(s) without field evidence"
                )
        con.execute(
            "UPDATE parse_run SET status=?,finished_at_utc=? WHERE parse_run_id=?",
            (status, finished_at_utc, parse_run_id),
        )
        con.execute("COMMIT")
        return record_count
    except Exception:
        con.execute("ROLLBACK")
        raise


def fail_route_run(
    con: sqlite3.Connection,
    run_id: str,
    *,
    reason: str,
    status: str = "failed",
    finished_at_utc: Optional[str] = None,
) -> None:
    """Close a run that produced nothing publishable, without inventing a terminal state.

    A quarantined parse is not a verdict about the route's data — it is the absence of one.
    ``finalize_route_run`` rightly refuses such a run, so without this path the route_run
    would stay 'running' forever and the route would silently stop being re-runnable. The
    schema keeps the distinction honest: only a 'completed' run may carry a terminal_state,
    and only a completed run may be published to route_current_run.
    """
    if status not in ("failed", "aborted"):
        raise ValueError(f"invalid non-terminal run status: {status!r}")
    finished_at_utc = finished_at_utc or utc_now()
    con.execute("BEGIN IMMEDIATE")
    try:
        changed = con.execute(
            """UPDATE route_run SET run_status=?, finished_at_utc=?, terminal_reason=?
               WHERE run_id=? AND run_status='running'""",
            (status, finished_at_utc, reason[:500], run_id),
        ).rowcount
        if changed != 1:
            raise WriterConflict(f"route run {run_id} is not running")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise


def finalize_route_run(
    con: sqlite3.Connection, run_id: str, *, finished_at_utc: Optional[str] = None
) -> tuple[str, str]:
    """Compute, persist and atomically publish the current route outcome."""
    finished_at_utc = finished_at_utc or utc_now()
    con.execute("BEGIN IMMEDIATE")
    try:
        row = con.execute("SELECT * FROM route_run WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise WriterConflict(f"route run {run_id} does not exist")
        if row["run_status"] != "running":
            raise WriterConflict(f"route run {run_id} is not running")
        live_job = con.execute(
            """SELECT 1 FROM job_queue WHERE job_id=? AND status='running'
                 AND julianday(lease_expires_at_utc)>=julianday(?)""",
            (row["job_id"], finished_at_utc),
        ).fetchone()
        if live_job is None:
            raise WriterConflict(f"route run {run_id} has no live job lease at finalization")
        if row["access_status"] == "ok":
            parse = con.execute(
                "SELECT parse_run_id,status FROM parse_run WHERE route_run_id=?", (run_id,)
            ).fetchone()
            if parse is None or parse["status"] != "parsed":
                raise WriterConflict(f"route run {run_id} requires a finalized successful parse")
            if con.execute(
                "SELECT count(*) FROM route_run_fetch WHERE run_id=?", (run_id,)
            ).fetchone()[0] == 0:
                raise WriterConflict(f"route run {run_id} has no finalized fetch inputs")
            actual_extracted_count = con.execute(
                "SELECT count(*) FROM source_record WHERE parse_run_id=?", (parse["parse_run_id"],)
            ).fetchone()[0]
            if row["extracted_count"] is not None and row["extracted_count"] != actual_extracted_count:
                raise WriterConflict(
                    f"route run {run_id} extracted_count={row['extracted_count']} "
                    f"but parse contains {actual_extracted_count} source record(s)"
                )
            derived_extracted_count = actual_extracted_count
            fetch_freshness = con.execute(
                """SELECT r.refetch_days,max(fa.requested_at_utc) AS latest_fetch
                   FROM route r JOIN route_run rr ON rr.route_id=r.route_id
                   JOIN route_run_fetch rrf ON rrf.run_id=rr.run_id
                   JOIN fetch_attempt fa ON fa.attempt_id=rrf.attempt_id
                   WHERE rr.run_id=? GROUP BY r.refetch_days""",
                (run_id,),
            ).fetchone()
            if fetch_freshness is None or fetch_freshness["refetch_days"] is None:
                derived_freshness_state = "unknown"
            else:
                age_days = (_parse_utc(finished_at_utc) - _parse_utc(
                    fetch_freshness["latest_fetch"]
                )).total_seconds() / 86400
                derived_freshness_state = (
                    "fresh" if 0 <= age_days <= 2 * fetch_freshness["refetch_days"] else "stale"
                )
        else:
            derived_extracted_count = row["extracted_count"]
            derived_freshness_state = row["freshness_state"]
        fixture_count = 0
        if row["adapter_id"] is not None:
            fixture_count = con.execute(
                """SELECT count(*) FROM adapter_fixture
                   WHERE adapter_id=? AND adapter_version=? AND passing=1""",
                (row["adapter_id"], row["adapter_version"]),
            ).fetchone()[0]
        blocking_escalations = con.execute(
            """SELECT count(*) FROM escalation
               WHERE status IN ('open','in_progress') AND (run_id=? OR route_id=?)""",
            (run_id, row["route_id"]),
        ).fetchone()[0]
        field_blocks = con.execute(
            """SELECT count(*) FROM field_health fh JOIN parse_run pr
                 ON pr.parse_run_id=fh.parse_run_id
               WHERE pr.route_run_id=? AND fh.alert_state='block'""",
            (run_id,),
        ).fetchone()[0]
        audit = con.execute("SELECT * FROM audit_sample WHERE run_id=?", (run_id,)).fetchone()
        audit_strategy = audit["strategy"] if audit else "none"
        audit_sampled_count = audit["n_sampled"] if audit else 0
        audit_error_count = audit["n_errors"] if audit else 0
        accuracy_lower_cp = audit["accuracy_lower_cp"] if audit else None
        corroboration = con.execute(
            """SELECT corroboration_kind FROM run_corroboration WHERE run_id=?
               ORDER BY CASE corroboration_kind WHEN 'independent_source' THEN 1
                 WHEN 'human_verified' THEN 2 ELSE 3 END LIMIT 1""",
            (run_id,),
        ).fetchone()
        corroboration_state = corroboration[0] if corroboration else "none"
        empty_evidence = con.execute(
            "SELECT 1 FROM empty_verification_evidence WHERE run_id=?", (run_id,)
        ).fetchone()
        # The prior run must be an OBSERVATION of emptiness, not merely a run that recorded
        # zero. A blocked, stale or parser-sick run never saw the route, and absence of
        # access is not evidence of absence of rows. access_status='ok' is what forces the
        # earlier finalization through the parse/fetch checks above.
        prior_empty = con.execute(
            """SELECT 1 FROM route_run WHERE route_id=? AND run_id<>?
                 AND run_status='completed' AND access_status='ok'
                 AND freshness_state='fresh' AND field_health_blocked=0
                 AND passing_fixture_count>=1
                 AND extracted_count=0 AND structural_count=0
                 AND container_resolved=1
                 AND (published_count IS NULL OR published_count=0)
                 AND julianday(?) - julianday(finished_at_utc) >= 1.0 LIMIT 1""",
            (row["route_id"], run_id, row["started_at_utc"]),
        ).fetchone()
        empty_corroborated = int(empty_evidence is not None and prior_empty is not None)
        oracle = con.execute(
            "SELECT json_array_length(provider_names_json) FROM oracle_check WHERE run_id=?",
            (run_id,),
        ).fetchone()
        llm_oracle_veto = int(oracle is not None and oracle[0] > 0)
        derived = dict(row)
        derived["extracted_count"] = derived_extracted_count
        derived["freshness_state"] = derived_freshness_state
        derived["passing_fixture_count"] = fixture_count
        derived["has_blocking_escalation"] = int(blocking_escalations > 0)
        derived["field_health_blocked"] = int(field_blocks > 0)
        derived["audit_strategy"] = audit_strategy
        derived["audit_sampled_count"] = audit_sampled_count
        derived["audit_error_count"] = audit_error_count
        derived["accuracy_lower_cp"] = accuracy_lower_cp
        derived["corroboration_state"] = corroboration_state
        derived["empty_corroborated"] = empty_corroborated
        derived["llm_oracle_veto"] = llm_oracle_veto
        decision = calculate_terminal_state(TerminalInputs.from_mapping(derived))
        con.execute(
            """UPDATE route_run SET run_status='completed', finished_at_utc=?,
                 terminal_state=?, terminal_reason=?, terminal_calculator_version=?,
                 extracted_count=?, freshness_state=?,
                 passing_fixture_count=?, has_blocking_escalation=?, field_health_blocked=?,
                 audit_strategy=?, audit_sampled_count=?, audit_error_count=?, accuracy_lower_cp=?,
                 corroboration_state=?, empty_corroborated=?, llm_oracle_veto=?
               WHERE run_id=?""",
            (
                finished_at_utc,
                decision.state,
                decision.reason,
                decision.calculator_version,
                derived_extracted_count,
                derived_freshness_state,
                fixture_count,
                int(blocking_escalations > 0),
                int(field_blocks > 0),
                audit_strategy,
                audit_sampled_count,
                audit_error_count,
                accuracy_lower_cp,
                corroboration_state,
                empty_corroborated,
                llm_oracle_veto,
                run_id,
            ),
        )
        con.execute(
            """INSERT INTO route_current_run(route_id,run_id,published_at_utc) VALUES (?,?,?)
               ON CONFLICT(route_id) DO UPDATE SET
                 run_id=excluded.run_id,published_at_utc=excluded.published_at_utc""",
            (row["route_id"], run_id, finished_at_utc),
        )
        con.execute("COMMIT")
        return decision.state, decision.reason
    except Exception:
        con.execute("ROLLBACK")
        raise
