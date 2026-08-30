BEGIN IMMEDIATE;

ALTER TABLE route ADD COLUMN access_class TEXT NOT NULL DEFAULT 'human_required'
  CHECK (access_class IN ('public','authenticated','private','sensitive','human_required'));
UPDATE route SET access_class='public'
 WHERE route_id IN ('RT-0001','RT-0002','RT-0003','RT-0004','RT-0005');

ALTER TABLE host_state ADD COLUMN consecutive_403_cycles INTEGER NOT NULL DEFAULT 0
  CHECK (consecutive_403_cycles >= 0);
ALTER TABLE host_state ADD COLUMN route_state TEXT NOT NULL DEFAULT 'fetchable'
  CHECK (route_state IN ('fetchable','awaiting_retry','blocked_access','needs_human'));
ALTER TABLE host_state ADD COLUMN reason TEXT NOT NULL DEFAULT 'initial';

CREATE TABLE schema_migration (
  migration_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  applied_by TEXT NOT NULL,
  applied_at_utc TEXT NOT NULL
) STRICT;
CREATE TRIGGER schema_migration_no_update BEFORE UPDATE ON schema_migration BEGIN
  SELECT RAISE(ABORT, 'migration ledger is immutable');
END;
CREATE TRIGGER schema_migration_no_delete BEFORE DELETE ON schema_migration BEGIN
  SELECT RAISE(ABORT, 'migration ledger is immutable');
END;

CREATE TRIGGER automated_source_policy_review_guard
BEFORE INSERT ON source_policy_review
WHEN NEW.reviewed_by LIKE 'tcpipe-public-preflight/%' AND (
  NEW.decision<>'approved' OR NEW.license_basis<>'public_web' OR
  NEW.allowed_purpose<>'factual_public_directory_parsing' OR
  NEW.evidence_artifact_sha IS NULL OR json_array_length(NEW.data_categories_json)<>0)
BEGIN SELECT RAISE(ABORT, 'automated source approval requires public-web basis, no sensitive categories, and stored evidence'); END;

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

DROP TRIGGER fetch_attempt_policy_guard;
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
BEGIN SELECT RAISE(ABORT, 'fetch blocked: automated public preflight or human approval missing'); END;

DROP TRIGGER fetch_attempt_finalize_guard;
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
        AND julianday(fa_prior.requested_at_utc)<=julianday(NEW.requested_at_utc)))
)
BEGIN SELECT RAISE(ABORT, 'fetch artifact roles do not satisfy the outcome/tier contract'); END;

UPDATE schema_meta SET schema_version='2.3.0',
  applied_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE schema_version='2.2.0';
INSERT INTO schema_migration VALUES (
  '2.2.0-to-2.3.0',
  'MIGRATION_SHA256_REPLACED_BY_RUNNER',
  'tcpipe-built-in',
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
);

COMMIT;
