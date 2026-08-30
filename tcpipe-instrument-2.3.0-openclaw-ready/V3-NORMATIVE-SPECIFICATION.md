# V3 — Training-centre discovery & mapping pipeline
## Single normative specification

**Version:** 1.1 (amendments A1–A3, see Part 15).
**Status:** Normative. Supersedes the V2 architecture draft and the QA regime draft.
**Authority:** Where this document conflicts with any earlier draft, this document wins.
**Scope of this revision:** specification only. No recovery, no governed writes, no production code.
**Keywords:** MUST / MUST NOT / SHOULD / MAY carry RFC-2119 force.

---

# Part 0 — How to use this document

Sections marked **[NORMATIVE]** are requirements. Sections marked **[RATIONALE]** explain why and are not requirements. Every quantitative estimate is labelled **[HYPOTHESIS]** and MUST NOT be treated as a commitment.

An implementing agent MUST NOT begin a phase before the previous phase's GO gate has passed (Part 13). An implementing agent MUST NOT implement anything specified in a later phase early.

---

# Part 1 — Vision and operating principles

## 1.1 What is being built [RATIONALE]

A deterministic data factory. For every association, scheme owner and national authority that publishes a list of approved training centres, it produces a governed record per centre carrying: contact number, certificates provided, location, cost where published, the centre's own website, and the apply/booking link — each field bound to the artifact it came from, the exact locator inside that artifact, and the quoted evidence.

Around that runs a bidirectional discovery loop. Associations reveal centres; centres reveal the other associations they claim accreditation from; unknown associations feed back into the association queue after human confirmation. The corpus grows itself under supervision.

## 1.2 The five laws [NORMATIVE]

**L1 — Separation of fetch and parse.** Every remote retrieval produces an immutable, content-addressed artifact. No component outside `src/fetch` may open a network socket. Parsers MUST operate only on stored artifacts.

**L2 — The LLM is never in the fetch path and never in the write path.** LLM output MAY enter the system only as a row in `review_queue` or `escalation`. It MUST NOT be written to `observation` or to any governed table.

**L3 — Determinism law.** *If a behaviour depends on an agent remembering to do it, it will fail.* Every control in this specification MUST be one of: a database constraint, a scheduled job, or an event trigger. No control may be a convention, an instruction, or a checklist item.

**L4 — The database is the master.** CSV and JSON are generated exports. No component may read an export back in. No human may hand-edit one.

**L5 — Recompute, don't inherit.** Any review, audit or verification MUST recompute its findings from primary artifacts and MUST publish the reproduction command. A figure quoted from a prior document is not evidence.

## 1.3 On L5 [RATIONALE]

L5 exists because the failure it prevents has already occurred twice in this project. The V1 pack shipped a manifest asserting `validation_ok: true` beside the validation file it hashed, which said `ok: false`. Then an independent reviewer, asked to check the V2 pack, adopted V2's own headline of 1,764 missing IDs — a figure that covered two of the five tables that reference canonical IDs — and recommended scoping recovery to it. The true union is 2,035. Both failures are the same failure: a document was trusted instead of recomputed.

Agents converge on each other's assertions. The only structural defence is to require the arithmetic, not the citation.

---

# Part 2 — Supervision and agent operations [NORMATIVE]

## 2.1 Why this layer exists first [RATIONALE]

The system this replaces failed in exactly the documented ways of unsupervised agents. It hot-edited its own governed data and removed 1,766 canonical IDs in a single overwrite whose originating command was never recovered from logs. Its state vocabulary drifted from an enum to 71 distinct prose values across 96 rows. Its reporting layer then classified those prose values by substring matching and declared six blocked national routes complete. No smarter agent fixes any of that. Deterministic scaffolding does.

## 2.2 The supervisor [NORMATIVE]

**S1.** The supervisor MUST be a non-LLM process: a Python script invoked by a systemd timer, running as a system user distinct from any agent user.

**S2.** The supervisor MUST NOT interpret agent output as instruction. It reads job state from the database and the filesystem only.

**S3.** On each tick (default 15 minutes) the supervisor MUST:

1. dispatch the next eligible job from `job_queue`;
2. rotate any worker session exceeding its token or turn ceiling;
3. run the tier of invariant checks due at this tick (Part 11.3);
4. reset agent scratch memory below the identity separator on schedule;
5. emit a heartbeat row to `supervisor_tick` including queue depth, open escalations, failed jobs, and current phase;
6. re-point every active worker at `MISSIONS.md`.

**S4.** The supervisor MUST hold a database advisory lock for the duration of a dispatch. A filesystem lock in `/tmp` MUST NOT be used for this purpose.

**S5.** If the supervisor is down, no work proceeds. Workers MUST NOT self-dispatch.

## 2.3 Shared memory [NORMATIVE]

**S6.** Code, specification, adapter rules and configuration MUST live in Git. Every agent action that changes any of these MUST end in a commit. Uncommitted work does not exist.

**S7.** Data state MUST live only in the governed database and the artifact store. No agent may retain durable state in its own context, notes, or scratch files.

**S8.** Merge conflicts are a feature and MUST NOT be auto-resolved by an agent. A conflict raises an escalation.

## 2.4 Missions [NORMATIVE]

**S9.** `MISSIONS.md` MUST exist at the repository root and MUST be machine-readable (front-matter per mission: `id`, `phase`, `problem`, `done_when`, `priority`).

**S10.** Every job in `job_queue` MUST reference a mission id. A job with no mission MUST be rejected at enqueue time.

**S11.** `MISSIONS.md` is operator-owned. It appears in the immutable set (S13).

## 2.5 Privilege separation — the control that would have prevented the 1,766-row loss [NORMATIVE]

**S12.** Agents MUST run as an unprivileged user with no write access to the governed database. All writes MUST go through the writer service, which runs as a separate user and enforces the terminal-state gate (Part 12).

**S13.** The following MUST be root-owned and set immutable (`chattr +i` on Linux, or an equivalent enforced by a root-level watchdog):

```
db/schema.sql
src/write/                      (the single writer, incl. the terminal-state gate)
src/fetch/politeness.py         (the rate limiter and circuit breaker)
config/sources.yaml
MISSIONS.md
AGENT.md                        (above the identity separator)
artifacts/                      (append-only; writes only via the artifact service)
recovery/                       (the recovery ledger database)
MANIFEST-*.json
```

**S14.** A root-level watchdog service MUST monitor the immutable set, the writer service, the egress proxy and the supervisor, and MUST restore from known-good backup on tamper or failure. It MUST run outside every agent's reach.

**S15.** The artifact store MUST be append-only. Deletion MUST be possible only through a retention job run by the supervisor, never by an agent.

## 2.6 Egress proxy — politeness enforced structurally [NORMATIVE]

**S16.** All outbound HTTP from the system MUST traverse a local egress proxy owned by the system user, not the agent user.

**S17.** The rate limiter, the per-host token bucket, robots enforcement and the circuit breaker MUST be implemented **in the proxy**, not in the fetcher library.

**S18.** The proxy MUST record per request: host, method, status, bytes, latency, cache disposition, and the originating job id. These feed the health dashboard.

### Why the proxy and not the library [RATIONALE]

If politeness lives in a library, any script — including one an agent writes at 3am because it seemed like a good idea — can bypass it by importing something else. In the proxy, a rogue script physically cannot exceed the rate. Politeness stops being a convention the agent might forget and becomes a property of the network path. This is L3 applied to the single risk most likely to get the project blocked.

