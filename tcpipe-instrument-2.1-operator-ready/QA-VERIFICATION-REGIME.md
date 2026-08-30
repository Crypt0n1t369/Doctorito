# Verification & QA regime — companion to the pipeline architecture

The architecture document covers *regression* testing: fixtures prove a change didn't break what already worked. That is necessary and insufficient. It says nothing about whether the extraction was ever right, or whether a whole cohort of training centres is missing from the corpus entirely.

This document covers the second problem: **proving completeness and correctness, continuously, at a known confidence level.**

---

## 0. The two questions, kept separate

| Question | Discipline | Answered by |
|---|---|---|
| *Did we correctly capture what this page shows?* | **Fidelity** | Count reconciliation, N-version parsing, field-level audit, fixtures |
| *Does this page show everything that exists?* | **Coverage** | Capture-recapture, reverse-discovery cross-checks, source triangulation |

Almost every scraping project measures fidelity and silently assumes coverage. Your instinct — *"is it 36 or 37?"* — is a fidelity question. The more dangerous one is: *IRATA lists 360 trainers; how many IRATA-approved trainers exist that IRATA's own directory doesn't show?* Both get answered below.

---

## 1. Failure-mode taxonomy → test mapping

Build tests against named failure modes, not against a vague sense of quality. Every mode below has been observed in the existing data or is a standard failure of this class of system.

| # | Failure mode | Symptom | Caught by |
|---|---|---|---|
| F1 | Pagination stops early | 36 of 37 rows | §2 three-way count reconciliation |
| F2 | Selector matches too much | 38 rows: header + "no results" placeholder counted | §2, §3 N-version |
| F3 | Column shift | Phone in address field, status `177` | §5 field-level plausibility |
| F4 | Field selector breaks, row selector fine | Row count perfect, phone fill-rate 80% → 12% | §5 fill-rate deltas |
| F5 | Soft-404 / redirect to generic page | Zero rows, HTTP 200 | §6 artifact sanity + `empty_is_valid` |
| F6 | JS not settled before capture | Partial list, no error | §3 N-version, §7 canary re-fetch |
| F7 | Source silently changed | Adapter still "works", data is now wrong | §7 structural drift canary |
| F8 | Over-merge in resolution | Two real centres become one — **silent, permanent** | §8 merge-safety invariants, §9 shuffle test |
| F9 | Under-merge | One centre appears 3× — inflates counts | §8 duplicate detectors |
| F10 | Adapter version bump drops rows | Counts fall, nobody notices | §10 A/B replay diff |
| F11 | Source directory itself is incomplete | Everything "passes", corpus is short | §11 capture-recapture, §12 reverse cross-check |
| F12 | Stale data presented as current | Correct-looking, months old | §13 freshness SLO |
| F13 | `complete` asserted on a blocked route | 27 complete / 2 blocked | §14 completion gate, enforced in code |
| F14 | Counter drift in denormalized columns | 299 wrong `relationship_count` | §8 invariants, every write |
| F15 | Governed row whose evidence artifact is gone | Unfalsifiable claim | §8 evidence-integrity invariant |

---

## 2. Three-way count reconciliation and the variance register

Your 36-vs-37 example, done properly. Two-way comparison (`published` vs `extracted`) is not enough, because when they disagree you cannot tell which is wrong.

Compute **three** independent numbers over the same frozen artifact:

1. **`published_count`** — what the source states in prose ("the updated list includes 43 training institutions").
2. **`extracted_count`** — rows the adapter produced.
3. **`structural_count`** — a deliberately *different* counting method over the same bytes. Never share code with the adapter. Examples:
   - count `<tr>` in the container, minus known header rows
   - count distinct `href` matching the profile-URL pattern
   - count occurrences of a strong per-row anchor (a country code, a numbered prefix `^\d+\.`, a repeated label)
   - for PDFs: count lines matching the row regex

Then:

