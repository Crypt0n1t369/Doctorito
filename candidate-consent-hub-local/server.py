#!/usr/bin/env python3
"""Candidate Consent Hub — dependency-free local CRM and consent register."""

from __future__ import annotations

import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DEFAULT_DB_PATH = APP_DIR / "data" / "candidate_hub.db"
DB_PATH = Path(os.environ.get("CANDIDATE_HUB_DB", str(DEFAULT_DB_PATH))).resolve()
HOST = os.environ.get("CANDIDATE_HUB_HOST", "127.0.0.1")
PORT = int(os.environ.get("CANDIDATE_HUB_PORT", "8787"))
PRIVACY_NOTICE_URL = os.environ.get("PRIVACY_NOTICE_URL", "#privacy-note")
WEBHOOK_SECRET = os.environ.get("SMARTLEAD_WEBHOOK_SECRET", "")
PUBLIC_URL = os.environ.get("CANDIDATE_HUB_PUBLIC_URL", f"http://{HOST}:{PORT}").rstrip("/")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_email(value: str) -> str:
    return value.strip().lower()


def candidate_key() -> str:
    return f"CAN-{secrets.token_hex(4).upper()}"


def consent_token() -> str:
    return secrets.token_urlsafe(32)


def connect_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY,
      candidate_key TEXT NOT NULL UNIQUE,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      source_context TEXT NOT NULL DEFAULT '',
      cv_reference TEXT NOT NULL DEFAULT '',
      received_at TEXT,
      original_basis TEXT NOT NULL DEFAULT 'review_required',
      eligibility TEXT NOT NULL DEFAULT 'review_required',
      status TEXT NOT NULL DEFAULT 'new',
      consent_beta_status TEXT NOT NULL DEFAULT 'not_requested',
      consent_cv_status TEXT NOT NULL DEFAULT 'not_requested',
      consent_contact_status TEXT NOT NULL DEFAULT 'not_requested',
      consent_phone_status TEXT NOT NULL DEFAULT 'not_requested',
      retention_until TEXT,
      privacy_notice_version TEXT NOT NULL DEFAULT 'draft-v1',
      consent_token TEXT NOT NULL UNIQUE,
      campaign_name TEXT NOT NULL DEFAULT '',
      smartlead_lead_id TEXT NOT NULL DEFAULT '',
      smartlead_campaign_id TEXT NOT NULL DEFAULT '',
      last_event_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS consent_events (
      id INTEGER PRIMARY KEY,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      scope TEXT NOT NULL,
      decision TEXT NOT NULL,
      source TEXT NOT NULL,
      notice_version TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      recorded_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS campaign_events (
      id INTEGER PRIMARY KEY,
      candidate_id INTEGER REFERENCES candidates(id) ON DELETE SET NULL,
      external_event_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      phase TEXT NOT NULL DEFAULT 'informing',
      status TEXT NOT NULL DEFAULT 'draft',
      smartlead_campaign_id TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      last_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status)",
    "CREATE INDEX IF NOT EXISTS idx_candidates_eligibility ON candidates(eligibility)",
    "CREATE INDEX IF NOT EXISTS idx_candidates_consent_beta ON candidates(consent_beta_status)",
    "CREATE INDEX IF NOT EXISTS idx_candidates_consent_cv ON candidates(consent_cv_status)",
    "CREATE INDEX IF NOT EXISTS idx_candidates_retention ON candidates(retention_until)",
    "CREATE INDEX IF NOT EXISTS idx_consent_candidate_time ON consent_events(candidate_id, recorded_at)",
    "CREATE INDEX IF NOT EXISTS idx_campaign_events_candidate_time ON campaign_events(candidate_id, occurred_at)",
]


