# Addendum 2.0 — review adjudication and restructure

**Verdict: the review is correct on every technical finding. I verified each against my own
files rather than accepting them.** The strategic framing is the most valuable part and I
accept it: this became a governance specification rather than a parsing instrument, and
"specification-quality, not implementation-ready" is accurate.

Two refinements added at the end. Everything else is accepted as written.

---

## 1. Findings — all confirmed

| # | Finding | Status |
|---|---|---|
| 1 | No executable denominator; 277-body / 96-route universe not shipped | **Confirmed.** Coverage is unstateable without it |
| 2 | Phase 0 need not block an isolated parser pilot; OSHA-only is too narrow | **Confirmed** |
| 3 | Audit utility unsafe as a gate | **Confirmed — fixed, see §2** |
| 4 | Schema doesn't enforce headline controls; no `job_queue` table exists | **Confirmed.** V3 S10 requires `job_queue`; I never created it |
| 5 | Observation model too coarse for field-level provenance | **Confirmed — the most important change** |
| 6 | No run boundary; one artifact per attempt contradicts T2 | **Confirmed.** V3 5.3 requires DOM *and* screenshot; schema allows one |
| 7 | Terminal-state function defects | **Confirmed, all five** |
| 8 | Adapter schema doesn't enforce its own stated requirements | **Confirmed** |

### Notes on the sharpest ones

**#3 — the `result_hash` defect was an L5 violation inside the L5 enforcement artifact.**
It hashed summary counts plus a 20-ID sample. Two agents could match hashes while
disagreeing about which IDs are missing — precisely the failure the tool existed to prevent.

**#5 — the observation model is internally incoherent, not merely coarse.**
`adapter-rules.schema.json` permits `certificate_name` and `price_text` as field names.
The `observation` table has no column for either. Two files in the same bundle disagree
about what an observation is.

**#7 — the parenthesization bug is real.** As written,
`(exhaustive…) OR (sampled…) AND no-field-block AND fixture` parses as
`A OR (B AND C AND D)`, so the exhaustive branch bypasses field-health and fixture checks.
Also confirmed: `derived_from_category_text` has no completion path (which silently strands
Estonia at `unresolved`), `blocked_paywall` is unreachable, and `second_source_corroboration`
is used but never defined.

---

## 2. Audit utility — fixed and tested (v2.0.0)

Changes:

- **Absent or malformed required input is FATAL (exit 2).** A pack missing its files can no
  longer exit clean. Deliberate omissions require explicit `--allow-missing TABLE`, recorded
  in the report.
- **`association_count` added.** All three counters now checked; it uses list-length
  semantics against `association_ids` rather than a row count.
- **Malformed counter values are counted (`malformed_values`), not skipped.**
- **`findings_hash` covers the canonical complete finding set** — every
  `(table, row_ordinal, field, missing_id)` tuple, sorted, NDJSON, hashed. `summary_hash`
  is separate. `--findings out.ndjson` dumps the full set for diffing.
- Header/column validation; `csv.Error` and `UnicodeDecodeError` are fatal.
- Exit codes: `0` clean · `1` dangling found · `2` fatal input error.

### Test results

```
1. real V2 pack   6,990 rows / 2,035 ids / 1,762 recoverable / 273 unrecoverable
                  / 271 invisible · findings_count 6,990 · exit 1
                  counters: relationship 299 · location 320 · association 215 · malformed 0
2. missing table  exit 2, FATAL with the remediation flag named
3. determinism    two runs, identical findings_hash
4. REGRESSION     swapped ONE reference between two missing IDs:
                  totals identical (6,990 / 2,035) — findings_hash DIFFERENT
                  bd8d706f… vs 829cb5c5…
                  Under v1.0 these would have matched. That was the defect.
```

Expected `findings_hash` on the unmodified V2 pack:
`bd8d706fa67b7b38f3c5e249dbe0a3496e220466ded85f08fd8cc91f4cefeba9`

---

## 3. Data model — the change that matters

Replace the flat observation with three levels:

```
parse_run          one adapter version × one artifact set × one route, at one time
  └── source_record    one row as published by the source
        └── field_observation
              field_name, raw_value, normalized_value,
              artifact_sha256, record_locator, evidence_quote,
              normalization_state, validation_flags
```