```
extracted == structural  and  extracted == published   → reconciled
extracted != structural                                 → PARSER BUG. Block. Escalate.
extracted == structural  and  extracted != published    → SOURCE VARIANCE. Adjudicate, don't block.
```

**The third outcome is the professional one and it happens constantly.** Sources count different units: 40 *organisations* published vs 43 *rows* because three organisations have two sites; a national authority counts *institutions* while the table lists *campuses*. That is not a bug and must not be forced to zero.

So the artefact is not a pass/fail — it is a **count variance register**:

```sql
CREATE TABLE count_variance (
  variance_id       TEXT PRIMARY KEY,
  route_id          TEXT NOT NULL REFERENCES route(route_id),
  artifact_sha256   TEXT NOT NULL REFERENCES artifact(sha256),
  published_count   INTEGER,
  extracted_count   INTEGER NOT NULL,
  structural_count  INTEGER NOT NULL,
  variance          INTEGER NOT NULL,        -- extracted - published
  status            TEXT NOT NULL,           -- reconciled | parser_bug | adjudicated_source_variance | unexplained
  unit_explanation  TEXT,                    -- 'published counts organisations; rows are locations'
  adjudicated_by    TEXT,
  adjudicated_at    TEXT,
  evidence_quote    TEXT
);
```

**Rules:**
- A route cannot reach `complete` with an `unexplained` variance.
- An adjudication is **sticky**: once you record *"IALA publishes organisations, the PDF lists sites, ratio 40:43"*, future runs with the same ratio auto-reconcile and never ask again. That is the learning loop applied to counts.
- Variance of exactly ±1 gets its own alert. It is nearly always an off-by-one on a header or footer row, and it is the single most common real bug.

---

## 3. N-version parsing — two independent extractors must agree

For high-value routes, extract twice by structurally different means and require agreement:

- **Version A:** DOM/selector-based (the production adapter).
- **Version B:** text-based — strip tags, apply row regex and field regex to the plain text.

Disagreement on row count or on any row's `published_name` → escalate, do not write.

This is expensive, so gate it: mandatory for routes with `published_count ≥ 100`, or for any route feeding more than 2% of the corpus. For the rest, the structural count in §2 is the cheap approximation of the same idea.

### The LLM as a test oracle — safe, and genuinely useful

This is the one place an LLM belongs in the quality path, because it never writes anything:

```
input:  frozen artifact (HTML→text, or PDF page images)
prompt: "List every training provider named on this page. Return names only, one per line.
         If the page lists none, return the single token NONE."
compare: set difference against the adapter's output
```

- Names the LLM found that the parser missed → likely **F1/F2 undercount**. High-value signal.
- Names the parser found that the LLM missed → usually fine (LLM skimmed), low priority.
- Both return NONE → strong corroboration for `blocked_no_public_rows` vs `blocked_access`. This alone would have prevented the six Belgium/Italy/Portugal-class misclassifications.

It is a *detector of disagreement*, never a source of data. Its output goes to `escalation`, never to `observation`. Run it on every new adapter's first run and on any run where the variance register flags `unexplained`.

---

## 4. Human verification — exhaustive where cheap, sampled where not

### 4a. Small routes: verify 100%, once, forever

Any route with `extracted_count ≤ 50` gets a full human pass on first extraction. That is your 36-row OSHA case: one minute in the blob's **Verify mode** — frozen page on the left, extracted rows on the right, tick or fix each.

The output is not just a green tick. It becomes a **permanent golden fixture**: artifact sha256 + the exact 36 verified records. Every future adapter change re-runs it. You verify a small route exactly once in the project's life.

Roughly 60% of your routes are under 50 rows. Exhaustive verification of the majority of routes is affordable and should be non-negotiable.

### 4b. Large routes: acceptance sampling with a stated confidence

For 652-row GWO you do not check 652. You use acceptance sampling and state the guarantee.

To demonstrate a defect rate **≤5% with 95% confidence**:

