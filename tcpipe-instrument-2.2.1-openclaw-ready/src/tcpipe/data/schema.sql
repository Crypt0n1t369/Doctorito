-- Training-centre parsing instrument — governed foundation schema
-- Version 2.3.0. Adds bounded autonomous public-source operation to the 2.2 model.
-- Target: SQLite >= 3.37. Connections must use tcpipe.db.open_db(), because
-- foreign_keys is connection-local.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE schema_meta (
  schema_version TEXT PRIMARY KEY,
  applied_at_utc TEXT NOT NULL
) STRICT;
INSERT INTO schema_meta VALUES ('2.3.0', strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE schema_migration (
  migration_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  applied_by TEXT NOT NULL,
  applied_at_utc TEXT NOT NULL
) STRICT;
INSERT INTO schema_migration VALUES (
  'baseline-2.3.0',
  '0000000000000000000000000000000000000000000000000000000000000000',
  'bootstrap',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);
CREATE TRIGGER schema_migration_no_update BEFORE UPDATE ON schema_migration BEGIN
  SELECT RAISE(ABORT, 'migration ledger is immutable');
END;
CREATE TRIGGER schema_migration_no_delete BEFORE DELETE ON schema_migration BEGIN
  SELECT RAISE(ABORT, 'migration ledger is immutable');
END;

-- Operations -----------------------------------------------------------------
CREATE TABLE mission (
  mission_id TEXT PRIMARY KEY,
  track TEXT NOT NULL CHECK (track IN ('legacy_integrity','parsing_capability','cross_track')),
  title TEXT NOT NULL,
  problem TEXT NOT NULL,
  done_when TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority > 0),
  blocks_production INTEGER NOT NULL DEFAULT 0 CHECK (blocks_production IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at_utc TEXT NOT NULL,
  UNIQUE (track, priority)
) STRICT;

CREATE TABLE job_queue (
  job_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES mission(mission_id),
  kind TEXT NOT NULL,
  params_json TEXT NOT NULL CHECK (json_valid(params_json)),
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','running','succeeded','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  not_before_utc TEXT,
  claimed_by TEXT,
  claimed_at_utc TEXT,
  lease_expires_at_utc TEXT,
  started_at_utc TEXT,
  finished_at_utc TEXT,
  outcome_detail_json TEXT CHECK (outcome_detail_json IS NULL OR json_valid(outcome_detail_json)),
  git_commit TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK (attempt_count <= max_attempts),
  CHECK ((status = 'running') =
    (claimed_by IS NOT NULL AND claimed_at_utc IS NOT NULL AND lease_expires_at_utc IS NOT NULL)),
  CHECK ((status IN ('succeeded','failed','cancelled')) = (finished_at_utc IS NOT NULL))
) STRICT;

CREATE TABLE job_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  event_kind TEXT NOT NULL CHECK (event_kind IN
    ('enqueued','claimed','heartbeat','succeeded','failed','cancelled','retry_scheduled')),
  actor TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  occurred_at_utc TEXT NOT NULL
) STRICT;
CREATE TRIGGER job_event_no_update BEFORE UPDATE ON job_event BEGIN
  SELECT RAISE(ABORT, 'job_event is append-only');
END;
CREATE TRIGGER job_event_no_delete BEFORE DELETE ON job_event BEGIN
  SELECT RAISE(ABORT, 'job_event is append-only');
END;

-- Versioned denominator and source policy ------------------------------------
CREATE TABLE source_universe (
  universe_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL CHECK (version > 0),
  scope_statement TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','frozen','retired')),
  created_at_utc TEXT NOT NULL,
  frozen_at_utc TEXT,
  CHECK ((status = 'draft') = (frozen_at_utc IS NULL))
) STRICT;

CREATE TABLE source (
  source_id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  acronym TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN
    ('association','scheme_owner','national_authority','registry','federation')),
  country_iso2 TEXT CHECK (country_iso2 IS NULL OR length(country_iso2) = 2),
  official_website TEXT NOT NULL,
  discovered_via TEXT NOT NULL CHECK (discovered_via IN ('seed','reverse_discovery','manual')),
  intake_state TEXT NOT NULL CHECK (intake_state IN
    ('candidate','confirmed','rejected_not_accreditor','duplicate')),
  terms_url TEXT,
  license_basis TEXT,
  allowed_purpose TEXT,
  retention_period TEXT,
  legal_review_state TEXT NOT NULL DEFAULT 'pending' CHECK (legal_review_state IN
    ('pending','approved','rejected','review_due')),
  last_legal_review_utc TEXT,
  created_at_utc TEXT NOT NULL,
  CHECK (legal_review_state <> 'approved' OR
    (allowed_purpose IS NOT NULL AND last_legal_review_utc IS NOT NULL))
) STRICT;

CREATE TABLE universe_source (
  universe_id TEXT NOT NULL REFERENCES source_universe(universe_id),
  source_id TEXT NOT NULL REFERENCES source(source_id),
  eligibility TEXT NOT NULL CHECK (eligibility IN ('candidate','eligible','excluded')),
  exclusion_reason TEXT,
  source_policy_review_id TEXT REFERENCES source_policy_review(source_policy_review_id),
  PRIMARY KEY (universe_id, source_id),
  CHECK ((eligibility = 'excluded') = (exclusion_reason IS NOT NULL)),
  CHECK (eligibility <> 'eligible' OR source_policy_review_id IS NOT NULL)
) STRICT;

-- Forward adapter reference is valid in SQLite and checked at statement time.
CREATE TABLE route (
  route_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(source_id),
  route_url TEXT NOT NULL,
  scheme_scope TEXT NOT NULL DEFAULT '',
  route_kind TEXT NOT NULL CHECK (route_kind IN
    ('download','html_list','html_paginated','json_api','powerbi','pdf','js_app','search_form')),
  acquisition_method TEXT NOT NULL CHECK (acquisition_method IN
    ('official_download','http','api','headless','human_capture')),
  access_class TEXT NOT NULL DEFAULT 'human_required' CHECK (access_class IN
    ('public','authenticated','private','sensitive','human_required')),
  policy_state TEXT NOT NULL DEFAULT 'pending' CHECK (policy_state IN ('pending','approved','rejected')),
  robots_state TEXT NOT NULL DEFAULT 'unknown' CHECK (robots_state IN ('unknown','allowed','disallowed')),
  robots_snapshot_sha TEXT REFERENCES artifact(sha256),
  crawl_delay_s REAL NOT NULL DEFAULT 5.0 CHECK (crawl_delay_s >= 1.0),
  volatility_class TEXT NOT NULL CHECK (volatility_class IN
    ('daily','weekly','monthly','quarterly','static')),
  refetch_days INTEGER CHECK (refetch_days IS NULL OR refetch_days > 0),
  active_adapter_id TEXT,
  active_adapter_version TEXT,
  created_at_utc TEXT NOT NULL,
  UNIQUE (source_id, route_url, scheme_scope),
  CHECK ((active_adapter_id IS NULL) = (active_adapter_version IS NULL)),
  CHECK (robots_state = 'unknown' OR robots_snapshot_sha IS NOT NULL),
  FOREIGN KEY (active_adapter_id, active_adapter_version) REFERENCES adapter(adapter_id, version)
) STRICT;

CREATE TABLE universe_route (
  universe_id TEXT NOT NULL REFERENCES source_universe(universe_id),
  route_id TEXT NOT NULL REFERENCES route(route_id),
  eligibility TEXT NOT NULL CHECK (eligibility IN ('candidate','eligible','excluded')),
  exclusion_reason TEXT,
  expected_records INTEGER CHECK (expected_records IS NULL OR expected_records >= 0),
  expected_basis TEXT,
  expected_as_of_utc TEXT,
  route_policy_review_id TEXT REFERENCES route_policy_review(route_policy_review_id),
  PRIMARY KEY (universe_id, route_id),
  CHECK ((eligibility = 'excluded') = (exclusion_reason IS NOT NULL)),
  CHECK (expected_records IS NULL OR expected_basis IS NOT NULL),
  CHECK (eligibility <> 'eligible' OR route_policy_review_id IS NOT NULL)
) STRICT;

CREATE TRIGGER universe_freeze_guard
BEFORE UPDATE OF status ON source_universe
WHEN NEW.status='frozen' AND (
  EXISTS (SELECT 1 FROM universe_source us WHERE us.universe_id=NEW.universe_id AND us.eligibility='candidate') OR
  EXISTS (SELECT 1 FROM universe_route ur WHERE ur.universe_id=NEW.universe_id AND ur.eligibility='candidate') OR
  EXISTS (SELECT 1 FROM universe_route ur WHERE ur.universe_id=NEW.universe_id
           AND ur.eligibility='eligible' AND (ur.expected_records IS NULL OR ur.expected_basis IS NULL)) OR
  EXISTS (SELECT 1 FROM universe_source us
           LEFT JOIN source_policy_review spr
             ON spr.source_policy_review_id=us.source_policy_review_id
           WHERE us.universe_id=NEW.universe_id AND us.eligibility='eligible'
             AND (spr.decision IS NULL OR spr.decision<>'approved'
               OR julianday(spr.reviewed_at_utc)>julianday(NEW.frozen_at_utc)
               OR (spr.valid_until_utc IS NOT NULL AND
                 julianday(spr.valid_until_utc)<julianday(NEW.frozen_at_utc)))) OR
  EXISTS (SELECT 1 FROM universe_route ur JOIN route r ON r.route_id=ur.route_id
           LEFT JOIN route_policy_review rpr
             ON rpr.route_policy_review_id=ur.route_policy_review_id
           WHERE ur.universe_id=NEW.universe_id AND ur.eligibility='eligible' AND
             (r.refetch_days IS NULL OR rpr.decision IS NULL OR rpr.decision<>'approved' OR
              julianday(rpr.reviewed_at_utc)>julianday(NEW.frozen_at_utc) OR
              (rpr.valid_until_utc IS NOT NULL AND
                julianday(rpr.valid_until_utc)<julianday(NEW.frozen_at_utc)) OR
              (rpr.robots_state<>'allowed' AND NOT
                (r.acquisition_method='human_capture' AND rpr.robots_state='disallowed'))))
)
BEGIN SELECT RAISE(ABORT, 'universe cannot freeze with candidates, unknown volume, or unapproved policy'); END;

CREATE TRIGGER frozen_universe_no_update
BEFORE UPDATE ON source_universe
WHEN OLD.status IN ('frozen','retired') AND NOT (
  OLD.status='frozen' AND NEW.status='retired'
  AND NEW.universe_id=OLD.universe_id AND NEW.version=OLD.version
  AND NEW.scope_statement=OLD.scope_statement AND NEW.created_at_utc=OLD.created_at_utc
  AND NEW.frozen_at_utc=OLD.frozen_at_utc)
