"""End-to-end route execution: fetch → parse → finalize → materialize.

This is the orchestration seam. It owns no rules of its own — every decision belongs to
``fetch_policy``, the schema triggers, the adapter rules, ``terminal_state`` or the
resolver. What it does own is *ordering*, and the order is the point:

    stage fetch → link artifacts → finalize fetch → open parse → write observations
    → seal parse → finalize route run (terminal state computed here) → materialize

Nothing downstream can run before its evidence is sealed upstream, because each step's
guard refuses otherwise. ``run_route`` reads artifacts that already exist; ``fetch_route``
is the only function that touches the network.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Optional, Sequence

from .adapter import Document, ParseOutcome, load_document, merge_outcomes, parse_document
from .artifact_store import ArtifactStore
from .audit import AuditRequest, record_audit_sample
from .materializer import MaterializationReport, materialize_parse_run
from .transport import Transport, record_fetch
from .writer import (
    artifact_set_hash,
    fail_route_run,
    finalize_parse_run,
    finalize_route_run,
    utc_now,
)


class PipelineError(RuntimeError):
    pass


@dataclass
class RouteContext:
    """Everything a run needs that the database cannot infer for itself."""

    route_id: str
    job_id: str
    adapter_id: str
    adapter_version: str
    parser_version: str
    source_policy_review_id: str
    route_policy_review_id: str
    robots_snapshot_sha: Optional[str]
    fetch_tier: int = 1
    crawl_delay_s: float = 5.0


@dataclass
class RunReport:
    run_id: str
    parse_run_id: str
    run_status: str
    terminal_state: Optional[str]
    terminal_reason: str
    extracted_count: int
    structural_count: Optional[int]
    published_count: Optional[int]
    parse_status: str
    drift_detail: list[str] = field(default_factory=list)
    rejects: list[str] = field(default_factory=list)
    audit: Optional[dict] = None
    materialization: Optional[MaterializationReport] = None

    def as_dict(self) -> dict:
        payload = {
            "run_id": self.run_id,
            "parse_run_id": self.parse_run_id,
            "run_status": self.run_status,
            "terminal_state": self.terminal_state,
            "terminal_reason": self.terminal_reason,
            "extracted_count": self.extracted_count,
            "structural_count": self.structural_count,
            "published_count": self.published_count,
            "parse_status": self.parse_status,
            "drift_detail": self.drift_detail,
            "rejects": self.rejects,
            "audit": self.audit,
        }
        if self.materialization is not None:
            payload["materialization"] = self.materialization.as_dict()
        return payload


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# -- acquisition -----------------------------------------------------------------------


def fetch_route(
    con,
    store: ArtifactStore,
    transport: Transport,
    context: RouteContext,
    *,
    url: str,
    etag: Optional[str] = None,
    last_modified: Optional[str] = None,
    fetcher_version: str = "tcpipe-transport/2.2.1",
) -> str:
    """Fetch one URL and record it. Returns the attempt id.

    The schema decides whether this fetch was permitted; the transport only carries bytes.
    """
    result = transport.fetch(url, crawl_delay_s=context.crawl_delay_s, etag=etag,
                             last_modified=last_modified)
    attempt_id = new_id("FA")
    record_fetch(
        con, store, result,
        attempt_id=attempt_id, job_id=context.job_id, route_id=context.route_id,
        fetch_tier=context.fetch_tier, fetcher_version=fetcher_version,
        source_policy_review_id=context.source_policy_review_id,
        route_policy_review_id=context.route_policy_review_id,
        robots_snapshot_sha=context.robots_snapshot_sha,
    )
    return attempt_id


def last_validators(con, route_id: str) -> tuple[Optional[str], Optional[str]]:
    """The etag/last-modified of the most recent successful fetch, for revalidation."""
    row = con.execute(
        """SELECT etag,last_modified FROM fetch_attempt
            WHERE route_id=? AND is_finalized=1 AND outcome IN ('content_200','not_modified_304')
            ORDER BY requested_at_utc DESC LIMIT 1""",
        (route_id,),
    ).fetchone()
    return (row["etag"], row["last_modified"]) if row else (None, None)


# -- parsing over stored artifacts ------------------------------------------------------


def _artifact_bytes(con, store: ArtifactStore, sha: str) -> tuple[bytes, Optional[str]]:
    row = con.execute(
        "SELECT storage_path,content_type FROM artifact WHERE sha256=?", (sha,)
    ).fetchone()
    if row is None:
        raise PipelineError(f"artifact {sha} is not registered")
    stored = store.verify(sha)
    with open(stored.storage_path, "rb") as handle:
        return handle.read(), row["content_type"]


def parse_inputs_for(con, attempt_ids: Sequence[str]) -> list[tuple[str, str]]:
    """The (role, sha) parse inputs implied by a set of finalized fetch attempts."""
    inputs: list[tuple[str, str]] = []
    for attempt_id in attempt_ids:
        for row in con.execute(
            """SELECT role,artifact_sha256 FROM fetch_attempt_artifact
                WHERE attempt_id=? AND role IN
                  ('response_body','download','reused_body','rendered_dom','human_capture')
                ORDER BY role,artifact_sha256""",
            (attempt_id,),
        ):
            inputs.append((row["role"], row["artifact_sha256"]))
    if not inputs:
        raise PipelineError(f"no parseable artifacts on attempts {list(attempt_ids)}")
    return sorted(set(inputs))


def run_route(
    con,
    store: ArtifactStore,
    context: RouteContext,
    rules: dict,
    attempt_ids: Sequence[str],
    *,
    route_kind: Optional[str] = None,
    base_url: Optional[str] = None,
    materialize: bool = True,
    audit: Optional[AuditRequest] = None,
    run_id: Optional[str] = None,
    parse_run_id: Optional[str] = None,
) -> RunReport:
    """Parse already-fetched artifacts into a completed, terminal-stated route run."""
    run_id = run_id or new_id("RUN")
    parse_run_id = parse_run_id or new_id("PARSE")
    started_at = utc_now()

    inputs = parse_inputs_for(con, attempt_ids)
    outcomes: list[ParseOutcome] = []
    documents: list[tuple[str, Document]] = []
    for role, sha in inputs:
        body, content_type = _artifact_bytes(con, store, sha)
        document = load_document(body, content_type=content_type, route_kind=route_kind)
        documents.append((sha, document))

    row_offset = 0
    pages: list[tuple[str, ParseOutcome]] = []
    for sha, document in documents:
        outcome = parse_document(rules, document, base_locator=f"artifact:{sha}",
                                 base_url=base_url, row_offset=row_offset)
        row_offset += len(outcome.records)
        outcomes.append(outcome)
        pages.append((sha, outcome))
    combined = merge_outcomes(outcomes)

    # The independent structural count exists to catch rows the parser drops SILENTLY.
    # Rows the adapter dropped on a declared reject rule, or for a missing required field,
    # are not silent: they are listed in `rejects` with a reason. Subtracting only those
    # keeps the extracted-vs-structural comparison meaningful instead of sending every run
    # with one out-of-scope row to needs_human.
    structural_in_scope = combined.structural_count
    if structural_in_scope is not None:
        structural_in_scope = max(0, structural_in_scope - len(combined.rejects))

    extracted = len(combined.records)
    if combined.published_count is None:
        count_quality, variance_status = "not_published", "not_evaluated"
    elif combined.published_count == extracted:
        count_quality, variance_status = "published", "reconciled"
    else:
        count_quality, variance_status = "published", "unexplained"

    con.execute(
        """INSERT INTO route_run
           (run_id,job_id,route_id,adapter_id,adapter_version,run_status,started_at_utc,
            published_count,count_quality,extracted_count,structural_count,
            container_resolved,variance_status)
           VALUES (?,?,?,?,?, 'running', ?,?,?,?,?,?,?)""",
        (run_id, context.job_id, context.route_id, context.adapter_id,
         context.adapter_version, started_at, combined.published_count,
         count_quality, None, structural_in_scope, int(combined.container_resolved),
         variance_status),
    )
    for attempt_id in attempt_ids:
        con.execute("INSERT OR IGNORE INTO route_run_fetch VALUES (?,?)", (run_id, attempt_id))

    con.execute(
        """INSERT INTO parse_run
           (parse_run_id,route_run_id,adapter_id,adapter_version,artifact_set_hash,
            parser_version,status,started_at_utc)
           VALUES (?,?,?,?,?,?, 'running', ?)""",
        (parse_run_id, run_id, context.adapter_id, context.adapter_version,
         artifact_set_hash(inputs), context.parser_version, started_at),
    )
    for role, sha in inputs:
        con.execute("INSERT OR IGNORE INTO parse_run_artifact VALUES (?,?,?)",
                    (parse_run_id, sha, role))

    _write_observations(con, parse_run_id, pages, started_at)

    parse_status = combined.status
    finalize_parse_run(con, parse_run_id, status=parse_status, finished_at_utc=utc_now())

    if parse_status != "parsed":
        # The template changed under us. Raise it for a human, close the run WITHOUT a
        # terminal state, and publish nothing: a quarantine is the absence of a verdict,
        # not a verdict of absence.
        reason = "; ".join(combined.drift_detail) or "parse did not complete cleanly"
        con.execute(
            """INSERT INTO escalation
               (escalation_id,kind,status,priority,route_id,run_id,question,context_json,
                opened_at_utc)
               VALUES (?,'pick_selector','open',10,?,?,?,?,?)""",
            (new_id("ESC"), context.route_id, run_id,
             "Adapter selectors drifted; confirm the template change and update the adapter.",
             json.dumps({"drift_detail": combined.drift_detail,
                         "rejects": combined.rejects[:20]}, sort_keys=True), utc_now()),
        )
        fail_route_run(con, run_id, reason=reason, finished_at_utc=utc_now())
        return RunReport(
            run_id=run_id, parse_run_id=parse_run_id, run_status="failed",
            terminal_state=None, terminal_reason=reason,
            extracted_count=len(combined.records),
            structural_count=combined.structural_count,
            published_count=combined.published_count, parse_status=parse_status,
            drift_detail=combined.drift_detail, rejects=combined.rejects,
        )

    # Audit evidence must land while the run is still running: the schema refuses it
    # afterwards, so a verdict can never be justified by evidence gathered to fit it.
    audit_summary = None
    if audit is not None:
        audit_summary = record_audit_sample(con, run_id, parse_run_id, audit)

    terminal_state, terminal_reason = finalize_route_run(con, run_id, finished_at_utc=utc_now())

    report = RunReport(
        run_id=run_id, parse_run_id=parse_run_id, run_status="completed",
        terminal_state=terminal_state,
        terminal_reason=terminal_reason, extracted_count=len(combined.records),
        structural_count=combined.structural_count, published_count=combined.published_count,
        parse_status=parse_status, drift_detail=combined.drift_detail,
        rejects=combined.rejects, audit=audit_summary,
    )
    if materialize:
        report.materialization = materialize_parse_run(
            con, parse_run_id, job_id=context.job_id
        )
    return report


def _write_observations(con, parse_run_id: str,
                        pages: Sequence[tuple[str, ParseOutcome]],
                        observed_at: str) -> None:
    """One source_record per parsed row, one field_observation per extracted value.

    Observations are written per page, so each one carries the sha256 of the artifact it
    was actually read from rather than the first artifact of the run.
    """
    seen_keys: dict[str, int] = {}
    for sha, outcome in pages:
        for record in outcome.records:
            key = record.source_record_key
            if key in seen_keys:
                seen_keys[key] += 1
                key = f"{key}#{seen_keys[key]}"
            else:
                seen_keys[key] = 0
            source_record_id = new_id("REC")
            con.execute(
                "INSERT INTO source_record VALUES (?,?,?,?,?,?)",
                (source_record_id, parse_run_id, key, record.row_ordinal,
                 record.record_locator, observed_at),
            )
            for field_name, hits in record.fields.items():
                for ordinal, hit in enumerate(hits):
                    con.execute(
                        """INSERT INTO field_observation
                           (field_observation_id,source_record_id,field_name,value_ordinal,
                            raw_value,normalized_value,artifact_sha256,field_locator,
                            evidence_quote,normalization_state,validation_state,
                            validation_flags_json,observed_at_utc)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (new_id("OBS"), source_record_id, field_name, ordinal, hit.value,
                         hit.normalized, sha, hit.locator, hit.evidence_quote[:2000],
                         hit.normalization_state,
                         "accepted" if hit.normalization_state in
                         ("normalized", "not_requested") else "flagged",
                         json.dumps([hit.normalization_state]
                                    if hit.normalization_state in ("failed", "ambiguous")
                                    else []),
                         observed_at),
                    )