| Sample size *n* | Accept if errors ≤ *c* |
|---:|---:|
| 59 | 0 |
| 93 | 1 |
| 124 | 2 |
| 153 | 3 |

To demonstrate **≤1% with 95% confidence**: n = 299, c = 0.

Sample **stratified**, not uniformly at random — stratify by page/pagination bucket, by country section, and by whether optional fields are populated. Uniform random sampling systematically under-tests the tail of a paginated list, which is exactly where F1 lives.

Record every audit:

```sql
CREATE TABLE audit_sample (
  sample_id     TEXT PRIMARY KEY,
  route_id      TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  strategy      TEXT NOT NULL,       -- exhaustive | stratified_random
  n_sampled     INTEGER NOT NULL,
  n_errors      INTEGER NOT NULL,
  error_detail_json TEXT NOT NULL,   -- which field, what was wrong
  accuracy_lower_ci REAL NOT NULL,   -- Wilson 95% lower bound
  audited_by    TEXT NOT NULL,
  audited_at    TEXT NOT NULL
);
```

Report **the lower confidence bound**, never the point estimate. "97% accurate" from a sample of 30 is noise; "≥91.2% accurate at 95% confidence, n=59, 1 error" is a claim you can defend.

### 4c. Every human correction becomes a test

A fixed cell is not just a fix. It writes:
1. A fixture assertion on that artifact.
2. A `rule` if the error is generalizable (a normalization alias, a reject pattern).
3. An entry in the error-detail log, so error *classes* can be counted and ranked.

Rank error classes by frequency each month. The top class tells you what to fix in the adapter engine rather than in the data.

---

## 5. Field-level health — the check that catches what row counts miss

**Row count can be perfect while every phone number is gone.** This is F4 and it is the most-missed failure in scraping systems.

For each `(route_id, adapter_version, field)` record the **fill rate** and compare against the trailing baseline:

```
phone_fill_rate:    0.81 → 0.12   ΔZ = -14.2   → BLOCK, escalate
website_fill_rate:  0.94 → 0.93                → fine
apply_url_fill:     0.31 → 0.30                → fine
```

Alert rule: any field whose fill rate moves more than 3 standard deviations, or by more than 20 percentage points absolute, against a baseline of the last 3 runs of that route.

### Plausibility validators, per field

| Field | Validator |
|---|---|
| `published_phone` | E.164-parseable **and** country code consistent with `country_iso2` |
| `published_website` | valid registrable domain; not a known aggregator/social host; sampled 2xx check |
| `country_iso2` | valid ISO 3166-1 alpha-2 |
| `latitude/longitude` | inside the bounding box of `country_iso2`; **and** `coords_state = 'published'` |
| `published_name` | length 3–200; not all-caps-single-word; not matching known placeholder set (`N/A`, `-`, `TBD`, `see below`) |
| `apply_url` | same registrable domain as centre website, or a known booking platform; else flag |
| `price.amount` | > 0; currency valid ISO 4217; within 3 IQR of the certificate's price distribution |

Validators produce **flags, not deletions.** A flagged row is written with `quality_flags` populated and excluded from clean exports by default. Never silently drop.

---

## 6. Invariants — run on every write, cost microseconds

These are assertions, not tests. If one fails, the transaction rolls back.

```
INV-1   Every FK resolves. All tables. (The 6,990-row failure becomes impossible.)
INV-2   Every observation references an artifact that exists on disk and re-hashes correctly.
INV-3   Every governed row traces to ≥1 observation.
INV-4   No canonical ID is ever deleted; superseding requires entity_state='merged_into'.
INV-5   Denormalized counters equal their computed value, or don't exist. (Prefer views.)
INV-6   Every status-bearing column holds a value from its enum.
INV-7   route_state='complete' ⟹ count variance is 'reconciled' or 'adjudicated_source_variance'.
INV-8   coords_state='published' ⟺ lat/long non-null. No derived coordinates, ever.
INV-9   is_personal_data=1 rows never appear in a default export.
INV-10  Every accreditation with evidence_strength='centre_self_claim' has direction='reverse'.
```