BEGIN SELECT RAISE(ABORT, 'frozen universe is immutable'); END;
CREATE TRIGGER frozen_universe_no_delete BEFORE DELETE ON source_universe
WHEN OLD.status IN ('frozen','retired')
BEGIN SELECT RAISE(ABORT, 'frozen universe is immutable'); END;

CREATE TRIGGER frozen_universe_source_no_insert BEFORE INSERT ON universe_source
WHEN (SELECT status FROM source_universe WHERE universe_id=NEW.universe_id) IN ('frozen','retired')
BEGIN SELECT RAISE(ABORT, 'frozen universe membership is immutable'); END;
CREATE TRIGGER frozen_universe_source_no_update BEFORE UPDATE ON universe_source
WHEN (SELECT status FROM source_universe WHERE universe_id=OLD.universe_id) IN ('frozen','retired')
BEGIN SELECT RAISE(ABORT, 'frozen universe membership is immutable'); END;
CREATE TRIGGER frozen_universe_source_no_delete BEFORE DELETE ON universe_source
WHEN (SELECT status FROM source_universe WHERE universe_id=OLD.universe_id) IN ('frozen','retired')
BEGIN SELECT RAISE(ABORT, 'frozen universe membership is immutable'); END;

CREATE TRIGGER frozen_universe_route_no_insert BEFORE INSERT ON universe_route
WHEN (SELECT status FROM source_universe WHERE universe_id=NEW.universe_id) IN ('frozen','retired')
BEGIN SELECT RAISE(ABORT, 'frozen universe routes are immutable'); END;
CREATE TRIGGER frozen_universe_route_no_update BEFORE UPDATE ON universe_route
WHEN (SELECT status FROM source_universe WHERE universe_id=OLD.universe_id) IN ('frozen','retired')
BEGIN SELECT RAISE(ABORT, 'frozen universe routes are immutable'); END;
CREATE TRIGGER frozen_universe_route_no_delete BEFORE DELETE ON universe_route
WHEN (SELECT status FROM source_universe WHERE universe_id=OLD.universe_id) IN ('frozen','retired')
BEGIN SELECT RAISE(ABORT, 'frozen universe routes are immutable'); END;

-- Immutable content and fetch events -----------------------------------------
CREATE TABLE artifact (
  sha256 TEXT PRIMARY KEY CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  byte_len INTEGER NOT NULL CHECK (byte_len > 0),
  content_type TEXT,
  storage_path TEXT NOT NULL UNIQUE,
  first_seen_at_utc TEXT NOT NULL
) STRICT;
CREATE TRIGGER artifact_no_update BEFORE UPDATE ON artifact BEGIN
  SELECT RAISE(ABORT, 'artifact metadata is immutable');
END;
CREATE TRIGGER artifact_no_delete BEFORE DELETE ON artifact BEGIN
  SELECT RAISE(ABORT, 'artifact metadata is immutable');
END;

CREATE TABLE source_policy_review (
  source_policy_review_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(source_id),
  decision TEXT NOT NULL CHECK (decision IN ('pending','approved','rejected','review_due')),
  terms_url TEXT,
  license_basis TEXT,
  allowed_purpose TEXT,
  retention_period TEXT,
  data_categories_json TEXT NOT NULL DEFAULT '[]' CHECK
    (json_valid(data_categories_json) AND json_type(data_categories_json)='array'),
  reviewed_by TEXT NOT NULL,
  reviewed_at_utc TEXT NOT NULL,
  valid_until_utc TEXT,
  evidence_artifact_sha TEXT REFERENCES artifact(sha256),
  CHECK (decision<>'approved' OR
    (allowed_purpose IS NOT NULL AND retention_period IS NOT NULL)),
  CHECK (valid_until_utc IS NULL OR julianday(valid_until_utc) >= julianday(reviewed_at_utc))
) STRICT;
CREATE TRIGGER source_policy_review_no_update BEFORE UPDATE ON source_policy_review BEGIN
  SELECT RAISE(ABORT, 'source policy reviews are immutable; add a new review');
END;
CREATE TRIGGER source_policy_review_no_delete BEFORE DELETE ON source_policy_review BEGIN
  SELECT RAISE(ABORT, 'source policy reviews are immutable; add a new review');
END;
CREATE TRIGGER automated_source_policy_review_guard
BEFORE INSERT ON source_policy_review
WHEN NEW.reviewed_by LIKE 'tcpipe-public-preflight/%' AND (
  NEW.decision<>'approved' OR NEW.license_basis<>'public_web' OR
  NEW.allowed_purpose<>'factual_public_directory_parsing' OR
  NEW.evidence_artifact_sha IS NULL OR json_array_length(NEW.data_categories_json)<>0)
BEGIN SELECT RAISE(ABORT, 'automated source approval requires public-web basis, no sensitive categories, and stored evidence'); END;

CREATE TABLE route_policy_review (
  route_policy_review_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES route(route_id),
  source_policy_review_id TEXT NOT NULL REFERENCES source_policy_review(source_policy_review_id),
  decision TEXT NOT NULL CHECK (decision IN ('pending','approved','rejected','review_due')),
  robots_state TEXT NOT NULL CHECK (robots_state IN ('unknown','allowed','disallowed')),
  robots_snapshot_sha TEXT REFERENCES artifact(sha256),
  reviewed_by TEXT NOT NULL,
  reviewed_at_utc TEXT NOT NULL,
  valid_until_utc TEXT,
  CHECK (robots_state='unknown' OR robots_snapshot_sha IS NOT NULL),
  CHECK (valid_until_utc IS NULL OR julianday(valid_until_utc) >= julianday(reviewed_at_utc))
) STRICT;
CREATE TRIGGER route_policy_review_insert_guard
BEFORE INSERT ON route_policy_review WHEN NOT EXISTS (
  SELECT 1 FROM route r JOIN source_policy_review spr ON spr.source_id=r.source_id
   WHERE r.route_id=NEW.route_id
     AND spr.source_policy_review_id=NEW.source_policy_review_id
     AND (NEW.decision<>'approved' OR spr.decision='approved'))
BEGIN SELECT RAISE(ABORT, 'route review must use an approved policy review for the same source'); END;
CREATE TRIGGER route_policy_review_no_update BEFORE UPDATE ON route_policy_review BEGIN
  SELECT RAISE(ABORT, 'route policy reviews are immutable; add a new review');
END;
CREATE TRIGGER route_policy_review_no_delete BEFORE DELETE ON route_policy_review BEGIN
  SELECT RAISE(ABORT, 'route policy reviews are immutable; add a new review');
END;
CREATE TRIGGER automated_route_policy_review_guard
BEFORE INSERT ON route_policy_review
WHEN NEW.reviewed_by LIKE 'tcpipe-public-preflight/%' AND NOT EXISTS (
  SELECT 1 FROM route r JOIN source_policy_review spr
    ON spr.source_policy_review_id=NEW.source_policy_review_id
   WHERE r.route_id=NEW.route_id AND r.access_class='public'
     AND r.acquisition_method<>'human_capture'
     AND spr.reviewed_by LIKE 'tcpipe-public-preflight/%'
     AND NEW.robots_snapshot_sha IS NOT NULL
     AND ((NEW.decision='approved' AND NEW.robots_state='allowed') OR
          (NEW.decision='rejected' AND NEW.robots_state='disallowed')))
BEGIN SELECT RAISE(ABORT, 'automated route decision is limited to public routes and may never approve a robots prohibition'); END;

CREATE TRIGGER route_policy_approval_guard
BEFORE UPDATE OF policy_state ON route
WHEN NEW.policy_state = 'approved' AND NOT EXISTS (
  SELECT 1 FROM source s WHERE s.source_id = NEW.source_id AND s.legal_review_state = 'approved')
BEGIN SELECT RAISE(ABORT, 'route policy requires an approved source legal review'); END;
CREATE TRIGGER route_policy_approval_insert_guard
BEFORE INSERT ON route
WHEN NEW.policy_state = 'approved' AND NOT EXISTS (
  SELECT 1 FROM source s WHERE s.source_id = NEW.source_id AND s.legal_review_state = 'approved')
BEGIN SELECT RAISE(ABORT, 'route policy requires an approved source legal review'); END;

CREATE TABLE fetch_attempt (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  route_id TEXT NOT NULL REFERENCES route(route_id),
  request_url TEXT NOT NULL,
  final_url TEXT,
  http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  outcome TEXT NOT NULL CHECK (outcome IN
    ('content_200','not_modified_304','human_capture','error_4xx','error_5xx',
     'rate_limited','blocked','timeout','robots_denied','paywall')),
  etag TEXT,
  last_modified TEXT,
  requested_at_utc TEXT NOT NULL,
  fetch_tier INTEGER NOT NULL CHECK (fetch_tier IN (1,2,3)),
  fetcher_version TEXT NOT NULL,
  source_policy_review_id TEXT NOT NULL REFERENCES source_policy_review(source_policy_review_id),
  route_policy_review_id TEXT NOT NULL REFERENCES route_policy_review(route_policy_review_id),
  robots_snapshot_sha TEXT REFERENCES artifact(sha256),
  captured_by TEXT,
  is_finalized INTEGER NOT NULL DEFAULT 0 CHECK (is_finalized IN (0,1)),
  finalized_at_utc TEXT,
  CHECK ((outcome = 'human_capture') = (fetch_tier = 3)),
  CHECK (outcome <> 'human_capture' OR captured_by IS NOT NULL),
  CHECK (outcome = 'human_capture' OR robots_snapshot_sha IS NOT NULL),
  CHECK (outcome <> 'content_200' OR http_status = 200),
  CHECK (outcome <> 'not_modified_304' OR
    (http_status = 304 AND (etag IS NOT NULL OR last_modified IS NOT NULL))),
  CHECK ((is_finalized = 1) = (finalized_at_utc IS NOT NULL))
) STRICT;