## 2.7 LLM proxy [NORMATIVE]

**S19.** All LLM calls (oracle checks, adapter proposals, escalation phrasing) MUST traverse a local proxy recording model, tokens in/out, cost, latency, cache hits, and calling job id.

**S20.** The LLM proxy MUST enforce a per-phase spend ceiling. On breach it returns an error; it MUST NOT queue or retry.

## 2.8 Session rotation and identity [NORMATIVE]

**S21.** Worker sessions MUST rotate before context exhaustion, at whichever comes first: 60% of the model's context window, or 200 turns. Rotation is performed by the supervisor, not requested by the agent.

**S22.** Rotation MUST be free of data loss because all durable state is in the database (S7). A rotated worker resumes by reading its job row.

**S23.** `AGENT.md` MUST use an identity separator:

```
# Operator-controlled identity — restored on every rotation
...role, boundaries, the five laws, current phase...
---
# Scratch — wiped on rotation
```

Everything above `---` is restored verbatim on every rotation. Everything below is discarded.

## 2.9 Job ledger [NORMATIVE]

**S24.** Every action that touches governed data or the artifact store MUST be a row in `job` with: id, mission, kind, actor, parameters, started_at, finished_at, outcome, and the git commit of the code that ran.

**S25.** A governed write with no originating job id MUST be rejected by the writer.

### [RATIONALE]
The V2 pack states: *"The exact command/process responsible for the 07:07 local-time overwrite has not been recovered from retained execution logs."* Under S24/S25 that sentence becomes impossible to write.

## 2.10 Article principle → control → incident prevented

| Principle | Control here | Past incident it prevents |
|---|---|---|
| Dumb deterministic supervisor | S1–S5 | Drift into 71 prose states; unscheduled ad-hoc runs |
| No LLM supervising an LLM | S2, L2 | Manifest asserting PASS beside a failing validator |
| Git as the only shared memory | S6–S8 | Stale hand-maintained manifests treated as current |
| Missions doc | S9–S11 | 309 one-off scripts with no traceable purpose |
| Lock critical files out of reach | S12–S15 | The 1,766-row overwrite |
| Rotate sessions before overflow | S21–S23 | Silent worker stalls; identity drift |
| Proxy for cost and health | S16–S20 | Invisible spend; unnoticed 403 storms |
| Every action logged | S24–S25 | Unattributable 07:07 overwrite |
| Agents agree each other into falsehoods | L5 | Reviewer adopting the 1,764 figure |

---

# Part 3 — System architecture

```
config/sources.yaml ─► Source Policy Registry
                              │
                       Fetch Queue (jobs)
                              │
        ┌─────────────────────┼─────────────────────┐
   T1 HTTP              T2 Headless            T3 Human capture
        └─────────────────────┼─────────────────────┘
                       Egress Proxy  (rate limit, robots, breaker, metrics)
                              │
                  fetch_attempt  ──►  artifact (sha256, immutable)
                              │
                       Adapter Registry (rules-as-data, versioned, fixtures)
                              │
                   observation (append-only, evidence-bearing)
                              │
                    Entity Resolution (deterministic → review_queue)
                              │
                   Single Writer  ──► governed DB (FK + CHECK enforced)
                              │
                 ┌────────────┴────────────┐
              exports                 telemetry (SQL-defined)

Cross-cutting: Supervisor · Escalation Queue ↔ Blob · Rule Store · Job Ledger
```

## 3.1 Repository layout [NORMATIVE]

```
tcpipe/
├── MISSIONS.md                 [immutable]
├── AGENT.md                    [immutable above separator]
├── config/sources.yaml         [immutable]
├── db/schema.sql               [immutable]
├── db/migrations/
├── artifacts/                  [append-only, service-mediated]
├── recovery/                   [separate DB, Phase 0 only]
├── adapters/{rules,code,fixtures}/
├── src/
│   ├── registry/ fetch/ store/ parse/ observe/ resolve/
│   ├── write/                  [immutable]
│   ├── discover/ escalate/ rules/ orchestrator/ supervisor/ proxy/
├── extension/                  the blob
├── exports/                    generated only
└── tests/{unit,fixtures,invariants,metamorphic}/
```

---

# Part 4 — Data model [NORMATIVE]

SQLite, `STRICT` tables. **`PRAGMA foreign_keys` is a per-connection setting that defaults to OFF and does not persist in the database file.** Applying `schema.sql` once does not enable it for anything else. Every application connection, worker, migration and test MUST set it and then assert it returns 1, aborting otherwise. Per L3 this MUST NOT be left to authors to remember: all connections open through the shared helper `assert_db_preconditions.open_db()`, and a precondition test MUST fail the build if any code path opens a raw connection. `journal_mode=WAL`, `STRICT` and all CHECK/FK clauses do persist; only `foreign_keys` does not. Postgres migration path preserved by avoiding SQLite-only syntax outside the indexes noted.

## 4.1 Complete DDL

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ══ Sources and routes ═══════════════════════════════════════════════
CREATE TABLE source (
  source_id            TEXT PRIMARY KEY,
  legal_name           TEXT NOT NULL,
  acronym              TEXT,
  source_kind          TEXT NOT NULL
     CHECK (source_kind IN ('association','scheme_owner','national_authority','registry','federation')),
  country_iso2         TEXT,
  official_website     TEXT,
  discovered_via       TEXT NOT NULL
     CHECK (discovered_via IN ('seed','reverse_discovery','manual')),
  discovered_from_centre_id TEXT REFERENCES centre(centre_id),
  intake_state         TEXT NOT NULL
     CHECK (intake_state IN ('candidate','confirmed','rejected_not_accreditor','duplicate')),
  created_at           TEXT NOT NULL
) STRICT;

CREATE TABLE route (
  route_id             TEXT PRIMARY KEY,
  source_id            TEXT NOT NULL REFERENCES source(source_id),
  route_url            TEXT NOT NULL,
  scheme_scope         TEXT NOT NULL DEFAULT '',      -- '' = route-wide; never NULL
  route_kind           TEXT NOT NULL
     CHECK (route_kind IN ('html_list','html_paginated','json_api','powerbi','pdf','js_app','search_form')),
  fetch_tier           INTEGER NOT NULL CHECK (fetch_tier IN (1,2,3)),
  robots_allowed       INTEGER NOT NULL CHECK (robots_allowed IN (0,1)),
  crawl_delay_s        REAL NOT NULL DEFAULT 5.0 CHECK (crawl_delay_s >= 1.0),
  volatility_class     TEXT NOT NULL
     CHECK (volatility_class IN ('daily','weekly','monthly','quarterly','static')),
  refetch_after        TEXT,
  published_count      INTEGER CHECK (published_count IS NULL OR published_count >= 0),
  count_quality        TEXT NOT NULL
     CHECK (count_quality IN ('published','derived_from_category_text','not_published')),
  route_state          TEXT NOT NULL CHECK (route_state IN (
     'discovered','policy_pending','fetchable','fetched','parsed',
     'partial','needs_human','awaiting_retry','stale','unresolved',
     'verified_empty','blocked_no_public_rows','blocked_access','blocked_robots','blocked_paywall',
     'complete_reconciled','complete_count_unpublished')),
  state_reason         TEXT,                            -- free text permitted HERE ONLY
  adapter_id           TEXT,
  adapter_version      TEXT,
  last_content_verified_at TEXT,
  UNIQUE (source_id, route_url, scheme_scope),
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version)
) STRICT;