Run INV-1..10 as a full-corpus sweep nightly as well, because constraints can be satisfied row-by-row and violated in aggregate.

---

## 7. Canary re-fetch — detect source drift before it breaks you

For every adapter, nominate one artifact as its canary. Weekly, re-fetch that URL and compare **structure**, not content:

- template fingerprint match?
- do all primary selectors still resolve?
- does row count fall within the historical range?

Three outcomes:

| Result | Meaning | Action |
|---|---|---|
| Fingerprint + selectors stable | Source unchanged | Refresh `last_verified_at` |
| Fingerprint stable, a selector fails | Cosmetic change | Auto-open `pick_selector` escalation **before** the full run breaks |
| Fingerprint changed | Redesign | Quarantine the adapter, mark route `needs_human` |

This converts adapter breakage from a surprise mid-run into scheduled maintenance. One request per adapter per week — negligible cost, large payoff.

---

## 8. Entity-resolution safety — the silent killer

Over-merge (F8) destroys data irreversibly and produces *no error*. Guard it explicitly:

**Blocking invariants** — refuse a merge if any holds:
- The two candidates have different registrable domains, both non-null.
- They have different official provider IDs from the same source.
- They sit in different countries.
- Combined, they would exceed a plausible location count (e.g. >25 sites) without a `parent_of` relationship.

**Under-merge detectors** — run nightly, feed `review_queue`:
- Same registrable domain, different `centre_id`.
- Same official provider ID, different `centre_id`.
- Name similarity ≥ 0.92 (token-set ratio) + same country + not linked.

**Merge audit trail:** every merge stores both pre-merge records in full. Merges are reversible. If you cannot reverse a merge, you cannot ever trust one.

**Precision/recall on a labelled set:** hand-label 300 candidate pairs once (match / not-match / unsure). Every resolver change runs against it and reports precision and recall. Resolver changes that raise recall while dropping precision below 0.99 are rejected — in this domain a false merge is far worse than a missed one.

---

## 9. Metamorphic and property tests — cheap, catch deep bugs

Relations that must hold regardless of input. Run in CI.

| Property | Catches |
|---|---|
| `parse(a) == parse(a)` on re-run | Nondeterminism, dict-ordering, timestamp leakage |
| `parse(page1) ∪ parse(page2) == parse(combined)` | Pagination boundary bugs |
| `resolve(shuffle(records)) == resolve(records)` | **Order-dependent entity resolution** — a latent nondeterminism bug that produces different corpora on different runs |
| Merging A,B then C == merging B,C then A | Non-associative resolution |
| Adding one new centre changes `count(centre)` by exactly 1 | Write-path leakage |
| Merging two centres preserves total accreditation count | Relationship loss during merge |
| `export → import → export` is byte-identical | Round-trip fidelity |

The shuffle test is the highest-value one here and takes an afternoon to write.

---

## 10. Backtesting — replay, diff, and never silently regress

Three distinct replays, all made possible by the immutable artifact store.

**R1 — Full rebuild.** Drop the DB, replay every parser over every artifact. Must reproduce the governed corpus exactly. Run monthly. This is the disaster-recovery proof *and* the strongest possible statement that no data exists outside its evidence.

**R2 — Version diff (mandatory on every adapter bump).** Run adapter v_old and v_new over every stored artifact for that route. Emit:

```
adapter emsa_dona__country_profile_met  1.2.0 → 1.3.0
  artifacts replayed:  17
  rows added:          +12   (Malta ×4, Poland ×8)
  rows dropped:        -1    (Cyprus row 7)     ← REQUIRES JUSTIFICATION
  fields changed:      23    (phone normalization)
  net row delta:       +11
```

**A version bump that drops rows requires a written justification recorded against the version.** Silent row loss during a "fix" is exactly how 1,766 IDs disappear.