CREATE TRIGGER fetch_attempt_policy_guard
BEFORE INSERT ON fetch_attempt
WHEN NOT EXISTS (
  SELECT 1 FROM route r
   JOIN job_queue jq ON jq.job_id=NEW.job_id
   JOIN source_policy_review spr ON spr.source_id=r.source_id
   JOIN route_policy_review rpr ON rpr.route_id=r.route_id
     AND rpr.source_policy_review_id=spr.source_policy_review_id
   WHERE r.route_id=NEW.route_id
     AND jq.status='running'
     AND julianday(jq.claimed_at_utc)<=julianday(NEW.requested_at_utc)
     AND julianday(jq.lease_expires_at_utc)>=julianday(NEW.requested_at_utc)
     AND spr.source_policy_review_id=NEW.source_policy_review_id
     AND rpr.route_policy_review_id=NEW.route_policy_review_id
     AND spr.decision='approved' AND rpr.decision='approved'
     AND (r.access_class='public' OR
          (spr.reviewed_by NOT LIKE 'tcpipe-public-preflight/%'
           AND rpr.reviewed_by NOT LIKE 'tcpipe-public-preflight/%'))
     AND julianday(spr.reviewed_at_utc)<=julianday(NEW.requested_at_utc)
     AND julianday(rpr.reviewed_at_utc)<=julianday(NEW.requested_at_utc)
     AND (spr.valid_until_utc IS NULL OR
       julianday(spr.valid_until_utc)>=julianday(NEW.requested_at_utc))
     AND (rpr.valid_until_utc IS NULL OR
       julianday(rpr.valid_until_utc)>=julianday(NEW.requested_at_utc))
     AND (NEW.outcome='human_capture'
          OR (NEW.outcome='robots_denied' AND rpr.robots_state='disallowed')
          OR (NEW.outcome<>'robots_denied' AND rpr.robots_state='allowed'))
     AND (NEW.outcome='human_capture' OR NEW.robots_snapshot_sha=rpr.robots_snapshot_sha))
BEGIN SELECT RAISE(ABORT, 'fetch blocked: legal, route policy, or robots approval missing'); END;

CREATE TRIGGER fetch_attempt_must_stage
BEFORE INSERT ON fetch_attempt WHEN NEW.is_finalized = 1
BEGIN SELECT RAISE(ABORT, 'fetch attempts must be staged, linked to artifacts, then finalized'); END;

CREATE TABLE fetch_attempt_artifact (
  attempt_id TEXT NOT NULL REFERENCES fetch_attempt(attempt_id),
  artifact_sha256 TEXT NOT NULL REFERENCES artifact(sha256),
  role TEXT NOT NULL CHECK (role IN
    ('response_body','download','reused_body','rendered_dom','screenshot','network_log','human_capture')),
  PRIMARY KEY (attempt_id, artifact_sha256, role)
) STRICT;

CREATE TRIGGER fetch_attempt_finalize_guard
BEFORE UPDATE OF is_finalized ON fetch_attempt
WHEN OLD.is_finalized = 0 AND NEW.is_finalized = 1 AND (
  (NEW.outcome = 'content_200' AND NEW.fetch_tier = 1 AND NOT EXISTS (
     SELECT 1 FROM fetch_attempt_artifact f WHERE f.attempt_id=NEW.attempt_id
       AND f.role IN ('response_body','download'))) OR
  (NEW.outcome = 'content_200' AND NEW.fetch_tier = 2 AND (
     NOT EXISTS (SELECT 1 FROM fetch_attempt_artifact f WHERE f.attempt_id=NEW.attempt_id AND f.role='rendered_dom') OR
     NOT EXISTS (SELECT 1 FROM fetch_attempt_artifact f WHERE f.attempt_id=NEW.attempt_id AND f.role='screenshot'))) OR
  (NEW.outcome = 'human_capture' AND NOT EXISTS (
     SELECT 1 FROM fetch_attempt_artifact f WHERE f.attempt_id=NEW.attempt_id AND f.role='human_capture')) OR
  (NEW.outcome = 'not_modified_304' AND NOT EXISTS (
     SELECT 1 FROM fetch_attempt_artifact f WHERE f.attempt_id=NEW.attempt_id AND f.role='reused_body')) OR
  (NEW.outcome = 'not_modified_304' AND NOT EXISTS (
     SELECT 1 FROM fetch_attempt_artifact reused
     JOIN fetch_attempt_artifact prior ON prior.artifact_sha256=reused.artifact_sha256
       AND prior.role IN ('response_body','download','reused_body','rendered_dom')
     JOIN fetch_attempt fa_prior ON fa_prior.attempt_id=prior.attempt_id
      WHERE reused.attempt_id=NEW.attempt_id AND reused.role='reused_body'
        AND fa_prior.attempt_id<>NEW.attempt_id AND fa_prior.route_id=NEW.route_id
        AND fa_prior.is_finalized=1
        AND julianday(fa_prior.requested_at_utc)<=julianday(NEW.requested_at_utc))) OR
  0
)
BEGIN SELECT RAISE(ABORT, 'fetch artifact roles do not satisfy the outcome/tier contract'); END;

CREATE TRIGGER fetch_attempt_final_no_update
BEFORE UPDATE ON fetch_attempt WHEN OLD.is_finalized = 1
BEGIN SELECT RAISE(ABORT, 'finalized fetch_attempt is immutable'); END;
CREATE TRIGGER fetch_attempt_final_no_delete
BEFORE DELETE ON fetch_attempt WHEN OLD.is_finalized = 1
BEGIN SELECT RAISE(ABORT, 'finalized fetch_attempt is immutable'); END;
CREATE TRIGGER fetch_artifact_final_no_update
BEFORE UPDATE ON fetch_attempt_artifact WHEN
  (SELECT is_finalized FROM fetch_attempt WHERE attempt_id=OLD.attempt_id) = 1
BEGIN SELECT RAISE(ABORT, 'artifacts of a finalized fetch are immutable'); END;
CREATE TRIGGER fetch_artifact_final_no_delete
BEFORE DELETE ON fetch_attempt_artifact WHEN
  (SELECT is_finalized FROM fetch_attempt WHERE attempt_id=OLD.attempt_id) = 1
BEGIN SELECT RAISE(ABORT, 'artifacts of a finalized fetch are immutable'); END;

CREATE TABLE host_state (
  host TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  suspended_until_utc TEXT,
  suspension_cycles INTEGER NOT NULL DEFAULT 0 CHECK (suspension_cycles >= 0),
  consecutive_403_cycles INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_403_cycles >= 0),
  route_state TEXT NOT NULL DEFAULT 'fetchable' CHECK
    (route_state IN ('fetchable','awaiting_retry','blocked_access','needs_human')),
  reason TEXT NOT NULL DEFAULT 'initial',
  robots_sha256 TEXT,
  robots_fetched_at_utc TEXT,
  last_outcome TEXT,
  updated_at_utc TEXT NOT NULL
) STRICT;

-- Versioned adapters ----------------------------------------------------------
CREATE TABLE adapter (
  adapter_id TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rules','code')),
  rules_sha256 TEXT,
  code_ref TEXT,
  template_fingerprint TEXT,
  authored_by TEXT NOT NULL CHECK (authored_by IN ('picker','llm_proposal','human')),
  confirmed_by_human INTEGER NOT NULL DEFAULT 0 CHECK (confirmed_by_human IN (0,1)),
  row_drop_justification TEXT,
  created_at_utc TEXT NOT NULL,
  PRIMARY KEY (adapter_id, version),
  CHECK ((kind = 'rules') = (rules_sha256 IS NOT NULL)),
  CHECK ((kind = 'code') = (code_ref IS NOT NULL))
) STRICT;

CREATE TABLE adapter_fixture (
  fixture_id TEXT PRIMARY KEY,
  adapter_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  artifact_sha256 TEXT NOT NULL REFERENCES artifact(sha256),
  expected_sha256 TEXT NOT NULL CHECK
    (length(expected_sha256) = 64 AND expected_sha256 NOT GLOB '*[^0-9a-f]*'),
  origin TEXT NOT NULL CHECK (origin IN ('exhaustive_audit','sampled_audit','picker_confirm')),
  passing INTEGER NOT NULL DEFAULT 1 CHECK (passing IN (0,1)),
  created_at_utc TEXT NOT NULL,
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version)
) STRICT;

CREATE TRIGGER route_adapter_fixture_insert BEFORE INSERT ON route
WHEN NEW.active_adapter_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM adapter_fixture f WHERE f.adapter_id = NEW.active_adapter_id
    AND f.adapter_version = NEW.active_adapter_version AND f.passing = 1)
BEGIN SELECT RAISE(ABORT, 'active adapter requires a passing fixture'); END;
CREATE TRIGGER route_adapter_fixture_update
BEFORE UPDATE OF active_adapter_id, active_adapter_version ON route
WHEN NEW.active_adapter_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM adapter_fixture f WHERE f.adapter_id = NEW.active_adapter_id
    AND f.adapter_version = NEW.active_adapter_version AND f.passing = 1)
BEGIN SELECT RAISE(ABORT, 'active adapter requires a passing fixture'); END;

CREATE TRIGGER adapter_no_update BEFORE UPDATE ON adapter BEGIN
  SELECT RAISE(ABORT, 'adapter versions are immutable');
END;
CREATE TRIGGER adapter_no_delete BEFORE DELETE ON adapter BEGIN
  SELECT RAISE(ABORT, 'adapter versions are immutable');
END;
CREATE TRIGGER adapter_fixture_no_update BEFORE UPDATE ON adapter_fixture BEGIN
  SELECT RAISE(ABORT, 'adapter fixtures are immutable; add a new fixture or version');
END;
CREATE TRIGGER adapter_fixture_no_delete BEFORE DELETE ON adapter_fixture BEGIN
  SELECT RAISE(ABORT, 'adapter fixtures are immutable; add a new fixture or version');
END;

