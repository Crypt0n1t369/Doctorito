# Corrections 2.1.1 — six defects found by auditing claims against behaviour

Bundle 2.1.0 packaged honestly: the manifest matched the tree exactly (43/43 files), the
seeds validated and all 34 tests passed. The defects below were therefore not packaging
gaps. They were places where a documented guarantee was **weaker in the code than in the
prose** — the enforcement existed, but did not cover the case the sentence promised.

Each was demonstrated against a live database before being changed, and each now has a
regression test. Schema and calculator versions move to `2.1.1` because both the stored
contract and the replay decision function changed.

## C1 — Freshness was aged from finalization, not from the fetch (highest impact)

`00-README-HANDOFF.md` claimed "fetch-derived freshness with automatic stale demotion from
coverage after two refetch windows". The **writer** did derive freshness from
`max(fetch_attempt.requested_at_utc)`, but both operational views aged the run from
`route_run.finished_at_utc`.

Those timestamps diverge whenever a run is finalized later than its fetch — replay from
stored artifacts, backfill, a slow queue — which is exactly the pilot's intended mode.
The gap granted the content a second freshness window measured from finalization.

Demonstrated: a route with `refetch_days=30` (a 60-day window), content fetched 119 days
ago, run finalized 59 days ago, reported `complete_reconciled` by `v_route_current_status`
and counted as fresh in `v_universe_coverage` — roughly four refetch windows of drift
inside a state the documentation described as fresh.

Fixed in `schema.sql`: both views now join a `run_content_fetch` CTE and age the run from
the latest linked fetch. A run with no linked fetch has no freshness evidence and is
demoted. `v_route_current_status` now exposes `content_fetched_at_utc` so an operator can
see the timestamp the decision used.

## C2 — A blocked run counted as evidence of emptiness

The claim was "empty completion requires a prior empty run at least 24 hours earlier plus
deterministic evidence". The writer's `prior_empty` probe accepted any completed run on the
route with `extracted_count=0 AND structural_count=0 AND container_resolved=1`.

A run with `access_status='blocked_access'` never fetches and never parses — the writer
skips those checks entirely for non-`ok` access — yet it satisfied that predicate. Absence
of access became evidence of absence of rows.

Demonstrated: a blocked run, then a genuine empty parse three days later, produced
`verified_empty`.

Fixed in `writer.py`: the prior run must be an actual observation — `access_status='ok'`
(which is what forces it through the parse/fetch checks), `freshness_state='fresh'`,
`field_health_blocked=0`, `passing_fixture_count>=1`, and no published count claiming rows
exist. A test confirms the legitimate two-run path still reaches `verified_empty`, so the
state has not been made unreachable.

## C3 — The sampled-audit gate contained a tautology

`verification_passed` tested `audit_error_count <= audit_sampled_count`. Both the
`route_run` and `audit_sample` CHECK constraints already guarantee that, so the term
constrained nothing while reading like a guard. The only real gate was
`accuracy_lower_cp >= 0.95`, a number supplied by the auditor and never cross-checked.

Demonstrated: 10 of 10 sampled rows recorded as errors, with a stored
`accuracy_lower_cp` of 0.99, passed verification and completed.

Fixed in `terminal_state.py` and `schema.sql`: the stored bound must not exceed the
accuracy actually observed in the sample (a lower confidence bound never exceeds its own
point estimate). Enforced both in the calculator and as a CHECK on `audit_sample`, so an
incoherent audit row cannot be stored in the first place.

## C4 — Unrecognised enumerated inputs fell through to completion

`calculate_terminal_state` raised `ValueError` on an unknown `count_quality` but silently
ignored an unknown `access_status`, falling past every access check into the ordinary
completion path. The schema constrains that column today, so this was not reachable through
the writer — but the calculator is documented as the pure, independently testable replay
authority, and its failure mode was to be permissive.

Demonstrated: `access_status='totally_bogus'` returned `complete_count_unpublished`.

Fixed: all six enumerated inputs are validated up front and a value the calculator does not
understand is now an error rather than a verdict.

## C5 — Artifact re-registration ignored a conflicting content type

`register_artifact` used `INSERT OR IGNORE` and then verified `byte_len` and
`storage_path`, but not `content_type`. Re-registering a digest with a different content
type silently kept the first value and reported success, against a table declared
immutable.

Fixed: `content_type` is now part of the conflict check. Note this is deliberately strict —
identical bytes served under two declared content types now raise `WriterConflict` rather
than resolving silently, consistent with how the bundle treats every other disagreement.

## C6 — Coverage hid how much of its own denominator was unknown

`universe_route.expected_records` is nullable, and `FOUNDATION-2.1.md` requires that "null
expected counts are visible". `v_universe_coverage` summed straight past the NULLs, so
`volume_coverage` could be computed against a denominator describing one of four eligible
routes with nothing in the output revealing it.

Fixed: the view now reports `eligible_routes_with_expected_records` and
`eligible_routes_missing_expected_records` alongside the ratio.

## What was checked and found sound

Not everything suspected turned out to be a defect. The following were probed and hold:
the manifest/tree correspondence; the 304 reused-body chain (it cannot cycle, and must
bottom out at a real body); `artifact_set_hash` canonical encoding; the append-only and
freeze triggers; `corroboration_state` and `empty_verification_evidence` enumerations,
which contain no LLM-derived value, so an oracle genuinely cannot establish emptiness;
`centre_contact.is_personal_data` being `NOT NULL`, so the default contact export cannot
leak through a NULL; and `audit_referential_integrity.py`, whose fatal-input handling and
complete finding-set hashing are correct. That script is unchanged, and its pinned
findings hash on the V2 pack is unaffected.
