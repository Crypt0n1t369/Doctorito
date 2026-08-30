"""Operator command line for instructing and overseeing the parsing instrument."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import urllib.parse
import uuid
from pathlib import Path
from typing import Any, Optional, Sequence

from .bootstrap import bootstrap
from .db import open_db
from .resources import adapter_path, self_check, shipped_adapter_ids
from .writer import enqueue_job, utc_now

SCHEMA_VERSION = "2.3.0"

# Deployment configuration. A harness sets these once in the unit/container environment
# instead of threading --db and --artifacts through every invocation; explicit flags still
# win, so an operator can always override what the environment decided.
ENV_DB = "TCPIPE_DB"
ENV_ARTIFACTS = "TCPIPE_ARTIFACTS"
ENV_PROXY = "TCPIPE_PROXY"
ENV_REQUIRE_PROXY = "TCPIPE_REQUIRE_PROXY"
ENV_USER_AGENT = "TCPIPE_USER_AGENT"


def _env_default(name: str, fallback=None):
    value = os.environ.get(name)
    return value if value not in (None, "") else fallback


def _env_flag(name: str) -> bool:
    return _env_default(name, "").strip().lower() in ("1", "true", "yes", "on")


def command_preflight(args: argparse.Namespace) -> int:
    """Check that this deployment can actually run before it is asked to.

    Deployment failures in this system are boring and repetitive: a wheel built without its
    package data, an unwritable artifact volume, an old SQLite, a missing optional extra
    that a pdf route needs. Each one otherwise surfaces halfway through an operator's first
    real command. This turns them into one green check at startup.
    """
    report: dict[str, Any] = {"ok": True, "checks": {}}

    report["checks"]["package_data"] = data_report = self_check()
    report["ok"] &= bool(data_report["ok"])

    report["checks"]["python"] = {"version": sys.version.split()[0], "ok": True}
    sqlite_ok = sqlite3.sqlite_version_info >= (3, 37, 0)
    report["checks"]["sqlite"] = {"version": sqlite3.sqlite_version,
                                  "required": "3.37.0", "ok": sqlite_ok}
    report["ok"] &= sqlite_ok

    dependencies: dict[str, Any] = {}
    for module, required in (("jsonschema", True), ("lxml", True), ("cssselect", True),
                             ("pypdf", False)):
        try:
            __import__(module)
            dependencies[module] = {"present": True, "required": required}
        except ImportError:
            dependencies[module] = {"present": False, "required": required,
                                    "note": "pdf routes cannot run without it"
                                            if not required else "required dependency"}
            if required:
                report["ok"] = False
    report["checks"]["dependencies"] = dependencies

    database = _env_default(ENV_DB, args.db)
    if database:
        path = Path(database).expanduser()
        exists = path.is_file()
        entry: dict[str, Any] = {"path": str(path), "exists": exists}
        if exists:
            try:
                con = open_db(str(path), readonly=True,
                              required_schema_version=SCHEMA_VERSION)
                entry["schema_version"] = SCHEMA_VERSION
                con.close()
                entry["ok"] = True
            except Exception as exc:
                entry.update({"ok": False, "error": str(exc)})
                report["ok"] = False
        else:
            entry["ok"] = True
            entry["note"] = "not created yet; run `tcpipe init`"
        report["checks"]["database"] = entry

    artifacts = _env_default(ENV_ARTIFACTS, args.artifacts)
    if artifacts:
        root = Path(artifacts).expanduser()
        entry = {"path": str(root)}
        try:
            root.mkdir(parents=True, exist_ok=True)
            probe = root / ".tcpipe-write-probe"
            probe.write_bytes(b"ok")
            probe.unlink()
            entry["ok"] = True
            entry["writable"] = True
        except OSError as exc:
            entry.update({"ok": False, "writable": False, "error": str(exc)})
            report["ok"] = False
        report["checks"]["artifact_store"] = entry

    proxy = _env_default(ENV_PROXY)
    proxy_host = urllib.parse.urlsplit(proxy).hostname if proxy else None
    report["checks"]["egress"] = {
        "proxy_configured": bool(proxy),
        "proxy_host": proxy_host,
        "require_proxy": _env_flag(ENV_REQUIRE_PROXY),
        "ok": True,
        "note": "a proxy the worker can decline is not an enforcement boundary; "
                "confine egress at the network layer in production",
    }

    _json_print(report)
    return 0 if report["ok"] else 1



def _id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:20].upper()}"


def _json_print(value: Any) -> None:
    print(json.dumps(value, indent=2, sort_keys=True, default=str))


def _load_json(value: str) -> dict[str, Any]:
    if value.startswith("@"):
        value = Path(value[1:]).read_text(encoding="utf-8")
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("job parameters must be a JSON object")
    return parsed


def _connect(path: str, *, readonly: bool = False) -> sqlite3.Connection:
    return open_db(path, readonly=readonly, required_schema_version=SCHEMA_VERSION)


def command_init(args: argparse.Namespace) -> int:
    """Create an isolated database and artifact directory."""
    report = bootstrap(Path(args.db), artifacts=Path(args.artifacts))
    report["next"] = [
        f"./tcpipe status --db {report['database']}",
        "Run `tcpipe readiness`; public routes can then use automated public preflight.",
    ]
    _json_print(report)
    return 0


def command_migrate(args: argparse.Namespace) -> int:
    """Apply the trusted upgrade and additive project-local migrations."""
    from .migrations import migrate_database

    _json_print(migrate_database(
        args.db, migration_dir=Path(args.migrations) if args.migrations else None,
        actor=args.by,
    ))
    return 0


def command_public_preflight(args: argparse.Namespace) -> int:
    """Fetch and store robots evidence, then decide an ordinary public route."""
    from .artifact_store import ArtifactStore
    from .public_policy import public_preflight
    from .transport import Transport, TransportConfig

    con = _connect(args.db)
    try:
        transport = Transport(TransportConfig(
            user_agent=args.user_agent, proxy_url=args.proxy,
            require_proxy=args.require_proxy, public_only=True,
        ))
        report = public_preflight(con, ArtifactStore(args.artifacts), transport, args.route)
        _json_print(report)
        return 0
    finally:
        con.close()


def command_adapter_activate(args: argparse.Namespace) -> int:
    """Activate an immutable adapter version only after a fixture has passed."""
    con = _connect(args.db)
    try:
        fixture = con.execute(
            """SELECT fixture_id FROM adapter_fixture WHERE adapter_id=?
                 AND adapter_version=? AND passing=1 ORDER BY created_at_utc DESC LIMIT 1""",
            (args.adapter, args.version),
        ).fetchone()
        if fixture is None:
            raise ValueError(
                f"adapter {args.adapter}@{args.version} has no passing immutable fixture"
            )
        con.execute(
            """UPDATE route SET active_adapter_id=?,active_adapter_version=?
                 WHERE route_id=?""", (args.adapter, args.version, args.route),
        )
        if con.execute("SELECT changes()").fetchone()[0] != 1:
            raise ValueError(f"unknown route: {args.route}")
        _json_print({
            "route_id": args.route, "adapter_id": args.adapter,
            "adapter_version": args.version, "fixture_id": fixture["fixture_id"],
            "activated_by": args.by,
        })
        return 0
    finally:
        con.close()


def command_adapter_fixture(args: argparse.Namespace) -> int:
    """Replay one immutable fetch artifact and optionally record the verified projection."""
    from dataclasses import asdict

    from .adapter import load_document, load_rules, parse_document
    from .artifact_store import ArtifactStore

    con = _connect(args.db)
    try:
        row = con.execute(
            """SELECT faa.artifact_sha256,a.content_type,a.storage_path,
                      r.route_id,r.route_kind,r.route_url
                 FROM fetch_attempt fa
                 JOIN route r ON r.route_id=fa.route_id
                 JOIN fetch_attempt_artifact faa ON faa.attempt_id=fa.attempt_id
                 JOIN artifact a ON a.sha256=faa.artifact_sha256
                WHERE fa.attempt_id=? AND fa.is_finalized=1
                  AND faa.role IN ('rendered_dom','response_body','download','reused_body')
                ORDER BY CASE faa.role WHEN 'rendered_dom' THEN 0 ELSE 1 END LIMIT 1""",
            (args.attempt,),
        ).fetchone()
        if row is None:
            raise ValueError(f"attempt {args.attempt} has no immutable parseable artifact")
        if args.route and row["route_id"] != args.route:
            raise ValueError(
                f"attempt {args.attempt} belongs to {row['route_id']}, not {args.route}"
            )
        stored = ArtifactStore(args.artifacts).verify(row["artifact_sha256"])
        body = Path(stored.storage_path).read_bytes()
        rules_path = adapter_path(args.adapter)
        rules = load_rules(rules_path)
        outcome = parse_document(
            rules, load_document(body, content_type=row["content_type"],
                                 route_kind=row["route_kind"]),
            base_locator=f"artifact:{row['artifact_sha256']}", base_url=row["route_url"],
        )
        projection = json.dumps({
            "records": [asdict(record) for record in outcome.records],
            "structural_count": outcome.structural_count,
            "published_count": outcome.published_count,
            "status": outcome.status,
            "drift_detail": outcome.drift_detail,
            "rejects": outcome.rejects,
        }, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        actual = hashlib.sha256(projection).hexdigest()
        report = {
            "route_id": row["route_id"], "attempt_id": args.attempt,
            "artifact_sha256": row["artifact_sha256"], "adapter_id": args.adapter,
            "adapter_version": args.version, "projection_sha256": actual,
            "parse_status": outcome.status, "record_count": len(outcome.records),
            "drift_detail": outcome.drift_detail, "recorded": False,
        }
        if not args.expected_sha256:
            _json_print(report)
            return 0
        if len(args.expected_sha256) != 64 or any(
            char not in "0123456789abcdef" for char in args.expected_sha256
        ):
            raise ValueError("expected sha256 must be 64 lowercase hexadecimal characters")
        passing = actual == args.expected_sha256 and outcome.status == "parsed"
        rules_sha = hashlib.sha256(rules_path.read_bytes()).hexdigest()
        existing = con.execute(
            "SELECT rules_sha256 FROM adapter WHERE adapter_id=? AND version=?",
            (args.adapter, args.version),
        ).fetchone()
        if existing and existing["rules_sha256"] != rules_sha:
            raise ValueError("adapter version is immutable; increment version after rules change")
        if existing is None:
            con.execute(
                """INSERT INTO adapter
                   (adapter_id,version,kind,rules_sha256,authored_by,confirmed_by_human,
                    created_at_utc) VALUES (?,?,'rules',?,'llm_proposal',0,?)""",
                (args.adapter, args.version, rules_sha, utc_now()),
            )
        fixture_id = _id("FIX")
        con.execute(
            """INSERT INTO adapter_fixture
               (fixture_id,adapter_id,adapter_version,artifact_sha256,expected_sha256,
                origin,passing,created_at_utc) VALUES (?,?,?,?,?,'picker_confirm',?,?)""",
            (fixture_id, args.adapter, args.version, row["artifact_sha256"],
             args.expected_sha256, int(passing), utc_now()),
        )
        report.update({"fixture_id": fixture_id, "passing": passing, "recorded": True})
        _json_print(report)
        return 0 if passing else 1
    finally:
        con.close()


def command_status(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        scalar_groups = {}
        for name, sql in {
            "jobs": "SELECT status,count(*) n FROM job_queue GROUP BY status",
            "current_routes": (
                "SELECT COALESCE(terminal_state,'never_run') status,count(*) n "
                "FROM v_route_current_status GROUP BY COALESCE(terminal_state,'never_run')"
            ),
            "escalations": "SELECT status,count(*) n FROM escalation GROUP BY status",
            "reviews": "SELECT status,count(*) n FROM review_queue GROUP BY status",
        }.items():
            scalar_groups[name] = {row["status"]: row["n"] for row in con.execute(sql)}
        correction_rows = con.execute(
            """SELECT COALESCE(md.decision,'pending') status,count(*) n
                 FROM manual_correction mc LEFT JOIN manual_correction_decision md
                   ON md.correction_id=mc.correction_id
                GROUP BY COALESCE(md.decision,'pending')"""
        ).fetchall()
        coverage = [dict(row) for row in con.execute(
            "SELECT * FROM v_universe_coverage ORDER BY universe_id"
        )]
        missions = [dict(row) for row in con.execute(
            """SELECT mission_id,track,title,blocks_production FROM mission
               WHERE active=1 ORDER BY track,priority"""
        )]
        _json_print({
            "schema_version": SCHEMA_VERSION,
            "missions": missions,
            **scalar_groups,
            "manual_corrections": {row["status"]: row["n"] for row in correction_rows},
            "active_correction_rules": con.execute(
                """SELECT count(*) FROM correction_rule cr WHERE NOT EXISTS (
                   SELECT 1 FROM correction_rule child
                    WHERE child.supersedes_rule_id=cr.correction_rule_id)"""
            ).fetchone()[0],
            "coverage": coverage,
            "attention": {
                "expired_running_leases": con.execute(
                    """SELECT count(*) FROM job_queue WHERE status='running'
                       AND julianday(lease_expires_at_utc)<=julianday('now')"""
                ).fetchone()[0],
                "open_blocking_escalations": con.execute(
                    "SELECT count(*) FROM escalation WHERE status IN ('open','in_progress')"
                ).fetchone()[0],
                "pending_manual_corrections": con.execute(
                    """SELECT count(*) FROM manual_correction mc WHERE NOT EXISTS
                       (SELECT 1 FROM manual_correction_decision md
                         WHERE md.correction_id=mc.correction_id)"""
                ).fetchone()[0],
                "pending_rule_reviews": con.execute(
                    """SELECT count(*) FROM review_queue
                       WHERE status='pending' AND review_kind='correction_rule_candidate'"""
                ).fetchone()[0],
            },
        })
        return 0
    finally:
        con.close()


def command_readiness(args: argparse.Namespace) -> int:
    """Report the executable gate state for every route without changing anything."""
    con = _connect(args.db, readonly=True)
    try:
        route_rows = con.execute(
            """SELECT r.route_id,r.source_id,s.legal_name,r.route_kind,r.route_url,
                      r.access_class,r.acquisition_method,
                      r.policy_state,r.robots_state,r.robots_snapshot_sha,r.refetch_days,
                      r.active_adapter_id,r.active_adapter_version,
                      (SELECT spr.source_policy_review_id FROM source_policy_review spr
                        WHERE spr.source_id=r.source_id AND spr.decision='approved'
                          AND (spr.valid_until_utc IS NULL OR
                               julianday(spr.valid_until_utc)>=julianday('now'))
                        ORDER BY spr.reviewed_at_utc DESC LIMIT 1) source_review_id,
                      (SELECT rpr.route_policy_review_id FROM route_policy_review rpr
                        WHERE rpr.route_id=r.route_id AND rpr.decision='approved'
                          AND (rpr.valid_until_utc IS NULL OR
                               julianday(rpr.valid_until_utc)>=julianday('now'))
                        ORDER BY rpr.reviewed_at_utc DESC LIMIT 1) route_review_id,
                      (SELECT count(*) FROM adapter_fixture af
                        WHERE af.adapter_id=r.active_adapter_id
                          AND af.adapter_version=r.active_adapter_version
                          AND af.passing=1) passing_fixtures,
                      (SELECT max(fa.requested_at_utc) FROM fetch_attempt fa
                        WHERE fa.route_id=r.route_id AND fa.is_finalized=1
                          AND fa.outcome IN ('content_200','not_modified_304','human_capture'))
                        last_content_fetch_utc
                 FROM route r JOIN source s ON s.source_id=r.source_id
                ORDER BY r.route_id"""
        ).fetchall()
        routes = []
        for row in route_rows:
            blockers = []
            if not row["source_review_id"]:
                blockers.append("approved_current_source_policy_review")
            if not row["route_review_id"]:
                blockers.append("approved_current_route_policy_review")
            if row["robots_state"] != "allowed" or not row["robots_snapshot_sha"]:
                blockers.append("allowed_pinned_robots_snapshot")
            if not row["active_adapter_id"] or not row["active_adapter_version"]:
                blockers.append("active_versioned_adapter")
            elif row["passing_fixtures"] < 1:
                blockers.append("passing_adapter_fixture")
            due = row["last_content_fetch_utc"] is None or bool(con.execute(
                "SELECT julianday('now') >= julianday(?) + ?",
                (row["last_content_fetch_utc"], row["refetch_days"]),
            ).fetchone()[0])
            host = urllib.parse.urlsplit(row["route_url"]).hostname
            host_state = con.execute(
                "SELECT route_state,reason,suspended_until_utc FROM host_state WHERE host=?",
                (host,),
            ).fetchone()
            if host_state and host_state["route_state"] in ("blocked_access", "needs_human"):
                blockers.append("human_access_review")
            automated_preflight = (
                row["access_class"] == "public"
                and row["acquisition_method"] != "human_capture"
                and "human_access_review" not in blockers
            )
            routes.append({
                **dict(row),
                "due": due,
                "can_fetch": not blockers,
                "automated_public_preflight_available": automated_preflight,
                "approval_path": "automated_public_preflight" if automated_preflight
                                 else "human_review",
                "host_state": dict(host_state) if host_state else None,
                "blockers": blockers,
            })
        queue = {
            row["status"]: row["n"] for row in con.execute(
                "SELECT status,count(*) n FROM job_queue GROUP BY status"
            )
        }
        _json_print({
            "schema_version": SCHEMA_VERSION,
            "ready_route_count": sum(route["can_fetch"] for route in routes),
            "route_count": len(routes),
            "due_fetchable_routes": [
                route["route_id"] for route in routes if route["can_fetch"] and route["due"]
            ],
            "policy_blocked_routes": [
                route["route_id"] for route in routes if not route["can_fetch"]
            ],
            "queue": queue,
            "routes": routes,
            "operator_boundary": {
                "network_command": "fetch",
                "human_attestation_required_for": "audit error counts",
                "human_decision_required_for": [
                    "authenticated/private/sensitive sources", "explicit robots prohibition",
                    "access barriers", "manual-correction decision", "learned-rule promotion"
                ],
            },
        })
        return 0
    finally:
        con.close()


def command_recover(args: argparse.Namespace) -> int:
    """Requeue retryable expired leases and terminalize exhausted ones."""
    from .writer import recover_expired_jobs

    con = _connect(args.db)
    try:
        requeued, failed = recover_expired_jobs(con, actor=args.by)
        _json_print({"requeued": requeued, "failed": failed, "actor": args.by})
        return 0
    finally:
        con.close()


def command_missions(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        _json_print([dict(row) for row in con.execute(
            "SELECT * FROM mission ORDER BY track,priority"
        )])
        return 0
    finally:
        con.close()


def command_enqueue(args: argparse.Namespace) -> int:
    con = _connect(args.db)
    try:
        job_id = args.job_id or _id("JOB")
        params = _load_json(args.params) if args.params else {
            "objective": args.instruction,
            "route_ids": args.route or [],
            "acceptance": args.acceptance or [],
            "execution_mode": args.mode,
        }
        created = enqueue_job(
            con,
            job_id=job_id,
            mission_id=args.mission,
            kind=args.kind,
            params=params,
            git_commit=args.git_commit,
            idempotency_key=args.idempotency_key,
            priority=args.priority,
            max_attempts=args.max_attempts,
            actor=args.by,
        )
        if not created:
            job_id = con.execute(
                "SELECT job_id FROM job_queue WHERE idempotency_key=?",
                (args.idempotency_key,),
            ).fetchone()[0]
        _json_print({"job_id": job_id, "created": created})
        return 0
    finally:
        con.close()


def command_jobs(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        params: tuple[Any, ...] = ()
        where = ""
        if args.status:
            where, params = "WHERE status=?", (args.status,)
        rows = con.execute(
            f"""SELECT job_id,mission_id,kind,status,priority,attempt_count,max_attempts,
                       claimed_by,lease_expires_at_utc,created_at_utc,finished_at_utc,
                       outcome_detail_json
                  FROM job_queue {where}
                 ORDER BY created_at_utc DESC,job_id LIMIT ?""",
            (*params, args.limit),
        )
        _json_print([dict(row) for row in rows])
        return 0
    finally:
        con.close()


def command_routes(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        rows = con.execute(
            """SELECT r.route_id,r.source_id,s.legal_name,r.route_url,r.route_kind,
                      r.acquisition_method,r.volatility_class,r.refetch_days,
                      GROUP_CONCAT(ur.universe_id || ':' || ur.eligibility) universes,
                      vcs.run_id,vcs.terminal_state,vcs.terminal_reason,vcs.finished_at_utc,
                      vcs.extracted_count
                 FROM route r JOIN source s ON s.source_id=r.source_id
                 LEFT JOIN universe_route ur ON ur.route_id=r.route_id
                 LEFT JOIN v_route_current_status vcs ON vcs.route_id=r.route_id
                GROUP BY r.route_id ORDER BY r.route_id LIMIT ?""",
            (args.limit,),
        )
        _json_print([dict(row) for row in rows])
        return 0
    finally:
        con.close()


def command_observations(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        clauses: list[str] = []
        values: list[Any] = []
        if args.route:
            clauses.append("rr.route_id=?")
            values.append(args.route)
        if args.field:
            clauses.append("efo.field_name=?")
            values.append(args.field)
        if args.contains:
            clauses.append(
                "(efo.raw_value LIKE ? OR COALESCE(efo.effective_normalized_value,'') LIKE ?)"
            )
            values.extend((f"%{args.contains}%", f"%{args.contains}%"))
        where = "WHERE " + " AND ".join(clauses) if clauses else ""
        rows = con.execute(
            f"""SELECT efo.field_observation_id,rr.route_id,pr.parse_run_id,
                       sr.source_record_key,efo.field_name,efo.raw_value,
                       efo.parser_normalized_value,efo.effective_normalized_value,
                       efo.effective_value_source,efo.correction_id,efo.field_locator,
                       efo.evidence_quote,efo.artifact_sha256
                  FROM v_effective_field_observation efo
                  JOIN source_record sr ON sr.source_record_id=efo.source_record_id
                  JOIN parse_run pr ON pr.parse_run_id=sr.parse_run_id
                  JOIN route_run rr ON rr.run_id=pr.route_run_id
                  {where}
                 ORDER BY rr.route_id,sr.row_ordinal,efo.field_name,efo.value_ordinal LIMIT ?""",
            (*values, args.limit),
        )
        _json_print([dict(row) for row in rows])
        return 0
    finally:
        con.close()


def command_correction_propose(args: argparse.Namespace) -> int:
    con = _connect(args.db)
    correction_id = args.correction_id or _id("COR")
    try:
        con.execute("BEGIN IMMEDIATE")
        con.execute(
            """INSERT INTO manual_correction
               (correction_id,field_observation_id,action,corrected_normalized_value,
                scope,reason,proposed_by,proposed_at_utc,supersedes_correction_id)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                correction_id,
                args.observation,
                args.action,
                args.value,
                args.scope,
                args.reason,
                args.by,
                utc_now(),
                args.supersedes,
            ),
        )
        con.execute("COMMIT")
        _json_print({
            "correction_id": correction_id,
            "status": "pending",
            "next": f"./tcpipe correction-decide --db {args.db} --correction {correction_id} "
                    "--decision accepted --by REVIEWER --rationale 'verified against source'",
        })
        return 0
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def _correction_context(con: sqlite3.Connection, correction_id: str) -> sqlite3.Row:
    row = con.execute(
        """SELECT mc.*,fo.field_name,fo.raw_value,fo.normalized_value,sr.source_record_key,
                  rr.route_id,rr.adapter_id,rr.adapter_version,r.route_url,a.template_fingerprint
             FROM manual_correction mc
             JOIN field_observation fo ON fo.field_observation_id=mc.field_observation_id
             JOIN source_record sr ON sr.source_record_id=fo.source_record_id
             JOIN parse_run pr ON pr.parse_run_id=sr.parse_run_id
             JOIN route_run rr ON rr.run_id=pr.route_run_id
             JOIN route r ON r.route_id=rr.route_id
             LEFT JOIN adapter a ON a.adapter_id=rr.adapter_id AND a.version=rr.adapter_version
            WHERE mc.correction_id=?""",
        (correction_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"correction not found: {correction_id}")
    return row


def command_correction_decide(args: argparse.Namespace) -> int:
    con = _connect(args.db)
    try:
        con.execute("BEGIN IMMEDIATE")
        correction = _correction_context(con, args.correction)
        review_id: Optional[str] = None
        if args.decision == "accepted" and correction["scope"] != "one_record":
            review_id = args.review_id or _id("REV")
            payload = {
                "correction_id": correction["correction_id"],
                "route_id": correction["route_id"],
                "route_url": correction["route_url"],
                "adapter_id": correction["adapter_id"],
                "adapter_version": correction["adapter_version"],
                "template_fingerprint": correction["template_fingerprint"],
                "field_name": correction["field_name"],
                "action": correction["action"],
                "corrected_normalized_value": correction["corrected_normalized_value"],
                "reason": correction["reason"],
                "required_before_promotion": [
                    "encode scoped adapter/rule change",
                    "add or update golden fixture",
                    "replay unchanged artifact set",
                    "compare canonical projection and row count",
                ],
            }
            con.execute(
                """INSERT INTO review_queue
                   (review_id,review_kind,payload_json,proposed_by,status)
                   VALUES (?,?,?,?,?)""",
                (review_id, "correction_rule_candidate", json.dumps(payload, sort_keys=True),
                 "operator_feedback", "pending"),
            )
        con.execute(
            """INSERT INTO manual_correction_decision
               (correction_id,decision,decided_by,rationale,rule_candidate_review_id,decided_at_utc)
               VALUES (?,?,?,?,?,?)""",
            (args.correction, args.decision, args.by, args.rationale, review_id, utc_now()),
        )
        con.execute("COMMIT")
        _json_print({
            "correction_id": args.correction,
            "decision": args.decision,
            "effective_immediately": args.decision == "accepted",
            "rule_candidate_review_id": review_id,
            "safety": (
                "The source observation remains unchanged. Broader reuse is pending fixture replay."
                if review_id else "The correction is scoped to one record."
            ),
        })
        return 0
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def command_corrections(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        rows = con.execute(
            """SELECT mc.*,md.decision,md.decided_by,md.rationale,
                      md.rule_candidate_review_id,md.decided_at_utc,
                      CASE WHEN md.decision='accepted' AND NOT EXISTS (
                        SELECT 1 FROM manual_correction child
                        JOIN manual_correction_decision child_decision
                          ON child_decision.correction_id=child.correction_id
                         WHERE child.supersedes_correction_id=mc.correction_id
                           AND child_decision.decision='accepted') THEN 1 ELSE 0 END effective
                 FROM manual_correction mc LEFT JOIN manual_correction_decision md
                   ON md.correction_id=mc.correction_id
                ORDER BY mc.proposed_at_utc DESC,mc.correction_id LIMIT ?""",
            (args.limit,),
        )
        _json_print([dict(row) for row in rows])
        return 0
    finally:
        con.close()


def command_reviews(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        rows = con.execute(
            """SELECT review_id,review_kind,payload_json,proposed_by,confidence,status,
                      decided_by,decision_rationale,decided_at_utc
                 FROM review_queue WHERE (? IS NULL OR status=?)
                ORDER BY status,review_id LIMIT ?""",
            (args.status, args.status, args.limit),
        )
        _json_print([dict(row) for row in rows])
        return 0
    finally:
        con.close()


def _rule_review_context(con: sqlite3.Connection, review_id: str) -> tuple[sqlite3.Row, sqlite3.Row]:
    review = con.execute(
        """SELECT rq.*,md.correction_id FROM review_queue rq
           JOIN manual_correction_decision md ON md.rule_candidate_review_id=rq.review_id
          WHERE rq.review_id=? AND rq.review_kind='correction_rule_candidate'""",
        (review_id,),
    ).fetchone()
    if review is None:
        raise ValueError(f"correction rule review not found: {review_id}")
    if review["status"] != "pending":
        raise ValueError(f"review {review_id} is already {review['status']}")
    return review, _correction_context(con, review["correction_id"])


def command_review_decide(args: argparse.Namespace) -> int:
    con = _connect(args.db)
    try:
        con.execute("BEGIN IMMEDIATE")
        review, correction = _rule_review_context(con, args.review)
        now = utc_now()
        con.execute(
            """UPDATE review_queue SET status=?,decided_by=?,decision_rationale=?,decided_at_utc=?
               WHERE review_id=? AND status='pending'""",
            (args.decision, args.by, args.rationale, now, args.review),
        )
        rule_id: Optional[str] = None
        if args.decision == "accepted":
            required = {
                "projection_hash_before": args.before_hash,
                "projection_hash_after": args.after_hash,
                "fixture_count": args.fixture_count,
                "affected_observation_count": args.affected,
                "row_count_delta": args.row_delta,
            }
            missing = [name for name, value in required.items() if value is None]
            if missing:
                raise ValueError(
                    "accepting a learned rule requires replay evidence: " + ", ".join(missing)
                )
            if correction["scope"] == "global_candidate":
                scope_kind, scope_value = "global", ""
            elif correction["template_fingerprint"]:
                scope_kind, scope_value = (
                    "template_fingerprint", correction["template_fingerprint"]
                )
            else:
                scope_kind, scope_value = "route_id", correction["route_id"]
            rule_id = args.rule_id or _id("CRULE")
            con.execute(
                """INSERT INTO correction_rule
                   (correction_rule_id,review_id,origin_correction_id,field_name,
                    match_raw_value,action,replacement_normalized_value,scope_kind,scope_value,
                    fixture_count,projection_hash_before,projection_hash_after,
                    affected_observation_count,row_count_delta,row_drop_justification,
                    replayed_by,replayed_at_utc,supersedes_rule_id)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    rule_id, review["review_id"], correction["correction_id"],
                    correction["field_name"], correction["raw_value"], correction["action"],
                    correction["corrected_normalized_value"], scope_kind, scope_value,
                    args.fixture_count, args.before_hash, args.after_hash, args.affected,
                    args.row_delta, args.row_drop_justification, args.by, now, args.supersedes_rule,
                ),
            )
        con.execute("COMMIT")
        _json_print({
            "review_id": args.review,
            "decision": args.decision,
            "correction_rule_id": rule_id,
            "effect": (
                "Future exact raw-value matches in this scope now receive the governed rule."
                if rule_id else "No reusable rule was created."
            ),
        })
        return 0
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def _verify_artifact(path: Path, expected_hash: str, expected_length: int) -> Optional[str]:
    if not path.is_file():
        return "missing"
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    if size != expected_length:
        return f"length mismatch: expected {expected_length}, got {size}"
    actual = digest.hexdigest()
    return None if actual == expected_hash else f"hash mismatch: got {actual}"


def command_doctor(args: argparse.Namespace) -> int:
    con = _connect(args.db, readonly=True)
    try:
        fk = [tuple(row) for row in con.execute("PRAGMA foreign_key_check")]
        quick = con.execute("PRAGMA quick_check").fetchone()[0]
        artifact_issues = []
        sql = "SELECT sha256,byte_len,storage_path FROM artifact ORDER BY first_seen_at_utc"
        if args.artifact_limit > 0:
            sql += f" LIMIT {int(args.artifact_limit)}"
        artifacts = con.execute(sql).fetchall()
        for row in artifacts:
            issue = _verify_artifact(Path(row["storage_path"]), row["sha256"], row["byte_len"])
            if issue:
                artifact_issues.append({"sha256": row["sha256"], "issue": issue})
        result = {
            "ok": quick == "ok" and not fk and not artifact_issues,
            "sqlite_quick_check": quick,
            "foreign_key_violations": fk,
            "artifacts_checked": len(artifacts),
            "artifact_issues": artifact_issues,
        }
        _json_print(result)
        return 0 if result["ok"] else 1
    finally:
        con.close()


def _job_for_attempts(con, attempt_ids: Sequence[str]) -> str:
    """The single job that owns every named fetch attempt."""
    rows = con.execute(
        "SELECT DISTINCT job_id FROM fetch_attempt WHERE attempt_id IN "
        f"({','.join('?' * len(attempt_ids))})",
        tuple(attempt_ids),
    ).fetchall()
    if not rows:
        raise ValueError(f"no such fetch attempt(s): {list(attempt_ids)}")
    if len(rows) > 1:
        raise ValueError(
            "attempts belong to different jobs; a route run must parse the artifacts of "
            "one acquisition job so its evidence stays a single unit of work"
        )
    job_id = rows[0]["job_id"]
    live = con.execute(
        """SELECT 1 FROM job_queue WHERE job_id=? AND status='running'
             AND julianday(lease_expires_at_utc) > julianday(?)""",
        (job_id, utc_now()),
    ).fetchone()
    if live is None:
        raise ValueError(
            f"job {job_id} is no longer running with a live lease. Re-fetch the route to "
            "open a new acquisition job; stored artifacts will be reused, not re-downloaded."
        )
    return job_id


def _job_owner(con, job_id: str) -> str:
    row = con.execute("SELECT claimed_by FROM job_queue WHERE job_id=?", (job_id,)).fetchone()
    return row["claimed_by"] if row and row["claimed_by"] else "operator-cli"


def _route_context(
    con, route_id: str, job_id: str, adapter_id: str, adapter_version: str,
    *, require_adapter: bool = True,
):
    """Assemble the run context from the route's own approved policy state."""
    from .pipeline import RouteContext

    row = con.execute(
        """SELECT r.route_url, r.route_kind, r.access_class, r.crawl_delay_s,
                  r.robots_snapshot_sha,
                  r.active_adapter_id, r.active_adapter_version,
                  (SELECT spr.source_policy_review_id FROM source_policy_review spr
                    WHERE spr.source_id=r.source_id AND spr.decision='approved'
                      AND (spr.valid_until_utc IS NULL OR
                           julianday(spr.valid_until_utc)>=julianday('now'))
                    ORDER BY spr.reviewed_at_utc DESC LIMIT 1) AS spr_id,
                  (SELECT rpr.route_policy_review_id FROM route_policy_review rpr
                    WHERE rpr.route_id=r.route_id AND rpr.decision='approved'
                      AND (rpr.valid_until_utc IS NULL OR
                           julianday(rpr.valid_until_utc)>=julianday('now'))
                    ORDER BY rpr.reviewed_at_utc DESC LIMIT 1) AS rpr_id
             FROM route r WHERE r.route_id=?""",
        (route_id,),
    ).fetchone()
    if row is None:
        raise ValueError(f"unknown route: {route_id}")
    if not row["spr_id"] or not row["rpr_id"]:
        raise ValueError(
            f"route {route_id} has no approved source/route policy review. "
            "Run automated public preflight for a public route, or obtain human review."
        )
    adapter_id = adapter_id or row["active_adapter_id"]
    adapter_version = adapter_version or row["active_adapter_version"]
    if not adapter_id and require_adapter:
        raise ValueError(
            f"route {route_id} has no active adapter. Register one with a passing fixture first."
        )
    adapter_id = adapter_id or "pending__fixture"
    adapter_version = adapter_version or "0"
    tier = {"js_app": 2}.get(row["route_kind"], 1)
    context = RouteContext(
        route_id=route_id, job_id=job_id, adapter_id=adapter_id,
        adapter_version=adapter_version, parser_version="tcpipe-adapter/2.3.0",
        source_policy_review_id=row["spr_id"], route_policy_review_id=row["rpr_id"],
        robots_snapshot_sha=row["robots_snapshot_sha"], fetch_tier=tier,
        crawl_delay_s=float(row["crawl_delay_s"] or 5),
    )
    return context, row


def command_fetch(args: argparse.Namespace) -> int:
    """Acquire artifacts for a route. This is the only command that touches the network."""
    from .artifact_store import ArtifactStore
    from .pipeline import fetch_route, last_validators
    from .public_policy import public_preflight
    from .transport import Transport, TransportConfig, assert_host_fetchable
    from .writer import claim_job, finish_job

    con = _connect(args.db)
    job_id = _id("J")
    claimed = False
    try:
        store = ArtifactStore(args.artifacts)
        transport = Transport(TransportConfig(
            user_agent=args.user_agent, proxy_url=args.proxy,
            require_proxy=args.require_proxy, public_only=args.public_only,
        ))
        if args.auto_public_preflight:
            current = con.execute(
                """SELECT 1 FROM route r WHERE r.route_id=? AND r.robots_state='allowed'
                     AND r.robots_snapshot_sha IS NOT NULL
                     AND EXISTS (SELECT 1 FROM source_policy_review spr
                       WHERE spr.source_id=r.source_id AND spr.decision='approved'
                         AND (spr.valid_until_utc IS NULL OR
                              julianday(spr.valid_until_utc)>=julianday('now')))
                     AND EXISTS (SELECT 1 FROM route_policy_review rpr
                       WHERE rpr.route_id=r.route_id AND rpr.decision='approved'
                         AND (rpr.valid_until_utc IS NULL OR
                              julianday(rpr.valid_until_utc)>=julianday('now')))""",
                (args.route,),
            ).fetchone()
            if current is None:
                public_preflight(con, store, transport, args.route)
        # Check the route before creating durable work. A policy-gated route should produce
        # a clear refusal, not a job that sits running until its lease expires.
        context, row = _route_context(
            con, args.route, job_id, args.adapter, args.adapter_version,
            require_adapter=False,
        )
        enqueue_job(con, job_id=job_id, mission_id=args.mission, kind="fetch",
                    params={"route_id": args.route}, git_commit=args.git_commit,
                    idempotency_key=f"fetch:{args.route}:{utc_now()}")
        claim_job(con, job_id, args.worker, lease_seconds=args.lease_seconds)
        claimed = True
        etag, last_modified = (
            (None, None) if args.no_conditional else last_validators(con, args.route)
        )
        urls = args.url or [row["route_url"]]
        attempts = []
        for url in urls:
            assert_host_fetchable(con, url)
            attempts.append(fetch_route(con, store, transport, context, url=url,
                                        etag=etag, last_modified=last_modified))
        _json_print({"job_id": job_id, "route_id": args.route, "attempts": attempts,
                     "next": f"./tcpipe run --db {args.db} --route {args.route} "
                             f"--attempt {' --attempt '.join(attempts)}"})
        return 0
    except Exception as exc:
        if claimed:
            finish_job(con, job_id, succeeded=False, actor=args.worker,
                       detail={"phase": "fetch", "error": str(exc)})
        raise
    finally:
        con.close()


def command_run(args: argparse.Namespace) -> int:
    """Parse stored artifacts into a governed, terminal-stated run. No network access."""
    from .adapter import load_rules
    from .artifact_store import ArtifactStore
    from .audit import AuditRequest
    from .pipeline import run_route
    from .writer import finish_job, heartbeat_job

    con = _connect(args.db)
    job_id: Optional[str] = None
    # A route run and the fetches that fed it are one unit of work: route_run_fetch_insert_guard
    # requires them to share a job. So `run` adopts the job that acquired the artifacts
    # rather than opening a new one.
    owner: Optional[str] = None
    try:
        job_id = _job_for_attempts(con, args.attempt)
        owner = _job_owner(con, job_id)
        heartbeat_job(con, job_id, owner, lease_seconds=args.lease_seconds)
        context, row = _route_context(
            con, args.route, job_id, args.adapter, args.adapter_version
        )
        rules = load_rules(args.rules or adapter_path(context.adapter_id))

        audit = None
        if args.audit_errors is not None:
            # The operator states how many sampled records were wrong. Supplying 0 without
            # checking is falsifying evidence; the number is recorded against their name.
            errors = args.audit_errors
            audit = AuditRequest(checker=lambda ids: errors, audited_by=args.audited_by,
                                 sample_size=args.audit_sample)

        report = run_route(
            con, ArtifactStore(args.artifacts), context, rules, args.attempt,
            route_kind=row["route_kind"], base_url=row["route_url"],
            materialize=not args.no_materialize, audit=audit,
        )
        finish_job(con, job_id, succeeded=report.run_status == "completed",
                   actor=owner, detail=report.as_dict())
        _json_print(report.as_dict())
        return 0 if report.run_status == "completed" else 1
    except Exception as exc:
        if job_id and owner:
            live = con.execute(
                "SELECT 1 FROM job_queue WHERE job_id=? AND status='running' AND claimed_by=?",
                (job_id, owner),
            ).fetchone()
            if live:
                finish_job(con, job_id, succeeded=False, actor=owner,
                           detail={"phase": "run", "error": str(exc)})
        raise
    finally:
        con.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="tcpipe",
        description="Instruct, oversee and correct the training-centre parsing instrument.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    preflight = sub.add_parser(
        "preflight", help="Verify this deployment can run (data, deps, db, volumes)")
    preflight.add_argument("--db", default=_env_default(ENV_DB))
    preflight.add_argument("--artifacts", default=_env_default(ENV_ARTIFACTS))
    preflight.set_defaults(func=command_preflight)

    init = sub.add_parser("init", help="Create an isolated database and artifact directory")
    init.add_argument("--db", default=_env_default(ENV_DB), required=_env_default(ENV_DB) is None)
    init.add_argument("--artifacts", default=_env_default(ENV_ARTIFACTS),
                      required=_env_default(ENV_ARTIFACTS) is None)
    init.set_defaults(func=command_init)

    migrate = sub.add_parser("migrate", help="Apply trusted and additive local migrations")
    migrate.add_argument("--db", default=_env_default(ENV_DB),
                         required=_env_default(ENV_DB) is None)
    migrate.add_argument("--migrations")
    migrate.add_argument("--by", default="operator-cli")
    migrate.set_defaults(func=command_migrate)

    public_preflight = sub.add_parser(
        "public-preflight", help="Automatically decide robots for an ordinary public route"
    )
    public_preflight.add_argument("--db", default=_env_default(ENV_DB),
                                  required=_env_default(ENV_DB) is None)
    public_preflight.add_argument("--artifacts", default=_env_default(ENV_ARTIFACTS),
                                  required=_env_default(ENV_ARTIFACTS) is None)
    public_preflight.add_argument("--route", required=True)
    public_preflight.add_argument("--proxy", default=_env_default(ENV_PROXY))
    public_preflight.add_argument("--require-proxy", action="store_true",
                                  default=_env_flag(ENV_REQUIRE_PROXY))
    public_preflight.add_argument("--user-agent", default=_env_default(
        ENV_USER_AGENT, "tcpipe/2.3 (+transparent governed public-source parser)"))
    public_preflight.set_defaults(func=command_public_preflight)

    activate = sub.add_parser(
        "adapter-activate", help="Activate an adapter version after a passing fixture"
    )
    activate.add_argument("--db", default=_env_default(ENV_DB),
                          required=_env_default(ENV_DB) is None)
    activate.add_argument("--route", required=True)
    activate.add_argument("--adapter", required=True)
    activate.add_argument("--version", required=True)
    activate.add_argument("--by", default="operator-cli")
    activate.set_defaults(func=command_adapter_activate)

    fixture = sub.add_parser(
        "adapter-fixture", help="Replay a fetched artifact and record a deterministic fixture"
    )
    fixture.add_argument("--db", default=_env_default(ENV_DB),
                         required=_env_default(ENV_DB) is None)
    fixture.add_argument("--artifacts", default=_env_default(ENV_ARTIFACTS),
                         required=_env_default(ENV_ARTIFACTS) is None)
    fixture.add_argument("--attempt", required=True)
    fixture.add_argument("--route")
    fixture.add_argument("--adapter", required=True)
    fixture.add_argument("--version", required=True)
    fixture.add_argument("--expected-sha256")
    fixture.set_defaults(func=command_adapter_fixture)

    for name, function, help_text in (
        ("status", command_status, "Show missions, work, coverage and attention items"),
        ("readiness", command_readiness, "Show per-route policy, fixture and schedule gates"),
        ("missions", command_missions, "List the instruction/mission registry"),
        ("jobs", command_jobs, "List queued and completed instructions"),
        ("routes", command_routes, "List source routes and current outcomes"),
        ("observations", command_observations, "Find evidence-backed fields to inspect or correct"),
        ("corrections", command_corrections, "List manual corrections and decisions"),
        ("reviews", command_reviews, "List human-review and learned-rule candidates"),
        ("doctor", command_doctor, "Check database and stored-artifact integrity"),
    ):
        command = sub.add_parser(name, help=help_text)
        command.add_argument("--db", default=_env_default(ENV_DB),
                             required=_env_default(ENV_DB) is None)
        if name in ("jobs", "reviews"):
            command.add_argument("--status")
        if name in ("jobs", "corrections", "reviews", "routes", "observations"):
            command.add_argument("--limit", type=int, default=100)
        if name == "observations":
            command.add_argument("--route")
            command.add_argument("--field")
            command.add_argument("--contains")
        if name == "doctor":
            command.add_argument(
                "--artifact-limit", type=int, default=0,
                help="0 checks all registered artifacts",
            )
        command.set_defaults(func=function)

    recover = sub.add_parser(
        "recover", help="Requeue expired worker leases and fail exhausted work"
    )
    recover.add_argument("--db", default=_env_default(ENV_DB),
                         required=_env_default(ENV_DB) is None)
    recover.add_argument("--by", default="operator-recovery")
    recover.set_defaults(func=command_recover)

    fetch = sub.add_parser("fetch", help="Acquire artifacts for a route (the only networked command)")
    fetch.add_argument("--db", default=_env_default(ENV_DB),
                     required=_env_default(ENV_DB) is None)
    fetch.add_argument("--artifacts", default=_env_default(ENV_ARTIFACTS),
                     required=_env_default(ENV_ARTIFACTS) is None)
    fetch.add_argument("--route", required=True)
    fetch.add_argument("--mission", default="M-120")
    fetch.add_argument("--url", action="append", help="Override/paginate; repeat per page")
    fetch.add_argument("--adapter")
    fetch.add_argument("--adapter-version")
    fetch.add_argument("--worker", default="operator-cli")
    fetch.add_argument("--lease-seconds", type=int, default=3600)
    fetch.add_argument("--git-commit", default="operator-cli")
    fetch.add_argument("--proxy", default=_env_default(ENV_PROXY), help="Egress proxy URL")
    fetch.add_argument("--require-proxy", action="store_true",
                       default=_env_flag(ENV_REQUIRE_PROXY),
                       help="Refuse to fetch unless a proxy is configured")
    fetch.add_argument("--user-agent", default=_env_default(
        ENV_USER_AGENT,
        "tcpipe/2.3 (+transparent governed public-source parser)"))
    fetch.add_argument("--auto-public-preflight", action="store_true",
                       help="Run fail-closed public robots preflight if current reviews are absent")
    fetch.add_argument("--public-only", action="store_true",
                       help="Reject private/reserved destinations and redirects")
    fetch.add_argument("--no-conditional", action="store_true",
                       help="Skip If-None-Match/If-Modified-Since revalidation")
    fetch.set_defaults(func=command_fetch)

    run = sub.add_parser("run", help="Parse stored artifacts into a governed run (no network)")
    run.add_argument("--db", default=_env_default(ENV_DB),
                     required=_env_default(ENV_DB) is None)
    run.add_argument("--artifacts", default=_env_default(ENV_ARTIFACTS),
                     required=_env_default(ENV_ARTIFACTS) is None)
    run.add_argument("--route", required=True)
    run.add_argument("--attempt", action="append", required=True,
                     help="Fetch attempt ID to parse; repeat per page")
    run.add_argument("--mission", default="M-120")
    run.add_argument("--adapter")
    run.add_argument("--adapter-version")
    run.add_argument("--rules", help="Adapter rules JSON path (defaults to adapters/<id>.json)")
    run.add_argument("--audit-errors", type=int,
                     help="Number of sampled records found wrong. Omit to skip the audit "
                          "(the run then cannot reach a complete state).")
    run.add_argument("--audit-sample", type=int, help="Override the sample size")
    run.add_argument("--audited-by", default="operator-cli")
    run.add_argument("--no-materialize", action="store_true")
    run.add_argument("--worker", default="operator-cli")
    run.add_argument("--lease-seconds", type=int, default=3600)
    run.add_argument("--git-commit", default="operator-cli")
    run.set_defaults(func=command_run)

    enqueue = sub.add_parser("enqueue", help="Give the instrument a governed work instruction")
    enqueue.add_argument("--db", required=True)
    enqueue.add_argument("--mission", required=True)
    enqueue.add_argument("--kind", required=True)
    instruction_input = enqueue.add_mutually_exclusive_group(required=True)
    instruction_input.add_argument("--params", help="JSON object or @path/to/file.json")
    instruction_input.add_argument("--instruction", help="Plain-language governed objective")
    enqueue.add_argument("--route", action="append", help="Route ID; repeat when needed")
    enqueue.add_argument(
        "--acceptance", action="append", help="Acceptance condition; repeat when needed"
    )
    enqueue.add_argument(
        "--mode", choices=("observe_only", "isolated_pilot", "governed_write"),
        default="isolated_pilot",
    )
    enqueue.add_argument("--idempotency-key", required=True)
    enqueue.add_argument("--git-commit", required=True)
    enqueue.add_argument("--by", required=True)
    enqueue.add_argument("--job-id")
    enqueue.add_argument("--priority", type=int, default=100)
    enqueue.add_argument("--max-attempts", type=int, default=3)
    enqueue.set_defaults(func=command_enqueue)

    propose = sub.add_parser(
        "correction-propose", help="Propose an append-only correction to one observation"
    )
    propose.add_argument("--db", required=True)
    propose.add_argument("--observation", required=True)
    propose.add_argument(
        "--action", required=True,
        choices=("replace_normalized", "reject_value", "reject_record"),
    )
    propose.add_argument("--value", help="Required only for replace_normalized")
    propose.add_argument(
        "--scope", required=True,
        choices=("one_record", "route_template", "global_candidate"),
    )
    propose.add_argument("--reason", required=True)
    propose.add_argument("--by", required=True)
    propose.add_argument("--supersedes")
    propose.add_argument("--correction-id")
    propose.set_defaults(func=command_correction_propose)

    decide = sub.add_parser(
        "correction-decide", help="Accept or reject a proposed correction"
    )
    decide.add_argument("--db", required=True)
    decide.add_argument("--correction", required=True)
    decide.add_argument("--decision", required=True, choices=("accepted", "rejected"))
    decide.add_argument("--by", required=True)
    decide.add_argument("--rationale", required=True)
    decide.add_argument("--review-id")
    decide.set_defaults(func=command_correction_decide)

    review_decide = sub.add_parser(
        "review-decide", help="Accept/reject a learned correction rule after fixture replay"
    )
    review_decide.add_argument("--db", required=True)
    review_decide.add_argument("--review", required=True)
    review_decide.add_argument("--decision", required=True, choices=("accepted", "rejected"))
    review_decide.add_argument("--by", required=True)
    review_decide.add_argument("--rationale", required=True)
    review_decide.add_argument("--before-hash")
    review_decide.add_argument("--after-hash")
    review_decide.add_argument("--fixture-count", type=int)
    review_decide.add_argument("--affected", type=int)
    review_decide.add_argument("--row-delta", type=int)
    review_decide.add_argument("--row-drop-justification")
    review_decide.add_argument("--rule-id")
    review_decide.add_argument("--supersedes-rule")
    review_decide.set_defaults(func=command_review_decide)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return int(args.func(args))
    except (ValueError, RuntimeError, sqlite3.Error, subprocess.CalledProcessError, OSError) as exc:
        from .secrets import redact_secrets

        print(f"ERROR: {redact_secrets(exc)}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
