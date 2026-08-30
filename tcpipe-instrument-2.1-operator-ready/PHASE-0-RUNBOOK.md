# Phase 0 runbook — recover referential integrity

**Mission:** M-000. **Authority:** V3 Part 13, Phase 0.
**Nature:** read-only against production. All work happens in a separate recovery database.
**Absolute rule:** zero governed writes. If a step would write to the governed corpus, stop.

---

## Scope, restated with its reproduction

```
crosswalk       1,770 dangling rows / 1,764 distinct IDs   (checked by verify_pack)
ledger             77 /    77                              (checked by verify_pack)
relationships   2,673 / 1,961                              (NOT checked)
locations       2,237 / 1,961                              (NOT checked)
offerings         233 /    15                              (NOT checked)
────────────────────────────────────────────────
TOTAL           6,990 dangling rows / 2,035 distinct IDs

present in a retained historical master : 1,762
absent from current AND every master    :   273
   reachable via the crosswalk check    :     2  (TC-011072, TC-011073)
   invisible to the crosswalk check     :   271
```

Run `audit_referential_integrity.py` before starting. Do not proceed on a figure
you have not reproduced (Law L5).

---

## Step 1 — Freeze a dedicated snapshot copy

**Do not alter permissions on the live evidence tree.** It is shared with unrelated work
and a broad `chmod -R` or `chattr +i` would disrupt processes that have nothing to do with
this recovery. Freeze a copy instead; the original stays exactly as it is.

1. Copy `current/` and `historical/` to a dedicated snapshot directory,
   `recovery/snapshot-<UTC-timestamp>/`, preserving relative structure and mtimes
   (`cp -a` or `rsync -a`). Do not move, do not hardlink.
2. Compute sha256 of every file **in the source** and every file **in the copy**.
3. Assert they match file-for-file. A mismatch means the copy is not faithful; stop.
4. Write `recovery/snapshot-<ts>/SNAPSHOT-PROVENANCE.json`:

```json
{
  "snapshot_id": "snapshot-2026-08-18T…Z",
  "source_path": "/absolute/path/to/live/pack",
  "copied_at_utc": "…",
  "copy_tool": "rsync -a --version …",
  "file_count": 0,
  "files": { "current/…csv": { "source_sha256": "…", "copy_sha256": "…" } },
  "verified_identical": true
}
```

5. Make **the copy only** read-only (`chmod -R a-w recovery/snapshot-<ts>/`, and
   `chattr +i` on that subtree if available). The live tree is untouched.
6. Publish `sha256(SNAPSHOT-PROVENANCE.json)` in the recovery README. The provenance file
   cannot hash itself; the README closes the chain.

All subsequent steps read from the frozen copy, never from the live tree. Record the
snapshot id on every recovery ledger row so each decision is bound to the exact bytes it
was made against.

**Nothing may be adjudicated before this step completes.**

## Step 2 — Build the recovery ledger