def init_db(seed: bool = True) -> None:
    stamp = now_iso()
    with closing(connect_db()) as db:
        # Keep existing local databases forward-compatible with the independent
        # beta-shortlist permission added after the initial schema.
        existing_columns = {
            row["name"] for row in db.execute("PRAGMA table_info(candidates)").fetchall()
        }
        if existing_columns and "consent_beta_status" not in existing_columns:
            db.execute(
                "ALTER TABLE candidates ADD COLUMN consent_beta_status TEXT NOT NULL DEFAULT 'not_requested'"
            )
        for statement in SCHEMA_STATEMENTS:
            db.execute(statement)
        db.execute("PRAGMA optimize")
        if seed and db.execute("SELECT COUNT(*) FROM candidates").fetchone()[0] == 0:
            examples = [
                {
                    "candidate_key": "CAN-DEMO01",
                    "first_name": "Marta",
                    "last_name": "Liepa",
                    "email": "marta@example.test",
                    "location": "Riga, Latvia",
                    "source_context": "Solar project engineer application",
                    "received_at": "2026-06-12",
                    "original_basis": "future_roles_consent",
                    "eligibility": "eligible",
                    "status": "invited",
                    "consent_cv_status": "pending",
                    "consent_contact_status": "pending",
                    "retention_until": "2027-06-12",
                    "campaign_name": "Energy Match — Invitation",
                },
                {
                    "candidate_key": "CAN-DEMO02",
                    "first_name": "Andris",
                    "last_name": "Ozols",
                    "email": "andris@example.test",
                    "location": "Ventspils, Latvia",
                    "source_context": "Wind operations application",
                    "received_at": "2026-05-04",
                    "original_basis": "future_roles_consent",
                    "eligibility": "eligible",
                    "status": "consented",
                    "consent_cv_status": "granted",
                    "consent_contact_status": "granted",
                    "retention_until": "2027-08-28",
                    "campaign_name": "Energy Match — Verification",
                },
                {
                    "candidate_key": "CAN-DEMO03",
                    "first_name": "Elina",
                    "last_name": "Krumina",
                    "email": "elina@example.test",
                    "location": "Tallinn, Estonia",
                    "source_context": "General CV submission",
                    "received_at": "2025-11-18",
                    "original_basis": "review_required",
                    "eligibility": "review_required",
                    "status": "legal_review",
                    "consent_cv_status": "not_requested",
                    "consent_contact_status": "not_requested",
                    "retention_until": "2026-09-18",
                    "campaign_name": "",
                },
                {
                    "candidate_key": "CAN-DEMO04",
                    "first_name": "Tomas",
                    "last_name": "Bergs",
                    "email": "tomas@example.test",
                    "location": "Liepaja, Latvia",
                    "source_context": "Electrical engineer vacancy",
                    "received_at": "2026-07-09",
                    "original_basis": "future_roles_consent",
                    "eligibility": "eligible",
                    "status": "interested_unverified",
                    "consent_cv_status": "pending",
                    "consent_contact_status": "pending",
                    "retention_until": "2027-07-09",
                    "campaign_name": "Energy Match — Invitation",
                },
            ]
            for item in examples:
                db.execute(
                    """
                    INSERT INTO candidates (
                      candidate_key, first_name, last_name, email, location,
                      source_context, received_at, original_basis, eligibility,
                      status, consent_cv_status, consent_contact_status,
                      retention_until, privacy_notice_version, consent_token,
                      campaign_name, is_demo, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft-v1', ?, ?, 1, ?, ?)
                    """,
                    (
                        item["candidate_key"], item["first_name"], item["last_name"],
                        item["email"], item["location"], item["source_context"],
                        item["received_at"], item["original_basis"], item["eligibility"],
                        item["status"], item["consent_cv_status"],
                        item["consent_contact_status"], item["retention_until"],
                        consent_token(), item["campaign_name"], stamp, stamp,
                    ),
                )
            db.execute(
                """
                INSERT OR IGNORE INTO campaigns
                  (name, phase, status, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)
                """,
                (
                    "Energy Match — Invitation", "informing", "draft",
                    "Initial information email and one reminder.", stamp, stamp,
                    "Energy Match — Verification", "verification", "draft",
                    "Consent confirmation for interested candidates.", stamp, stamp,
                ),
            )
        db.commit()


def row_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(row) if row is not None else None


def candidate_by_email(db: sqlite3.Connection, email: str) -> sqlite3.Row | None:
    return db.execute(
        "SELECT * FROM candidates WHERE email = ? COLLATE NOCASE", (normalize_email(email),)
    ).fetchone()