-- ══ Fetching: content and events are SEPARATE ════════════════════════
CREATE TABLE artifact (                    -- content only, immutable, deduped
  sha256               TEXT PRIMARY KEY,
  byte_len             INTEGER NOT NULL CHECK (byte_len > 0),
  content_type         TEXT,
  storage_path         TEXT NOT NULL,
  first_seen_at        TEXT NOT NULL
) STRICT;

CREATE TABLE fetch_attempt (               -- event; many attempts per artifact
  attempt_id           TEXT PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES job(job_id),
  route_id             TEXT NOT NULL REFERENCES route(route_id),
  request_url          TEXT NOT NULL,
  final_url            TEXT,
  http_status          INTEGER,
  outcome              TEXT NOT NULL CHECK (outcome IN (
     'content_200','not_modified_304','human_capture',
     'error_4xx','error_5xx','rate_limited','blocked','timeout','robots_denied')),
  artifact_sha256      TEXT REFERENCES artifact(sha256),
  etag                 TEXT,
  last_modified        TEXT,
  requested_at_utc     TEXT NOT NULL,
  fetch_tier           INTEGER NOT NULL CHECK (fetch_tier IN (1,2,3)),
  fetcher_version      TEXT NOT NULL,
  robots_snapshot_sha  TEXT,
  captured_by          TEXT,                            -- required for human_capture
  CHECK ((outcome IN ('content_200','human_capture')) = (artifact_sha256 IS NOT NULL)),
  CHECK ((outcome = 'human_capture') = (fetch_tier = 3)),
  CHECK (outcome <> 'human_capture' OR captured_by IS NOT NULL)
) STRICT;

CREATE TABLE host_state (                  -- circuit breaker, owned by the proxy
  host                 TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  suspended_until      TEXT,
  suspension_cycles    INTEGER NOT NULL DEFAULT 0,
  robots_sha256        TEXT,
  robots_fetched_at    TEXT,
  last_outcome         TEXT
) STRICT;

-- ══ Adapters: (id, version) is the key ═══════════════════════════════
CREATE TABLE adapter (
  adapter_id           TEXT NOT NULL,
  version              TEXT NOT NULL,                   -- semver
  kind                 TEXT NOT NULL CHECK (kind IN ('rules','code')),
  rules_sha256         TEXT,
  code_ref             TEXT,
  template_fingerprint TEXT,
  authored_by          TEXT NOT NULL CHECK (authored_by IN ('picker','llm_proposal','human')),
  confirmed_by_human   INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_by_human IN (0,1)),
  superseded_by        TEXT,
  created_at           TEXT NOT NULL,
  PRIMARY KEY (adapter_id, version),
  CHECK ((kind = 'rules') = (rules_sha256 IS NOT NULL))
) STRICT;

CREATE TABLE adapter_fixture (
  fixture_id           TEXT PRIMARY KEY,
  adapter_id           TEXT NOT NULL,
  adapter_version      TEXT NOT NULL,
  artifact_sha256      TEXT NOT NULL REFERENCES artifact(sha256),
  expected_sha256      TEXT NOT NULL,                   -- hash of canonical expected output
  origin               TEXT NOT NULL CHECK (origin IN ('exhaustive_audit','sampled_audit','picker_confirm')),
  created_at           TEXT NOT NULL,
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version)
) STRICT;

-- ══ Observations: append-only ════════════════════════════════════════
CREATE TABLE observation (
  observation_id       TEXT PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES job(job_id),
  route_id             TEXT NOT NULL REFERENCES route(route_id),
  artifact_sha256      TEXT NOT NULL REFERENCES artifact(sha256),
  adapter_id           TEXT NOT NULL,
  adapter_version      TEXT NOT NULL,
  record_locator       TEXT NOT NULL,
  parse_state          TEXT NOT NULL CHECK (parse_state IN
     ('parsed','quarantined_schema_drift','rejected_not_centre','blocked_source')),
  published_name       TEXT,
  published_address    TEXT,
  published_country    TEXT,
  published_phone      TEXT,
  published_website    TEXT,
  published_apply_url  TEXT,
  official_relationship_wording TEXT,
  evidence_quote       TEXT NOT NULL,
  retrieved_at_utc     TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version)
) STRICT;

-- ══ Governed entities ════════════════════════════════════════════════
CREATE TABLE centre (
  centre_id            TEXT PRIMARY KEY,
  display_name         TEXT NOT NULL,
  registrable_domain   TEXT,
  website_url          TEXT,
  entity_state         TEXT NOT NULL CHECK (entity_state IN ('active','merged_into','rejected')),
  merged_into_id       TEXT REFERENCES centre(centre_id),
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  CHECK ((entity_state = 'merged_into') = (merged_into_id IS NOT NULL))
) STRICT;

CREATE TABLE centre_identifier (
  id_kind              TEXT NOT NULL CHECK (id_kind IN
     ('official_provider_id','domain','legacy_tc_id','org_number')),
  id_value             TEXT NOT NULL,
  centre_id            TEXT NOT NULL REFERENCES centre(centre_id),
  source_id            TEXT REFERENCES source(source_id),
  PRIMARY KEY (id_kind, id_value)
) STRICT;

CREATE TABLE centre_location (
  location_id          TEXT PRIMARY KEY,
  centre_id            TEXT NOT NULL REFERENCES centre(centre_id),
  country_iso2         TEXT,
  locality             TEXT,
  address_published    TEXT,
  latitude             REAL,
  longitude            REAL,
  coords_state         TEXT NOT NULL CHECK (coords_state IN ('published','not_published')),
  observation_id       TEXT NOT NULL REFERENCES observation(observation_id),
  CHECK ((coords_state = 'published') = (latitude IS NOT NULL AND longitude IS NOT NULL))
) STRICT;

CREATE TABLE centre_contact (
  contact_id           TEXT PRIMARY KEY,
  centre_id            TEXT NOT NULL REFERENCES centre(centre_id),
  contact_kind         TEXT NOT NULL CHECK (contact_kind IN
     ('org_phone','org_role_inbox','apply_url','enquiry_form')),
  contact_value        TEXT NOT NULL,
  is_personal_data     INTEGER NOT NULL CHECK (is_personal_data IN (0,1)),
  observation_id       TEXT NOT NULL REFERENCES observation(observation_id),
  verified_at_utc      TEXT
) STRICT;

CREATE TABLE accreditation (
  accreditation_id     TEXT PRIMARY KEY,
  centre_id            TEXT NOT NULL REFERENCES centre(centre_id),
  source_id            TEXT NOT NULL REFERENCES source(source_id),
  route_id             TEXT NOT NULL REFERENCES route(route_id),
  relationship_verbatim TEXT NOT NULL,
  relationship_class   TEXT NOT NULL CHECK (relationship_class IN
     ('approved','accredited','authorised','member','partner','unclassified')),
  direction            TEXT NOT NULL CHECK (direction IN ('forward','reverse')),
  evidence_strength    TEXT NOT NULL CHECK (evidence_strength IN
     ('official_directory','centre_self_claim')),
  observation_id       TEXT NOT NULL REFERENCES observation(observation_id),
  UNIQUE (centre_id, source_id, route_id),
  CHECK ((evidence_strength = 'centre_self_claim') = (direction = 'reverse'))
) STRICT;

