# Bundle 1.1 — amendments

Three operator amendments, all accepted. Two corrected defects I introduced; the third
converts a documented requirement into an enforced one.

---

## A1 — Root cause requires evidence. Numeric position is not evidence.

**Defect.** The Phase 0 runbook instructed: *"Ids that never appear in any snapshot inside
the window and are numerically below the window's minted range are `pre_window_lineage_break`."*
That is a heuristic wearing the clothes of a finding — the exact failure mode this recovery
exists to remove. Sequence allocation is not guaranteed monotonic across importers, IDs can
be reserved and used later, and rollbacks create gaps. Absence from our records is a
statement about our records, not about history.

**Change.**
- `pre_window_lineage_break` **removed from the assertable `root_cause` enum entirely.**
  By definition it cannot be evidenced from inside the retained window — no pre-2026-08-13
  snapshot survives to test it against.
- `root_cause` now defaults to `'unknown'`, and a CHECK constraint requires
  `root_cause_evidence` (a snapshot containing the ID, or an execution log showing the write)
  for any other value.
- Bounded inference gets its own fields: `root_cause_hypothesis` + `hypothesis_basis`, with a
  CHECK that they are set together. The basis must state what it does **not** establish.
- Runbook now carries a worked example of a correctly-bounded hypothesis.
- **Disposition is decoupled from cause.** `remap_to_survivor` and `reject_references` are
  correct decisions for an ID whose origin is unknown — the references are broken either way.
  Unknown cause does not block the GO gate. A fabricated cause would corrupt the record
  permanently, so V3 Phase 0 criterion 4 now makes an unevidenced assertion a **FAIL**.

## A2 — Freeze a copy, not the shared tree

**Defect.** The runbook said to `chmod -R a-w` and `chattr +i` the whole evidence tree. That
tree is shared with unrelated work; freezing it in place would disrupt processes that have
nothing to do with this recovery.

**Change.** Copy to `recovery/snapshot-<UTC-ts>/` with `cp -a`/`rsync -a`; hash every file in
**both** source and copy; assert file-for-file identity; write `SNAPSHOT-PROVENANCE.json`
recording source path, copy time, tool, and both hash sets plus `verified_identical`; make
**only the copy** read-only. The live tree is never touched. Every `recovery_candidate` row
now carries `snapshot_id`, binding each decision to the exact bytes it was made against.

## A3 — Foreign keys are per-connection, and that is now a control

**Clarification, correctly made.** `PRAGMA foreign_keys` does not persist in the database
file and resets to OFF on every new connection. Applying `schema.sql` once enables it only
for the applying connection. The prior bundle noted this in a header comment — which under
Law L3 means it would eventually be forgotten.

**Change.**
- `schema.sql` header now carries an explicit persistence table: `journal_mode=WAL`, `STRICT`
  and CHECK/FK clauses persist; `foreign_keys` does not.
- New file `assert_db_preconditions.py` provides `open_db()` as the only sanctioned way to
  connect. It sets `foreign_keys`, asserts it returns 1, verifies `journal_mode`, runs
  `foreign_key_check`, and raises rather than returning a connection that would let
  violations pass.
- V3 standing rule 15: a raw `sqlite3.connect` in application code is a build failure.

**Self-test output, demonstrating the hazard is real:**

```
fresh connection PRAGMA foreign_keys = 0   <-- OFF by default, silently
orphan insert on a raw connection: SUCCEEDED (this is the hazard)
open_db(): refused — foreign_key_check reports 1 existing violation(s)…
open_db() on clean db: PRAGMA foreign_keys = 1
orphan insert through open_db(): rejected ✓
```

---

## Files changed

| File | Change |
|---|---|
| `PHASE-0-RUNBOOK.md` | Step 1 rewritten (snapshot copy + dual-hash provenance); recovery ledger DDL gains `snapshot_id`, `root_cause_evidence`, `root_cause_hypothesis`, `hypothesis_basis` and three CHECKs; Step 3's 271-ID rule replaced; Step 6 and the attestation updated |
| `V3-NORMATIVE-SPECIFICATION.md` | → v1.1. Part 4 pragma persistence; Part 13 criteria 1 and 4; change log rows A1–A3; standing rules 15–17 |
| `schema.sql` | Header persistence table and per-connection warning |
| `assert_db_preconditions.py` | **New.** Enforces A3 |
| `HANDOFF-MANIFEST.json` | Regenerated |

## Unchanged and still true

The audit figures are untouched by these amendments and still reproduce exactly:
6,990 dangling rows / 2,035 distinct IDs / 1,762 recoverable / 273 unrecoverable /
271 invisible to the crosswalk check.
`audit_referential_integrity.py` `result_hash` on the unmodified V2 pack remains
`ac3769af168a6b4b42773420b684ae1102c1c8b41331328687e5e17a7da7dce1`.