def summary_payload(db: sqlite3.Connection) -> dict[str, Any]:
    totals = db.execute(
        """
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN eligibility = 'eligible' THEN 1 ELSE 0 END) AS eligible,
          SUM(CASE WHEN status IN ('legal_review', 'interested_unverified') THEN 1 ELSE 0 END) AS review_queue,
          SUM(CASE WHEN consent_cv_status = 'granted' THEN 1 ELSE 0 END) AS consented,
          SUM(CASE WHEN status IN ('declined', 'withdrawn', 'do_not_contact') THEN 1 ELSE 0 END) AS suppressed
        FROM candidates
        """
    ).fetchone()
    statuses = [
        dict(row)
        for row in db.execute(
            "SELECT status, COUNT(*) AS count FROM candidates GROUP BY status ORDER BY count DESC"
        ).fetchall()
    ]
    return {"totals": dict(totals), "statuses": statuses, "generated_at": now_iso()}


def create_or_update_candidate(db: sqlite3.Connection, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    email = normalize_email(str(payload.get("email", "")))
    if not email or "@" not in email:
        raise ValueError("A valid email address is required.")
    existing = candidate_by_email(db, email)
    stamp = now_iso()
    allowed = {
        "first_name", "last_name", "phone", "location", "source_context",
        "cv_reference", "received_at", "original_basis", "eligibility", "status",
        "consent_beta_status",
        "consent_cv_status", "consent_contact_status", "consent_phone_status",
        "retention_until", "privacy_notice_version", "campaign_name",
        "smartlead_lead_id", "smartlead_campaign_id",
    }
    clean = {key: str(value).strip() for key, value in payload.items() if key in allowed and value is not None}
    if existing:
        if clean:
            assignments = ", ".join(f"{key} = ?" for key in clean)
            db.execute(
                f"UPDATE candidates SET {assignments}, updated_at = ? WHERE id = ?",
                (*clean.values(), stamp, existing["id"]),
            )
        created = False
        candidate_id = existing["id"]
    else:
        db.execute(
            """
            INSERT INTO candidates (
              candidate_key, first_name, last_name, email, phone, location,
              source_context, cv_reference, received_at, original_basis,
              eligibility, status, consent_beta_status, consent_cv_status, consent_contact_status,
              consent_phone_status, retention_until, privacy_notice_version,
              consent_token, campaign_name, smartlead_lead_id,
              smartlead_campaign_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                candidate_key(), clean.get("first_name", ""), clean.get("last_name", ""),
                email, clean.get("phone", ""), clean.get("location", ""),
                clean.get("source_context", ""), clean.get("cv_reference", ""),
                clean.get("received_at") or None, clean.get("original_basis", "review_required"),
                clean.get("eligibility", "review_required"), clean.get("status", "new"),
                clean.get("consent_beta_status", "not_requested"),
                clean.get("consent_cv_status", "not_requested"),
                clean.get("consent_contact_status", "not_requested"),
                clean.get("consent_phone_status", "not_requested"),
                clean.get("retention_until") or None,
                clean.get("privacy_notice_version", "draft-v1"), consent_token(),
                clean.get("campaign_name", ""), clean.get("smartlead_lead_id", ""),
                clean.get("smartlead_campaign_id", ""), stamp, stamp,
            ),
        )
        candidate_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
        created = True
    db.commit()
    result = row_dict(db.execute("SELECT * FROM candidates WHERE id = ?", (candidate_id,)).fetchone())
    assert result is not None
    return result, created


def apply_consent(db: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    token = str(payload.get("token", ""))
    candidate = db.execute("SELECT * FROM candidates WHERE consent_token = ?", (token,)).fetchone()
    if not candidate:
        raise LookupError("This consent link is invalid or expired.")
    action = str(payload.get("action", "grant"))
    # `beta_shortlist` identifies the independent, newer consent form. If it
    # is absent, retain the original CV-required API contract for compatibility
    # with older links and integrations.
    independent_form = "beta_shortlist" in payload
    beta_shortlist = bool(payload.get("beta_shortlist"))
    cv_match = bool(payload.get("cv_match"))
    direct_email = bool(payload.get("direct_email"))
    direct_phone = bool(payload.get("direct_phone"))
    stamp = now_iso()
    notice_version = candidate["privacy_notice_version"]
    if action == "delete":
        status = "deletion_requested"
        beta_status = cv_status = contact_status = phone_status = "withdrawn"
    elif action == "decline":
        status = "declined"
        beta_status = cv_status = contact_status = phone_status = "declined"
    elif independent_form:
        beta_status = "granted" if beta_shortlist else "declined"
        cv_status = "granted" if cv_match else "declined"
        contact_status = "granted" if direct_email else "declined"
        phone_status = "granted" if direct_phone else "declined"
        status = "consented" if any((beta_shortlist, cv_match, direct_email, direct_phone)) else "declined"
    elif not cv_match:
        # Legacy form: CV matching was the required purpose, so declining it
        # declined the other contact scopes as well.
        status, beta_status, cv_status, contact_status, phone_status = (
            "declined", "not_requested", "declined", "declined", "declined"
        )
    else:
        status = "consented"
        beta_status = "not_requested"
        cv_status = "granted"
        contact_status = "granted" if direct_email else "declined"
        phone_status = "granted" if direct_phone else "declined"
    db.execute(
        """
        UPDATE candidates
        SET status = ?, consent_beta_status = ?, consent_cv_status = ?, consent_contact_status = ?,
            consent_phone_status = ?, last_event_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, beta_status, cv_status, contact_status, phone_status, stamp, stamp, candidate["id"]),
    )
    decisions = []
    if independent_form:
        decisions.append(("beta_shortlist", beta_status))
    decisions.extend((
        ("cv_matching", cv_status),
        ("direct_email", contact_status),
        ("direct_phone", phone_status),
    ))
    for scope, decision in decisions:
        db.execute(
            """
            INSERT INTO consent_events
              (candidate_id, event_type, scope, decision, source, notice_version, evidence, recorded_at)
            VALUES (?, 'consent_choice', ?, ?, 'secure_link', ?, ?, ?)
            """,
            (
                candidate["id"], scope, decision, notice_version,
                f"action={action}; token fingerprint={hashlib.sha256(token.encode()).hexdigest()[:12]}",
                stamp,
            ),
        )
    db.commit()
    updated = row_dict(db.execute("SELECT * FROM candidates WHERE id = ?", (candidate["id"],)).fetchone())
    assert updated is not None
    return updated


