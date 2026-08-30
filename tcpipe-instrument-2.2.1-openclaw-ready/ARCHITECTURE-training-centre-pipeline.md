# Training-centre discovery & mapping pipeline — architecture

Target state for the system that replaces the current LLM-worker monolith.
Written to be executed phase by phase by an implementing agent without judgement calls.

---

## 0. Design note — the vision, and why this shape

### What we are building

A **deterministic data factory** that, for every association / scheme owner / national authority that publishes a list of approved training centres, produces a governed record per training centre containing: contact number, certificates provided, location, cost where published, the centre's own website, and the apply/booking link — each field carrying the artifact it came from, the exact locator inside that artifact, and the quoted evidence.

And a **bidirectional discovery loop**: associations reveal centres; centres reveal the other associations they are accredited by; unknown associations feed back into the association queue. The corpus grows itself.

### The single most important idea

**Separate getting the bytes from understanding the bytes.**

Every remote fetch produces an immutable, content-addressed artifact. Nothing downstream ever touches the network. Parsers run offline, against frozen bytes, as many times as you like, for free.

This one property delivers:

- **You stop getting blocked.** Iterating a parser costs zero requests. Today's blocking is caused by re-fetching the same page dozens of times while an agent figures out the DOM.
- **Parsers become testable.** A frozen artifact + expected output = a golden fixture. Regression suite instead of 309 one-off scripts.
- **Evidence becomes provable.** Every claim points at a sha256 you still hold.
- **Recovery becomes possible.** Lose the database, replay every parser over the artifact store, rebuild.

### "Scripts, not the agent" — restated precisely

You are right about the outcome and slightly off on the cause. Sites do not block you for being an agent; they block you for **request behaviour**: no caching, high repetition, no conditional requests, no backoff, ignoring robots. A script with bad manners gets blocked just as fast.

So the rule is not "no LLM". The rule is:

> **The LLM is never in the fetch path and never in the write path.**

The LLM's jobs, all off the critical path and all reviewable:

1. Propose an adapter rule from a frozen page (a human or the fixture suite confirms it).
2. Triage escalations — write the human-readable question the blob asks you.
3. Classify official relationship wording into a controlled vocabulary (proposal only).
4. Suggest entity merges into the review queue (never merge).

Everything that touches the network or the database is deterministic code.

### The human is a sensor, not a fallback

When a page defeats the parser, we do not "give up and mark blocked". We ask you one precise question — *click the element that contains one school row* — and turn your answer into a **rule** that fires forever after, on that host and on every host sharing that template. Human intervention is a measured input with a target curve: interventions per 100 new records must decrease monotonically. If it doesn't, the learning loop is broken and that's a bug.

---

## 1. Answer: is the current architecture optimised for robust performance?

No. Four structural reasons, each with a corresponding fix in this design.

| Current defect | Consequence observed | Fix here |
|---|---|---|
| One LLM worker does research + extraction + matching + code generation + governed writes | Any failure anywhere corrupts governed data; 309 one-off scripts; unreproducible runs | Four separate services with typed interfaces; LLM confined to proposals |
| Route state is free prose (71 distinct values across 96 rows) | Dashboard classifies by substring matching; 6 blocked routes reported as complete | Enum state machine, transitions in code, illegal transitions rejected |
| Governed data is CSV/JSON mirrors treated as the master | 6,990 dangling FK rows; mirrors diverge; no atomicity | SQLite/Postgres is the master with FK constraints ON; CSV/JSON are exports |
| No cache/replay separation | Every parser iteration is a live request → 403s, blocked hosts | Content-addressed artifact store; parsers never hit the network |

Throughput is not the problem and never was. Rough sizing for the full ambition:

- Forward discovery: 277 bodies × ~3 pages avg ≈ 800 fetches.
- Reverse discovery: ~10,000 centres × ≤3 targeted pages ≈ 30,000 fetches.
- At 1 request per host per 5 s with 8 different hosts in flight: ≈ **5–6 hours of pure fetch time** for the whole reverse crawl.
- Storage: ~30k pages, gzipped ≈ **1.5–3 GB**, plus PDFs; budget 20 GB.

The work is a two-day job at polite speed. What has been costing months is rework caused by the four defects above.

---

## 2. Component map