Governed `centre`, `centre_location`, `centre_contact`, `offering`, `price_observation`
become **materializations of accepted field observations**, not primary writes.

Consequences that fall out for free: multiple phones and locations per centre; multiple
certificates; per-field locators; per-field normalization failure; a field's provenance
survives even when its parent record is later merged.

Plus the run boundary:

```
fetch_attempt_artifact(attempt_id, artifact_sha256, role)   -- role: dom|screenshot|pdf|json
route_run(run_id, route_id, adapter_id, adapter_version,
          attempt_ids, extracted_count, structural_count, container_resolved,
          variance_status, audit_result, disposition, is_current)
```

`route.route_state` becomes a projection over the **current** `route_run`, not a stored
fact. That resolves #6 and #7 together — the terminal-state function becomes a tested pure
function of one explicit run.

---

## 4. Restructure — two parallel tracks

Phase 0 blocks **merging into production**. It does not block learning to parse.

```
TRACK A — legacy integrity          TRACK B — parsing capability
  snapshot + provenance               isolated artifact store + isolated DB
  recovery ledger (2,035)             five-archetype pilot
  adjudication                        field-level provenance model
  independent verification            adapter fixtures + drift + version-diff replay
            │                                     │
            └──────────► PRODUCTION MATERIALIZATION ◄──────────┘
                         opens only when BOTH pass
```

**Pilot matrix — five archetypes, not one route.** Prefer official downloads and structured
data over interactive interfaces wherever both exist:

| Archetype | Candidate |
|---|---|
| Official download / dataset | GWO provider list export |
| Structured HTML or API | OSHA course schedule |
| Paginated HTML | a national STCW directory with pagination |
| PDF table | IALA VTS accredited organisations PDF |
| Client-rendered | OPITO centre network — **last resort**, only if no export exists |

**Source usage policy moves to now, not Phase 8.** Add to `source`: `terms_url`,
`license_basis`, `allowed_purpose`, `robots_snapshot_sha`, `retention_period`,
`last_legal_review`. Permissions differ per source — some reserve copyright while permitting
conditional reuse — and that determines what may be stored and republished. It must be
recorded before the first fetch, not audited after thousands.

**Execution order** — as the review specifies:

1. Fix and independently test the Phase 0 audit ✔ (this addendum)
2. Establish the versioned source/route denominator
3. Redesign observations around parse runs, source records, field-level provenance
4. Add job queue, mission registry, writer boundary, executable schema invariants
5. Five-archetype isolated pilot, parallel with Track A
6. Adapter fixtures, drift detection, version-diff replay
7. Operational automation only after the parsing loop is proven
8. Blob, LLM proxy, session rotation, root watchdog only when recurring intervention
   or continuous multi-agent operation justifies them

---

## 5. Two refinements

**R1 — Route count is the wrong denominator on its own.** Routes are wildly unequal: GWO is
~652 centres, Ireland's SAT route is 1. A route-count coverage figure over-weights trivial
routes and will read as progress while the large ones stall. Report the primary metric
**twice**:

```
route coverage   = fresh verified eligible routes / total eligible routes
volume coverage  = expected records on fresh verified routes / total expected records
```

`expected_records` comes from `published_count` where published, and a recorded estimate with
its basis where not. Divergence between the two figures is itself the signal — it says the
instrument is harvesting the easy tail.

**R2 — Politeness stays in the "keep now" bucket.** The review is right to defer the blob,
LLM proxy, session rotation and root watchdog. I'd move one item back: per-host rate
limiting, `robots.txt` honouring, conditional requests and the circuit breaker. Not for
governance reasons — because getting a source to block us is the main thing that stalls the
parsing track, and a five-archetype pilot with real fetching is exactly when it happens.
It is roughly 150 lines and it protects the pilot it runs during. Everything else in Part 2
of V3 defers as the review says.

---

## 6. What this addendum supersedes

- `audit_referential_integrity.py` → v2.0.0, in this bundle.
- V3 Parts 4, 7, 12 (data model, observation contract, terminal state) are **suspended**
  pending the field-provenance redesign. Do not implement against them.
- V3 Part 13 phase sequencing → replaced by the two-track structure in §4.
- V3 Parts 1, 5 (laws, fetch politeness) and the A1–A3 amendments stand unchanged.
- `MISSIONS.md` M-000 and M-001 need rewriting against the two-track structure before work
  starts.
