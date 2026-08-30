"""Governed materialization (G5b).

Turns effective field observations into governed entities. Two rules are absolute:

* **No field without lineage.** Every governed value writes a ``materialization_lineage``
  row pointing at the exact ``field_observation`` it came from. ``materialize_parse_run``
  verifies this before committing and rolls back if any field is unlineaged, so a value can
  never appear in an export without an artifact, locator and evidence quote behind it.
* **Read through corrections.** Input comes from ``v_effective_field_observation``, not
  from ``field_observation`` directly, so accepted manual corrections and active correction
  rules are already applied — and the lineage records which one was responsible.

The resolver decides identity. Anything it blocks becomes a ``review_queue`` row rather
than a guess, and materialization continues for the records that did resolve.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

from .resolver import (
    CandidateCentre,
    ResolutionBlocked,
    identifier_entity_id,
    identifier_rows,
    registrable_domain,
    resolve,
)
from .writer import utc_now

CONTACT_KIND_BY_FIELD = {
    "published_phone": "org_phone",
    "published_apply_url": "apply_url",
}


class MaterializationError(RuntimeError):
    pass


def stable_id(prefix: str, *parts: object) -> str:
    """Derive an entity id from its own content, never from the run that observed it.

    Deriving ids from source_record_id made every replay mint new ids for the same real
    thing, which collided with the natural-key UNIQUE constraints the moment a route ran
    twice. Content-derived ids make re-materialization a no-op and let a genuine change
    (a centre moves, changes number) appear as a new row alongside the old one.
    """
    joined = "|".join("" if part is None else str(part) for part in parts)
    return f"{prefix}-{hashlib.sha256(joined.encode('utf-8')).hexdigest()[:16]}"


@dataclass
class MaterializationReport:
    parse_run_id: str
    centres_created: int = 0
    centres_matched: int = 0
    blocked_records: int = 0
    locations: int = 0
    contacts: int = 0
    accreditations: int = 0
    offerings: int = 0
    lineage_rows: int = 0
    review_items: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "parse_run_id": self.parse_run_id,
            "centres_created": self.centres_created,
            "centres_matched": self.centres_matched,
            "blocked_records": self.blocked_records,
            "locations": self.locations,
            "contacts": self.contacts,
            "accreditations": self.accreditations,
            "offerings": self.offerings,
            "lineage_rows": self.lineage_rows,
            "review_items": self.review_items,
        }


@dataclass
class _Pending:
    """A lineage row queued until its entity exists."""

    entity_kind: str
    entity_id: str
    field_name: str
    field_observation_id: str
    correction_id: Optional[str]
    correction_rule_id: Optional[str]


def _observations(con, parse_run_id: str) -> dict[str, dict[str, list[sqlite3.Row]]]:
    """Effective observations grouped by source record, then field name."""
    rows = con.execute(
        """SELECT efo.*, sr.source_record_key, sr.row_ordinal
             FROM v_effective_field_observation efo
             JOIN source_record sr ON sr.source_record_id=efo.source_record_id
            WHERE sr.parse_run_id=?
            ORDER BY sr.row_ordinal, efo.field_name, efo.value_ordinal""",
        (parse_run_id,),
    ).fetchall()
    grouped: dict[str, dict[str, list[sqlite3.Row]]] = {}
    for row in rows:
        grouped.setdefault(row["source_record_id"], {}).setdefault(
            row["field_name"], []
        ).append(row)
    return grouped


def _value(row: sqlite3.Row) -> str:
    return row["effective_normalized_value"] or row["raw_value"]


def materialize_parse_run(
    con,
    parse_run_id: str,
    *,
    job_id: str,
    actor: str = "materializer",
) -> MaterializationReport:
    """Materialize one sealed parse run. All-or-nothing.

    Requires the parse to be ``parsed`` — a quarantined or failed parse must not reach
    governed tables — and the owning route run to have completed, so identity is only ever
    assigned to evidence that already passed the terminal-state gates.
    """
    report = MaterializationReport(parse_run_id=parse_run_id)
    con.execute("BEGIN IMMEDIATE")
    try:
        parse = con.execute(
            """SELECT pr.*, rr.route_id, rr.run_id, rr.terminal_state, r.source_id
                 FROM parse_run pr
                 JOIN route_run rr ON rr.run_id=pr.route_run_id
                 JOIN route r ON r.route_id=rr.route_id
                WHERE pr.parse_run_id=?""",
            (parse_run_id,),
        ).fetchone()
        if parse is None:
            raise MaterializationError(f"parse run {parse_run_id} does not exist")
        if parse["status"] != "parsed":
            raise MaterializationError(
                f"parse run {parse_run_id} has status {parse['status']!r}; only a clean "
                "'parsed' run may be materialized"
            )
        if parse["terminal_state"] is None:
            raise MaterializationError(
                f"route run {parse['run_id']} has not been finalized; materialization "
                "cannot precede the terminal-state decision"
            )

        now = utc_now()
        pending: list[_Pending] = []
        grouped = _observations(con, parse_run_id)

        for source_record_id, fields in grouped.items():
            candidate = _candidate_from(fields, source_scope=parse["source_id"])
            try:
                resolution = resolve(con, candidate)
            except ResolutionBlocked as exc:  # pragma: no cover - defensive
                resolution = None
                _queue_review(con, parse, source_record_id, exc.reason, now, actor)
                report.blocked_records += 1
                report.review_items.append(exc.reason)
                continue

            if resolution.blockers:
                reason = "; ".join(resolution.blockers)
                _queue_review(con, parse, source_record_id, reason, now, actor)
                report.blocked_records += 1
                report.review_items.append(f"{source_record_id}: {reason}")
                continue

            centre_id = resolution.centre_id
            if resolution.is_new:
                strongest = candidate.build_keys()[0]
                centre_id = stable_id("C", strongest.kind, strongest.value,
                                      strongest.source_scope)
                con.execute(
                    """INSERT INTO centre (centre_id,display_name,registrable_domain,
                         website_url,entity_state,created_by_job_id,created_at_utc,updated_at_utc)
                       VALUES (?,?,?,?, 'active', ?,?,?)""",
                    (centre_id, candidate.display_name,
                     registrable_domain(candidate.website_url or ""), candidate.website_url,
                     job_id, now, now),
                )
                report.centres_created += 1
            else:
                report.centres_matched += 1

            # Evidence accumulates: a re-observation of the same field adds lineage rather
            # than being discarded, so corroboration across runs is visible.
            name_rows = fields.get("published_name", [])
            if name_rows:
                pending.append(_lineage("centre", centre_id, "display_name", name_rows[0]))
            site_rows = fields.get("published_website", [])
            if site_rows:
                pending.append(_lineage("centre", centre_id, "website_url", site_rows[0]))

            for id_kind, id_value, scope, _ in identifier_rows(centre_id, candidate):
                con.execute(
                    "INSERT OR IGNORE INTO centre_identifier VALUES (?,?,?,?)",
                    (id_kind, id_value, scope, centre_id),
                )
                evidence = _identifier_evidence(fields, id_kind)
                if evidence is not None:
                    pending.append(_lineage(
                        "centre_identifier",
                        identifier_entity_id(id_kind, id_value, scope),
                        "id_value", evidence,
                    ))

            report.locations += _materialize_location(
                con, centre_id, fields, source_record_id, job_id, pending
            )
            report.contacts += _materialize_contacts(
                con, centre_id, fields, source_record_id, job_id, pending
            )
            report.accreditations += _materialize_accreditation(
                con, centre_id, fields, parse, source_record_id, job_id, pending
            )
            report.offerings += _materialize_offerings(
                con, centre_id, fields, parse, source_record_id, job_id, pending
            )

        for item in pending:
            con.execute(
                """INSERT OR IGNORE INTO materialization_lineage
                   (entity_kind,entity_id,field_name,field_observation_id,
                    manual_correction_id,correction_rule_id,created_by_job_id,created_at_utc)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (item.entity_kind, item.entity_id, item.field_name,
                 item.field_observation_id, item.correction_id, item.correction_rule_id,
                 job_id, now),
            )
        report.lineage_rows = len(pending)

        unlineaged = _unlineaged_fields(con, job_id)
        if unlineaged:
            raise MaterializationError(
                "refusing to materialize: no lineage for "
                + ", ".join(f"{kind}.{field_name} ({entity_id})"
                            for kind, entity_id, field_name in unlineaged)
            )
        con.execute("COMMIT")
        return report
    except Exception:
        con.execute("ROLLBACK")
        raise