Separate database file, `recovery/recovery.db`. Not the governed database.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE recovery_candidate (
  canonical_id        TEXT PRIMARY KEY,
  first_seen_via      TEXT NOT NULL,         -- crosswalk|ledger|relationships|locations|offerings
  referenced_by_json  TEXT NOT NULL,         -- {"relationships":41,"locations":38,...}
  total_ref_rows      INTEGER NOT NULL,
  present_in_backups  TEXT NOT NULL,         -- JSON array of master filenames, [] if none
  backup_row_json     TEXT,                  -- the full row if exactly one backup version exists
  conflict_count      INTEGER NOT NULL DEFAULT 0,  -- distinct differing versions across backups
  decision            TEXT NOT NULL CHECK (decision IN
                        ('restore_from_backup','remap_to_survivor','reject_references','unresolved')),
  remap_target_id     TEXT,
  snapshot_id         TEXT NOT NULL,        -- the frozen copy this decision was made against

  -- Root cause may be ASSERTED only from direct evidence. Note that
  -- 'pre_window_lineage_break' is deliberately absent from this enum: by definition it
  -- cannot be evidenced from inside the retained window. Absence from every retained
  -- snapshot is a statement about our records, not about when an ID was created.
  root_cause          TEXT NOT NULL DEFAULT 'unknown' CHECK (root_cause IN
                        ('lineage_break_in_window','writer_bug','unknown')),
  root_cause_evidence TEXT,                 -- snapshot path + row, or execution-log reference

  -- Bounded inference is recorded separately and is never promoted to root_cause
  -- without direct evidence.
  root_cause_hypothesis TEXT CHECK (root_cause_hypothesis IS NULL OR root_cause_hypothesis IN
                        ('pre_window_lineage_break','writer_bug','other')),
  hypothesis_basis    TEXT,                 -- what supports it AND what it cannot establish

  evidence            TEXT,                 -- evidence for the DISPOSITION, not the cause
  decided_by          TEXT,
  decided_at          TEXT,
  CHECK ((decision = 'remap_to_survivor') = (remap_target_id IS NOT NULL)),
  CHECK (decision = 'unresolved' OR evidence IS NOT NULL),
  CHECK ((root_cause = 'unknown') OR (root_cause_evidence IS NOT NULL)),
  CHECK ((root_cause_hypothesis IS NULL) = (hypothesis_basis IS NULL))
) STRICT;

CREATE TABLE lineage_event (
  event_id            TEXT PRIMARY KEY,
  observed_at_utc     TEXT NOT NULL,
  snapshot_path       TEXT NOT NULL,
  ids_before          INTEGER NOT NULL,
  ids_after           INTEGER NOT NULL,
  delta               INTEGER NOT NULL,
  is_exact_subset     INTEGER NOT NULL CHECK (is_exact_subset IN (0,1)),
  decision            TEXT NOT NULL CHECK (decision IN
                        ('accepted_intentional','defect_to_reverse','unexplained')),
  notes               TEXT
) STRICT;

CREATE TABLE ledger_status_change (
  change_id           TEXT PRIMARY KEY,
  from_status         TEXT NOT NULL,
  to_status           TEXT NOT NULL,
  row_count           INTEGER NOT NULL,
  explanation         TEXT,
  disposition         TEXT NOT NULL CHECK (disposition IN ('explained','to_reverse','unexplained'))
) STRICT;
```

Populate `recovery_candidate` with all 2,035. One row each. No exceptions, no sampling.

## Step 3 — Adjudicate

For each candidate, in this order:

1. **Present in exactly one backup, no conflict** → `restore_from_backup`. Evidence: backup filename + row hash.
2. **Present in multiple backups with differing content** → resolve the conflict first.
   Record `conflict_count`. Prefer the version whose `updated_at` is latest *and* whose
   source ids are a superset. If neither dominates → `unresolved`, escalate.
3. **Absent from all backups, but a plausible survivor exists** (same registrable domain,
   same official provider id, or same normalized name + country) → `remap_to_survivor`
   with the target id and the matching basis in `evidence`.
4. **Absent from all backups, no survivor** → `reject_references`. The referencing rows in
   relationships/locations/offerings are deleted in the *rebuilt* corpus, and each deletion
   is itself logged. Evidence must state why no survivor exists.

**The 271:** these appear in no master at all, so they are not restorable by definition.
Each needs case 3 or case 4.

**Their root cause is `unknown` and MUST stay `unknown` unless direct evidence changes it.**
Direct evidence means a snapshot containing the ID, or an execution log showing the write
that created or removed it. Nothing else qualifies.

In particular: **numeric position is not evidence.** An ID sorting below or above some
presumed minted range says nothing about when or why it was created. Sequence allocation is
not guaranteed monotonic across importers, IDs can be reserved and used later, and gaps can
be created by rollbacks. Inferring `pre_window_lineage_break` from an ID number converts an
absence in our records into a claim about history, which is exactly the class of false
finding this recovery exists to remove.

If a pattern is worth recording, record it as a **bounded inference**:

```
root_cause            = 'unknown'
root_cause_hypothesis = 'pre_window_lineage_break'
hypothesis_basis      = 'Absent from all 169 retained snapshots (window opens
                         2026-08-13T00:26 at 10,666 ids) and from all three shipped
                         historical masters. This establishes only that the ID is not in
                         any record we retain. It does NOT establish when the ID was
                         created, whether it ever existed in a master, or that a
                         pre-window event occurred. No pre-2026-08-13 snapshot survives
                         to test the hypothesis against.'
