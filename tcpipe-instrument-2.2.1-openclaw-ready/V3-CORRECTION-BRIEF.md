# Correction brief for V3 — adjudication of the independent review

**Verdict on the review: 9 of 11 items accepted in full, 1 accepted with amendment, 1 rejected with evidence.**

It is a strong review. Items 2–5 and 7–11 found real defects in my drafts, several of which would have shipped contradictory logic. Item 6 is directionally right and overshoots in one respect. Item 1 is wrong in a way that matters more than the other ten combined, because accepting it silently removes 271 broken IDs from the recovery scope.

The reviewer's process recommendation — review first, no governed writes, isolated non-writing prototype only — is correct and I endorse it without qualification.

---

## Item 1 — REJECTED, with reproduction

> *"Reconcile Phase 0's unsupported 2,035 figure with verified V2: 1,764 missing crosswalk targets = 1,762 recoverable + 2 MARINA reconstructions."*

The 2,035 is not unsupported. It is computed, and it is reproducible in ten seconds from the V2 pack itself. The reviewer has treated the V2 pack's own headline as ground truth — which is precisely the assumption the review existed to test.

`verify_pack.py` checks two of five tables that reference `canonical_training_centre_id`. Run the same check across all five:

```
table              rows  dangling rows  distinct missing
crosswalk         11654           1770              1764   ← checked by V2
ledger              188             77                77   ← checked by V2
relationships     12706           2673              1961   ← NOT CHECKED
locations         12262           2237              1961   ← NOT CHECKED
offerings          8473            233                15   ← NOT CHECKED

TOTAL dangling rows           : 6990
UNION of distinct missing IDs : 2035
V2 pack reports               : 1847 rows / 1764 IDs

Recoverable from shipped historical masters : 1762
NOT present in current or ANY shipped master: 273
  reachable via the crosswalk check         : 2   -> TC-011072, TC-011073
  INVISIBLE to the V2 checks                : 271
```

Reproduction — run from the V2 pack root, no dependencies:

```python
import csv, glob
def col(p,f):
    with open(p,newline='',encoding='utf-8-sig') as fh:
        return [r[f] for r in csv.DictReader(fh) if r.get(f)]
cur = set(col('current/canonical-training-centre-master.csv','canonical_training_centre_id'))
refs = {
 'crosswalk':    ('current/canonical-training-centre-source-crosswalk.csv','canonical_training_centre_id'),
 'ledger':       ('current/authoritative-candidate-ledger.csv','canonical_match_id'),
 'relationships':('current/association-training-centre-relationships.csv','training_centre_id'),
 'locations':    ('current/training-centre-locations.csv','training_centre_id'),
 'offerings':    ('current/training-centre-certificate-offerings.csv','training_centre_id'),
}
union=set()
for name,(p,f) in refs.items():
    miss=[x for x in col(p,f) if x not in cur]; union |= set(miss)
    print(f'{name:<15}{len(miss):>7} dangling rows, {len(set(miss)):>5} distinct')
hist=set()
for p in glob.glob('historical/*canonical-training-centre-master.csv'):
    hist |= set(col(p,'canonical_training_centre_id'))
print('UNION distinct missing:', len(union), '| unrecoverable:', len(union-hist))
```

Two further corrections to the item as written:

- **"2 MARINA reconstructions" is an invented attribution.** The two unrecoverable crosswalk IDs are `TC-011072` and `TC-011073`. Nothing in the V2 pack ties them to MARINA. They must enter the recovery ledger as `unresolved` pending evidence, not as a solved case with a label.
- **The 271 are a different defect class.** They appear in *no* master — current or historical. They are not deleted rows awaiting restore; they are references to IDs that were never minted, or that predate the retained snapshot window (which begins 2026-08-13 at 10,666, so the 10,878 → 10,666 transition is outside it). 306 relationship rows and 297 location rows point at them. Same-ID restore cannot fix them. Each needs `remap_to_survivor` or `reject_references`, plus a root-cause finding: writer bug, or pre-window lineage break.

**Normative for V3: Phase 0 scope is 6,990 dangling rows across 2,035 distinct IDs, of which 1,762 are restorable and 273 are not.**

---

## Item 6 — ACCEPTED WITH AMENDMENT

> *"IRATA and OPITO are not automatically samples of the same population, and the result is model-dependent — not a guaranteed lower bound."*