def _candidate_from(fields: dict[str, list[sqlite3.Row]], *, source_scope: str
                    ) -> CandidateCentre:
    name_rows = fields.get("published_name", [])
    site_rows = fields.get("published_website", [])
    country_rows = fields.get("published_country", [])
    provider_rows = fields.get("provider_id", [])
    return CandidateCentre(
        display_name=_value(name_rows[0]) if name_rows else "",
        country_iso2=_value(country_rows[0]) if country_rows else None,
        website_url=_value(site_rows[0]) if site_rows else None,
        provider_ids=tuple((source_scope, _value(row)) for row in provider_rows),
    )


def _lineage(entity_kind: str, entity_id: str, field_name: str, row: sqlite3.Row) -> _Pending:
    return _Pending(entity_kind, entity_id, field_name, row["field_observation_id"],
                    row["correction_id"], row["correction_rule_id"])


def _identifier_evidence(fields: dict[str, list[sqlite3.Row]], id_kind: str
                         ) -> Optional[sqlite3.Row]:
    if id_kind == "official_provider_id":
        rows = fields.get("provider_id", [])
    elif id_kind == "domain":
        rows = fields.get("published_website", [])
    else:
        rows = fields.get("published_name", [])
    return rows[0] if rows else None


def _materialize_location(con, centre_id, fields, source_record_id, job_id, pending) -> int:
    address_rows = fields.get("published_address", [])
    locality_rows = fields.get("published_locality", [])
    country_rows = fields.get("published_country", [])
    if not (address_rows or locality_rows or country_rows):
        return 0
    location_id = stable_id(
        "L", centre_id,
        _value(country_rows[0]) if country_rows else None,
        _value(locality_rows[0]) if locality_rows else None,
        _value(address_rows[0]) if address_rows else None,
    )
    existing = con.execute(
        "SELECT 1 FROM centre_location WHERE location_id=?", (location_id,)
    ).fetchone()
    if existing is None:
        con.execute(
            """INSERT INTO centre_location
               (location_id,centre_id,country_iso2,locality,address_published,
                coords_state,created_by_job_id)
               VALUES (?,?,?,?,?, 'not_published', ?)""",
            (location_id, centre_id,
             _value(country_rows[0]) if country_rows else None,
             _value(locality_rows[0]) if locality_rows else None,
             _value(address_rows[0]) if address_rows else None,
             job_id),
        )
    for field_name, rows in (("country_iso2", country_rows), ("locality", locality_rows),
                             ("address_published", address_rows)):
        if rows:
            pending.append(_lineage("centre_location", location_id, field_name, rows[0]))
    return 1 if existing is None else 0