def verify_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not WEBHOOK_SECRET:
        return True
    expected = "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def ingest_smartlead_event(
    db: sqlite3.Connection, payload: dict[str, Any], request_id: str | None
) -> tuple[dict[str, Any], bool]:
    external_id = request_id or str(payload.get("id") or "") or None
    if external_id:
        prior = db.execute(
            "SELECT id FROM campaign_events WHERE external_event_id = ?", (external_id,)
        ).fetchone()
        if prior:
            return {"event_id": prior["id"], "duplicate": True}, False
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    event_type = str(payload.get("type") or payload.get("event_type") or data.get("event_type") or "unknown").lower()
    lead = data.get("lead") if isinstance(data.get("lead"), dict) else {}
    email = normalize_email(str(data.get("email") or lead.get("email") or payload.get("email") or ""))
    candidate = candidate_by_email(db, email) if email else None
    stamp = str(payload.get("created_at") or data.get("created_at") or now_iso())
    if candidate:
        next_status = candidate["status"]
        beta_status = candidate["consent_beta_status"]
        cv_status = candidate["consent_cv_status"]
        contact_status = candidate["consent_contact_status"]
        if "unsubscribe" in event_type:
            next_status, beta_status, contact_status = "do_not_contact", "withdrawn", "withdrawn"
        elif "bounce" in event_type:
            next_status = "bounced"
        elif "reply" in event_type:
            next_status = "replied"
        elif "click" in event_type:
            next_status = "interested_unverified"
        category = str(data.get("category") or data.get("lead_category") or "").lower()
        if category in {"interested", "positive", "requested info", "requested_info"}:
            next_status = "interested_unverified"
        if category in {"not interested", "do not contact", "unsubscribe"}:
            next_status, beta_status, contact_status = "do_not_contact", "withdrawn", "withdrawn"
        db.execute(
            """
            UPDATE candidates SET status = ?, consent_beta_status = ?, consent_cv_status = ?,
              consent_contact_status = ?, last_event_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (next_status, beta_status, cv_status, contact_status, stamp, now_iso(), candidate["id"]),
        )
    db.execute(
        """
        INSERT INTO campaign_events
          (candidate_id, external_event_id, event_type, source, payload_json, occurred_at)
        VALUES (?, ?, ?, 'smartlead_webhook', ?, ?)
        """,
        (candidate["id"] if candidate else None, external_id, event_type, json.dumps(payload), stamp),
    )
    event_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
    db.commit()
    return {"event_id": event_id, "duplicate": False, "candidate_found": bool(candidate)}, True


class CandidateHubHandler(BaseHTTPRequestHandler):
    server_version = "CandidateConsentHub/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write(f"[{now_iso()}] {self.address_string()} {fmt % args}\n")

    def security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        )

    def send_bytes(self, data: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.security_headers()
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, payload: Any, status: int = 200) -> None:
        self.send_bytes(
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
            status,
        )

    def send_error_json(self, message: str, status: int) -> None:
        self.send_json({"error": message}, status)

    def read_json(self) -> tuple[dict[str, Any], bytes]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 2_000_000:
            raise ValueError("Request body is too large.")
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError as exc:
            raise ValueError("Invalid JSON body.") from exc
        if not isinstance(payload, dict):
            raise ValueError("JSON body must be an object.")
        return payload, raw

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path in {"/", "/index.html"}:
            return self.serve_static("index.html")
        if path.startswith("/static/"):
            return self.serve_static(path.removeprefix("/static/"))
        if path.startswith("/consent/"):
            return self.serve_consent(path.removeprefix("/consent/"))
        if path == "/api/summary":
            with closing(connect_db()) as db:
                return self.send_json(summary_payload(db))
        if path == "/api/candidates":
            return self.list_candidates(parse_qs(parsed.query))
        if path == "/api/candidates/export.csv":
            return self.export_candidates()
        if path == "/api/candidates/smartlead.csv":
            return self.export_smartlead_candidates()
        if path == "/api/campaigns":
            with closing(connect_db()) as db:
                rows = [dict(row) for row in db.execute("SELECT * FROM campaigns ORDER BY id").fetchall()]
                return self.send_json({"campaigns": rows})
        if path == "/api/consent-events":
            with closing(connect_db()) as db:
                rows = [
                    dict(row)
                    for row in db.execute(
                        """
                        SELECT ce.*, c.candidate_key, c.first_name, c.last_name, c.email
                        FROM consent_events ce JOIN candidates c ON c.id = ce.candidate_id
                        ORDER BY ce.recorded_at DESC LIMIT 200
                        """
                    ).fetchall()
                ]
                return self.send_json({"events": rows})
        if path == "/api/config":
            return self.send_json(
                {
                    "mode": "automatic" if WEBHOOK_SECRET else "manual",
                    "webhook_secret_configured": bool(WEBHOOK_SECRET),
                    "webhook_path": "/api/webhooks/smartlead",
                    "database_path": str(DB_PATH),
                    "privacy_notice_url": PRIVACY_NOTICE_URL,
                    "public_url": PUBLIC_URL,
                }
            )
        return self.send_error_json("Not found.", HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            payload, raw = self.read_json()
            if path == "/api/candidates":
                with closing(connect_db()) as db:
                    candidate, created = create_or_update_candidate(db, payload)
                    return self.send_json({"candidate": candidate}, HTTPStatus.CREATED if created else HTTPStatus.OK)
            if path == "/api/import":
                items = payload.get("candidates")
                if not isinstance(items, list) or len(items) > 5000:
                    raise ValueError("Provide a candidates array with at most 5,000 rows.")
                created = updated = failed = 0
                errors: list[dict[str, Any]] = []
                with closing(connect_db()) as db:
                    for index, item in enumerate(items, start=1):
                        try:
                            if not isinstance(item, dict):
                                raise ValueError("Row is not an object.")
                            _, was_created = create_or_update_candidate(db, item)
                            created += int(was_created)
                            updated += int(not was_created)
                        except (ValueError, sqlite3.Error) as exc:
                            failed += 1
                            if len(errors) < 20:
                                errors.append({"row": index, "error": str(exc)})
                return self.send_json({"created": created, "updated": updated, "failed": failed, "errors": errors})
            if path == "/api/consent":
                with closing(connect_db()) as db:
                    candidate = apply_consent(db, payload)
                    return self.send_json({"candidate": candidate})
            if path == "/api/webhooks/smartlead":
                signature = self.headers.get("X-Smartlead-Signature", "")
                if not verify_webhook_signature(raw, signature):
                    return self.send_error_json("Invalid webhook signature.", HTTPStatus.UNAUTHORIZED)
                with closing(connect_db()) as db:
                    result, _ = ingest_smartlead_event(db, payload, self.headers.get("X-Request-Id"))
                    return self.send_json(result)
            if path == "/api/campaigns":
                name = str(payload.get("name", "")).strip()
                if not name:
                    raise ValueError("Campaign name is required.")
                stamp = now_iso()
                with closing(connect_db()) as db:
                    db.execute(
                        """
                        INSERT INTO campaigns (name, phase, status, smartlead_campaign_id, description, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(name) DO UPDATE SET phase=excluded.phase, status=excluded.status,
                          smartlead_campaign_id=excluded.smartlead_campaign_id,
                          description=excluded.description, updated_at=excluded.updated_at
                        """,
                        (
                            name, str(payload.get("phase", "informing")), str(payload.get("status", "draft")),
                            str(payload.get("smartlead_campaign_id", "")), str(payload.get("description", "")),
                            stamp, stamp,
                        ),
                    )
                    db.commit()
                return self.send_json({"ok": True}, HTTPStatus.CREATED)
            if path == "/api/demo/clear":
                with closing(connect_db()) as db:
                    count = db.execute("SELECT COUNT(*) FROM candidates WHERE is_demo = 1").fetchone()[0]
                    db.execute("DELETE FROM candidates WHERE is_demo = 1")
                    db.commit()
                    return self.send_json({"deleted": count})
            return self.send_error_json("Not found.", HTTPStatus.NOT_FOUND)
        except LookupError as exc:
            return self.send_error_json(str(exc), HTTPStatus.NOT_FOUND)
        except (ValueError, sqlite3.IntegrityError) as exc:
            return self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)
        except Exception as exc:  # defensive boundary for the local server
            self.log_error("Unhandled error: %s", exc)
            return self.send_error_json("Internal server error.", HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_PATCH(self) -> None:
        path = urlparse(self.path).path
        match = re.fullmatch(r"/api/candidates/(\d+)", path)
        if not match:
            return self.send_error_json("Not found.", HTTPStatus.NOT_FOUND)
        try:
            payload, _ = self.read_json()
            allowed = {
                "first_name", "last_name", "phone", "location", "source_context",
                "cv_reference", "received_at", "original_basis", "eligibility", "status",
                "consent_beta_status",
                "consent_cv_status", "consent_contact_status", "consent_phone_status",
                "retention_until", "privacy_notice_version", "campaign_name",
                "smartlead_lead_id", "smartlead_campaign_id",
            }
            clean = {key: str(value).strip() for key, value in payload.items() if key in allowed}
            if not clean:
                raise ValueError("No supported fields were provided.")
            with closing(connect_db()) as db:
                assignments = ", ".join(f"{key} = ?" for key in clean)
                cursor = db.execute(
                    f"UPDATE candidates SET {assignments}, updated_at = ? WHERE id = ?",
                    (*clean.values(), now_iso(), int(match.group(1))),
                )
                if cursor.rowcount == 0:
                    raise LookupError("Candidate not found.")
                db.commit()
                row = row_dict(db.execute("SELECT * FROM candidates WHERE id = ?", (int(match.group(1)),)).fetchone())
                return self.send_json({"candidate": row})
        except LookupError as exc:
            return self.send_error_json(str(exc), HTTPStatus.NOT_FOUND)
        except (ValueError, sqlite3.Error) as exc:
            return self.send_error_json(str(exc), HTTPStatus.BAD_REQUEST)

    def serve_static(self, filename: str) -> None:
        safe = Path(filename).name
        file_path = STATIC_DIR / safe
        if not file_path.exists() or not file_path.is_file():
            return self.send_error_json("Not found.", HTTPStatus.NOT_FOUND)
        types = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8"}
        self.send_bytes(file_path.read_bytes(), types.get(file_path.suffix, "application/octet-stream"))

    def list_candidates(self, query: dict[str, list[str]]) -> None:
        search = (query.get("q") or [""])[0].strip()
        status = (query.get("status") or [""])[0].strip()
        eligibility = (query.get("eligibility") or [""])[0].strip()
        clauses, values = [], []
        if search:
            clauses.append("(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR candidate_key LIKE ?)")
            needle = f"%{search}%"
            values.extend([needle] * 4)
        if status:
            clauses.append("status = ?")
            values.append(status)
        if eligibility:
            clauses.append("eligibility = ?")
            values.append(eligibility)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        with closing(connect_db()) as db:
            rows = [
                dict(row)
                for row in db.execute(
                    f"SELECT * FROM candidates{where} ORDER BY updated_at DESC, id DESC LIMIT 1000", values
                ).fetchall()
            ]
            self.send_json({"candidates": rows, "count": len(rows)})

    def export_candidates(self) -> None:
        with closing(connect_db()) as db:
            rows = db.execute("SELECT * FROM candidates ORDER BY id").fetchall()
            output = io.StringIO()
            writer = csv.writer(output)
            headers = [description[0] for description in db.execute("SELECT * FROM candidates LIMIT 0").description]
            writer.writerow(headers)
            writer.writerows([[row[header] for header in headers] for row in rows])
            data = output.getvalue().encode("utf-8-sig")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="candidate-consent-export.csv"')
            self.send_header("Content-Length", str(len(data)))
            self.security_headers()
            self.end_headers()
            self.wfile.write(data)

    def export_smartlead_candidates(self) -> None:
        """Export only the minimum fields needed for the informing campaign."""
        with closing(connect_db()) as db:
            rows = db.execute(
                """
                SELECT first_name, last_name, email, candidate_key, consent_token
                FROM candidates
                WHERE eligibility = 'eligible'
                  AND status NOT IN ('declined', 'withdrawn', 'do_not_contact', 'deletion_requested', 'bounced', 'consented')
                ORDER BY id
                """
            ).fetchall()
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["first_name", "last_name", "email", "candidate_id", "consent_form_link"])
            for row in rows:
                writer.writerow(
                    [
                        row["first_name"], row["last_name"], row["email"], row["candidate_key"],
                        f"{PUBLIC_URL}/consent/{row['consent_token']}",
                    ]
                )
            data = output.getvalue().encode("utf-8-sig")
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="smartlead-eligible-candidates.csv"')
            self.send_header("Content-Length", str(len(data)))
            self.security_headers()
            self.end_headers()
            self.wfile.write(data)

    def serve_consent(self, token: str) -> None:
        with closing(connect_db()) as db:
            candidate = db.execute(
                "SELECT first_name, consent_cv_status, privacy_notice_version FROM candidates WHERE consent_token = ?",
                (token,),
            ).fetchone()
        if not candidate:
            return self.send_bytes(b"Consent link not found.", "text/plain; charset=utf-8", HTTPStatus.NOT_FOUND)
        template = (STATIC_DIR / "consent.html").read_text(encoding="utf-8")
        safe_name = re.sub(r"[^\w\- 'āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]", "", candidate["first_name"])
        page = (
            template.replace("{{FIRST_NAME}}", safe_name or "there")
            .replace("{{TOKEN}}", token)
            .replace("{{NOTICE_VERSION}}", candidate["privacy_notice_version"])
            .replace("{{PRIVACY_NOTICE_URL}}", PRIVACY_NOTICE_URL)
        )
        self.send_bytes(page.encode("utf-8"), "text/html; charset=utf-8")


def main() -> None:
    init_db(seed=True)
    server = ThreadingHTTPServer((HOST, PORT), CandidateHubHandler)
    print(f"Candidate Consent Hub running at http://{HOST}:{PORT}", flush=True)
    print(f"Database: {DB_PATH}", flush=True)
    if HOST != "127.0.0.1" and not WEBHOOK_SECRET:
        print("WARNING: configure SMARTLEAD_WEBHOOK_SECRET before exposing this server.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Candidate Consent Hub.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