**The first half is correct and the example was mine to get wrong.** IRATA accredits rope-access training; OPITO accredits offshore oil-and-gas training. They do not sample a common closed population, so Chapman does not apply to that pair. The worked example must be struck.

**The second half needs precision.** "Model-dependent" is right. "Not a guaranteed lower bound" is right as stated but for a reason worth naming: the downward bias holds under *positive* list dependence and under heterogeneous capture probability, both of which are likely here — but neither is guaranteed. If two bodies are substitutes rather than complements (a centre picks one scheme *instead of* the other), overlap falls below independence and N̂ inflates. So the direction of bias is an assumption, not a theorem, and must be declared per application.

**Normative for V3:**

1. Capture–recapture is **demoted to a secondary, exploratory instrument.** It is never a governed KPI and never appears in a coverage claim without its model stated.
2. Any application must first declare a **closed population** that both lists demonstrably sample: one scheme, one country, one time window. Example of a valid pairing: providers of a single GWO module in one country, as listed by GWO's directory versus that country's national industry register.
3. Prefer **≥3 lists with a log-linear model** so dependence is estimated rather than assumed. Report a **sensitivity range** across independence, positive-dependence and heterogeneity models — not a point estimate.
4. **The primary coverage instrument becomes the orphan-claim rate** from reverse discovery (QA §12). It needs no closed-population assumption, it is computed continuously from data the system already generates, and it localises the gap to a specific source. Capture–recapture supplements it; it does not lead.
5. Optional assumption-light cross-check: coverage against an external frame (national company register filtered to training NACE/SIC codes). Weaker signal, no independence assumption.

---

## Items 2–5, 7–11 — ACCEPTED, with the normative fix

Each of these is a genuine defect. The fix is specified so V3 can absorb it directly.

### Item 2 — One computed completion gate

Both drafts state a completion rule and they are not the same rule. Worse, both fail on two real cases in your corpus: a directory that genuinely publishes zero entries (Belgium), and a source that publishes no count at all (IALA, `count_quality = not_published` — under the architecture rule it could never reach `complete`).

Replace with a single terminal-state function, computed at the writer, never assertable:

```
route_terminal_state(route) :=
  blocked_robots            if robots disallows
  blocked_access            if last attempt outcome ∈ {401,403,429,captcha,session_required}
  needs_human               if open blocking escalation
  stale                     if age > 2× refetch window
  partial                   if 0 < extracted < published
  verified_empty            if extracted = 0 AND structural = 0
                               AND corroborated_empty(route)
  blocked_no_public_rows    if extracted = 0 AND published > 0
  complete_reconciled       if published > 0 AND variance ∈ {reconciled, adjudicated}
                               AND extracted = structural AND verification_passed
  complete_count_unpublished if count_quality = 'not_published'
                               AND extracted = structural
                               AND verification_passed
                               AND second_source_corroboration
  unresolved                otherwise

corroborated_empty(route) := ≥2 fetch attempts ≥24h apart both yielding 0 rows
                             AND structural_count = 0
                             AND LLM oracle returns NONE
                             AND no published count > 0
```

Coverage reporting must present `complete_reconciled`, `complete_count_unpublished` and `verified_empty` as **three separate lines with three denominators.** `verified_empty` resolves a route while contributing zero centres; collapsing it into "complete" is how the V2 dashboard reported six blocked national routes as done.

### Item 3 — Adapter versioning

```sql
CREATE TABLE adapter (
  adapter_id  TEXT NOT NULL,
  version     TEXT NOT NULL,              -- semver
  kind        TEXT NOT NULL CHECK (kind IN ('rules','code')),
  rules_sha256 TEXT,
  code_ref    TEXT,
  authored_by TEXT NOT NULL,
  confirmed_by_human INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_by_human IN (0,1)),
  superseded_by TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (adapter_id, version)
);

ALTER TABLE route       ADD adapter_version TEXT;
ALTER TABLE observation ADD adapter_version TEXT NOT NULL;
-- composite FKs, both tables:
FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version)
```

Every observation is thereby attributable to an exact, immutable adapter version, which is what makes the R2 version-diff replay meaningful.

### Item 4 — Rebuild determinism

Strike "byte-identical". SQLite files are not reproducible — page allocation, freelist state and rowid ordering vary. Replace with a canonical projection hash:

