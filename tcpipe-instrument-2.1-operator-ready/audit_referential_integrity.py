#!/usr/bin/env python3
"""
Referential-integrity audit across ALL tables referencing canonical_training_centre_id.

Authority: V3-NORMATIVE-SPECIFICATION.md Law L5. This is the reproduction artifact:
two agents on two machines run it and compare `findings_hash`.

findings_hash covers the CANONICAL COMPLETE FINDING SET — every (table, row_ordinal,
field, missing_id) tuple, sorted, serialized as NDJSON. Equal findings_hash therefore
means the two runs disagree about nothing. (v1.0 hashed a summary plus a 20-ID sample,
so equal hashes did NOT imply equal findings. That defect is fixed here.)

Absent or malformed required input is FATAL. A pack missing its files must not be able
to exit clean.

Read-only. Writes nothing except the optional dump files.

  python3 audit_referential_integrity.py <pack-root>
        [--json report.json] [--findings findings.ndjson] [--allow-missing TABLE,...]

Exit codes:  0 clean · 1 dangling references found · 2 input/usage error (FATAL)
"""
import argparse, csv, glob, hashlib, io, json, os, sys

TOOL_VERSION = "2.1.0"

REFERENCES = [
    ("crosswalk",     "current/canonical-training-centre-source-crosswalk.csv", "canonical_training_centre_id"),
    ("ledger",        "current/authoritative-candidate-ledger.csv",             "canonical_match_id"),
    ("relationships", "current/association-training-centre-relationships.csv",  "training_centre_id"),
    ("locations",     "current/training-centre-locations.csv",                  "training_centre_id"),
    ("offerings",     "current/training-centre-certificate-offerings.csv",      "training_centre_id"),
]
MASTER, MASTER_KEY = "current/canonical-training-centre-master.csv", "canonical_training_centre_id"
HISTORICAL_GLOB = "historical/*canonical-training-centre-master.csv"

# All THREE counters required by V3. `list_len` counts ';'-delimited members of a column
# on the master itself; `row_count` counts referencing rows in another table.
COUNTERS = [
    ("relationship_count", "row_count", "current/association-training-centre-relationships.csv", "training_centre_id"),
    ("location_count",     "row_count", "current/training-centre-locations.csv",                 "training_centre_id"),
    ("association_count",  "list_len",  None,                                                    "association_ids"),
]


class FatalInput(Exception):
    pass


def read_rows(path, required_fields):
    if not os.path.exists(path):
        raise FatalInput(f"required file missing: {path}")
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            rdr = csv.DictReader(fh)
            if rdr.fieldnames is None:
                raise FatalInput(f"file has no header row: {path}")
            for f in required_fields:
                if f not in rdr.fieldnames:
                    raise FatalInput(f"required column {f!r} absent from {path}; "
                                     f"columns are {rdr.fieldnames}")
            return list(rdr)
    except UnicodeDecodeError as e:
        raise FatalInput(f"cannot decode {path}: {e}") from None
    except csv.Error as e:
        raise FatalInput(f"malformed CSV {path}: {e}") from None
    except OSError as e:
        raise FatalInput(f"cannot read {path}: {e}") from None


def canonical_findings_ndjson(findings):
    """Deterministic serialization of the COMPLETE finding set."""
    buf = io.StringIO()
    for f in sorted(findings, key=lambda d: (d["table"], d["row_ordinal"], d["field"], d["missing_id"])):
        buf.write(json.dumps(f, sort_keys=True, separators=(",", ":")) + "\n")
    return buf.getvalue()