-- A route run is the unit of completion, freshness and replay -----------------
CREATE TABLE route_run (
  run_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  route_id TEXT NOT NULL REFERENCES route(route_id),
  adapter_id TEXT,
  adapter_version TEXT,
  run_status TEXT NOT NULL CHECK (run_status IN ('running','completed','failed','aborted')),
  started_at_utc TEXT NOT NULL,
  finished_at_utc TEXT,
  access_status TEXT NOT NULL DEFAULT 'ok' CHECK (access_status IN
    ('ok','robots_denied','paywall','blocked_access','transient_failure')),
  suspension_cycles INTEGER NOT NULL DEFAULT 0 CHECK (suspension_cycles >= 0),
  has_blocking_escalation INTEGER NOT NULL DEFAULT 0 CHECK (has_blocking_escalation IN (0,1)),
  freshness_state TEXT NOT NULL DEFAULT 'unknown' CHECK (freshness_state IN ('fresh','stale','unknown')),
  published_count INTEGER CHECK (published_count IS NULL OR published_count >= 0),
  count_quality TEXT NOT NULL CHECK (count_quality IN
    ('published','derived_from_category_text','not_published')),
  extracted_count INTEGER CHECK (extracted_count IS NULL OR extracted_count >= 0),
  structural_count INTEGER CHECK (structural_count IS NULL OR structural_count >= 0),
  container_resolved INTEGER CHECK (container_resolved IS NULL OR container_resolved IN (0,1)),
  variance_status TEXT NOT NULL DEFAULT 'not_evaluated' CHECK (variance_status IN
    ('not_evaluated','reconciled','parser_bug','adjudicated_source_variance','unexplained')),
  variance_evidence TEXT,
  variance_adjudicated_by TEXT,
  audit_strategy TEXT NOT NULL DEFAULT 'none' CHECK (audit_strategy IN
    ('none','exhaustive','stratified_random')),
  audit_sampled_count INTEGER NOT NULL DEFAULT 0 CHECK (audit_sampled_count >= 0),
  audit_error_count INTEGER NOT NULL DEFAULT 0 CHECK (audit_error_count >= 0),
  accuracy_lower_cp REAL CHECK (accuracy_lower_cp IS NULL OR accuracy_lower_cp BETWEEN 0 AND 1),
  field_health_blocked INTEGER NOT NULL DEFAULT 0 CHECK (field_health_blocked IN (0,1)),
  passing_fixture_count INTEGER NOT NULL DEFAULT 0 CHECK (passing_fixture_count >= 0),
  corroboration_state TEXT NOT NULL DEFAULT 'none' CHECK (corroboration_state IN
    ('none','second_parser','human_verified','independent_source')),
  empty_corroborated INTEGER NOT NULL DEFAULT 0 CHECK (empty_corroborated IN (0,1)),
  llm_oracle_veto INTEGER NOT NULL DEFAULT 0 CHECK (llm_oracle_veto IN (0,1)),
  terminal_state TEXT CHECK (terminal_state IS NULL OR terminal_state IN
    ('blocked_robots','blocked_paywall','blocked_access','awaiting_retry','needs_human',
     'stale','partial','verified_empty','blocked_no_public_rows','complete_reconciled',
     'complete_reconciled_derived_count','complete_count_unpublished','unresolved')),
  terminal_reason TEXT,
  terminal_calculator_version TEXT,
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version),
  CHECK ((adapter_id IS NULL) = (adapter_version IS NULL)),
  CHECK (audit_error_count <= audit_sampled_count),
  CHECK (variance_status <> 'adjudicated_source_variance' OR
    (variance_evidence IS NOT NULL AND variance_adjudicated_by IS NOT NULL)),
  CHECK (run_status = 'running' OR finished_at_utc IS NOT NULL),
  CHECK (finished_at_utc IS NULL OR julianday(finished_at_utc) >= julianday(started_at_utc)),
  CHECK ((run_status = 'completed') = (terminal_state IS NOT NULL)),
  UNIQUE (run_id, route_id)
) STRICT;

CREATE TRIGGER route_run_must_start_running
BEFORE INSERT ON route_run WHEN NEW.run_status<>'running' OR NEW.finished_at_utc IS NOT NULL
  OR NEW.terminal_state IS NOT NULL OR NEW.terminal_reason IS NOT NULL
  OR NEW.terminal_calculator_version IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM job_queue jq WHERE jq.job_id=NEW.job_id AND jq.status='running'
      AND julianday(jq.claimed_at_utc)<=julianday(NEW.started_at_utc)
      AND julianday(jq.lease_expires_at_utc)>=julianday(NEW.started_at_utc))
BEGIN SELECT RAISE(ABORT, 'route runs must be inserted running and finalized by the writer'); END;

CREATE TABLE route_current_run (
  route_id TEXT PRIMARY KEY REFERENCES route(route_id),
  run_id TEXT NOT NULL UNIQUE,
  published_at_utc TEXT NOT NULL,
  FOREIGN KEY (run_id, route_id) REFERENCES route_run(run_id, route_id)
) STRICT;

CREATE TABLE route_run_fetch (
  run_id TEXT NOT NULL REFERENCES route_run(run_id),
  attempt_id TEXT NOT NULL UNIQUE REFERENCES fetch_attempt(attempt_id),
  PRIMARY KEY (run_id, attempt_id)
) STRICT;

CREATE TRIGGER route_run_fetch_insert_guard
BEFORE INSERT ON route_run_fetch WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr JOIN fetch_attempt fa
    ON fa.route_id=rr.route_id AND fa.job_id=rr.job_id
   WHERE rr.run_id=NEW.run_id AND fa.attempt_id=NEW.attempt_id
     AND rr.run_status='running' AND fa.is_finalized=1)
BEGIN SELECT RAISE(ABORT, 'route run fetch must be finalized, same-route, and linked while running'); END;
CREATE TRIGGER route_run_fetch_no_update BEFORE UPDATE ON route_run_fetch BEGIN
  SELECT RAISE(ABORT, 'route run fetch links are append-only');
END;
CREATE TRIGGER route_run_fetch_no_delete BEFORE DELETE ON route_run_fetch BEGIN
  SELECT RAISE(ABORT, 'route run fetch links are append-only');
END;

CREATE TRIGGER route_current_run_insert_guard
BEFORE INSERT ON route_current_run WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr WHERE rr.run_id=NEW.run_id AND rr.route_id=NEW.route_id
    AND rr.run_status='completed')
BEGIN SELECT RAISE(ABORT, 'only a completed same-route run can be published'); END;
CREATE TRIGGER route_current_run_update_guard
BEFORE UPDATE ON route_current_run WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr WHERE rr.run_id=NEW.run_id AND rr.route_id=NEW.route_id
    AND rr.run_status='completed')
BEGIN SELECT RAISE(ABORT, 'only a completed same-route run can be published'); END;

CREATE TRIGGER route_run_completed_no_update
BEFORE UPDATE ON route_run WHEN OLD.run_status <> 'running'
BEGIN SELECT RAISE(ABORT, 'finished route_run is immutable'); END;
CREATE TRIGGER route_run_no_delete BEFORE DELETE ON route_run
BEGIN SELECT RAISE(ABORT, 'route_run is append-only'); END;

CREATE TABLE parse_run (
  parse_run_id TEXT PRIMARY KEY,
  route_run_id TEXT NOT NULL UNIQUE REFERENCES route_run(run_id),
  adapter_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  artifact_set_hash TEXT NOT NULL CHECK
    (length(artifact_set_hash) = 64 AND artifact_set_hash NOT GLOB '*[^0-9a-f]*'),
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','parsed','quarantined_schema_drift','failed')),
  started_at_utc TEXT NOT NULL,
  finished_at_utc TEXT,
  FOREIGN KEY (adapter_id, adapter_version) REFERENCES adapter(adapter_id, version),
  CHECK ((status = 'running') = (finished_at_utc IS NULL)),
  CHECK (finished_at_utc IS NULL OR julianday(finished_at_utc) >= julianday(started_at_utc))
) STRICT;

CREATE TRIGGER parse_run_insert_guard
BEFORE INSERT ON parse_run WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr WHERE rr.run_id=NEW.route_run_id
    AND rr.run_status='running' AND rr.adapter_id=NEW.adapter_id
    AND rr.adapter_version=NEW.adapter_version
    AND EXISTS (SELECT 1 FROM job_queue jq WHERE jq.job_id=rr.job_id AND jq.status='running'))
BEGIN SELECT RAISE(ABORT, 'parse run must use the adapter of a running route run'); END;

CREATE TABLE parse_run_artifact (
  parse_run_id TEXT NOT NULL REFERENCES parse_run(parse_run_id),
  artifact_sha256 TEXT NOT NULL REFERENCES artifact(sha256),
  role TEXT NOT NULL CHECK (role IN
    ('response_body','download','reused_body','rendered_dom','screenshot','human_capture')),
  PRIMARY KEY (parse_run_id, artifact_sha256, role)
) STRICT;

CREATE TRIGGER parse_run_artifact_insert_guard
BEFORE INSERT ON parse_run_artifact WHEN NOT EXISTS (
  SELECT 1 FROM parse_run pr
  JOIN route_run_fetch rrf ON rrf.run_id=pr.route_run_id
  JOIN fetch_attempt_artifact faa ON faa.attempt_id=rrf.attempt_id
   AND faa.artifact_sha256=NEW.artifact_sha256 AND faa.role=NEW.role
  JOIN fetch_attempt fa ON fa.attempt_id=faa.attempt_id
   WHERE pr.parse_run_id=NEW.parse_run_id AND pr.status='running' AND fa.is_finalized=1)
BEGIN SELECT RAISE(ABORT, 'parse input must come from a linked finalized fetch artifact'); END;
CREATE TRIGGER parse_run_artifact_no_update BEFORE UPDATE ON parse_run_artifact BEGIN
  SELECT RAISE(ABORT, 'parse input links are append-only');
END;
CREATE TRIGGER parse_run_artifact_no_delete BEFORE DELETE ON parse_run_artifact BEGIN
  SELECT RAISE(ABORT, 'parse input links are append-only');
END;

CREATE TABLE source_record (
  source_record_id TEXT PRIMARY KEY,
  parse_run_id TEXT NOT NULL REFERENCES parse_run(parse_run_id),
  source_record_key TEXT NOT NULL,
  row_ordinal INTEGER NOT NULL CHECK (row_ordinal >= 0),
  record_locator TEXT NOT NULL,
  created_at_utc TEXT NOT NULL,
  UNIQUE (parse_run_id, source_record_key),
  UNIQUE (parse_run_id, row_ordinal)
) STRICT;

CREATE TABLE field_definition (
  field_name TEXT PRIMARY KEY,
  value_kind TEXT NOT NULL CHECK (value_kind IN
    ('text','url','phone','country','identifier','currency_amount','date','boolean')),
  cardinality TEXT NOT NULL CHECK (cardinality IN ('one','many')),
  description TEXT NOT NULL
) STRICT;
INSERT INTO field_definition VALUES
 ('published_name','text','one','Name exactly as published'),
 ('published_address','text','many','Published postal or street address'),
 ('published_country','country','one','Published country'),
 ('published_phone','phone','many','Public organisation phone'),
 ('published_website','url','many','Centre website'),
 ('published_apply_url','url','many','Course or application URL'),
 ('official_relationship_wording','text','many','Verbatim relationship wording'),
 ('certificate_name','text','many','Published certificate or course name'),
 ('price_text','text','many','Verbatim price statement'),
 ('provider_id','identifier','many','Source-scoped official provider identifier'),
 ('package_name','text','many','Published name of a multi-course bundle'),
 ('package_contents','text','many','Verbatim list of courses included in a bundle'),
 ('delivery_mode_text','text','many','Verbatim delivery mode wording'),
 ('published_locality','text','many','Published city or locality');