CREATE TABLE certificate (
  certificate_id       TEXT PRIMARY KEY,
  source_id            TEXT NOT NULL REFERENCES source(source_id),
  official_code        TEXT,
  certificate_name     TEXT NOT NULL,
  official_url         TEXT
) STRICT;

CREATE TABLE offering (
  offering_id          TEXT PRIMARY KEY,
  centre_id            TEXT NOT NULL REFERENCES centre(centre_id),
  certificate_id       TEXT NOT NULL REFERENCES certificate(certificate_id),
  location_id          TEXT REFERENCES centre_location(location_id),
  delivery_mode        TEXT CHECK (delivery_mode IS NULL OR delivery_mode IN
     ('classroom','blended','online','unknown')),
  apply_url            TEXT,
  observation_id       TEXT NOT NULL REFERENCES observation(observation_id)
) STRICT;

CREATE UNIQUE INDEX ux_offering ON offering (
  centre_id, certificate_id, COALESCE(location_id,''), COALESCE(delivery_mode,'unknown'));

CREATE TABLE price_observation (
  price_id             TEXT PRIMARY KEY,
  offering_id          TEXT NOT NULL REFERENCES offering(offering_id),
  amount               REAL NOT NULL CHECK (amount > 0),
  currency             TEXT NOT NULL CHECK (length(currency) = 3),
  price_basis          TEXT NOT NULL CHECK (price_basis IN
     ('per_person','per_course','per_group','from')),
  includes_vat         INTEGER CHECK (includes_vat IS NULL OR includes_vat IN (0,1)),
  inclusions_note      TEXT,
  valid_from           TEXT,
  observation_id       TEXT NOT NULL REFERENCES observation(observation_id)
) STRICT;

-- ══ Quality ══════════════════════════════════════════════════════════
CREATE TABLE count_variance (
  variance_id          TEXT PRIMARY KEY,
  route_id             TEXT NOT NULL REFERENCES route(route_id),
  artifact_sha256      TEXT NOT NULL REFERENCES artifact(sha256),
  published_count      INTEGER,
  extracted_count      INTEGER NOT NULL CHECK (extracted_count >= 0),
  structural_count     INTEGER NOT NULL CHECK (structural_count >= 0),
  container_resolved   INTEGER NOT NULL CHECK (container_resolved IN (0,1)),
  status               TEXT NOT NULL CHECK (status IN
     ('reconciled','parser_bug','adjudicated_source_variance','unexplained')),
  unit_explanation     TEXT,
  adjudicated_by       TEXT,
  adjudicated_at       TEXT,
  evidence_quote       TEXT
) STRICT;

CREATE TABLE audit_sample (
  sample_id            TEXT PRIMARY KEY,
  route_id             TEXT NOT NULL REFERENCES route(route_id),
  adapter_id           TEXT NOT NULL,
  adapter_version      TEXT NOT NULL,
  strategy             TEXT NOT NULL CHECK (strategy IN ('exhaustive','stratified_random')),
  n_sampled            INTEGER NOT NULL CHECK (n_sampled > 0),
  n_errors             INTEGER NOT NULL CHECK (n_errors >= 0),
  error_detail_json    TEXT NOT NULL,
  accuracy_lower_cp    REAL NOT NULL,        -- one-sided Clopper-Pearson, alpha=0.05
  audited_by           TEXT NOT NULL,
  audited_at           TEXT NOT NULL,
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version)
) STRICT;

CREATE TABLE field_health (
  route_id             TEXT NOT NULL REFERENCES route(route_id),
  adapter_version      TEXT NOT NULL,
  field_name           TEXT NOT NULL,
  run_at               TEXT NOT NULL,
  fill_rate            REAL NOT NULL CHECK (fill_rate BETWEEN 0 AND 1),
  baseline_mean        REAL,
  baseline_sd          REAL,
  alert_state          TEXT NOT NULL CHECK (alert_state IN ('ok','warn','block')),
  PRIMARY KEY (route_id, adapter_version, field_name, run_at)
) STRICT;

-- ══ Human-in-the-loop ════════════════════════════════════════════════
CREATE TABLE escalation (
  escalation_id        TEXT PRIMARY KEY,
  kind                 TEXT NOT NULL CHECK (kind IN
     ('pick_selector','pick_pagination','capture_page','solve_access','confirm_extraction',
      'confirm_merge','classify_relationship','confirm_new_source','confirm_no_data','merge_conflict')),
  status               TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','wont_fix','expired')),
  priority             INTEGER NOT NULL,
  route_id             TEXT REFERENCES route(route_id),
  centre_id            TEXT REFERENCES centre(centre_id),
  target_url           TEXT,
  question             TEXT NOT NULL,
  context_json         TEXT NOT NULL,
  resolution_json      TEXT,
  produced_rule_id     TEXT REFERENCES rule(rule_id),
  opened_at            TEXT NOT NULL,
  resolved_at          TEXT
) STRICT;

CREATE TABLE rule (
  rule_id              TEXT PRIMARY KEY,
  rule_kind            TEXT NOT NULL CHECK (rule_kind IN
     ('selector','pagination','host_recipe','name_alias','merge_decision','reject_pattern')),
  scope_kind           TEXT NOT NULL CHECK (scope_kind IN
     ('url','host','template_fingerprint','global')),
  scope_value          TEXT NOT NULL,
  payload_json         TEXT NOT NULL,
  origin_escalation    TEXT REFERENCES escalation(escalation_id),
  hit_count            INTEGER NOT NULL DEFAULT 0,
  last_hit_at          TEXT,
  confidence           REAL NOT NULL DEFAULT 1.0,
  created_at           TEXT NOT NULL
) STRICT;

CREATE TABLE review_queue (
  review_id            TEXT PRIMARY KEY,
  review_kind          TEXT NOT NULL CHECK (review_kind IN
     ('merge_candidate','relationship_class','new_source_candidate')),
  payload_json         TEXT NOT NULL,
  proposed_by          TEXT NOT NULL CHECK (proposed_by IN ('resolver','llm')),
  confidence           REAL,
  status               TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
  decided_at           TEXT
) STRICT;

-- ══ Operations ═══════════════════════════════════════════════════════
CREATE TABLE job (
  job_id               TEXT PRIMARY KEY,
  mission_id           TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  actor                TEXT NOT NULL,
  params_json          TEXT NOT NULL,
  git_commit           TEXT NOT NULL,
  started_at           TEXT NOT NULL,
  finished_at          TEXT,
  outcome              TEXT CHECK (outcome IS NULL OR outcome IN
     ('success','failed','aborted','superseded'))
) STRICT;