```

Disposition does not depend on root cause. You can correctly decide `remap_to_survivor` or
`reject_references` for an ID whose origin is unknown — the referencing rows are broken
either way. Unknown cause does not block the GO gate; a fabricated cause would corrupt the
record permanently.

**TC-011072 and TC-011073:** no attribution is established by the evidence pack. Do not
label them. They stay `unresolved` until evidence exists, or take case 4 with an evidence
statement that says explicitly that origin is unknown.

## Step 4 — Lineage register

Record all four decreasing transitions in `lineage_event`:

| observed_at | before → after | delta | snapshot |
|---|---|---:|---|
| 2026-08-15T04:07 | 10,782 → 9,016 | −1,766 | marina-stcw-batch6 |
| 2026-08-14T14:01 | 10,832 → 10,666 | −166 | confirmed-new-reconciliation |
| 2026-08-14T19:54 | 10,768 → 10,738 | −30 | user-import-apec-antwerp |
| 2026-08-13T08:52 | 10,748 → 10,741 | −7 | confirmed-user-import-official-batch |

State the window limit in `notes`: the register opens 2026-08-13 at 10,666, so the
10,878 → 10,666 transition implied by the 08-03 release manifest lies outside it.

## Step 5 — Ledger status change

Record the 75 `confirmed_new` → `existing` transition in `ledger_status_change` with a
disposition. `unexplained` is a valid disposition only if it blocks the gate — which it does.

## Step 6 — Rebuild and verify

1. Apply decisions to a working copy derived from the frozen snapshot. The frozen snapshot
   and the live tree both stay untouched.
2. Re-run `audit_referential_integrity.py` against the rebuilt copy across all five tables.
   Required result: zero dangling.
3. Re-run the three counter invariants (`relationship_count`, `location_count`,
   `association_count`). Required result: zero disagreements.
4. Hash the rebuilt corpus; write `POST-RECOVERY-MANIFEST.json`.

## Step 7 — Independent verification

A second agent that did not build the ledger:

- runs `audit_referential_integrity.py` itself against both the frozen original and the
  rebuilt copy;
- confirms the pre-recovery manifest hashes still match the frozen tree;
- confirms `recovery_candidate` has 2,035 rows and zero at `unresolved`;
- publishes its reproduction command and its own output hash (Law L5).

It MUST NOT accept any figure from this runbook without recomputing it.

---

## GO gate

All eleven criteria in V3 Part 13 Phase 0, as amended in V3 v1.1: criterion 4 requires a
**disposition plus a root-cause record**, where `unknown` with a bounded, labelled
hypothesis is a complete and acceptable answer. An asserted cause without direct evidence
is a FAIL, not a pass. NO-GO on any single failure.
On GO, Phase 1 may begin on an isolated database. Production writes stay paused
until the Phase 1 gate also passes.

## Attestation required at close

> No governed write occurred during Phase 0 outside `recovery/`.
> The live evidence tree was read only and its permissions were not altered.
> Snapshot id: `<snapshot-2026-…Z>`, provenance hash `<sha256>`, verified_identical true.
> Post-recovery manifest hash: `<sha256>`.
> Independent verifier: `<id>`, reproduction output hash `<sha256>`.
> Root causes asserted: `<n>` (all with direct evidence). Recorded as unknown: `<n>`.