**R3 — Historical backtest.** Run today's adapter against last quarter's artifacts. Compare against what was recorded then. Quantifies how much of the historical corpus is wrong by current standards, and tells you whether re-processing history is worth it.

---

## 11. Capture-recapture — estimating what you never saw

This answers the question nobody normally asks: **how many training centres exist that no directory we've read has listed?**

Standard technique from epidemiology and census undercount. Two independent lists covering the same population:

- `n1` = centres found by list A
- `n2` = centres found by list B
- `m` = centres found by both

Chapman estimator (less biased than raw Lincoln–Petersen at small `m`):

```
N̂ = ((n1 + 1)(n2 + 1) / (m + 1)) − 1
```

Worked example — offshore/rope-access centres in one country, two independent lists:

```
n1 = 360   (IRATA trainer directory)
n2 = 244   (OPITO approved centres)
m  =  96   (appear in both)

N̂ = (361 × 245 / 97) − 1 ≈ 911
observed union = 360 + 244 − 96 = 508
estimated missed ≈ 403        coverage ≈ 56%
```

That is a defensible, quantified coverage figure — the number the V1 pack was missing entirely.

**Assumption and how to state it honestly:** capture-recapture assumes the two lists are independent. Here they are *positively* correlated — a centre that pursues one accreditation tends to pursue others. Positive dependence biases `N̂` **downward**, so treat the result as a **lower bound on the true population**, i.e. an upper bound on your coverage. Say that in the report. With three or more overlapping lists, fit a log-linear model to relax the independence assumption.

Where to apply it: any domain where two or more of your sources genuinely overlap — offshore safety (IRATA/OPITO/GWO), maritime STCW (EMSA DONA vs national authority vs IALA), welding/NDT (CSWIP/BINDT). Run quarterly per domain. It converts "we have 9,530 centres" into "we have 9,530 of an estimated ≥17,000, concentrated in these gaps."

---

## 12. Reverse discovery as a continuous, adversarial coverage test

This is free — the system generates it as a by-product — and it is the sharpest completeness signal you will get.

When a centre's own site claims *"IRATA-approved"* and IRATA's directory does not list them, exactly one of three things is true:

1. The claim is false or expired → **data quality finding about the centre**.
2. IRATA's directory is incomplete or stale → **finding about the source**.
3. Our IRATA parse missed the row → **finding about our parser**. ← the one you care about

Track per association:

```
orphan_claim_rate = reverse_claims_not_in_forward_directory / total_reverse_claims_for_that_source
```

A baseline of a few percent is normal (lapsed accreditations, marketing overreach). **A spike for one association means that association's route is under-extracting.** Alert at 2× the corpus median.

Add the inverse check too:

```
forward_orphan_rate = centres_in_directory_whose_site_never_mentions_the_body / directory_size
```

A high value there suggests over-extraction — rows captured that are not really accredited centres.

These two rates, per source, on one dashboard row each, are the most informative completeness instrument in the whole system, and they cost nothing extra to compute.

---

## 13. Freshness SLO

Correct-but-stale is a failure mode with no error message.

- Per route: `age = now − last_ok_fetch_at`, compared to `volatility_class`.
- SLO: ≥95% of `complete` routes within 1× their refetch window; 100% within 2×.
- Corpus age distribution published: median, p90, worst.
- Any route past 2× → auto-demote `complete` → `stale`. **A stale route must not be counted as complete in coverage reporting.**

---

## 14. The completion gate — computed, never asserted

Enforced in code at the single writer. A route is `complete` only when **all** hold:

```
1. count variance status ∈ {reconciled, adjudicated_source_variance}
2. published_count > 0  AND  count_quality = 'published'
3. extracted_count == structural_count
4. adapter has ≥1 passing fixture
5. verification: exhaustive (n ≤ 50) or sampled with accuracy_lower_ci ≥ 0.95
6. no field fill-rate alert open
7. age < 2× refetch window
8. zero open blocking escalations for the route
```