```
For each governed table, in a fixed table order:
  SELECT * ORDER BY primary key, columns in declared order
  NULL → \N ; REAL → repr with fixed precision ; timestamps → UTC ISO-8601 'Z'
  text → UTF-8 NFC ; serialize NDJSON, LF endings
  table_hash = sha256(bytes)
rebuild_hash = sha256(concat(table_hash for each table in order))
```

R1 asserts `rebuild_hash` equality **and** equality of the full invariant sweep result. Publish `rebuild_hash` with each release.

### Item 5 — Artifacts vs fetch attempts

The draft conflated content with events, which makes a 304 unrepresentable.

```sql
CREATE TABLE artifact (                       -- content, immutable, deduped
  sha256 TEXT PRIMARY KEY,
  byte_len INTEGER NOT NULL,
  content_type TEXT,
  storage_path TEXT NOT NULL,
  first_seen_at TEXT NOT NULL
);

CREATE TABLE fetch_attempt (                  -- event; many per artifact
  attempt_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES route(route_id),
  request_url TEXT NOT NULL,
  final_url TEXT,
  http_status INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN
    ('content_200','not_modified_304','error_4xx','error_5xx','blocked','timeout','robots_denied')),
  artifact_sha256 TEXT REFERENCES artifact(sha256),   -- NULL for 304 / error
  etag TEXT, last_modified TEXT,
  requested_at_utc TEXT NOT NULL,
  fetch_tier INTEGER NOT NULL CHECK (fetch_tier IN (1,2,3)),
  fetcher_version TEXT NOT NULL,
  robots_snapshot_sha TEXT,
  captured_by TEXT,
  CHECK ((outcome = 'content_200') = (artifact_sha256 IS NOT NULL))
);
```

Freshness semantics: `content_verified_at(route) = MAX(requested_at_utc)` over attempts whose outcome is `not_modified_304`, or `content_200` yielding the currently-bound sha256. A 304 proves freshness without minting a duplicate artifact — which is the whole point of conditional requests and was unrepresentable in the draft.

### Item 7 — Sampling and the completion threshold

The contradiction is real and the fix is one word. My table (n=59/c=0, 93/1, 124/2) is an **acceptance-sampling** table: accept if `P(X ≤ c | n, p=0.05) ≤ 0.05`. The gate said **Wilson** 95% lower bound ≥ 0.95, and Wilson two-sided for 59/59 gives 0.939 — so the gate rejects what the table accepts.

Use **one-sided Clopper–Pearson throughout.** The two formulations are then identical by construction: `CP one-sided 95% lower bound ≥ 0.95` ⟺ `P(X ≤ c | n, 0.05) ≤ 0.05`. Check: 59 successes of 59 → exact one-sided lower bound `0.05^(1/59) = 0.9505 ≥ 0.95`. Consistent.

**Normative:** one-sided Clopper–Pearson, α = 0.05. The table is *derived* from that rule in V3, never stated alongside it as an independent fact.

### Item 8 — Invariant tiering

```
T-WRITE  (in transaction, µs)     FK, CHECK enums, uniqueness, INV-4, INV-7, INV-8, INV-10
T-RUN    (end of route run, s)    count reconciliation, field fill-rate deltas
T-NIGHT  (full corpus, min)       INV-3 orphan sweep, counter recompute, duplicate detectors
T-WEEK   (sampled)                artifact rehash: 2% random + all artifacts touched this week
T-MONTH  (hours)                  full artifact rehash, R1 rebuild + rebuild_hash assertion
```

Rotate the weekly artifact sample so every artifact is rehashed at least quarterly. Nightly rehash of the full store was never affordable and the draft implied it.

### Item 9 — Real constraints, and nullable uniqueness

SQLite treats NULLs as distinct in `UNIQUE`, so both draft uniqueness constraints are inert whenever the nullable column is NULL:

```sql
-- route: '' means route-wide, not "unknown"
scheme_scope TEXT NOT NULL DEFAULT '',
UNIQUE (source_id, route_url, scheme_scope)

-- offering: express the key over coalesced values
CREATE UNIQUE INDEX ux_offering ON offering (
  centre_id, certificate_id, COALESCE(location_id,''), COALESCE(delivery_mode,'unknown'));
```

Also add across V3: `PRAGMA foreign_keys=ON` asserted at connection open (it is off by default and silently so); `CHECK` constraints on every enum column; `NOT NULL` on every column the text describes as required.