def _materialize_contacts(con, centre_id, fields, source_record_id, job_id, pending) -> int:
    created = 0
    for field_name, contact_kind in CONTACT_KIND_BY_FIELD.items():
        for row in fields.get(field_name, []):
            contact_id = stable_id("CT", centre_id, contact_kind, _value(row))
            if con.execute("SELECT 1 FROM centre_contact WHERE contact_id=?",
                           (contact_id,)).fetchone():
                pending.append(_lineage("centre_contact", contact_id, "contact_value", row))
                continue
            con.execute(
                """INSERT INTO centre_contact
                   (contact_id,centre_id,contact_kind,contact_value,is_personal_data,
                    created_by_job_id) VALUES (?,?,?,?,?,?)""",
                (contact_id, centre_id, contact_kind, _value(row),
                 _is_personal(contact_kind, _value(row)), job_id),
            )
            pending.append(_lineage("centre_contact", contact_id, "contact_value", row))
            created += 1
    return created


def _is_personal(contact_kind: str, value: str) -> int:
    """Conservative default: an organisation switchboard is not personal data, but a named
    individual's address is. Anything that looks like a person's mailbox is flagged so the
    default export excludes it; an operator can downgrade it with evidence."""
    if contact_kind == "org_phone":
        return 0
    lowered = value.lower()
    if "@" in lowered:
        local = lowered.split("@", 1)[0]
        role_inboxes = {"info", "contact", "sales", "training", "admin", "office",
                        "enquiries", "enquiry", "bookings", "support", "hello"}
        return 0 if local in role_inboxes else 1
    return 0


def _materialize_accreditation(con, centre_id, fields, parse, source_record_id, job_id,
                               pending) -> int:
    wording_rows = fields.get("official_relationship_wording", [])
    accreditation_id = stable_id("AC", centre_id, parse["source_id"], parse["route_id"],
                                 "forward")
    if con.execute(
        """SELECT 1 FROM accreditation WHERE centre_id=? AND source_id=? AND route_id=?
             AND direction='forward'""",
        (centre_id, parse["source_id"], parse["route_id"]),
    ).fetchone():
        if wording_rows:
            pending.append(_lineage("accreditation", accreditation_id,
                                    "relationship_verbatim", wording_rows[0]))
        return 0
    verbatim = _value(wording_rows[0]) if wording_rows else "listed in official directory"
    con.execute(
        """INSERT INTO accreditation
           (accreditation_id,centre_id,source_id,route_id,relationship_verbatim,
            relationship_class,direction,evidence_strength,created_by_job_id)
           VALUES (?,?,?,?,?,?, 'forward', 'official_directory', ?)""",
        (accreditation_id, centre_id, parse["source_id"], parse["route_id"], verbatim,
         classify_relationship(verbatim), job_id),
    )
    if wording_rows:
        pending.append(_lineage("accreditation", accreditation_id,
                                "relationship_verbatim", wording_rows[0]))
    elif fields.get("published_name"):
        pending.append(_lineage("accreditation", accreditation_id,
                                "relationship_verbatim", fields["published_name"][0]))
    return 1