Anything else is `partial`, `needs_human`, or a `blocked_*` subtype. There is no path by which a human or an LLM can write `complete` directly. This makes the "27 complete / 2 blocked" class of error unrepresentable.

---

## 15. The quality scorecard

One row per route, one number per corpus, so attention goes where it pays.

```
route_quality_score =
    0.30 × count_reconciliation   (1.0 reconciled, 0.7 adjudicated, 0.0 unexplained)
  + 0.25 × verification_confidence (accuracy lower CI, 0 if never audited)
  + 0.20 × field_completeness      (mean fill rate ÷ expected fill rate, capped 1.0)
  + 0.15 × freshness               (1.0 fresh, decaying to 0 at 3× window)
  + 0.10 × adapter_maturity        (fixtures, canary passes, versions without a drop)
```

Corpus grade = enrolment-weighted mean, published with its denominator:

> **Corpus: 9,530 centres across 41 of 277 bodies. Estimated population ≥17,000 (capture-recapture, lower bound). Verified accuracy ≥94.1% (95% CI, n=612 across 23 routes). Median route age 9 days. 6 routes stale, 2 unexplained variances.**

That paragraph is what a buyer, an auditor, or a partner actually needs, and every number in it is computed from a stored SQL definition.

---

## 16. Test pyramid — cost and cadence

| Layer | What | Cost | Cadence |
|---|---|---|---|
| L1 | Unit: rules engine, normalizers, validators | ms | every commit |
| L2 | Fixture: adapter vs frozen artifact | seconds | every commit |
| L3 | Invariants INV-1..10 | µs | every write + nightly sweep |
| L4 | Count reconciliation + field fill-rate | seconds | every route run |
| L5 | Metamorphic / property (incl. shuffle) | minutes | every commit on resolver/parser |
| L6 | Canary re-fetch | 1 request/adapter | weekly |
| L7 | N-version + LLM oracle | LLM call/route | new adapters + unexplained variance |
| L8 | Human audit (exhaustive or sampled) | minutes | first extraction + on adapter major bump |
| L9 | Version-diff replay (R2) | minutes | **every adapter version bump** |
| L10 | Full rebuild replay (R1) | hours | monthly |
| L11 | Capture-recapture population estimate | minutes | quarterly per domain |
| L12 | Orphan-claim rate | SQL | continuous |

---

## 17. Mapping into the build phases

| Phase | Add |
|---|---|
| **1 — Spine** | INV-1..6; three-way count reconciliation; the `count_variance` table; R1 replay proof in the done-when |
| **2 — Adapters** | Fixture harness; L5 metamorphic incl. shuffle; R2 version-diff **required before any version bump merges** |
| **3 — Blob** | Verify mode (exhaustive audit UI); `audit_sample` table; corrections auto-promote to fixtures |
| **4 — Scale** | Field fill-rate baselines + alerts; canary re-fetch; completion gate §14 enforced at the writer; scorecard v1 |
| **5 — Reverse** | Orphan-claim rate both directions; per-source alerting |
| **6 — Learning** | LLM oracle on new adapters; capture-recapture per domain; error-class ranking |
| **7 — Costs** | Price plausibility validators; coverage reported with explicit denominator |
| **8 — Hardening** | Freshness SLO; nightly invariant sweep; published corpus grade |

---

## 18. Build these three first

Ranked by defect-caught per hour of work:

1. **Three-way count reconciliation + the variance register (§2).** Directly answers "36 or 37", and the sticky adjudication means each source's counting quirk is explained exactly once. Half a day.
2. **Field fill-rate baselines (§5).** Catches the failure class that row counts structurally cannot see, and it is ~40 lines over data you already store. Two hours.
3. **R2 version-diff replay (§10).** Makes silent row loss on an adapter "improvement" impossible. This is the specific control that would have caught the 1,766-row deletion the day it happened. One day.

Then the shuffle test (§9) and the orphan-claim rate (§12) — both cheap, both catch things nothing else will.