```
                        ┌──────────────────────────────┐
                        │   Source Policy Registry     │  declarative, versioned
                        │  (who, what route, how fast) │
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │        Fetch Queue           │  jobs, priorities, refetch_after
                        └──────────────┬───────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        │                              │                              │
  ┌─────▼──────┐              ┌────────▼────────┐            ┌────────▼────────┐
  │ T1 HTTP    │              │ T2 Headless     │            │ T3 Human        │
  │ fetcher    │              │ render          │            │ capture inbox   │
  └─────┬──────┘              └────────┬────────┘            └────────┬────────┘
        └──────────────────────────────┼──────────────────────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │   Artifact Store (sha256)    │  immutable, gzipped, replayable
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │      Adapter Registry        │  rules-as-data + golden fixtures
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │   Observations (append-only) │  typed, evidence-bearing
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │   Entity Resolution          │  deterministic → review queue
                        └──────────────┬───────────────┘
                                       │
                        ┌──────────────▼───────────────┐
                        │  Single Atomic Writer → DB   │  FK-constrained governed store
                        └──────┬──────────────┬────────┘
                               │              │
                    ┌──────────▼───┐   ┌──────▼────────────┐
                    │  Exports     │   │  Live telemetry   │
                    │ (CSV/JSON)   │   │  (SQL-defined)    │
                    └──────────────┘   └───────────────────┘

        Cross-cutting:  Escalation Queue ←→ "The Blob" (browser overlay)
                        Rule Store (learned selectors, recipes, aliases)
```

---

## 3. Repository layout

```
tcpipe/
├── config/
│   ├── sources.yaml              # source policy registry (versioned, reviewed)
│   └── settings.yaml             # rates, paths, DB DSN, UA string
├── db/
│   ├── schema.sql                # authoritative DDL
│   └── migrations/
├── artifacts/                    # content-addressed store  ab/cd/abcd…{.gz}
│   └── index.sqlite              # artifact metadata (or table in main DB)
├── adapters/
│   ├── rules/                    # <source>__<route>.rules.json   ← selector-picker output
│   ├── code/                     # only for genuinely irregular sources
│   └── fixtures/                 # <adapter>@<version>/input.sha256 + expected.json
├── src/
│   ├── registry/                 # load & validate sources.yaml
│   ├── fetch/                    # queue, tier1_http, tier2_render, tier3_inbox, politeness
│   ├── store/                    # artifact put/get, dedupe, gc
│   ├── parse/                    # rule engine, adapter runner, pdf/json/html backends
│   ├── observe/                  # observation schema + writer
│   ├── resolve/                  # blocking, deterministic keys, review queue
│   ├── write/                    # single atomic writer, transactions
│   ├── discover/                 # forward + reverse discovery
│   ├── escalate/                 # escalation queue + local API for the blob
│   ├── rules/                    # learned-rule store, generalization, template fingerprints
│   └── orchestrator/             # state machine, job runner, locks
├── extension/                    # Chrome MV3 — the blob
│   ├── manifest.json
│   ├── overlay/                  # UI, picker, capture, guided sequence
│   └── bridge/                   # talks to 127.0.0.1 local API
├── exports/                      # generated CSV/JSON — never edited by hand
└── tests/
    ├── fixtures/                 # golden adapter tests
    └── invariants/               # FK + counter + contract tests
```

---

## 4. Data model (authoritative)

SQLite to start (single file, FK enforcement, WAL). Postgres when concurrency demands it. **CSV and JSON are exports only.** Nothing reads them back.