CREATE TABLE supervisor_tick (
  tick_id              TEXT PRIMARY KEY,
  ticked_at            TEXT NOT NULL,
  phase                TEXT NOT NULL,
  queue_depth          INTEGER NOT NULL,
  open_escalations     INTEGER NOT NULL,
  failed_jobs_24h      INTEGER NOT NULL,
  notes                TEXT
) STRICT;
```

## 4.2 Merge safety [NORMATIVE]

Centre IDs MUST NOT be deleted. Superseding is `entity_state='merged_into'` plus `merged_into_id`. Every merge MUST store both pre-merge records in full in a `merge_audit` table so that every merge is reversible. A merge that cannot be reversed MUST NOT be performed.

---

# Part 5 — Fetch layer [NORMATIVE]

## 5.1 Politeness contract (enforced in the egress proxy, S16–S18)

**F1.** Identify honestly: `User-Agent: GPSolutionTrainingCentreBot/1.0 (+<contact-url>; research indexing of publicly published approved-provider lists)`.

**F2.** Fetch and honour `robots.txt` before any request to a new host. Store its sha256 on every attempt. `Disallow` on the target path → `route_state = blocked_robots`, never fetched, escalate for a human decision.

**F3.** One in-flight request per host. Concurrency across distinct hosts only. `crawl_delay_s` default 5.0, jittered ±30%, raised to any published `Crawl-delay`.

**F4.** Conditional requests always. Store and send `ETag` / `Last-Modified`.

**F5.** MUST NOT: rotate proxies or IPs, vary the User-Agent to evade, solve CAPTCHAs, spoof fingerprints, reuse a third party's session cookie, or bypass a login.

**F6.** Prefer published machine-readable endpoints that the site's own front-end calls. This is documented behaviour, not evasion.

## 5.2 Circuit breaker — transient vs terminal [NORMATIVE]

The V2 draft collapsed these. They are now distinct.

```
On a failed attempt, classify:

  TRANSIENT   429, 503, timeout, connection reset
  AMBIGUOUS   403
  TERMINAL    401, explicit login wall, CAPTCHA challenge page, robots disallow

TRANSIENT:
  host_state.consecutive_failures += 1
  suspend host until now + max(Retry-After, 24h)   [suspension_cycles += 1]
  route_state := 'awaiting_retry'
  NO escalation on the first two suspension cycles.
  On the third consecutive cycle ending in TRANSIENT failure:
      route_state := 'needs_human'; open solve_access escalation.

AMBIGUOUS (403):
  first occurrence  → treat as TRANSIENT (suspend 24h, awaiting_retry, no escalation)
  second consecutive suspension cycle also ending in 403
                    → route_state := 'blocked_access'; open solve_access escalation

TERMINAL:
  immediately route_state := 'blocked_access' (or 'blocked_robots')
  open solve_access escalation; no retry.

Recovery: any attempt with outcome content_200 or not_modified_304 resets
consecutive_failures and suspension_cycles to 0.
```

**`awaiting_retry` is a transient route state and MUST NOT be reported as blocked in coverage.** It appears in operations telemetry only.

## 5.3 Tiers [NORMATIVE]

| Tier | Used when | Outcome recorded |
|---|---|---|
| T1 HTTP | static HTML, JSON, PDF | `content_200` / `not_modified_304` / error |
| T2 Headless render | client-rendered with no reachable API | `content_200`; DOM and screenshot both stored |
| T3 Human capture | session required, terminal 403, auth wall | **`human_capture`**, `fetch_tier=3`, `captured_by` set |

T3 is a first-class, auditable input, not a workaround. It carries no `http_status` requirement.

## 5.4 Freshness [NORMATIVE]

```
last_content_verified_at(route) := MAX(requested_at_utc) over attempts where
    outcome = 'not_modified_304'
 OR (outcome IN ('content_200','human_capture') AND artifact_sha256 = current bound artifact)
```

A 304 proves freshness without minting a duplicate artifact.

---

# Part 6 — Adapters [NORMATIVE]

**A1.** An adapter is a JSON rules document unless a written justification for a code adapter is committed in its header.

**A2.** Every selector MUST carry three fallback strategies in priority order: stable attribute → role+text → structural path. The engine records which fired. If the primary fails on ≥20% of rows, emit `quarantined_schema_drift` and open `pick_selector`. It MUST NOT silently degrade.

**A3.** `template_fingerprint` = hash of the structural skeleton (tag-path histogram + landmark attributes, content stripped). Adapters bind to fingerprints, not just URLs.

**A4.** A new `(adapter_id, version)` MUST have ≥1 row in `adapter_fixture` before any route may reference it.

**A5.** An adapter MUST NOT write to the database. It returns observations.

**A6.** `list.empty_is_valid` and `list.container` are mandatory fields. The engine MUST record `container_resolved` separately from `extracted_count` — see Part 12.3.

---

# Part 7 — Observation contract [NORMATIVE]

Required on every observation: `observation_id`, `job_id`, `route_id`, `artifact_sha256`, `adapter_id`, `adapter_version`, `record_locator`, `parse_state`, `evidence_quote`, `retrieved_at_utc`.

Contacts MUST remain observations until all pass: syntactic validation, official-page context, organisation-level role/publication check, evidence locator, retrieval timestamp, freshness policy. Loose numbers harvested from scripts, CSS, coordinates or page source MUST be rejected.

`is_personal_data` MUST be classified at write time, not filtered at export time. A contact tied to a named individual MUST be `is_personal_data = 1` and MUST be excluded from default exports.

---

# Part 8 — Entity resolution [NORMATIVE]

**R1.** Deterministic keys in order: official provider ID → registrable domain (eTLD+1) → normalized name + country + locality.

**R2.** An LLM MUST NOT merge. It MAY propose into `review_queue`.

**R3.** Blocking invariants — a merge MUST be refused if any holds:
- different registrable domains, both non-null;
- different official provider IDs from the same source;
- different countries;
- combined location count would exceed 25 without an explicit parent relationship.

**R4.** Under-merge detectors run nightly into `review_queue`: same domain different centre_id; same official provider id different centre_id; name similarity ≥0.92 + same country + unlinked.

**R5.** A labelled set of ≥300 candidate pairs MUST exist. Every resolver change reports precision and recall against it. A change that drops precision below 0.99 MUST be rejected, regardless of recall gain.

---

# Part 9 — Discovery [NORMATIVE]

## 9.1 Forward
`source(confirmed) → routes → fetch → parse → observations → resolve → accreditation(direction='forward', evidence_strength='official_directory')`. Gated by count reconciliation (Part 11.1).

## 9.2 Reverse — bounded, never a site crawl

**D1.** Max 3 pages per centre host, depth ≤2 from the homepage.
**D2.** Only intent paths: `/about`, `/accreditation(s)`, `/approval(s)`, `/certification(s)`, `/quality`, `/partners`, `/memberships`, plus homepage footer links.
**D3.** Same politeness contract. A centre host that fails is skipped, not escalated.
**D4.** Priority: centres with most existing accreditations first, then country coverage gaps.

**D5.** Claim signals, descending strength: (a) outbound link to a known association domain; (b) logo filename / alt text / adjacent heading matching a known name or acronym; (c) text matching `(approved|accredited|authorised|certified|recognised)\s+(by|training\s+(centre|provider))\s+([A-Z][\w&.\- ]{2,60})`.

**D6.** Every reverse claim is written with `direction='reverse'`, `evidence_strength='centre_self_claim'`. It MUST NOT be promoted to a confirmed accreditation. It triggers a fetch of that association's own directory; only appearance there creates a `forward` row.

**D7.** A new source requires human confirmation via `confirm_new_source`.

---

# Part 10 — The blob (human-in-the-loop) [NORMATIVE]

**B1.** Chrome MV3 extension plus a local API on `127.0.0.1`. It queries: any escalation for this URL, host, or template fingerprint?

**B2.** Five modes: pick element, pick fields, capture page, record action, confirm extraction.

**B3.** The blob MUST NOT click, submit or navigate autonomously. It highlights and instructs; the human acts.

**B4.** It MUST NOT capture a page whose host matches the configured personal deny-list.

**B5.** On resolution it MUST queue the next escalation and offer to navigate there.

**B6.** Every resolution writes a `rule` at the narrowest scope that is provably safe, and the rule engine matches `url` → `host` → `template_fingerprint` in widening order.

**B7.** `intervention_rate = escalations_resolved / new_centre_records_written` MUST be published weekly. A flat or rising trend over 4 weeks is a defect and MUST raise an engineering escalation.

---

# Part 11 — Verification and QA [NORMATIVE]

## 11.1 Three-way count reconciliation

Compute over the same artifact: `published_count`, `extracted_count`, `structural_count` (a counting method sharing no code with the adapter).

```
extracted = structural = published            → reconciled
extracted ≠ structural                        → parser_bug. Block. Escalate.
extracted = structural, extracted ≠ published → adjudicate; may be a legitimate unit difference
```

Adjudications are sticky: once a unit explanation and ratio are recorded, matching future runs auto-reconcile. A variance of exactly ±1 MUST raise its own alert.

## 11.2 Sampling — one-sided Clopper–Pearson throughout

**Q1.** Routes with `extracted_count ≤ 50`: exhaustive human verification on first extraction, result stored as a fixture. Verified once in the project's lifetime.

**Q2.** Larger routes: stratified sampling (by pagination bucket, country section, and optional-field presence). Uniform random sampling MUST NOT be used; it under-tests the tail where pagination failures live.

**Q3.** The gate is **one-sided Clopper–Pearson lower bound ≥ 0.95 at α = 0.05**. The acceptance table is *derived* from that rule, not stated independently:

| n | accept if errors ≤ | check |
|---:|---:|---|
| 59 | 0 | `0.05^(1/59) = 0.9505 ≥ 0.95` ✓ |
| 93 | 1 | equivalent by construction |
| 124 | 2 | equivalent by construction |
| 153 | 3 | equivalent by construction |

`CP one-sided lower ≥ 0.95` ⟺ `P(X ≤ c | n, p=0.05) ≤ 0.05`. The two formulations are the same condition. Wilson MUST NOT be used.

**Q4.** Reports MUST quote the lower bound with n and error count, never a point estimate.

## 11.3 Invariant tiers

```
T-WRITE  (in transaction)  FK, CHECK, uniqueness, merge-safety, coords_state,
                           self-claim/direction coherence, job-id presence