### Item 10 — Phase 0 exit criteria

Replace the draft's two-line done-when with all of:

1. **Immutable pre-recovery snapshot.** Every `current/` and `historical/` file hashed; manifest hash published in the README; store set read-only. Nothing may be adjudicated before this exists.
2. **Recovery ledger** (in a *separate* database), one row per member of the 2,035-ID union: id, referencing tables, referencing row count, backups containing it, decision ∈ `{restore_from_backup, remap_to_survivor, reject_references, unresolved}`, decided_by, evidence.
3. Zero rows remaining at `unresolved`.
4. Each of the 271 no-provenance IDs carries a disposition **and** a root-cause finding (writer bug vs pre-window lineage break).
5. `TC-011072` and `TC-011073` explicitly dispositioned — no assumed attribution.
6. All four lineage drops (−1,766, −166, −30, −7) recorded with decisions; retained-window limit stated (window opens 2026-08-13 at 10,666; the 10,878 → 10,666 transition is outside it).
7. The ledger status change — 75 `confirmed_new` → `existing` — explained or reversed.
8. Post-recovery FK audit across **all five** referencing tables returns zero dangling.
9. All three counter invariants pass.
10. Independent re-verification by a second agent against the snapshot, recorded with its own hash.
11. No governed write occurred during Phase 0 outside the separate recovery-ledger database.

### Item 11 — Estimates are hypotheses

Accepted. All of "two-day job", ~30,000 fetches, 1.5–3 GB, 5–6 hours are **forecasts from stated assumptions, not commitments**, and V3 must label them as such.

Replace with a measurement plan. Instrument the OSHA pilot to record per route: pages fetched, bytes raw and gzipped, wall-clock, 4xx/429 rate per host, T3 escalations raised, human minutes per escalation. Re-forecast after 5 completed routes and publish the forecast with an interval. No capacity commitment before that.

---

## GO / NO-GO gates

**Phase 0 → GO** requires all eleven criteria in item 10, plus: the recovery ledger reviewed by a second agent that did not produce it, and a written statement that no governed write occurred.

**Phase 1 → GO** requires, on an isolated database, against one route (OSHA OTI, 36 records):

1. `schema.sql` applied with `foreign_keys=ON` verified at runtime; all CHECK constraints present.
2. Fetch → artifact → parse → observation → resolve → write completes.
3. Re-run is a no-op: one `not_modified_304` attempt, zero new artifacts, zero new observations.
4. R1 replay from artifacts reproduces the identical `rebuild_hash`.
5. Three-way count reconciliation: published 36 = extracted 36 = structural 36, `reconciled`.
6. Exhaustive human verification of all 36 records; result stored as a golden fixture.
7. T-WRITE invariants pass; T-NIGHT sweep clean.
8. Terminal state computes to `complete_reconciled` with no manual assertion available anywhere in the code path.
9. Attempting to write `complete` directly is rejected by the writer — demonstrate the rejection in a test.

**NO-GO on any single failure.** Governed writes to the production corpus remain paused until Phase 1 passes on the isolated database.

---

## Endorsed sequence

The reviewer's sequence is correct. One insertion, marked:

1. Freeze and hash current + historical backups; publish the manifest hash
2. **Merge V3 from these corrections; settle the 2,035-vs-1,764 scope question first, because Phase 0's size depends on it** ← insert
3. Build the read-only recovery ledger over the 2,035-ID union
4. Adjudicate restore / remap / reject, including the 271 no-provenance IDs and the 2 unrecoverable
5. Independently verify a clean snapshot
6. Implement schema and tests in a separate database
7. Run the OSHA pilot against the Phase 1 GO gate
8. Permit governed writes only after that gate passes

---

## What V3 must contain

1. Single normative specification merging the architecture and QA documents — one completion rule, one sampling rule, one schema.
2. Change log from both drafts, item by item, citing this brief.
3. Complete `schema.sql` with FKs, CHECKs, partial unique indexes, and the artifact/fetch_attempt split.
4. The invariant tier table with each invariant assigned to exactly one tier.
5. GO/NO-GO gates for Phases 0 and 1 as above.
6. Every quantitative estimate labelled `HYPOTHESIS` with its assumptions and its measurement plan.
7. An explicit assumptions register: what capture–recapture requires, what the politeness contract assumes, what the retained-snapshot window covers.