```sql
PRAGMA foreign_keys = ON;

-- ── Sources & routes ────────────────────────────────────────────────
CREATE TABLE source (                     -- an association / scheme owner / authority
  source_id           TEXT PRIMARY KEY,   -- SRC-0001
  legal_name          TEXT NOT NULL,
  acronym             TEXT,
  source_kind         TEXT NOT NULL,      -- association|scheme_owner|national_authority|registry|federation
  country_iso2        TEXT,
  official_website    TEXT,
  discovered_via      TEXT NOT NULL,      -- seed|reverse_discovery|manual
  discovered_from_centre_id TEXT,         -- set when found by reverse discovery
  intake_state        TEXT NOT NULL,      -- candidate|confirmed|rejected_not_accreditor|duplicate
  created_at          TEXT NOT NULL
);

CREATE TABLE route (                      -- one published list under a source
  route_id            TEXT PRIMARY KEY,   -- RT-0001
  source_id           TEXT NOT NULL REFERENCES source(source_id),
  route_url           TEXT NOT NULL,
  route_kind          TEXT NOT NULL,      -- html_list|html_paginated|json_api|powerbi|pdf|js_app|search_form
  scheme_scope        TEXT,               -- which certificate/scheme this list governs
  fetch_tier          INTEGER NOT NULL,   -- 1|2|3
  robots_allowed      INTEGER NOT NULL,
  crawl_delay_s       REAL NOT NULL DEFAULT 5.0,
  volatility_class    TEXT NOT NULL,      -- daily|weekly|monthly|quarterly|static
  refetch_after       TEXT,               -- computed timestamp
  published_count     INTEGER,            -- what the source claims
  count_quality       TEXT NOT NULL,      -- published|derived_from_category_text|not_published
  route_state         TEXT NOT NULL,      -- see enum below
  state_reason        TEXT,               -- free text ALLOWED here only, never parsed
  adapter_id          TEXT REFERENCES adapter(adapter_id),
  last_ok_fetch_at    TEXT,
  UNIQUE(source_id, route_url, scheme_scope)
);

-- ── Artifacts ───────────────────────────────────────────────────────
CREATE TABLE artifact (
  sha256              TEXT PRIMARY KEY,
  byte_len            INTEGER NOT NULL,
  content_type        TEXT,
  url                 TEXT NOT NULL,
  final_url           TEXT,
  http_status         INTEGER,
  fetched_at_utc      TEXT NOT NULL,
  fetch_tier          INTEGER NOT NULL,
  fetcher_version     TEXT NOT NULL,
  robots_snapshot_sha TEXT,               -- robots.txt in force at fetch time
  captured_by         TEXT,               -- 'system' | user id, for tier 3
  storage_path        TEXT NOT NULL
);

-- ── Adapters ────────────────────────────────────────────────────────
CREATE TABLE adapter (
  adapter_id          TEXT PRIMARY KEY,   -- <source>__<route>
  version             TEXT NOT NULL,      -- semver
  kind                TEXT NOT NULL,      -- rules|code
  rules_path          TEXT,
  code_ref            TEXT,
  authored_by         TEXT NOT NULL,      -- picker|llm_proposal|human
  confirmed_by_human  INTEGER NOT NULL DEFAULT 0,
  fixture_count       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(adapter_id, version)
);

-- ── Observations (APPEND ONLY) ──────────────────────────────────────
CREATE TABLE observation (
  observation_id      TEXT PRIMARY KEY,
  route_id            TEXT NOT NULL REFERENCES route(route_id),
  artifact_sha256     TEXT NOT NULL REFERENCES artifact(sha256),
  adapter_id          TEXT NOT NULL,
  adapter_version     TEXT NOT NULL,
  record_locator      TEXT NOT NULL,      -- CSS path | JSON pointer | pdf:page:line
  parse_state         TEXT NOT NULL,      -- parsed|quarantined_schema_drift|rejected_not_centre|blocked_source
  published_name      TEXT,
  published_address   TEXT,
  published_country   TEXT,
  published_phone     TEXT,
  published_website   TEXT,
  published_apply_url TEXT,
  official_relationship_wording TEXT,     -- verbatim, never normalized in place
  evidence_quote      TEXT NOT NULL,
  retrieved_at_utc    TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

-- ── Resolved entities ───────────────────────────────────────────────
CREATE TABLE centre (
  centre_id           TEXT PRIMARY KEY,   -- TC-######  (never reused, never deleted)
  display_name        TEXT NOT NULL,
  registrable_domain  TEXT,               -- eTLD+1, the strongest natural key
  website_url         TEXT,
  entity_state        TEXT NOT NULL,      -- active|merged_into|rejected
  merged_into_id      TEXT REFERENCES centre(centre_id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE centre_identifier (          -- official provider IDs, alt domains, legacy ids
  centre_id           TEXT NOT NULL REFERENCES centre(centre_id),
  id_kind             TEXT NOT NULL,      -- official_provider_id|domain|legacy_tc_id|org_number
  id_value            TEXT NOT NULL,
  source_id           TEXT REFERENCES source(source_id),
  PRIMARY KEY (id_kind, id_value)
);

CREATE TABLE centre_location (
  location_id         TEXT PRIMARY KEY,
  centre_id           TEXT NOT NULL REFERENCES centre(centre_id),
  country_iso2        TEXT,
  locality            TEXT,
  address_published   TEXT,
  latitude            REAL,
  longitude           REAL,
  coords_state        TEXT NOT NULL,      -- published|not_published   (never 'derived')
  observation_id      TEXT NOT NULL REFERENCES observation(observation_id)
);

CREATE TABLE centre_contact (
  contact_id          TEXT PRIMARY KEY,
  centre_id           TEXT NOT NULL REFERENCES centre(centre_id),
  contact_kind        TEXT NOT NULL,      -- org_phone|org_role_inbox|apply_url|enquiry_form
  contact_value       TEXT NOT NULL,
  is_personal_data    INTEGER NOT NULL,   -- 1 = named individual → excluded from exports by default
  observation_id      TEXT NOT NULL REFERENCES observation(observation_id),
  verified_at_utc     TEXT
);

CREATE TABLE accreditation (              -- centre ↔ source, the partner relationship
  accreditation_id    TEXT PRIMARY KEY,
  centre_id           TEXT NOT NULL REFERENCES centre(centre_id),
  source_id           TEXT NOT NULL REFERENCES source(source_id),
  route_id            TEXT NOT NULL REFERENCES route(route_id),
  relationship_verbatim TEXT NOT NULL,    -- exact published wording
  relationship_class  TEXT NOT NULL,      -- approved|accredited|authorised|member|partner|unclassified
  direction           TEXT NOT NULL,      -- forward (from association list) | reverse (claimed by centre)
  evidence_strength   TEXT NOT NULL,      -- official_directory|centre_self_claim
  observation_id      TEXT NOT NULL REFERENCES observation(observation_id),
  UNIQUE(centre_id, source_id, route_id)
);

CREATE TABLE certificate (
  certificate_id      TEXT PRIMARY KEY,
  source_id           TEXT NOT NULL REFERENCES source(source_id),
  official_code       TEXT,
  certificate_name    TEXT NOT NULL,
  official_url        TEXT
);

CREATE TABLE offering (                   -- a course/certificate AT a centre
  offering_id         TEXT PRIMARY KEY,
  centre_id           TEXT NOT NULL REFERENCES centre(centre_id),
  certificate_id      TEXT NOT NULL REFERENCES certificate(certificate_id),
  location_id         TEXT REFERENCES centre_location(location_id),
  delivery_mode       TEXT,               -- classroom|blended|online|unknown
  apply_url           TEXT,               -- apply link is course-scoped, not centre-scoped
  observation_id      TEXT NOT NULL REFERENCES observation(observation_id),
  UNIQUE(centre_id, certificate_id, location_id, delivery_mode)
);

CREATE TABLE price_observation (          -- costs are rare; model them honestly
  price_id            TEXT PRIMARY KEY,
  offering_id         TEXT NOT NULL REFERENCES offering(offering_id),
  amount              REAL NOT NULL,
  currency            TEXT NOT NULL,      -- ISO 4217
  price_basis         TEXT NOT NULL,      -- per_person|per_course|per_group|from
  includes_vat        INTEGER,
  inclusions_note     TEXT,
  valid_from          TEXT,
  observation_id      TEXT NOT NULL REFERENCES observation(observation_id)
);

-- ── Human-in-the-loop ───────────────────────────────────────────────
CREATE TABLE escalation (
  escalation_id       TEXT PRIMARY KEY,
  kind                TEXT NOT NULL,      -- see enum
  status              TEXT NOT NULL,      -- open|in_progress|resolved|wont_fix|expired
  priority            INTEGER NOT NULL,
  route_id            TEXT REFERENCES route(route_id),
  centre_id           TEXT REFERENCES centre(centre_id),
  target_url          TEXT,
  question            TEXT NOT NULL,      -- the exact sentence the blob shows you
  context_json        TEXT NOT NULL,      -- what it already tried, what it needs
  resolution_json     TEXT,
  produced_rule_id    TEXT REFERENCES rule(rule_id),
  opened_at           TEXT NOT NULL,
  resolved_at         TEXT
);

CREATE TABLE rule (                       -- everything learned from a human answer
  rule_id             TEXT PRIMARY KEY,
  rule_kind           TEXT NOT NULL,      -- selector|pagination|host_recipe|name_alias|merge_decision|reject_pattern
  scope_kind          TEXT NOT NULL,      -- url|host|template_fingerprint|global
  scope_value         TEXT NOT NULL,
  payload_json        TEXT NOT NULL,
  origin_escalation   TEXT REFERENCES escalation(escalation_id),
  hit_count           INTEGER NOT NULL DEFAULT 0,
  last_hit_at         TEXT,
  confidence          REAL NOT NULL DEFAULT 1.0,
  created_at          TEXT NOT NULL
);

CREATE TABLE review_queue (               -- proposed merges/classifications awaiting a human
  review_id           TEXT PRIMARY KEY,
  review_kind         TEXT NOT NULL,      -- merge_candidate|relationship_class|new_source_candidate
  payload_json        TEXT NOT NULL,
  proposed_by         TEXT NOT NULL,      -- resolver|llm
  confidence          REAL,
  status              TEXT NOT NULL,      -- pending|accepted|rejected
  decided_at          TEXT
);
```