T-RUN    (end of route)    count reconciliation, field fill-rate deltas
T-NIGHT  (full corpus)     orphan sweep, counter recompute, under-merge detectors
T-WEEK   (sampled)         artifact rehash: 2% random + all artifacts touched this week
T-MONTH                    full artifact rehash; R1 rebuild + rebuild_hash assertion
```

Rotate the weekly sample so every artifact is rehashed at least quarterly. Full-store rehash MUST NOT run at transaction time or nightly.

## 11.4 Field health

Per `(route, adapter_version, field)`: fill rate versus trailing 3-run baseline. Alert on >3 SD movement or >20 percentage points absolute. Row count being correct while a field silently empties is a distinct failure class and this is the only control that catches it.

Plausibility validators produce **flags, never deletions**: E.164 + country-code consistency; valid registrable domain; ISO-3166 country; coordinates inside country bounding box; name length and placeholder set; apply-url domain match; price within 3 IQR of the certificate's distribution.

## 11.5 N-version and the LLM oracle

**Q5.** Routes with `published_count ≥ 100` MUST be extracted twice by structurally different means (DOM-based and text-regex-based). Disagreement blocks the write.

**Q6.** The LLM oracle (list every provider named on this page, or NONE) is a **disagreement detector**. It is used asymmetrically:
- Names the LLM found that the parser missed → escalate; likely undercount.
- The LLM MAY veto a `verified_empty` determination. It MUST NOT be sufficient to establish one.

## 11.6 Replay

**R1 — full rebuild (monthly).** Drop the DB, replay every parser over every artifact, assert `rebuild_hash` equality and identical invariant sweep results.

**Canonical projection** (replaces "byte-identical"): per table in fixed order, `SELECT *` ordered by primary key, columns in declared order, `NULL → \N`, REAL at fixed precision, timestamps normalized to UTC ISO-8601 `Z`, text UTF-8 NFC, serialized NDJSON with LF endings. `table_hash = sha256(bytes)`; `rebuild_hash = sha256(concat(table_hash…))`. SQLite file bytes are not reproducible and MUST NOT be compared.

**R2 — version diff (mandatory on every adapter version bump).** Replay both versions over all stored artifacts for that route. Report rows added, rows dropped, fields changed. **A version bump that drops rows MUST carry a written justification recorded against the version, or be rejected.**

**R3 — historical backtest.** Today's adapter against last quarter's artifacts; quantifies historical error.

## 11.7 Metamorphic properties

`parse(a) == parse(a)`; `parse(p1) ∪ parse(p2) == parse(p1+p2)`; **`resolve(shuffle(x)) == resolve(x)`**; merge order independence; adding one centre changes the count by exactly one; merging preserves total accreditation count; `export → import → export` round-trips.

## 11.8 Coverage — primary and secondary instruments

**Primary: orphan-claim rate.** Per source:
```
orphan_claim_rate  = reverse claims not present in that source's forward directory ÷ total reverse claims
forward_orphan_rate = directory centres whose own site never mentions the body ÷ directory size
```
Needs no population assumption, computed continuously, and localises a gap to a specific source. Alert at 2× the corpus median.

**Secondary and exploratory: capture–recapture.** [HYPOTHESIS-BEARING]

**C1.** It MUST NOT be a governed KPI and MUST NOT appear in any coverage claim without its model stated.
**C2.** Each application MUST first declare a **closed population that both lists demonstrably sample** — one scheme, one country, one time window. Pairing two bodies with different accreditation scopes (for example rope-access versus offshore oil-and-gas) is invalid and MUST be rejected.
**C3.** Prefer ≥3 lists with a log-linear model so dependence is estimated rather than assumed.
**C4.** Results MUST be reported as a **sensitivity range** across independence, positive-dependence and heterogeneity models. The estimate MUST NOT be described as a guaranteed lower bound: downward bias holds under positive list dependence and capture heterogeneity, but if two bodies act as substitutes rather than complements, overlap falls below independence and the estimate inflates instead.
**C5.** Optional assumption-light cross-check: coverage against an external frame such as a national company register filtered to training activity codes.

## 11.9 Freshness SLO

≥95% of terminal-state routes within 1× their refetch window; 100% within 2×. Beyond 2× the route is demoted to `stale` and MUST NOT be counted as complete.

## 11.10 Scorecard

```
route_quality_score = 0.30·count_reconciliation + 0.25·verification_confidence
                    + 0.20·field_completeness   + 0.15·freshness
                    + 0.10·adapter_maturity