def main(argv):
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("root")
    ap.add_argument("--json")
    ap.add_argument("--findings")
    ap.add_argument("--allow-missing", default="",
                    help="comma-separated table names permitted to be absent; each must be "
                         "declared explicitly and is recorded in the report")
    a = ap.parse_args(argv)
    allow = {x.strip() for x in a.allow_missing.split(",") if x.strip()}
    known_tables = {name for name, _, _ in REFERENCES}
    unknown_allow = sorted(allow - known_tables)
    if unknown_allow:
        raise FatalInput(f"unknown --allow-missing table name(s): {unknown_allow}")
    P = lambda rel: os.path.join(a.root, rel)

    if not os.path.isdir(a.root):
        raise FatalInput(f"pack root is not a directory: {a.root}")

    master_rows = read_rows(P(MASTER), [MASTER_KEY])
    master_ids = [r[MASTER_KEY] for r in master_rows]
    blank_master_ids = sum(not value.strip() for value in master_ids)
    canonical = {value for value in master_ids if value.strip()}
    if not canonical:
        raise FatalInput(f"{MASTER} contains zero canonical IDs; refusing to audit")

    findings, tables, union = [], {}, set()
    for name, rel, field in REFERENCES:
        p = P(rel)
        if not os.path.exists(p):
            if name not in allow:
                raise FatalInput(
                    f"required reference table {name!r} missing at {p}. "
                    f"Pass --allow-missing {name} to declare this deliberately. "
                    f"An audit cannot report clean over inputs it never read.")
            tables[name] = {"status": "absent_declared"}
            continue
        rows = read_rows(p, [field])
        n_ref = 0
        for i, r in enumerate(rows):
            v = r.get(field)
            if not v:
                continue
            n_ref += 1
            if v not in canonical:
                findings.append({"table": name, "row_ordinal": i, "field": field, "missing_id": v})
                union.add(v)
        dangling = [f for f in findings if f["table"] == name]
        tables[name] = {"status": "checked", "rows_total": len(rows),
                        "rows_with_reference": n_ref, "dangling_rows": len(dangling),
                        "distinct_missing_ids": len({f["missing_id"] for f in dangling})}

    # ── counters: malformed values are ERRORS, not skips ──────────────────
    counters, header = {}, (master_rows[0].keys() if master_rows else [])
    for cname, kind, rel, field in COUNTERS:
        if cname not in header:
            raise FatalInput(f"required counter column {cname!r} absent from {MASTER}")
        actual = {}
        if kind == "row_count":
            p = P(rel)
            if not os.path.exists(p):
                counters[cname] = {"status": "reference_table_absent"}
                continue
            for r in read_rows(p, [field]):
                v = r.get(field)
                if v:
                    actual[v] = actual.get(v, 0) + 1
        bad, malformed = 0, 0
        for r in master_rows:
            raw = (r.get(cname) or "").strip()
            try:
                stated = int(raw) if raw else 0
            except ValueError:
                malformed += 1
                continue
            if kind == "row_count":
                real = actual.get(r[MASTER_KEY], 0)
            else:
                real = len([x for x in (r.get(field) or "").split(";") if x.strip()])
            if stated != real:
                bad += 1
        counters[cname] = {"status": "checked", "disagreeing_rows": bad,
                           "malformed_values": malformed, "of": len(master_rows)}

    # ── recoverability from retained historical masters ───────────────────
    hist, hist_files = set(), sorted(glob.glob(P(HISTORICAL_GLOB)))
    for p in hist_files:
        hist |= {r[MASTER_KEY] for r in read_rows(p, [MASTER_KEY])}

    xw_visible = {f["missing_id"] for f in findings if f["table"] in ("crosswalk", "ledger")}
    findings_ndjson = canonical_findings_ndjson(findings)

    counter_error_count = sum(
        value.get("disagreeing_rows", 0) + value.get("malformed_values", 0)
        for value in counters.values()
    )
    duplicate_master_ids = len(master_ids) - len(set(master_ids))
    report = {
        "tool_version": TOOL_VERSION,
        "master_rows": len(master_rows),
        "master_unique_ids": len(canonical),
        "master_duplicate_ids": duplicate_master_ids,
        "master_blank_ids": blank_master_ids,
        "tables": tables,
        "counters": counters,
        "total_dangling_rows": len(findings),
        "union_missing_ids": len(union),
        "historical_masters_read": [os.path.basename(p) for p in hist_files],
        "recoverable_from_historical": len(union & hist) if hist_files else None,
        "unrecoverable": len(union - hist) if hist_files else None,
        "missing_invisible_to_crosswalk_check": len(union - xw_visible),
        "findings_hash": hashlib.sha256(findings_ndjson.encode()).hexdigest(),
        "findings_count": len(findings),
        "counter_error_count": counter_error_count,
        "integrity_error_count": (
            len(findings) + counter_error_count + duplicate_master_ids + blank_master_ids
        ),
    }
    report["summary_hash"] = hashlib.sha256(
        json.dumps({k: v for k, v in report.items() if k != "summary_hash"},
                   sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    print(json.dumps(report, indent=2, sort_keys=True))
    if a.json:
        open(a.json, "w", encoding="utf-8").write(json.dumps(report, indent=2, sort_keys=True))
    if a.findings:
        open(a.findings, "w", encoding="utf-8").write(findings_ndjson)
    return 1 if report["integrity_error_count"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except FatalInput as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(2)