### Enums — these are law, no free text

```
route_state:      discovered → policy_pending → fetchable → fetched → parsed
                  → { complete | partial | needs_human
                    | blocked_no_public_rows      -- source published nothing
                    | blocked_access              -- 403/401/CAPTCHA/session required
                    | blocked_robots              -- disallowed, we will not fetch
                    | blocked_paywall }
                  → stale (refetch_after passed)

parse_state:      parsed | quarantined_schema_drift | rejected_not_centre | blocked_source
count_quality:    published | derived_from_category_text | not_published
coords_state:     published | not_published
escalation.kind:  pick_selector | pick_pagination | capture_page | solve_access
                  | confirm_extraction | confirm_merge | classify_relationship
                  | confirm_new_source | confirm_no_data
```

**`blocked_no_public_rows` and `blocked_access` are different states.** Belgium (empty official table) and Netherlands (HTTP 403) are not the same situation and must never render as the same thing — nor as `complete`.

**Completion rule, enforced in code:**
`complete` requires `extracted_count == published_count AND published_count > 0 AND count_quality = 'published'`.
Everything else is `partial`, `needs_human`, or a `blocked_*` state. This makes the V2 dashboard regression structurally impossible.

---

## 5. The fetch layer — how we stay unblocked

### Politeness contract (non-negotiable, enforced in the fetcher, not in policy docs)