```
Corpus grade published with denominators and with every number backed by a stored SQL definition.

---

# Part 12 — Terminal state: the single completion gate [NORMATIVE]

This replaces every completion rule in every prior draft. There is exactly one.

## 12.1 The function

```
route_terminal_state(route) :=
  blocked_robots              if robots disallows the path
  blocked_access              if circuit breaker reached terminal (Part 5.2)
  awaiting_retry              if host suspended, cycles < threshold          [transient]
  needs_human                 if any open blocking escalation
  stale                       if age > 2 × refetch window
  partial                     if 0 < extracted_count < published_count
  verified_empty              if corroborated_empty(route)                    [see 12.3]
  blocked_no_public_rows      if extracted_count = 0 AND published_count > 0
  complete_reconciled         if published_count > 0
                                 AND count_quality = 'published'
                                 AND variance.status IN ('reconciled','adjudicated_source_variance')
                                 AND extracted_count = structural_count
                                 AND verification_passed(route)
  complete_count_unpublished  if count_quality = 'not_published'
                                 AND extracted_count = structural_count
                                 AND extracted_count > 0
                                 AND verification_passed(route)
                                 AND second_source_corroboration(route)
  unresolved                  otherwise

verification_passed(route) :=
     (extracted_count ≤ 50 AND exhaustive audit recorded with 0 errors)
  OR (sampled audit recorded with accuracy_lower_cp ≥ 0.95)
  AND no field_health row at alert_state = 'block'
  AND adapter has ≥1 passing fixture
```

## 12.2 Enforcement

**T1.** `route_state` MUST be computed by the writer service on every route transition. No API, no script, no agent and no human may set it directly. A test MUST demonstrate that a direct write is rejected.

**T2.** Coverage reporting MUST present `complete_reconciled`, `complete_count_unpublished` and `verified_empty` on **three separate lines with three denominators**. Collapsing them is what produced the V2 report of 27 complete / 2 blocked when six national routes carried status text beginning `"blocked - "`.

## 12.3 `corroborated_empty` — deterministic evidence required

An officially empty directory is data. A failed selector is not. The discriminator is deterministic and MUST NOT rest on an LLM.

```
corroborated_empty(route) :=
      container_resolved = 1                       ← the list element was FOUND and rendered
  AND extracted_count = 0
  AND structural_count = 0
  AND (published_count IS NULL OR published_count = 0)
  AND ≥2 fetch attempts ≥24h apart, both satisfying all of the above
  AND at least ONE independent deterministic corroboration:
        (a) a second structural counting method, sharing no code, also returns 0; OR
        (b) an explicit textual no-records statement on the page matched by a
            registered regex, stored as evidence_quote; OR
        (c) T3 human confirmation recorded via confirm_no_data
  AND the LLM oracle has NOT returned any provider names        ← veto only