CREATE TABLE field_observation (
  field_observation_id TEXT PRIMARY KEY,
  source_record_id TEXT NOT NULL REFERENCES source_record(source_record_id),
  field_name TEXT NOT NULL REFERENCES field_definition(field_name),
  value_ordinal INTEGER NOT NULL DEFAULT 0 CHECK (value_ordinal >= 0),
  raw_value TEXT NOT NULL,
  normalized_value TEXT,
  artifact_sha256 TEXT NOT NULL REFERENCES artifact(sha256),
  field_locator TEXT NOT NULL,
  evidence_quote TEXT NOT NULL,
  normalization_state TEXT NOT NULL CHECK (normalization_state IN
    ('not_requested','normalized','failed','ambiguous')),
  validation_state TEXT NOT NULL CHECK (validation_state IN
    ('pending','accepted','flagged','rejected')),
  validation_flags_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(validation_flags_json)),
  observed_at_utc TEXT NOT NULL,
  UNIQUE (source_record_id, field_name, value_ordinal)
) STRICT;
CREATE TRIGGER source_record_no_update BEFORE UPDATE ON source_record BEGIN
  SELECT RAISE(ABORT, 'source_record is append-only');
END;
CREATE TRIGGER source_record_requires_running_parse
BEFORE INSERT ON source_record WHEN NOT EXISTS (
  SELECT 1 FROM parse_run p WHERE p.parse_run_id=NEW.parse_run_id AND p.status='running')
BEGIN SELECT RAISE(ABORT, 'source records require a running parse'); END;
CREATE TRIGGER source_record_no_delete BEFORE DELETE ON source_record BEGIN
  SELECT RAISE(ABORT, 'source_record is append-only');
END;
CREATE TRIGGER field_observation_no_update BEFORE UPDATE ON field_observation BEGIN
  SELECT RAISE(ABORT, 'field_observation is append-only');
END;
CREATE TRIGGER field_observation_no_delete BEFORE DELETE ON field_observation BEGIN
  SELECT RAISE(ABORT, 'field_observation is append-only');
END;
CREATE TRIGGER field_observation_requires_running_parse
BEFORE INSERT ON field_observation WHEN NOT EXISTS (
  SELECT 1 FROM source_record s JOIN parse_run p ON p.parse_run_id=s.parse_run_id
  JOIN parse_run_artifact pa ON pa.parse_run_id=p.parse_run_id
   AND pa.artifact_sha256=NEW.artifact_sha256
   WHERE s.source_record_id=NEW.source_record_id AND p.status='running')
BEGIN SELECT RAISE(ABORT, 'field observations require a running parse and one of its inputs'); END;
CREATE TRIGGER parse_run_final_no_update
BEFORE UPDATE ON parse_run WHEN OLD.status <> 'running'
BEGIN SELECT RAISE(ABORT, 'finished parse_run is immutable'); END;
CREATE TRIGGER parse_run_no_delete BEFORE DELETE ON parse_run
BEGIN SELECT RAISE(ABORT, 'parse_run is append-only'); END;

CREATE TABLE field_health (
  parse_run_id TEXT NOT NULL REFERENCES parse_run(parse_run_id),
  field_name TEXT NOT NULL REFERENCES field_definition(field_name),
  fill_rate REAL NOT NULL CHECK (fill_rate BETWEEN 0 AND 1),
  baseline_mean REAL CHECK (baseline_mean IS NULL OR baseline_mean BETWEEN 0 AND 1),
  baseline_sd REAL CHECK (baseline_sd IS NULL OR baseline_sd >= 0),
  alert_state TEXT NOT NULL CHECK (alert_state IN ('ok','warn','block')),
  PRIMARY KEY (parse_run_id, field_name)
) STRICT;
CREATE TRIGGER field_health_insert_guard
BEFORE INSERT ON field_health WHEN NOT EXISTS (
  SELECT 1 FROM parse_run pr JOIN route_run rr ON rr.run_id=pr.route_run_id
   WHERE pr.parse_run_id=NEW.parse_run_id AND rr.run_status='running')
BEGIN SELECT RAISE(ABORT, 'field health must be recorded before route-run finalization'); END;
CREATE TRIGGER field_health_no_update BEFORE UPDATE ON field_health BEGIN
  SELECT RAISE(ABORT, 'field health evidence is immutable');
END;
CREATE TRIGGER field_health_no_delete BEFORE DELETE ON field_health BEGIN
  SELECT RAISE(ABORT, 'field health evidence is immutable');
END;

CREATE TABLE audit_sample (
  run_id TEXT PRIMARY KEY REFERENCES route_run(run_id),
  strategy TEXT NOT NULL CHECK (strategy IN ('exhaustive','stratified_random')),
  n_sampled INTEGER NOT NULL CHECK (n_sampled > 0),
  n_errors INTEGER NOT NULL CHECK (n_errors BETWEEN 0 AND n_sampled),
  accuracy_lower_cp REAL CHECK (accuracy_lower_cp IS NULL OR accuracy_lower_cp BETWEEN 0 AND 1),
  error_detail_json TEXT NOT NULL CHECK (json_valid(error_detail_json)),
  audited_by TEXT NOT NULL,
  audited_at_utc TEXT NOT NULL,
  CHECK ((strategy = 'stratified_random') = (accuracy_lower_cp IS NOT NULL)),
  -- A lower confidence bound on accuracy can never exceed the accuracy actually observed
  -- in the sample. This rejects audit rows whose stored bound contradicts their own
  -- error count, which is the only thing standing between a fabricated accuracy_lower_cp
  -- and a completion verdict.
  CHECK (accuracy_lower_cp IS NULL OR
         accuracy_lower_cp <= 1.0 - (CAST(n_errors AS REAL) / n_sampled))
) STRICT;
CREATE TRIGGER audit_sample_insert_guard
BEFORE INSERT ON audit_sample WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr WHERE rr.run_id=NEW.run_id AND rr.run_status='running')
BEGIN SELECT RAISE(ABORT, 'audit evidence must be recorded before route-run finalization'); END;
CREATE TRIGGER audit_sample_no_update BEFORE UPDATE ON audit_sample BEGIN
  SELECT RAISE(ABORT, 'audit evidence is immutable');
END;
CREATE TRIGGER audit_sample_no_delete BEFORE DELETE ON audit_sample BEGIN
  SELECT RAISE(ABORT, 'audit evidence is immutable');
END;

CREATE TABLE run_corroboration (
  run_id TEXT NOT NULL REFERENCES route_run(run_id),
  corroboration_kind TEXT NOT NULL CHECK (corroboration_kind IN
    ('second_parser','human_verified','independent_source')),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  recorded_by TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  PRIMARY KEY (run_id, corroboration_kind)
) STRICT;
CREATE TRIGGER run_corroboration_insert_guard
BEFORE INSERT ON run_corroboration WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr WHERE rr.run_id=NEW.run_id AND rr.run_status='running')
BEGIN SELECT RAISE(ABORT, 'corroboration must be recorded before route-run finalization'); END;
CREATE TRIGGER run_corroboration_no_update BEFORE UPDATE ON run_corroboration BEGIN
  SELECT RAISE(ABORT, 'corroboration evidence is immutable');
END;
CREATE TRIGGER run_corroboration_no_delete BEFORE DELETE ON run_corroboration BEGIN
  SELECT RAISE(ABORT, 'corroboration evidence is immutable');
END;

CREATE TABLE empty_verification_evidence (
  run_id TEXT PRIMARY KEY REFERENCES route_run(run_id),
  evidence_kind TEXT NOT NULL CHECK (evidence_kind IN
    ('second_structural_count','text_no_records','human_confirmation')),
  artifact_sha256 TEXT REFERENCES artifact(sha256),
  evidence_quote TEXT,
  confirmed_by TEXT,
  recorded_at_utc TEXT NOT NULL,
  CHECK (evidence_kind <> 'text_no_records' OR
    (artifact_sha256 IS NOT NULL AND evidence_quote IS NOT NULL)),
  CHECK (evidence_kind <> 'human_confirmation' OR confirmed_by IS NOT NULL)
) STRICT;
CREATE TRIGGER empty_evidence_insert_guard
BEFORE INSERT ON empty_verification_evidence WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr WHERE rr.run_id=NEW.run_id AND rr.run_status='running')
BEGIN SELECT RAISE(ABORT, 'empty evidence must be recorded before route-run finalization'); END;
CREATE TRIGGER empty_evidence_no_update BEFORE UPDATE ON empty_verification_evidence BEGIN
  SELECT RAISE(ABORT, 'empty-result evidence is immutable');
END;
CREATE TRIGGER empty_evidence_no_delete BEFORE DELETE ON empty_verification_evidence BEGIN
  SELECT RAISE(ABORT, 'empty-result evidence is immutable');
END;

CREATE TABLE oracle_check (
  run_id TEXT PRIMARY KEY REFERENCES route_run(run_id),
  provider_names_json TEXT NOT NULL CHECK (json_valid(provider_names_json)),
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL CHECK
    (length(prompt_hash) = 64 AND prompt_hash NOT GLOB '*[^0-9a-f]*'),
  checked_at_utc TEXT NOT NULL,
  CHECK (json_type(provider_names_json) = 'array')
) STRICT;
CREATE TRIGGER oracle_check_insert_guard
BEFORE INSERT ON oracle_check WHEN NOT EXISTS (
  SELECT 1 FROM route_run rr WHERE rr.run_id=NEW.run_id AND rr.run_status='running')
BEGIN SELECT RAISE(ABORT, 'oracle evidence must be recorded before route-run finalization'); END;
CREATE TRIGGER oracle_check_no_update BEFORE UPDATE ON oracle_check BEGIN
  SELECT RAISE(ABORT, 'oracle evidence is immutable');
END;
CREATE TRIGGER oracle_check_no_delete BEFORE DELETE ON oracle_check BEGIN
  SELECT RAISE(ABORT, 'oracle evidence is immutable');
END;

-- Human review and reusable rules --------------------------------------------
CREATE TABLE rule (
  rule_id TEXT PRIMARY KEY,
  rule_kind TEXT NOT NULL CHECK (rule_kind IN
    ('selector','pagination','host_recipe','name_alias','merge_decision','reject_pattern')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('url','host','template_fingerprint','global')),
  scope_value TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  hit_count INTEGER NOT NULL DEFAULT 0 CHECK (hit_count >= 0),
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  created_at_utc TEXT NOT NULL
) STRICT;

CREATE TABLE escalation (
  escalation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN
    ('pick_selector','pick_pagination','capture_page','solve_access','confirm_extraction',
     'confirm_merge','classify_relationship','confirm_new_source','confirm_no_data',
     'merge_conflict','engineering','legal_review')),
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','wont_fix','expired')),
  priority INTEGER NOT NULL CHECK (priority > 0),
  route_id TEXT REFERENCES route(route_id),
  run_id TEXT REFERENCES route_run(run_id),
  question TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK (json_valid(context_json)),
  resolution_json TEXT CHECK (resolution_json IS NULL OR json_valid(resolution_json)),
  produced_rule_id TEXT REFERENCES rule(rule_id),
  opened_at_utc TEXT NOT NULL,
  resolved_at_utc TEXT,
  CHECK ((status = 'resolved') = (resolved_at_utc IS NOT NULL))
) STRICT;