1. **Identify honestly.** `User-Agent: GPSolutionTrainingCentreBot/1.0 (+https://<contact-page>; research indexing of publicly published approved-provider lists)`.
2. **Fetch and honour `robots.txt`** before any request to a new host; store its sha256 with every artifact. `Disallow` → route goes `blocked_robots` and is never retried automatically.
3. **One in-flight request per host.** Concurrency is across *different* hosts only. Default `crawl_delay_s = 5`, jittered ±30%, overridden upward by any published `Crawl-delay`.
4. **Conditional requests always.** Store `ETag`/`Last-Modified`; send `If-None-Match`/`If-Modified-Since`. A 304 costs nothing and proves freshness.
5. **Circuit breaker.** Two consecutive 403/429/503 on a host → suspend that host for 24 h, open a `solve_access` escalation. **Never retry harder, never vary the UA, never rotate IPs.**
6. **Prefer published machine-readable endpoints.** If a site ships a JSON/OData/Power BI query endpoint that its own front-end calls, use it — that is documented behaviour, not evasion. (The Norway NMA Power BI route is the model.)
7. **Never** solve CAPTCHAs, spoof fingerprints, rotate proxies, reuse someone's session cookie, or bypass a login. If access needs a human, it goes to tier 3.

### The three tiers

| Tier | Used when | Mechanism |
|---|---|---|
| **T1 HTTP** | Static HTML, JSON, PDF | `httpx` + politeness contract. ~90% of routes. |
| **T2 Render** | Client-rendered lists with no reachable API | Headless Chromium, same politeness contract, one page at a time, screenshot + DOM both stored as artifacts. |
| **T3 Human capture** | Session required, 403 to automation, JS app behind auth, or robots-disallowed-but-user-visible | **You** open the page in your normal browser; the blob captures the rendered DOM and stores it as an artifact with `captured_by = <you>`, `fetch_tier = 3`. Parser then runs identically. |

T3 is not a workaround — it is a first-class, auditable input. It also completely sidesteps the blocking problem for the hardest ~10% of sources.

---

## 6. Adapters — rules as data

An adapter is a JSON document, mostly generated by the selector picker, versioned, and covered by fixtures. Code adapters exist but are the exception and require a written justification in the file header.