```

`container_resolved = 1` is the load-bearing condition: it proves we located the right element and it rendered, so zero rows is the source's statement rather than our failure. The LLM oracle may **veto** by finding names; it may never **establish** emptiness.

---

# Part 13 — Phases and GO/NO-GO gates [NORMATIVE]

## Phase 0 — Freeze and recover

**Scope: 6,990 dangling rows across 2,035 distinct canonical IDs.** Of these, 1,762 are present in at least one retained historical master; 273 are not. Of the 273, exactly 2 (`TC-011072`, `TC-011073`) are reachable through the crosswalk check and 271 are invisible to it, appearing in no master, current or historical.

Phase 0 runs entirely in a **separate recovery database**. No governed write occurs.

### GO gate — all eleven MUST hold

1. **Immutable pre-recovery snapshot — of a dedicated copy.** Copy `current/` and `historical/` to `recovery/snapshot-<ts>/`; hash every file in both source and copy; assert they match file-for-file; write `SNAPSHOT-PROVENANCE.json` recording source path, copy time, tool and both hash sets; make **the copy** read-only. The live evidence tree MUST NOT have its permissions altered — it is shared with unrelated work. Publish the provenance hash in the recovery README. Nothing may be adjudicated before this exists.
2. **Recovery ledger** with one row per member of the 2,035-ID union: id, referencing tables, referencing row count, backups containing it, decision ∈ `{restore_from_backup, remap_to_survivor, reject_references, unresolved}`, decided_by, evidence.
3. Zero rows remaining at `unresolved`.
4. Each of the 271 no-provenance IDs carries a disposition **and** a root-cause record. `root_cause = 'unknown'` is a complete and acceptable answer; a cause may be **asserted** only from direct evidence (a snapshot containing the ID, or an execution log showing the write). Patterns worth noting are recorded as an explicitly bounded `root_cause_hypothesis` with a `hypothesis_basis` that states what the basis does **not** establish. **Numeric ID position is not evidence** and MUST NOT be used to assert a cause. An asserted cause lacking direct evidence is a gate FAILURE.
5. `TC-011072` and `TC-011073` explicitly dispositioned. No attribution may be assumed; the evidence pack does not establish one.
6. All four lineage drops recorded with decisions: −1,766 (marina batch6), −166 (confirmed-new reconciliation), −30 (apec-antwerp import), −7 (confirmed-user-import batch). The retained window limit is stated: it opens 2026-08-13 at 10,666, so the 10,878 → 10,666 transition lies outside it.
7. The ledger status change — 75 `confirmed_new` → `existing` — explained or reversed.
8. Post-recovery FK audit across **all five** referencing tables returns zero dangling references.
9. All three counter invariants pass (`relationship_count`, `location_count`, `association_count`).
10. Independent re-verification by a second agent that did not produce the ledger, recomputing from primary artifacts per L5 and publishing its reproduction command.
11. Written attestation that no governed write occurred outside the recovery database.

**NO-GO on any single failure.**

## Phase 1 — The spine

Isolated database. One route: OSHA OTI, 36 records.

**Do:** `schema.sql`; artifact store; source registry; egress proxy with the full politeness contract and circuit breaker; T1 fetcher; one hand-written adapter; observation writer; deterministic resolver; single writer; supervisor v1; job ledger.

### GO gate — all nine MUST hold

1. `foreign_keys=ON` verified at runtime by a startup check that aborts on failure; all CHECK constraints present.
2. Fetch → artifact → parse → observation → resolve → write completes end to end.
3. Re-run is a no-op: one `not_modified_304` attempt, zero new artifacts, zero new observations.
4. R1 replay from artifacts reproduces an identical `rebuild_hash`.
5. Three-way reconciliation: published 36 = extracted 36 = structural 36, status `reconciled`.
6. Exhaustive human verification of all 36 records; stored as a fixture.
7. T-WRITE invariants pass; T-NIGHT sweep clean.
8. Terminal state computes to `complete_reconciled`.
9. A test demonstrates that writing `route_state` directly is rejected by the writer.

**NO-GO on any single failure. Governed writes to production remain paused until this passes.**

## Phase 2 — Adapter registry
Rules engine; fixture harness; `template_fingerprint`; migrate three archetypes (paginated HTML, JSON API, PDF).
**Done when:** four adapters, all rules-based, all with ≥1 fixture; a deliberate DOM change in a fixture yields `quarantined_schema_drift`, not silent wrong data; R2 version-diff runs and blocks on unjustified row drops.

## Phase 3 — The blob
Escalation table + local API; MV3 extension; five modes; rule store with three scopes; T3 capture producing `human_capture` attempts.
**Done when:** ≥3 currently-blocked routes resolved with no hand-written code; a selector authored on one EMSA DONA country page parses a second country page with zero further input.

## Phase 4 — Scale forward discovery
T2 tier; per-host budgets; state machine end to end; completion gate enforced; dashboard from SQL views only.
**Done when:** the 96-row route map is represented as `route` rows in enum states; ≥40 routes in a terminal complete state under Part 12; zero hardcoded literals in reporting.

## Phase 5 — Reverse discovery
Bounded crawler; claim extractor; source matcher; `confirm_new_source`; forward-verification loop.
**Done when:** ≥500 centre sites processed within bounds; ≥10 new bodies confirmed; every reverse claim either verified forward or still flagged `centre_self_claim`.

## Phase 6 — Learning and metrics
Rule generalization; alias and reject learners; `intervention_rate`; error-class ranking; capture–recapture per Part 11.8 constraints.
**Done when:** `intervention_rate` falls for four consecutive weeks; ≥60% of parses served by rules at `host` or `template` scope.

## Phase 7 — Costs and apply links
Offering-scoped `apply_url`; price observations; course-page adapters.
**Done when:** price coverage reported as a percentage with an explicit denominator; no price without currency, basis and evidence quote.

## Phase 8 — Hardening
Retention and GC; personal-data export filtering; GDPR basis and retention documented; incremental backups; runbook.
**Done when:** full restore + artifact replay reproduces `rebuild_hash`; default exports contain no `is_personal_data = 1` rows.

---

# Part 14 — Assumptions register [HYPOTHESIS]

None of the following is a commitment. Each MUST be measured in the Phase 1–2 pilot and re-forecast with an interval after five completed routes.

| # | Hypothesis | Basis | How measured |
|---|---|---|---|
| H1 | ~800 fetches for forward discovery | 277 bodies × ~3 pages | pages per route, recorded per job |
| H2 | ~30,000 fetches for reverse discovery | ~10,000 centres × ≤3 pages | actual hosts reached vs skipped |
| H3 | 5–6 hours of fetch wall-clock | 1 req/host/5s × 8 hosts | proxy latency and throughput logs |
| H4 | 1.5–3 GB gzipped artifact storage | ~200 KB/page, ~4:1 gzip | bytes stored per artifact |
| H5 | ~10% of routes require T3 | 9 of 29 observed blocked in V2 | T3 attempts ÷ total routes |
| H6 | Human intervention declines with template scope | EMSA DONA shares one template | `intervention_rate` weekly |
| H7 | Price data available for <10% of offerings | industry norm | price coverage with denominator |

Additional stated assumptions: the politeness contract assumes hosts honour `Retry-After` and publish accurate `robots.txt`; the retained-snapshot window covers 2026-08-13 onward only; capture–recapture requires a closed population that both lists sample (Part 11.8).

---

# Part 15 — Change log against prior drafts

| # | Change | Origin | Prior state |
|---|---|---|---|
| C1 | Phase 0 scope set to 2,035 IDs / 6,990 rows | Correction brief item 1, reproduced by operator | Draft said 2,035 without reproduction; reviewer proposed 1,764 |
| C2 | No attribution for TC-011072/TC-011073 | Correction brief item 1 | Reviewer labelled them MARINA reconstructions |
| C3 | Single computed terminal-state function; `verified_empty` and `complete_count_unpublished` added | Review item 2 | Two conflicting rules; both failed on Belgium and IALA |
| C4 | `(adapter_id, version)` composite PK; composite FKs from route and observation | Review item 3 | `adapter_id` sole PK contradicted `UNIQUE(adapter_id, version)` |
| C5 | Canonical projection hash replaces byte-identical rebuild | Review item 4 | SQLite files are not byte-reproducible |
| C6 | `artifact` / `fetch_attempt` split | Review item 5 | 304s were unrepresentable |
| C7 | Capture–recapture demoted to secondary; closed-population requirement; sensitivity range; IRATA/OPITO example struck | Review item 6 (accepted with amendment) | Presented as a guaranteed lower bound with an invalid pairing |
| C8 | One-sided Clopper–Pearson throughout; table derived from the rule | Review item 7 | Wilson gate contradicted the acceptance table |
| C9 | Invariant tiers T-WRITE / T-RUN / T-NIGHT / T-WEEK / T-MONTH | Review item 8 | Artifact rehash implied at transaction time |
| C10 | Real CHECK/FK/NOT NULL; `scheme_scope NOT NULL DEFAULT ''`; expression unique index on offering | Review item 9 | Nullable uniqueness constraints were inert |
| C11 | Phase 0 gate expanded to eleven criteria | Review item 10 | Two-line done-when |
| C12 | All estimates labelled HYPOTHESIS with a measurement plan | Review item 11 | Presented as conclusions |
| C13 | `awaiting_retry` transient state; 403 escalation ladder; transient/ambiguous/terminal classification | Operator adjustment 1 | Single 429 could reach `blocked_access` |
| C14 | `human_capture` fetch outcome; tier-3 coherence CHECKs | Operator adjustment 2 | T3 could not produce a valid attempt row |
| C15 | `corroborated_empty` requires `container_resolved`, two attempts, and deterministic corroboration; LLM is veto-only | Operator adjustment 3 | Rested on an LLM returning NONE |
| C16 | Part 2 supervision layer added in full | *Raising Agentic Children* | Absent |
| C17 | Law L3 (determinism) and L5 (recompute, don't inherit) added | Article + the 1,764 incident in review | Absent |
| C18 | Politeness moved into the egress proxy, outside agent reach | Article — lock it out of reach | Was a library convention |
| C19 | Job ledger with git commit; writes require a job id | Article — every action logged | The 07:07 overwrite was unattributable |
| **A1** | Root cause assertable only from direct evidence; `pre_window_lineage_break` removed from the assertable enum; bounded `root_cause_hypothesis` + `hypothesis_basis` added; numeric ID position explicitly disqualified | Operator amendment 1 | Runbook inferred cause from numeric position — a heuristic presented as a finding |
| **A2** | Freeze a dedicated snapshot copy with dual-hash provenance; never alter permissions on the live shared tree | Operator amendment 2 | Runbook said `chmod -R` / `chattr +i` the whole tree |
| **A3** | `foreign_keys` documented as per-connection and non-persistent; mandatory `assert_db_preconditions.open_db()`; build-failing precondition test | Operator amendment 3 | Header note only; easy to open a raw connection with FKs silently OFF |

---

# Part 16 — Standing rules

1. The database is the master; exports are generated and never read back.
2. One writer. Transactional, FK-enforced, DB advisory lock. Never a `/tmp` flock.
3. Canonical IDs are never deleted. Supersede only.
4. Observations are append-only.
5. No network access outside `src/fetch`; enforced by a lint rule and by the egress proxy.
6. No LLM call inside `src/fetch`, `src/parse` or `src/write`.
7. Free text is confined to `state_reason`, `relationship_verbatim`, `evidence_quote`, and escalation `question`. Every other status column is a CHECK-constrained enum.
8. Every governed number has a stored SQL definition. No literals in reporting code.
9. New adapter version requires a fixture. New enum value requires a migration.
10. When blocked, escalate — never retry harder.
11. Personal data is classified at write time.
12. Completion is computed, never asserted.
13. Every review recomputes from primary artifacts and publishes its reproduction command.
14. If a control depends on an agent remembering it, it is not a control.
15. All database connections open through `assert_db_preconditions.open_db()`. A raw `sqlite3.connect` in application code is a build failure.
16. A cause is asserted only from direct evidence. Absence from our records is a statement about our records, never about history. Patterns are recorded as bounded, labelled hypotheses that state their own limits.
17. Freezing evidence means freezing a copy. Shared trees are never made read-only.