CREATE TABLE review_queue (
  review_id TEXT PRIMARY KEY,
  review_kind TEXT NOT NULL CHECK (review_kind IN
    ('merge_candidate','relationship_class','new_source_candidate','field_validation',
     'correction_rule_candidate')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  proposed_by TEXT NOT NULL CHECK
    (proposed_by IN ('resolver','llm','validator','operator_feedback')),
  confidence REAL CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','rejected')),
  decided_by TEXT,
  decision_rationale TEXT,
  decided_at_utc TEXT,
  CHECK ((status = 'pending') =
    (decided_at_utc IS NULL AND decided_by IS NULL AND decision_rationale IS NULL))
) STRICT;

-- Manual correction overlay --------------------------------------------------
-- Published source evidence is never edited. Corrections are proposed, decided and
-- layered over observations; wider-scope corrections must open a reusable-rule review.
CREATE TABLE manual_correction (
  correction_id TEXT PRIMARY KEY,
  field_observation_id TEXT NOT NULL REFERENCES field_observation(field_observation_id),
  action TEXT NOT NULL CHECK
    (action IN ('replace_normalized','reject_value','reject_record')),
  corrected_normalized_value TEXT,
  scope TEXT NOT NULL CHECK
    (scope IN ('one_record','route_template','global_candidate')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 10),
  proposed_by TEXT NOT NULL,
  proposed_at_utc TEXT NOT NULL,
  supersedes_correction_id TEXT UNIQUE REFERENCES manual_correction(correction_id),
  CHECK ((action='replace_normalized') = (corrected_normalized_value IS NOT NULL))
) STRICT;

CREATE TRIGGER manual_correction_supersedes_guard
BEFORE INSERT ON manual_correction
WHEN NEW.supersedes_correction_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM manual_correction prior
   WHERE prior.correction_id=NEW.supersedes_correction_id
     AND prior.field_observation_id=NEW.field_observation_id)
BEGIN SELECT RAISE(ABORT, 'a correction can only supersede one for the same observation'); END;
CREATE TRIGGER manual_correction_no_update BEFORE UPDATE ON manual_correction BEGIN
  SELECT RAISE(ABORT, 'manual corrections are append-only; supersede instead');
END;
CREATE TRIGGER manual_correction_no_delete BEFORE DELETE ON manual_correction BEGIN
  SELECT RAISE(ABORT, 'manual corrections are append-only');
END;

CREATE TABLE manual_correction_decision (
  correction_id TEXT PRIMARY KEY REFERENCES manual_correction(correction_id),
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  decided_by TEXT NOT NULL,
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) >= 5),
  rule_candidate_review_id TEXT REFERENCES review_queue(review_id),
  decided_at_utc TEXT NOT NULL,
  CHECK (decision<>'rejected' OR rule_candidate_review_id IS NULL)
) STRICT;

CREATE TRIGGER correction_decision_scope_guard
BEFORE INSERT ON manual_correction_decision
WHEN NEW.decision='accepted' AND NOT EXISTS (
  SELECT 1 FROM manual_correction mc WHERE mc.correction_id=NEW.correction_id AND
    ((mc.scope='one_record' AND NEW.rule_candidate_review_id IS NULL) OR
     (mc.scope<>'one_record' AND NEW.rule_candidate_review_id IS NOT NULL)))
BEGIN SELECT RAISE(ABORT, 'accepted correction review linkage does not match its scope'); END;
CREATE TRIGGER correction_decision_current_guard
BEFORE INSERT ON manual_correction_decision
WHEN NEW.decision='accepted' AND EXISTS (
  SELECT 1 FROM manual_correction incoming
  JOIN manual_correction current
    ON current.field_observation_id=incoming.field_observation_id
  JOIN manual_correction_decision current_decision
    ON current_decision.correction_id=current.correction_id
   WHERE incoming.correction_id=NEW.correction_id
     AND current_decision.decision='accepted'
     AND current.correction_id<>incoming.correction_id
     AND incoming.supersedes_correction_id IS NOT current.correction_id
     AND NOT EXISTS (
       SELECT 1 FROM manual_correction child
       JOIN manual_correction_decision child_decision
         ON child_decision.correction_id=child.correction_id
        WHERE child.supersedes_correction_id=current.correction_id
          AND child_decision.decision='accepted'))
BEGIN SELECT RAISE(ABORT, 'accepting a second correction requires an explicit supersedes link'); END;
CREATE TRIGGER correction_decision_rule_guard
BEFORE INSERT ON manual_correction_decision
WHEN NEW.rule_candidate_review_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM review_queue rq JOIN manual_correction mc
    ON mc.correction_id=NEW.correction_id
   WHERE rq.review_id=NEW.rule_candidate_review_id
     AND rq.review_kind='correction_rule_candidate' AND rq.status='pending')
BEGIN SELECT RAISE(ABORT, 'broader correction requires its pending rule-candidate review'); END;
CREATE TRIGGER correction_decision_no_update BEFORE UPDATE ON manual_correction_decision BEGIN
  SELECT RAISE(ABORT, 'correction decisions are append-only');
END;
CREATE TRIGGER correction_decision_no_delete BEFORE DELETE ON manual_correction_decision BEGIN
  SELECT RAISE(ABORT, 'correction decisions are append-only');
END;

CREATE TABLE correction_rule (
  correction_rule_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES review_queue(review_id),
  origin_correction_id TEXT NOT NULL REFERENCES manual_correction(correction_id),
  field_name TEXT NOT NULL REFERENCES field_definition(field_name),
  match_raw_value TEXT NOT NULL,
  action TEXT NOT NULL CHECK
    (action IN ('replace_normalized','reject_value','reject_record')),
  replacement_normalized_value TEXT,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('route_id','template_fingerprint','global')),
  scope_value TEXT NOT NULL,
  fixture_count INTEGER NOT NULL CHECK (fixture_count > 0),
  projection_hash_before TEXT NOT NULL CHECK
    (length(projection_hash_before)=64 AND projection_hash_before NOT GLOB '*[^0-9a-f]*'),
  projection_hash_after TEXT NOT NULL CHECK
    (length(projection_hash_after)=64 AND projection_hash_after NOT GLOB '*[^0-9a-f]*'),
  affected_observation_count INTEGER NOT NULL CHECK (affected_observation_count > 0),
  row_count_delta INTEGER NOT NULL CHECK (row_count_delta <= 0),
  row_drop_justification TEXT,
  replayed_by TEXT NOT NULL,
  replayed_at_utc TEXT NOT NULL,
  supersedes_rule_id TEXT UNIQUE REFERENCES correction_rule(correction_rule_id),
  CHECK ((action='replace_normalized') = (replacement_normalized_value IS NOT NULL)),
  CHECK (projection_hash_before<>projection_hash_after),
  CHECK ((scope_kind='global') = (scope_value='')),
  CHECK (row_count_delta=0 OR length(trim(row_drop_justification))>=10)
) STRICT;

CREATE TRIGGER correction_rule_review_guard
BEFORE INSERT ON correction_rule WHEN NOT EXISTS (
  SELECT 1 FROM review_queue rq
  JOIN manual_correction_decision md ON md.rule_candidate_review_id=rq.review_id
   WHERE rq.review_id=NEW.review_id AND rq.review_kind='correction_rule_candidate'
     AND rq.status='accepted' AND md.correction_id=NEW.origin_correction_id
     AND md.decision='accepted')
BEGIN SELECT RAISE(ABORT, 'correction rule requires its accepted correction-rule review'); END;
CREATE TRIGGER correction_rule_supersedes_guard
BEFORE INSERT ON correction_rule WHEN NEW.supersedes_rule_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM correction_rule prior WHERE prior.correction_rule_id=NEW.supersedes_rule_id
    AND prior.field_name=NEW.field_name AND prior.match_raw_value=NEW.match_raw_value
    AND prior.scope_kind=NEW.scope_kind AND prior.scope_value=NEW.scope_value)
BEGIN SELECT RAISE(ABORT, 'a correction rule may only supersede the same match and scope'); END;
CREATE TRIGGER correction_rule_conflict_guard
BEFORE INSERT ON correction_rule WHEN EXISTS (
  SELECT 1 FROM correction_rule current
   WHERE current.field_name=NEW.field_name AND current.match_raw_value=NEW.match_raw_value
     AND current.scope_kind=NEW.scope_kind AND current.scope_value=NEW.scope_value
     AND current.correction_rule_id IS NOT NEW.supersedes_rule_id
     AND NOT EXISTS (
       SELECT 1 FROM correction_rule child
        WHERE child.supersedes_rule_id=current.correction_rule_id))
BEGIN SELECT RAISE(ABORT, 'an active correction rule already covers this exact match and scope'); END;
CREATE TRIGGER correction_rule_no_update BEFORE UPDATE ON correction_rule BEGIN
  SELECT RAISE(ABORT, 'correction rules are append-only; supersede instead');
END;
CREATE TRIGGER correction_rule_no_delete BEFORE DELETE ON correction_rule BEGIN
  SELECT RAISE(ABORT, 'correction rules are append-only');
END;

-- Governed materializations ---------------------------------------------------
CREATE TABLE centre (
  centre_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  registrable_domain TEXT,
  website_url TEXT,
  entity_state TEXT NOT NULL CHECK (entity_state IN ('active','merged_into','rejected')),
  merged_into_id TEXT REFERENCES centre(centre_id),
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL,
  CHECK ((entity_state = 'merged_into') = (merged_into_id IS NOT NULL)),
  CHECK (merged_into_id IS NULL OR merged_into_id <> centre_id)
) STRICT;

CREATE TABLE centre_identifier (
  id_kind TEXT NOT NULL CHECK (id_kind IN
    ('official_provider_id','domain','legacy_tc_id','org_number')),
  id_value TEXT NOT NULL,
  source_scope TEXT NOT NULL DEFAULT '',
  centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  PRIMARY KEY (id_kind, id_value, source_scope),
  CHECK (id_kind <> 'official_provider_id' OR source_scope <> '')
) STRICT;

CREATE TABLE centre_location (
  location_id TEXT PRIMARY KEY,
  centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  country_iso2 TEXT CHECK (country_iso2 IS NULL OR length(country_iso2) = 2),
  locality TEXT,
  address_published TEXT,
  latitude REAL,
  longitude REAL,
  coords_state TEXT NOT NULL CHECK (coords_state IN ('published','not_published')),
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  CHECK ((coords_state = 'published') = (latitude IS NOT NULL AND longitude IS NOT NULL))
) STRICT;