```jsonc
{
  "adapter_id": "emsa_dona__country_profile_met",
  "version": "1.3.0",
  "applies_to": {
    "template_fingerprint": "emsa-dona-country-profile-v2",   // ← generalizes across 20+ countries
    "url_pattern": "^https://portal\\.emsa\\.europa\\.eu/web/dona/country-profiles/[a-z-]+/"
  },
  "list": {
    "container": { "strategy": "css", "value": "table.met-institutions tbody" },
    "row":       { "strategy": "css", "value": "tr" },
    "min_expected_rows": 1,
    "empty_is_valid": true,                 // an officially empty table is data, not failure
    "published_count": { "strategy": "regex_on_text",
                         "value": "accredited by the MSs\\s*\\|\\s*(\\d+)" }
  },
  "fields": {
    "published_name":    { "strategy": "css_text",  "value": "td:nth-child(1)", "required": true },
    "published_address": { "strategy": "css_text",  "value": "td:nth-child(2)" },
    "published_phone":   { "strategy": "css_text",  "value": "td:nth-child(3)",
                           "normalize": "phone_e164_or_verbatim" },
    "published_website": { "strategy": "css_attr",  "value": "td a@href" },
    "published_apply_url": { "strategy": "css_attr", "value": "a.apply@href" }
  },
  "pagination": { "kind": "none" },
  "rejects": [
    { "when": "published_name matches '^(N/A|-|see below)$'", "parse_state": "rejected_not_centre" }
  ],
  "fixtures": ["sha256:9f2c…", "sha256:c41a…"]
}
```

**Rules for the implementing agent:**

- Every selector carries **three fallback strategies** in priority order (stable attribute → role+text → structural path). Record which one fired; if the primary fails on ≥20% of rows, raise `quarantined_schema_drift` and open a `pick_selector` escalation. Do not silently degrade.
- `template_fingerprint` is computed from the page's structural skeleton (tag path histogram + landmark attributes, content stripped). Pages with the same fingerprint share an adapter. **This is the highest-leverage generalization available here** — the EMSA DONA country profiles alone are 15+ routes on one template.
- Adding an adapter version **requires** at least one fixture. No fixture, no merge.
- An adapter never writes to the database. It returns observations. The writer decides.

---

## 7. The blob — the human-in-the-loop assistant

A Chrome MV3 extension plus a local API on `127.0.0.1`. It is the difference between a system that stalls on 9 blocked routes and one that finishes.

### Behaviour

**Ambient.** A small badge, always present, showing open escalation count. It does nothing until there is work.

**Contextual.** On page load it asks the local API: *any escalation for this URL, this host, or this template?* If yes, the blob expands with **one question and one action**.

**Guided, issue to issue.** After you resolve one, it says *"Resolved. Next: Estonia Transport Administration — needs session capture (2 of 7). Open it?"* and navigates you there. You never go hunting for what's stuck; it queues you.

### The five interaction modes

| Mode | What you see | What it produces |
|---|---|---|
| **Pick element** | Hover highlights; click selects. *"Click one row of the school list."* | A `selector` rule with 3 fallback strategies + a repeat-pattern inference you confirm |
| **Pick fields** | The chosen row is outlined; it asks for each target field in turn: *"Now click the phone number."* Fields you skip are recorded as `not_published` | Field selectors, scoped to the row |
| **Capture page** | *"This page needs your session. Click Capture."* | Rendered DOM + headers → artifact, `fetch_tier = 3` |
| **Record action** | *"Click the button that loads the next page."* It records the action, not a screenshot | A `pagination` rule (click / URL template / XHR replay) |
| **Confirm extraction** | A 5-row preview table over the live page. Fix any cell inline | Confirmation, or a `correction` rule that becomes a fixture assertion |

### How it learns

Every resolution writes a `rule` row, and rules are matched at three widening scopes:

1. **`url`** — exact page. Weakest, always tried first.
2. **`host`** — e.g. *transportstyrelsen.se requires session capture; pagination is a "Visa fler" button*. Applies to every future page on that host.
3. **`template_fingerprint`** — the big one. Teach it one EMSA DONA country profile and it silently handles the other 20.

Plus two global learners:

- **`name_alias`** — every merge you confirm teaches the normalizer (*"Sp. z o.o." ≡ "Sp. z o. o."*, *"Maritime Academy" ≡ "Maritime Akademi"*). Feeds entity resolution, so merge escalations decline too.
- **`reject_pattern`** — every *"this row is not a training centre"* teaches the rejecter.

**The metric that governs the whole system:**

```
intervention_rate = human_escalations_resolved / new_centre_records_written  (per week)
```

Publish it on the dashboard. It must trend down. If it is flat, the generalization scopes aren't firing — that is a defect, not a fact of life.

### Safety rails on the blob

- It **never** clicks anything itself. It highlights and instructs; you act. No automated interaction with a session you are logged into.
- It **never** captures a page whose URL matches a configured deny-list (banking, webmail, anything under a `personal` host list).
- Captured artifacts are marked `captured_by` and are auditable as human-sourced.