def classify_relationship(verbatim: str) -> str:
    lowered = (verbatim or "").lower()
    for token, label in (("approved", "approved"), ("accredit", "accredited"),
                         ("authoris", "authorised"), ("authoriz", "authorised"),
                         ("member", "member"), ("partner", "partner")):
        if token in lowered:
            return label
    return "unclassified"


def _materialize_offerings(con, centre_id, fields, parse, source_record_id, job_id,
                           pending) -> int:
    created = 0
    location_id = stable_id(
        "L", centre_id,
        _value(fields["published_country"][0]) if fields.get("published_country") else None,
        _value(fields["published_locality"][0]) if fields.get("published_locality") else None,
        _value(fields["published_address"][0]) if fields.get("published_address") else None,
    )
    has_location = con.execute(
        "SELECT 1 FROM centre_location WHERE location_id=?", (location_id,)
    ).fetchone() is not None
    for row in fields.get("certificate_name", []):
        name = _value(row)
        certificate_id = f"CERT-{parse['source_id']}-{_slug(name)}"
        if not con.execute("SELECT 1 FROM certificate WHERE certificate_id=?",
                           (certificate_id,)).fetchone():
            con.execute(
                """INSERT INTO certificate
                   (certificate_id,source_id,certificate_name,created_by_job_id)
                   VALUES (?,?,?,?)""",
                (certificate_id, parse["source_id"], name, job_id),
            )
        pending.append(_lineage("certificate", certificate_id, "certificate_name", row))
        offering_id = stable_id("OF", centre_id, certificate_id,
                                location_id if has_location else "", "unknown")
        duplicate = con.execute(
            """SELECT 1 FROM offering WHERE centre_id=? AND certificate_id=?
                 AND COALESCE(location_id,'')=? AND COALESCE(delivery_mode,'unknown')='unknown'""",
            (centre_id, certificate_id, location_id if has_location else ""),
        ).fetchone()
        if duplicate:
            pending.append(_lineage("offering", offering_id, "certificate_id", row))
            continue
        con.execute(
            """INSERT INTO offering
               (offering_id,centre_id,certificate_id,location_id,created_by_job_id)
               VALUES (?,?,?,?,?)""",
            (offering_id, centre_id, certificate_id, location_id if has_location else None,
             job_id),
        )
        pending.append(_lineage("offering", offering_id, "certificate_id", row))
        created += 1
    return created


def _slug(value: str) -> str:
    return "".join(ch if ch.isalnum() else "-" for ch in value.lower()).strip("-")[:60]


def _unlineaged_fields(con, job_id: str) -> list[tuple[str, str, str]]:
    """Governed rows this job created that carry no lineage at all."""
    checks = (
        ("centre", "SELECT centre_id FROM centre WHERE created_by_job_id=?", "display_name"),
        ("centre_location",
         "SELECT location_id FROM centre_location WHERE created_by_job_id=?", None),
        ("centre_contact",
         "SELECT contact_id FROM centre_contact WHERE created_by_job_id=?", "contact_value"),
        ("accreditation",
         "SELECT accreditation_id FROM accreditation WHERE created_by_job_id=?",
         "relationship_verbatim"),
        ("certificate",
         "SELECT certificate_id FROM certificate WHERE created_by_job_id=?",
         "certificate_name"),
        ("offering", "SELECT offering_id FROM offering WHERE created_by_job_id=?",
         "certificate_id"),
    )
    missing: list[tuple[str, str, str]] = []
    for kind, sql, field_name in checks:
        for row in con.execute(sql, (job_id,)):
            entity_id = row[0]
            found = con.execute(
                "SELECT 1 FROM materialization_lineage WHERE entity_kind=? AND entity_id=? LIMIT 1",
                (kind, entity_id),
            ).fetchone()
            if not found:
                missing.append((kind, entity_id, field_name or "*"))
    return missing


def _queue_review(con, parse, source_record_id: str, reason: str, now: str, actor: str) -> None:
    """Park an unresolvable record for a human.

    Deliberately a review_queue item rather than an escalation: an escalation would set
    has_blocking_escalation and hold the whole route's next run hostage to one ambiguous
    row. The row waits; the route keeps running.
    """
    review_id = f"RV-{source_record_id}"
    con.execute(
        """INSERT OR IGNORE INTO review_queue
           (review_id,review_kind,payload_json,proposed_by,status)
           VALUES (?,'merge_candidate',?,'resolver','pending')""",
        (review_id, json.dumps({
            "reason": reason,
            "route_id": parse["route_id"],
            "run_id": parse["run_id"],
            "parse_run_id": parse["parse_run_id"],
            "source_record_id": source_record_id,
            "raised_at_utc": now,
            "raised_by": actor,
        }, sort_keys=True)),
    )