CREATE TABLE centre_contact (
  contact_id TEXT PRIMARY KEY,
  centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  contact_kind TEXT NOT NULL CHECK (contact_kind IN
    ('org_phone','org_role_inbox','apply_url','enquiry_form')),
  contact_value TEXT NOT NULL,
  is_personal_data INTEGER NOT NULL CHECK (is_personal_data IN (0,1)),
  verified_at_utc TEXT,
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id)
) STRICT;

CREATE TABLE accreditation (
  accreditation_id TEXT PRIMARY KEY,
  centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  source_id TEXT NOT NULL REFERENCES source(source_id),
  route_id TEXT NOT NULL REFERENCES route(route_id),
  relationship_verbatim TEXT NOT NULL,
  relationship_class TEXT NOT NULL CHECK (relationship_class IN
    ('approved','accredited','authorised','member','partner','unclassified')),
  direction TEXT NOT NULL CHECK (direction IN ('forward','reverse')),
  evidence_strength TEXT NOT NULL CHECK (evidence_strength IN
    ('official_directory','centre_self_claim')),
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  UNIQUE (centre_id, source_id, route_id, direction),
  CHECK ((evidence_strength = 'centre_self_claim') = (direction = 'reverse'))
) STRICT;

CREATE TABLE certificate (
  certificate_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source(source_id),
  official_code TEXT,
  certificate_name TEXT NOT NULL,
  official_url TEXT,
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id)
) STRICT;

CREATE TABLE offering (
  offering_id TEXT PRIMARY KEY,
  centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  certificate_id TEXT NOT NULL REFERENCES certificate(certificate_id),
  location_id TEXT REFERENCES centre_location(location_id),
  delivery_mode TEXT CHECK (delivery_mode IS NULL OR delivery_mode IN
    ('classroom','blended','online','unknown')),
  apply_url TEXT,
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id)
) STRICT;
CREATE UNIQUE INDEX ux_offering ON offering
  (centre_id, certificate_id, COALESCE(location_id,''), COALESCE(delivery_mode,'unknown'));

-- A bundle is a price covering SEVERAL certificates, so it cannot be expressed as an
-- offering (one centre x one certificate x one location x one delivery mode). Packages
-- carry their own price and list their contents. Tier-2 centre-site parsing populates
-- these; tier-1 association directories do not publish prices at all.
CREATE TABLE package (
  package_id TEXT PRIMARY KEY,
  centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  package_name TEXT NOT NULL,
  published_summary TEXT,
  location_id TEXT REFERENCES centre_location(location_id),
  delivery_mode TEXT CHECK (delivery_mode IS NULL OR delivery_mode IN
    ('classroom','blended','online','unknown')),
  apply_url TEXT,
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id)
) STRICT;
CREATE UNIQUE INDEX ux_package ON package
  (centre_id, package_name, COALESCE(location_id,''), COALESCE(delivery_mode,'unknown'));

CREATE TABLE package_item (
  package_id TEXT NOT NULL REFERENCES package(package_id),
  certificate_id TEXT NOT NULL REFERENCES certificate(certificate_id),
  item_ordinal INTEGER NOT NULL CHECK (item_ordinal >= 0),
  offering_id TEXT REFERENCES offering(offering_id),
  PRIMARY KEY (package_id, certificate_id),
  UNIQUE (package_id, item_ordinal)
) STRICT;

CREATE TRIGGER package_item_same_centre_guard
BEFORE INSERT ON package_item WHEN NEW.offering_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM package p JOIN offering o ON o.offering_id=NEW.offering_id
   WHERE p.package_id=NEW.package_id AND o.centre_id=p.centre_id
     AND o.certificate_id=NEW.certificate_id)
BEGIN SELECT RAISE(ABORT, 'package item offering must belong to the same centre and certificate'); END;

CREATE TABLE price_observation (
  price_id TEXT PRIMARY KEY,
  offering_id TEXT REFERENCES offering(offering_id),
  package_id TEXT REFERENCES package(package_id),
  amount REAL NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  price_basis TEXT NOT NULL CHECK (price_basis IN
    ('per_person','per_course','per_group','from','package')),
  includes_vat INTEGER CHECK (includes_vat IS NULL OR includes_vat IN (0,1)),
  valid_from TEXT,
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  -- exactly one subject: a single offering or a bundle, never both and never neither
  CHECK ((offering_id IS NULL) <> (package_id IS NULL)),
  CHECK ((price_basis = 'package') = (package_id IS NOT NULL))
) STRICT;

CREATE TABLE materialization_lineage (
  entity_kind TEXT NOT NULL CHECK (entity_kind IN
    ('centre','centre_identifier','centre_location','centre_contact',
     'accreditation','certificate','offering','package','package_item',
     'price_observation')),
  entity_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_observation_id TEXT NOT NULL REFERENCES field_observation(field_observation_id),
  manual_correction_id TEXT REFERENCES manual_correction(correction_id),
  correction_rule_id TEXT REFERENCES correction_rule(correction_rule_id),
  created_by_job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  created_at_utc TEXT NOT NULL,
  PRIMARY KEY (entity_kind, entity_id, field_name, field_observation_id),
  CHECK (manual_correction_id IS NULL OR correction_rule_id IS NULL)
) STRICT;

CREATE TRIGGER materialization_lineage_entity_guard
BEFORE INSERT ON materialization_lineage WHEN
  (NEW.entity_kind='centre' AND NOT EXISTS
    (SELECT 1 FROM centre WHERE centre_id=NEW.entity_id)) OR
  (NEW.entity_kind='centre_identifier' AND NOT EXISTS
    (SELECT 1 FROM centre_identifier
      WHERE id_kind || ':' || id_value || ':' || source_scope=NEW.entity_id)) OR
  (NEW.entity_kind='centre_location' AND NOT EXISTS
    (SELECT 1 FROM centre_location WHERE location_id=NEW.entity_id)) OR
  (NEW.entity_kind='centre_contact' AND NOT EXISTS
    (SELECT 1 FROM centre_contact WHERE contact_id=NEW.entity_id)) OR
  (NEW.entity_kind='accreditation' AND NOT EXISTS
    (SELECT 1 FROM accreditation WHERE accreditation_id=NEW.entity_id)) OR
  (NEW.entity_kind='certificate' AND NOT EXISTS
    (SELECT 1 FROM certificate WHERE certificate_id=NEW.entity_id)) OR
  (NEW.entity_kind='offering' AND NOT EXISTS
    (SELECT 1 FROM offering WHERE offering_id=NEW.entity_id)) OR
  (NEW.entity_kind='package' AND NOT EXISTS
    (SELECT 1 FROM package WHERE package_id=NEW.entity_id)) OR
  (NEW.entity_kind='package_item' AND NOT EXISTS
    (SELECT 1 FROM package_item
      WHERE package_id || ':' || certificate_id=NEW.entity_id)) OR
  (NEW.entity_kind='price_observation' AND NOT EXISTS
    (SELECT 1 FROM price_observation WHERE price_id=NEW.entity_id))
BEGIN SELECT RAISE(ABORT, 'lineage must reference an existing governed entity'); END;
CREATE TRIGGER materialization_lineage_correction_guard
BEFORE INSERT ON materialization_lineage
WHEN NEW.manual_correction_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM manual_correction mc
  JOIN manual_correction_decision md ON md.correction_id=mc.correction_id
   WHERE mc.correction_id=NEW.manual_correction_id
     AND mc.field_observation_id=NEW.field_observation_id
     AND md.decision='accepted'
     AND NOT EXISTS (
       SELECT 1 FROM manual_correction child
       JOIN manual_correction_decision child_decision
         ON child_decision.correction_id=child.correction_id
        WHERE child.supersedes_correction_id=mc.correction_id
          AND child_decision.decision='accepted'))
BEGIN SELECT RAISE(ABORT, 'lineage correction must be the effective accepted correction'); END;
CREATE TRIGGER materialization_lineage_rule_guard
BEFORE INSERT ON materialization_lineage
WHEN NEW.correction_rule_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM correction_rule cr
  JOIN field_observation fo ON fo.field_observation_id=NEW.field_observation_id
  JOIN source_record sr ON sr.source_record_id=fo.source_record_id
  JOIN parse_run pr ON pr.parse_run_id=sr.parse_run_id
  JOIN route_run rr ON rr.run_id=pr.route_run_id
  LEFT JOIN adapter a ON a.adapter_id=rr.adapter_id AND a.version=rr.adapter_version
   WHERE cr.correction_rule_id=NEW.correction_rule_id
     AND cr.field_name=fo.field_name AND cr.match_raw_value=fo.raw_value
     AND (cr.scope_kind='global' OR
       (cr.scope_kind='route_id' AND cr.scope_value=rr.route_id) OR
       (cr.scope_kind='template_fingerprint' AND cr.scope_value=a.template_fingerprint))
     AND NOT EXISTS (
       SELECT 1 FROM correction_rule child
        WHERE child.supersedes_rule_id=cr.correction_rule_id))
BEGIN SELECT RAISE(ABORT, 'lineage rule must be the active rule matching this observation'); END;
CREATE TRIGGER materialization_lineage_no_update BEFORE UPDATE ON materialization_lineage BEGIN
  SELECT RAISE(ABORT, 'materialization lineage is append-only');
END;
CREATE TRIGGER materialization_lineage_no_delete BEFORE DELETE ON materialization_lineage BEGIN
  SELECT RAISE(ABORT, 'materialization lineage is append-only');
END;

CREATE TABLE merge_audit (
  merge_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_queue(job_id),
  survivor_centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  merged_centre_id TEXT NOT NULL REFERENCES centre(centre_id),
  survivor_before_json TEXT NOT NULL CHECK (json_valid(survivor_before_json)),
  merged_before_json TEXT NOT NULL CHECK (json_valid(merged_before_json)),
  basis TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  merged_at_utc TEXT NOT NULL,
  reversed_at_utc TEXT,
  CHECK (survivor_centre_id <> merged_centre_id)
) STRICT;

-- Quality evidence and governed metrics --------------------------------------
CREATE TABLE invariant_result (
  result_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES route_run(run_id),
  tier TEXT NOT NULL CHECK (tier IN ('write','run','night','week','month')),
  invariant_name TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0,1)),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  checked_at_utc TEXT NOT NULL
) STRICT;

CREATE TABLE metric_definition (
  metric_name TEXT PRIMARY KEY,
  sql_definition TEXT NOT NULL,
  denominator_note TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at_utc TEXT NOT NULL
) STRICT;
INSERT INTO metric_definition VALUES
 ('route_coverage','see v_universe_coverage.route_coverage','eligible routes in a frozen universe',1,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('volume_coverage','see v_universe_coverage.volume_coverage','eligible routes with expected_records',1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));