---

## 8. Discovery — both directions

### Forward: association → centres

```
source(confirmed) → enumerate routes → fetch → parse → observations
                  → resolve → accreditation(direction='forward',
                                             evidence_strength='official_directory')
```

Reconciliation gate: `extracted_count` vs `published_count`. Mismatch → `partial` + escalation. Never `complete` on a mismatch.

### Reverse: centre → other associations

This is where the corpus grows, and where politeness matters most (10k independent hosts).

```
centre(with website) → targeted page discovery (NOT a full crawl)
                     → accreditation-claim extraction
                     → association name/logo/URL candidates
                     → match against known sources
                     → unknown? → review_queue(new_source_candidate)
                     → you confirm → source(intake_state='candidate' → 'confirmed')
                     → enters the forward queue
```

**Bounded crawl rules — the implementing agent must not exceed these:**

- Max **3 pages per centre host**, depth ≤ 2 from the homepage.
- Only paths matching an allow-list of intents: `/about`, `/accreditation(s)`, `/approval(s)`, `/certification(s)`, `/quality`, `/partners`, `/memberships`, plus the footer of the homepage.
- Homepage first; only follow links whose anchor text or href matches the intent list.
- Same politeness contract. A centre site that 403s is simply skipped — never escalated, there are 10,000 more.
- Prioritise the queue: centres with the most existing accreditations first (they are the most likely to reveal new bodies), then by country coverage gaps.

**Claim extraction** looks for three signal types, in descending strength:

1. An outbound link to a known association domain, or to a `/find-a-centre`-style directory URL.
2. A logo image whose filename, `alt` text, or nearby heading matches a known association name or acronym.
3. Text matching `(approved|accredited|authorised|certified|recognised)\s+(by|training\s+(centre|provider))\s+([A-Z][\w&.\- ]{2,60})`.

Every reverse-discovered accreditation is written with `direction='reverse'` and `evidence_strength='centre_self_claim'`. **A self-claim is never promoted to a confirmed accreditation.** It becomes a hypothesis: the association's own directory is fetched and, if the centre appears there, a `forward` row is written alongside. This closes the loop and self-corrects — the audit rule *"never infer accreditation from membership or company keywords"* is preserved structurally rather than by discipline.

New-source confirmation is deliberately a human click, but a cheap one: the blob shows the claim, the evidence quote, the candidate's website, and asks *"Is this an accrediting body with a public centre directory? yes / no / it's a duplicate of ___"*. One second each, and it is the only place a whole new branch of work can be created.

---

## 9. Development phases

Each phase has a hard **done-when**. Do not begin a phase until the previous one's done-when is demonstrably true. Do not implement anything in a later phase early.

### Phase 0 — Freeze and recover the existing data
**Goal:** stop building on broken foundations.
**Do:** apply the V2 review fixes; extend the FK audit to all five tables; adjudicate the 2,035 missing IDs (restore / remap / reject); produce one clean, FK-valid snapshot.
**Done when:** an FK audit over every table returns zero dangling references, and the counter invariants (`relationship_count`, `location_count`, `association_count`) all pass.
**Do not:** write any new scraper code in this phase.

### Phase 1 — The spine
**Goal:** one association end-to-end through the new architecture.
**Do:** `schema.sql`; artifact store (put/get/dedupe/gzip); source registry loader; T1 fetcher with the full politeness contract; **one** hand-written adapter; observation writer; deterministic resolver; single atomic writer; import the Phase 0 snapshot.
**Done when:** `tcpipe run --source OSHA-OTI` fetches, parses, resolves and writes 36 centres; re-running is a no-op (304s, zero new observations); deleting the DB and replaying from artifacts reproduces it byte-identically.
**Do not:** build the extension, reverse discovery, or T2 yet.

### Phase 2 — Adapter registry and fixtures
**Goal:** kill the one-script-per-batch pattern permanently.
**Do:** the rules engine and rule schema; the fixture harness; `template_fingerprint`; migrate three archetypes — a paginated HTML list, a JSON API, a PDF list.
**Done when:** four adapters exist, all rules-based, all with ≥1 fixture; `pytest tests/fixtures` is green; a deliberate DOM change in a fixture produces `quarantined_schema_drift`, not silent wrong data.
**Do not:** hand-write a code adapter unless a written justification is committed alongside it.

### Phase 3 — The blob
**Goal:** turn blocked routes into resolved ones, and start the learning loop.
**Do:** escalation table + local API; MV3 extension; the five interaction modes; the rule store with the three matching scopes; T3 capture inbox.
**Done when:** at least 3 of the 9 currently-blocked routes are resolved through the blob with no code written by hand; a selector rule authored on one EMSA DONA country page automatically parses a second country page with zero further input.
**Do not:** let the extension click, submit, or navigate on its own. Highlight and instruct only.

### Phase 4 — Scale forward discovery
**Goal:** work the real backlog.
**Do:** T2 render tier; job scheduler with per-host budgets; the route state machine end-to-end; count reconciliation gate; live dashboard from SQL views.
**Done when:** the 96-row route map is fully represented as `route` rows in enum states; ≥40 routes are `complete` under the strict completion rule; the dashboard derives every number from SQL with zero hardcoded literals.
**Do not:** report a route `complete` without a published count match. Ever.

### Phase 5 — Reverse discovery
**Goal:** make the corpus self-expanding.
**Do:** the bounded centre crawler; claim extractor; source-candidate matcher; `confirm_new_source` escalation; the forward-verification loop that upgrades self-claims.
**Done when:** ≥500 centre sites processed within the crawl bounds; ≥10 genuinely new accrediting bodies confirmed and queued; every reverse claim is either verified forward or still flagged `centre_self_claim`.
**Do not:** exceed 3 pages per host or follow non-intent links. Do not write an `accreditation` from a self-claim alone.

### Phase 6 — Learning and metrics
**Goal:** make intervention decline.
**Do:** rule generalization from `url`→`host`→`template_fingerprint`; alias and reject learners; `intervention_rate` telemetry; rule hit-count decay and confidence.
**Done when:** `intervention_rate` has fallen for four consecutive weeks; ≥60% of parses are served by a rule created at `host` or `template` scope rather than `url`.

### Phase 7 — Costs and apply links
**Goal:** the two thin fields, honestly.
**Do:** offering-scoped `apply_url`; the price observation model; course-page adapters for the subset of centres that publish prices.
**Done when:** price coverage is reported as an explicit percentage with a denominator, and no price exists without a currency, basis and evidence quote.
**Do not:** infer, convert, or average prices. Store what is published.

### Phase 8 — Hardening
**Do:** artifact retention and GC policy; personal-data classification and export filtering (`is_personal_data = 1` excluded by default); GDPR basis/retention documentation; backup strategy that is incremental, not full-copy; export generator; runbook.
**Done when:** a full restore from backup + artifact replay reproduces the governed DB; exports contain no personal data unless explicitly requested with a justification flag.

---

## 10. Standing rules for the implementing agent

1. **The database is the master.** CSV and JSON are generated exports. Never read an export back in. Never hand-edit one.
2. **One writer.** All writes go through `src/write`. Transactional, FK-enforced. Advisory lock in the DB, not a `/tmp` flock.
3. **Never delete a canonical ID.** Supersede with `entity_state='merged_into'` + `merged_into_id`. The 1,766-row disappearance becomes impossible.
4. **Observations are append-only.** Re-parsing creates new rows. Never mutate or delete.
5. **No network access outside `src/fetch`.** No `requests` import anywhere else. Enforce with a lint rule.
6. **No LLM call inside `src/fetch`, `src/parse` or `src/write`.** Proposals only, into `review_queue`.
7. **Free text is confined to `state_reason`, `relationship_verbatim`, `evidence_quote`, and escalation `question`.** Every other status-bearing column is an enum, validated on write.
8. **Every governed number has a SQL definition** stored beside the dashboard. No literals in reporting code.
9. **New adapter requires a fixture. New enum value requires a migration.** Both reviewed.
10. **When blocked, escalate — never retry harder.** No UA rotation, no proxies, no CAPTCHA solving, no session reuse.
11. **Personal data is classified at write time**, not filtered at export time. `is_personal_data=1` for anything tied to a named individual.
12. **Count reconciliation gates completion.** `complete` is computed, never asserted.

---

## 11. What to build first, concretely

If the implementing agent needs a single starting instruction:

> Create `db/schema.sql` exactly as specified in §4, `config/sources.yaml` with the OSHA OTI route as the sole entry, and `src/fetch/tier1.py` implementing the full politeness contract in §5. Then write one hand-coded adapter for OSHA OTI, the observation writer, and the deterministic resolver. Prove Phase 1's done-when. Stop there and report.

Everything else in this document is downstream of that spine working.