-- Read models ----------------------------------------------------------------
CREATE VIEW v_effective_field_observation AS
WITH effective_correction AS (
  SELECT mc.* FROM manual_correction mc
  JOIN manual_correction_decision md ON md.correction_id=mc.correction_id
   WHERE md.decision='accepted' AND NOT EXISTS (
     SELECT 1 FROM manual_correction child
     JOIN manual_correction_decision child_decision
       ON child_decision.correction_id=child.correction_id
      WHERE child.supersedes_correction_id=mc.correction_id
        AND child_decision.decision='accepted')
), active_rule AS (
  SELECT cr.* FROM correction_rule cr WHERE NOT EXISTS (
    SELECT 1 FROM correction_rule child WHERE child.supersedes_rule_id=cr.correction_rule_id)
), rule_match_candidate AS (
  SELECT fo.field_observation_id,ar.correction_rule_id,ar.action,
         ar.replacement_normalized_value,
         ROW_NUMBER() OVER (PARTITION BY fo.field_observation_id ORDER BY
           CASE ar.scope_kind WHEN 'route_id' THEN 1
             WHEN 'template_fingerprint' THEN 2 ELSE 3 END,
           ar.replayed_at_utc DESC,ar.correction_rule_id) match_rank
    FROM field_observation fo
    JOIN source_record sr ON sr.source_record_id=fo.source_record_id
    JOIN parse_run pr ON pr.parse_run_id=sr.parse_run_id
    JOIN route_run rr ON rr.run_id=pr.route_run_id
    LEFT JOIN adapter a ON a.adapter_id=rr.adapter_id AND a.version=rr.adapter_version
    JOIN active_rule ar ON ar.field_name=fo.field_name AND ar.match_raw_value=fo.raw_value
     AND (ar.scope_kind='global' OR
       (ar.scope_kind='route_id' AND ar.scope_value=rr.route_id) OR
       (ar.scope_kind='template_fingerprint' AND ar.scope_value=a.template_fingerprint))
), rule_match AS (
  SELECT * FROM rule_match_candidate WHERE match_rank=1
), rejected_records AS (
  SELECT DISTINCT fo.source_record_id
    FROM effective_correction ec JOIN field_observation fo
      ON fo.field_observation_id=ec.field_observation_id
   WHERE ec.action='reject_record'
  UNION
  SELECT DISTINCT fo.source_record_id
    FROM rule_match rm JOIN field_observation fo
      ON fo.field_observation_id=rm.field_observation_id
   WHERE rm.action='reject_record'
)
SELECT fo.field_observation_id,fo.source_record_id,fo.field_name,fo.value_ordinal,
       fo.raw_value,
       CASE WHEN ec.action='replace_normalized' THEN ec.corrected_normalized_value
            WHEN rm.action='replace_normalized' THEN rm.replacement_normalized_value
            ELSE fo.normalized_value END AS effective_normalized_value,
       fo.normalized_value AS parser_normalized_value,fo.artifact_sha256,fo.field_locator,
       fo.evidence_quote,fo.normalization_state,fo.validation_state,
       fo.validation_flags_json,fo.observed_at_utc,ec.correction_id,
       rm.correction_rule_id,
       CASE WHEN ec.correction_id IS NOT NULL THEN 'manual_correction'
            WHEN rm.correction_rule_id IS NOT NULL THEN 'correction_rule'
            ELSE 'parser' END AS effective_value_source
  FROM field_observation fo
  LEFT JOIN effective_correction ec ON ec.field_observation_id=fo.field_observation_id
  LEFT JOIN rule_match rm ON rm.field_observation_id=fo.field_observation_id
 WHERE fo.source_record_id NOT IN (SELECT source_record_id FROM rejected_records)
   AND COALESCE(ec.action,'')<>'reject_value'
   AND (ec.correction_id IS NOT NULL OR COALESCE(rm.action,'')<>'reject_value');

-- Freshness is a property of the CONTENT, so it is aged from the latest fetch that fed
-- the run, never from finished_at_utc. A run finalized long after its fetch (replay,
-- backfill, a slow queue) must not buy the content a second freshness window. A run with
-- no linked fetch has no evidence of freshness at all and is demoted.
CREATE VIEW v_route_current_status AS
WITH run_content_fetch AS (
  SELECT rrf.run_id, max(fa.requested_at_utc) AS content_fetched_at_utc
    FROM route_run_fetch rrf JOIN fetch_attempt fa ON fa.attempt_id=rrf.attempt_id
   GROUP BY rrf.run_id
)
SELECT r.route_id, r.source_id, rr.run_id, rr.terminal_state AS stored_terminal_state,
       CASE WHEN rr.terminal_state IN
         ('complete_reconciled','complete_reconciled_derived_count',
          'complete_count_unpublished','verified_empty')
         AND (r.refetch_days IS NULL OR cf.content_fetched_at_utc IS NULL OR
           julianday('now') - julianday(cf.content_fetched_at_utc) > 2.0 * r.refetch_days)
         THEN 'stale' ELSE rr.terminal_state END AS terminal_state, rr.terminal_reason,
       rr.finished_at_utc, cf.content_fetched_at_utc,
       rr.extracted_count, rr.published_count, rr.count_quality
  FROM route r LEFT JOIN route_current_run cr ON cr.route_id=r.route_id
  LEFT JOIN route_run rr ON rr.run_id=cr.run_id
  LEFT JOIN run_content_fetch cf ON cf.run_id=rr.run_id;

-- Coverage is aged from content fetch time (see v_route_current_status) and reports how
-- much of its own denominator is actually known: expected_records is nullable, so
-- volume_coverage is only meaningful alongside eligible_routes_missing_expected_records.
CREATE VIEW v_universe_coverage AS
WITH run_content_fetch AS (
  SELECT rrf.run_id, max(fa.requested_at_utc) AS content_fetched_at_utc
    FROM route_run_fetch rrf JOIN fetch_attempt fa ON fa.attempt_id=rrf.attempt_id
   GROUP BY rrf.run_id
), route_state AS (
  SELECT ur.universe_id, ur.eligibility, ur.expected_records, rr.terminal_state,
         CASE WHEN r.refetch_days IS NOT NULL AND cf.content_fetched_at_utc IS NOT NULL
                   AND julianday('now') - julianday(cf.content_fetched_at_utc)
                       <= 2.0 * r.refetch_days
              THEN 1 ELSE 0 END AS content_is_fresh
    FROM universe_route ur
    JOIN route r ON r.route_id=ur.route_id
    LEFT JOIN route_current_run cr ON cr.route_id=ur.route_id
    LEFT JOIN route_run rr ON rr.run_id=cr.run_id
    LEFT JOIN run_content_fetch cf ON cf.run_id=rr.run_id
), scored AS (
  SELECT universe_id, expected_records,
    CASE WHEN eligibility='eligible' THEN 1 ELSE 0 END AS is_eligible,
    CASE WHEN eligibility='eligible' AND content_is_fresh=1 AND terminal_state IN
      ('complete_reconciled','complete_reconciled_derived_count',
       'complete_count_unpublished','verified_empty')
      THEN 1 ELSE 0 END AS is_fresh_verified,
    CASE WHEN eligibility='eligible' AND content_is_fresh=1 AND terminal_state IN
      ('complete_reconciled','complete_reconciled_derived_count','complete_count_unpublished')
      THEN 1 ELSE 0 END AS counts_toward_volume
    FROM route_state
)
SELECT universe_id,
  SUM(is_eligible) AS eligible_routes,
  SUM(CASE WHEN is_eligible=1 AND expected_records IS NOT NULL THEN 1 ELSE 0 END)
    AS eligible_routes_with_expected_records,
  SUM(CASE WHEN is_eligible=1 AND expected_records IS NULL THEN 1 ELSE 0 END)
    AS eligible_routes_missing_expected_records,
  SUM(is_fresh_verified) AS fresh_verified_routes,
  CAST(SUM(is_fresh_verified) AS REAL) / NULLIF(SUM(is_eligible),0) AS route_coverage,
  SUM(CASE WHEN is_eligible=1 THEN expected_records ELSE 0 END) AS expected_records,
  SUM(CASE WHEN counts_toward_volume=1 THEN expected_records ELSE 0 END)
    AS covered_expected_records,
  CAST(SUM(CASE WHEN counts_toward_volume=1 THEN COALESCE(expected_records,0) ELSE 0 END)
       AS REAL)
    / NULLIF(SUM(CASE WHEN is_eligible=1 THEN expected_records ELSE 0 END),0)
    AS volume_coverage
  FROM scored
 GROUP BY universe_id;

CREATE VIEW v_export_centre_contact AS
SELECT contact_id, centre_id, contact_kind, contact_value, verified_at_utc
  FROM centre_contact cc WHERE is_personal_data = 0 AND EXISTS (
    SELECT 1 FROM materialization_lineage ml
     WHERE ml.entity_kind='centre_contact' AND ml.entity_id=cc.contact_id
       AND ml.field_name='contact_value');

-- Performance indexes ---------------------------------------------------------
CREATE INDEX ix_job_queue_dispatch ON job_queue(status, not_before_utc, priority, created_at_utc);
CREATE INDEX ix_job_queue_lease ON job_queue(status, lease_expires_at_utc);
CREATE INDEX ix_fetch_attempt_route ON fetch_attempt(route_id, requested_at_utc);
CREATE INDEX ix_fetch_artifact_sha ON fetch_attempt_artifact(artifact_sha256);
CREATE INDEX ix_source_policy_source ON source_policy_review(source_id, reviewed_at_utc);
CREATE INDEX ix_route_policy_route ON route_policy_review(route_id, reviewed_at_utc);
CREATE INDEX ix_route_run_fetch_run ON route_run_fetch(run_id);
CREATE INDEX ix_route_run_route ON route_run(route_id, finished_at_utc);
CREATE INDEX ix_parse_artifact_sha ON parse_run_artifact(artifact_sha256);
CREATE INDEX ix_source_record_parse ON source_record(parse_run_id);
CREATE INDEX ix_field_observation_record ON field_observation(source_record_id, field_name);
CREATE INDEX ix_field_observation_artifact ON field_observation(artifact_sha256);
CREATE INDEX ix_manual_correction_observation ON manual_correction(field_observation_id, proposed_at_utc);
CREATE INDEX ix_correction_rule_match ON correction_rule(field_name, match_raw_value, scope_kind, scope_value);
CREATE INDEX ix_centre_domain ON centre(registrable_domain) WHERE registrable_domain IS NOT NULL;
CREATE INDEX ix_accreditation_source ON accreditation(source_id, direction);
CREATE INDEX ix_escalation_open ON escalation(status, priority) WHERE status = 'open';
CREATE INDEX ix_rule_scope ON rule(scope_kind, scope_value);
