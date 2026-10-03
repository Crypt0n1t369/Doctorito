-- Synthetic first-build spine. Run as a migration owner, never as the application role.
-- PostgreSQL 16+ syntax; real-server gates require the deployed PostgreSQL version.
CREATE SCHEMA IF NOT EXISTS mission_spine;
SET search_path = mission_spine, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mission_spine_app') THEN
    CREATE ROLE mission_spine_app NOLOGIN;
  END IF;
END $$;

CREATE TABLE principal (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('human', 'service', 'model')),
  authenticated_by text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mission (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'closed')),
  pause_reason text,
  revival_trigger text,
  plan_version integer NOT NULL DEFAULT 1 CHECK (plan_version > 0),
  created_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE charter_revision (
  mission_id text NOT NULL REFERENCES mission(id),
  revision integer NOT NULL CHECK (revision > 0),
  purpose text NOT NULL,
  boundary text NOT NULL,
  created_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, revision)
);

CREATE TABLE mandate (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  principal_id text NOT NULL REFERENCES principal(id),
  action text NOT NULL,
  scope text NOT NULL DEFAULT 'mission',
  valid_until timestamptz,
  revoked_at timestamptz,
  granted_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  UNIQUE (mission_id, principal_id, action, scope)
);

CREATE TABLE plan_revision (
  mission_id text NOT NULL REFERENCES mission(id),
  version integer NOT NULL CHECK (version > 0),
  statement text NOT NULL,
  acceptance_test text NOT NULL,
  created_by text NOT NULL REFERENCES principal(id),
  decision_id text,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, version)
);

CREATE TABLE source_metadata (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  submitter_principal text REFERENCES principal(id),
  receipt_hash char(64),
  current_revision integer NOT NULL DEFAULT 1,
  standing text NOT NULL DEFAULT 'unreviewed' CHECK (standing IN ('unreviewed', 'reviewed', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  corrected_at timestamptz,
  PRIMARY KEY (mission_id, id),
  CHECK ((submitter_principal IS NOT NULL) OR (receipt_hash IS NOT NULL))
);

-- Erasable text is apart from canonical audit and lineage. Erasure is a separate command.
CREATE TABLE source_payload (
  mission_id text NOT NULL,
  source_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  erased_at timestamptz,
  PRIMARY KEY (mission_id, source_id, revision),
  FOREIGN KEY (mission_id, source_id) REFERENCES source_metadata(mission_id, id)
);

CREATE TABLE source_grant (
  mission_id text NOT NULL,
  id text NOT NULL,
  source_id text NOT NULL,
  grantee text NOT NULL,
  purpose text NOT NULL,
  action text NOT NULL,
  provider text NOT NULL DEFAULT 'none',
  allow_read boolean NOT NULL DEFAULT false,
  allow_process boolean NOT NULL DEFAULT false,
  allow_publish boolean NOT NULL DEFAULT false,
  allow_train boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, source_id) REFERENCES source_metadata(mission_id, id),
  CHECK (allow_read OR allow_process OR allow_publish OR allow_train)
);
CREATE INDEX source_grant_lookup ON source_grant(mission_id, source_id, grantee)
  WHERE revoked_at IS NULL;

CREATE TABLE issue (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'paused')),
  created_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id)
);

CREATE TABLE claim_revision (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  issue_id text NOT NULL,
  claim_text text NOT NULL,
  standing text NOT NULL DEFAULT 'contested' CHECK (standing IN ('contested', 'supported', 'rejected')),
  stale boolean NOT NULL DEFAULT false,
  reviewed_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id, revision),
  FOREIGN KEY (mission_id, issue_id) REFERENCES issue(mission_id, id)
);

CREATE TABLE relation (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  source_id text NOT NULL,
  source_revision integer NOT NULL,
  issue_id text NOT NULL,
  claim_id text,
  relation_type text NOT NULL CHECK (relation_type IN ('similar', 'supports', 'disputes')),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'stale', 'rejected')),
  reviewed_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, source_id, source_revision) REFERENCES source_payload(mission_id, source_id, revision),
  FOREIGN KEY (mission_id, issue_id) REFERENCES issue(mission_id, id)
);

CREATE TABLE decision (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  previous_version integer NOT NULL,
  next_version integer NOT NULL,
  reason text NOT NULL,
  unresolved_objection text NOT NULL,
  approved_by text NOT NULL REFERENCES principal(id),
  mandate_id text NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, mandate_id) REFERENCES mandate(mission_id, id),
  FOREIGN KEY (mission_id, previous_version) REFERENCES plan_revision(mission_id, version)
);
ALTER TABLE plan_revision ADD CONSTRAINT plan_decision_fk
  FOREIGN KEY (mission_id, decision_id) REFERENCES decision(mission_id, id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE work_package (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  plan_version integer NOT NULL,
  decision_id text NOT NULL,
  outcome text NOT NULL,
  acceptance_test text NOT NULL,
  risk_class integer NOT NULL CHECK (risk_class BETWEEN 0 AND 3),
  requires_reservation boolean NOT NULL DEFAULT false,
  mentor_id text NOT NULL REFERENCES principal(id),
  reviewer_id text NOT NULL REFERENCES principal(id),
  capacity_hours integer NOT NULL CHECK (capacity_hours > 0),
  due_at timestamptz NOT NULL,
  compensation text NOT NULL,
  rights text NOT NULL,
  stop_condition text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'committed', 'pending_reconfirmation', 'closed')),
  created_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, plan_version) REFERENCES plan_revision(mission_id, version),
  FOREIGN KEY (mission_id, decision_id) REFERENCES decision(mission_id, id)
);

CREATE TABLE work_invitation (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  work_id text NOT NULL,
  principal_id text NOT NULL REFERENCES principal(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  UNIQUE (mission_id, work_id, principal_id),
  FOREIGN KEY (mission_id, work_id) REFERENCES work_package(mission_id, id)
);

CREATE TABLE offer (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  work_id text NOT NULL,
  contributor_id text NOT NULL REFERENCES principal(id),
  accepted_terms boolean NOT NULL CHECK (accepted_terms),
  capacity_hours integer NOT NULL CHECK (capacity_hours > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, work_id) REFERENCES work_package(mission_id, id)
);

CREATE TABLE commitment (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  work_id text NOT NULL,
  offer_id text NOT NULL,
  contributor_id text NOT NULL REFERENCES principal(id),
  authorized_by text NOT NULL REFERENCES principal(id),
  mandate_id text NOT NULL,
  plan_version integer NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_reconfirmation', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  UNIQUE (mission_id, work_id),
  FOREIGN KEY (mission_id, work_id) REFERENCES work_package(mission_id, id),
  FOREIGN KEY (mission_id, offer_id) REFERENCES offer(mission_id, id),
  FOREIGN KEY (mission_id, mandate_id) REFERENCES mandate(mission_id, id)
);

CREATE TABLE resource_account (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'EUR',
  pledged_cents bigint NOT NULL DEFAULT 0 CHECK (pledged_cents >= 0),
  cleared_cents bigint NOT NULL DEFAULT 0 CHECK (cleared_cents >= 0),
  spent_cents bigint NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
  custodian text NOT NULL,
  PRIMARY KEY (mission_id, id),
  CHECK (spent_cents <= cleared_cents)
);

CREATE TABLE reservation (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  account_id text NOT NULL,
  work_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  spent_cents bigint NOT NULL DEFAULT 0 CHECK (spent_cents >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'released')),
  authorized_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, account_id) REFERENCES resource_account(mission_id, id),
  FOREIGN KEY (mission_id, work_id) REFERENCES work_package(mission_id, id),
  CHECK (spent_cents <= amount_cents)
);

CREATE TABLE result (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  commitment_id text NOT NULL,
  submitted_by text NOT NULL REFERENCES principal(id),
  summary text NOT NULL,
  limits text NOT NULL,
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'reviewed', 'stale')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, commitment_id) REFERENCES commitment(mission_id, id)
);

CREATE TABLE finding (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  result_id text NOT NULL,
  conclusion text NOT NULL,
  limits text NOT NULL,
  reviewed_by text NOT NULL REFERENCES principal(id),
  stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  UNIQUE (mission_id, result_id),
  FOREIGN KEY (mission_id, result_id) REFERENCES result(mission_id, id)
);

CREATE TABLE receipt (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  source_id text NOT NULL,
  finding_id text,
  status text NOT NULL CHECK (status IN ('available', 'superseded')),
  message text NOT NULL,
  created_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, source_id) REFERENCES source_metadata(mission_id, id),
  FOREIGN KEY (mission_id, finding_id) REFERENCES finding(mission_id, id)
);

CREATE TABLE context_manifest (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  created_by text NOT NULL REFERENCES principal(id),
  purpose text NOT NULL,
  audience text NOT NULL,
  provider text NOT NULL,
  action text NOT NULL,
  plan_version integer NOT NULL,
  policy_version integer NOT NULL,
  model_version text NOT NULL,
  cost_bound integer NOT NULL,
  included jsonb NOT NULL,
  omitted jsonb NOT NULL,
  limits jsonb NOT NULL,
  invalidated_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id)
);

CREATE TABLE public_release (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  source_id text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'suppressed')),
  approved_by text NOT NULL REFERENCES principal(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  FOREIGN KEY (mission_id, source_id) REFERENCES source_metadata(mission_id, id)
);

CREATE TABLE lineage (
  mission_id text NOT NULL REFERENCES mission(id),
  parent_kind text NOT NULL,
  parent_id text NOT NULL,
  child_kind text NOT NULL,
  child_id text NOT NULL,
  edge_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, parent_kind, parent_id, child_kind, child_id)
);
CREATE INDEX lineage_descendants ON lineage(mission_id, parent_kind, parent_id);

CREATE TABLE audit (
  mission_id text NOT NULL REFERENCES mission(id),
  id bigint GENERATED ALWAYS AS IDENTITY,
  command_id text NOT NULL,
  actor_id text,
  actor_kind text NOT NULL CHECK (actor_kind IN ('human', 'service', 'bearer')),
  action text NOT NULL,
  authority_ref text NOT NULL,
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  plan_version integer,
  source_refs jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id)
);

CREATE TABLE outbox (
  mission_id text NOT NULL REFERENCES mission(id),
  id text NOT NULL,
  command_id text NOT NULL,
  kind text NOT NULL,
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  recipient_principal text,
  source_id text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'dispatched', 'acknowledged', 'unknown_external_effect', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, id),
  UNIQUE (mission_id, command_id, kind, subject_id)
);

CREATE TABLE command_dedupe (
  mission_id text NOT NULL REFERENCES mission(id),
  idempotency_key text NOT NULL,
  action text NOT NULL,
  request_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, idempotency_key)
);

CREATE FUNCTION mission_scope() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.mission_id', true), '')
$$;
CREATE FUNCTION principal_scope() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.principal_id', true), '')
$$;
CREATE FUNCTION receipt_scope() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.receipt_hash', true), '')
$$;

-- These functions are defense in depth for direct SQL by the trusted app role.
-- The application still checks purpose, audience and provider before retrieving text.
CREATE FUNCTION may_read_source(p_mission text, p_source text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  SELECT p_mission = mission_scope() AND EXISTS (
    SELECT 1 FROM source_metadata s
    WHERE s.mission_id = p_mission AND s.id = p_source AND s.standing <> 'withdrawn'
      AND (
        s.submitter_principal = principal_scope()
        OR (receipt_scope() IS NOT NULL AND s.receipt_hash = receipt_scope())
        OR EXISTS (
          SELECT 1 FROM source_grant g WHERE g.mission_id = s.mission_id AND g.source_id = s.id
            AND g.grantee = principal_scope() AND principal_scope() <> 'public' AND g.allow_read
            AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
        )
      )
  )
$$;

CREATE FUNCTION may_read_release(p_mission text, p_release text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  SELECT p_mission = mission_scope() AND EXISTS (
    SELECT 1 FROM public_release r JOIN source_metadata s
      ON s.mission_id = r.mission_id AND s.id = r.source_id
    JOIN source_grant g ON g.mission_id = r.mission_id AND g.source_id = r.source_id
    WHERE r.mission_id = p_mission AND r.id = p_release
      AND r.status = 'published' AND s.standing <> 'withdrawn'
      AND g.grantee = 'public' AND g.allow_read AND g.allow_publish
      AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())
  )
$$;

CREATE FUNCTION has_mandate(p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM mandate m JOIN principal p ON p.id = m.principal_id
    WHERE m.mission_id = mission_scope() AND m.principal_id = principal_scope()
      AND m.action = p_action AND m.revoked_at IS NULL
      AND (m.valid_until IS NULL OR m.valid_until > now())
      AND p.kind = 'human' AND p.verified
  )
$$;

CREATE FUNCTION verified_human(p_principal text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM principal p WHERE p.id = p_principal
    AND p.kind='human' AND p.verified)
$$;

CREATE FUNCTION verified_mandate(p_mission text, p_principal text, p_action text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  SELECT p_mission = mission_scope() AND EXISTS (
    SELECT 1 FROM mandate m JOIN principal p ON p.id=m.principal_id
    WHERE m.mission_id=p_mission AND m.principal_id=p_principal AND m.action=p_action
      AND m.revoked_at IS NULL AND (m.valid_until IS NULL OR m.valid_until>now())
      AND p.kind='human' AND p.verified
  )
$$;

CREATE FUNCTION has_active_reservation(p_mission text, p_work text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  SELECT p_mission = mission_scope() AND EXISTS (
    SELECT 1 FROM reservation WHERE mission_id=p_mission AND work_id=p_work AND status='active'
  )
$$;

CREATE FUNCTION controls_source(p_mission text, p_source text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  SELECT p_mission = mission_scope() AND EXISTS (
    SELECT 1 FROM source_metadata s WHERE s.mission_id=p_mission AND s.id=p_source
      AND ((principal_scope() IS NOT NULL AND s.submitter_principal=principal_scope())
        OR (receipt_scope() IS NOT NULL AND s.receipt_hash=receipt_scope()))
  )
$$;

CREATE FUNCTION derived_sources_readable(p_kind text, p_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
  WITH RECURSIVE upstream(kind,id) AS (
    SELECT parent_kind,parent_id FROM lineage
      WHERE mission_id=mission_scope() AND child_kind=p_kind AND child_id=p_id
    UNION
    SELECT l.parent_kind,l.parent_id FROM lineage l JOIN upstream u
      ON l.child_kind=u.kind AND l.child_id=u.id WHERE l.mission_id=mission_scope()
  )
  SELECT NOT EXISTS (SELECT 1 FROM upstream WHERE kind='source'
    AND NOT may_read_source(mission_scope(),id))
$$;

CREATE FUNCTION mark_source_stale(p_mission text, p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mission_spine, pg_temp AS $$
DECLARE
  relations text[] := '{}'; claims text[] := '{}'; decisions text[] := '{}';
  works text[] := '{}'; invitations text[] := '{}'; commitments text[] := '{}';
  results text[] := '{}'; findings text[] := '{}'; receipts text[] := '{}';
  plans text[] := '{}';
BEGIN
  IF NOT controls_source(p_mission, p_source) THEN
    RAISE EXCEPTION 'source holder required' USING ERRCODE='42501';
  END IF;
  WITH RECURSIVE downstream(kind,id) AS (
    SELECT child_kind,child_id FROM lineage WHERE mission_id=p_mission
      AND parent_kind='source' AND parent_id=p_source
    UNION
    SELECT l.child_kind,l.child_id FROM lineage l JOIN downstream d
      ON l.parent_kind=d.kind AND l.parent_id=d.id WHERE l.mission_id=p_mission
  )
  SELECT
    COALESCE(array_agg(id) FILTER (WHERE kind='relation'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='claim'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='decision'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='work'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='invitation'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='commitment'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='result'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='finding'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='receipt'),'{}'),
    COALESCE(array_agg(id) FILTER (WHERE kind='plan'),'{}')
  INTO relations,claims,decisions,works,invitations,commitments,results,findings,receipts,plans
  FROM downstream;

  UPDATE relation SET status='stale' WHERE mission_id=p_mission AND id=ANY(relations);
  UPDATE claim_revision SET stale=true WHERE mission_id=p_mission AND id=ANY(claims);
  UPDATE decision SET stale=true WHERE mission_id=p_mission AND id=ANY(decisions);
  UPDATE plan_revision SET stale=true WHERE mission_id=p_mission AND version::text=ANY(plans);
  UPDATE work_package SET status='pending_reconfirmation' WHERE mission_id=p_mission
    AND id=ANY(works) AND status IN ('open','committed');
  UPDATE work_invitation SET status='revoked' WHERE mission_id=p_mission AND id=ANY(invitations);
  UPDATE commitment SET status='pending_reconfirmation' WHERE mission_id=p_mission
    AND id=ANY(commitments) AND status='active';
  UPDATE result SET status='stale' WHERE mission_id=p_mission AND id=ANY(results);
  UPDATE finding SET stale=true WHERE mission_id=p_mission AND id=ANY(findings);
  UPDATE receipt SET status='superseded' WHERE mission_id=p_mission AND id=ANY(receipts);
  UPDATE public_release SET status='suppressed' WHERE mission_id=p_mission AND source_id=p_source;
  UPDATE context_manifest SET invalidated_at=now() WHERE mission_id=p_mission
    AND included @> jsonb_build_array(jsonb_build_object('sourceId',p_source));
  UPDATE outbox SET status='cancelled',updated_at=now() WHERE mission_id=p_mission
    AND status='available' AND (source_id=p_source
      OR (subject_kind='relation' AND subject_id=ANY(relations))
      OR (subject_kind='decision' AND subject_id=ANY(decisions))
      OR (subject_kind='work' AND subject_id=ANY(works))
      OR (subject_kind='invitation' AND subject_id=ANY(invitations))
      OR (subject_kind='commitment' AND subject_id=ANY(commitments))
      OR (subject_kind='result' AND subject_id=ANY(results))
      OR (subject_kind='finding' AND subject_id=ANY(findings))
      OR (subject_kind='receipt' AND subject_id=ANY(receipts)));
  UPDATE outbox SET status='unknown_external_effect',updated_at=now() WHERE mission_id=p_mission
    AND status='dispatched' AND (source_id=p_source
      OR (subject_kind='receipt' AND subject_id=ANY(receipts)));
END
$$;

-- Accountless intake can insert a source, but cannot review, decide or commit: those
-- gates are enforced by the command layer and verified principal + mandate checks.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY[
    'charter_revision','mandate','plan_revision','source_metadata','source_payload',
    'source_grant','issue','claim_revision','relation','decision','work_package','offer',
    'work_invitation','commitment','resource_account','reservation','result','finding','receipt',
    'context_manifest','public_release','lineage','audit','outbox','command_dedupe'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I_scope ON %I USING (mission_id = mission_scope()) WITH CHECK (mission_id = mission_scope())', t, t);
  END LOOP;
END $$;

ALTER TABLE mission ENABLE ROW LEVEL SECURITY;
CREATE POLICY mission_scope_policy ON mission USING (id = mission_scope()) WITH CHECK (id = mission_scope());

-- Remove the broad policies for rows with personal or publishable content.
DROP POLICY source_metadata_scope ON source_metadata;
CREATE POLICY source_metadata_select ON source_metadata FOR SELECT
  USING (mission_id = mission_scope() AND may_read_source(mission_id, id));
CREATE POLICY source_metadata_insert ON source_metadata FOR INSERT
  WITH CHECK (mission_id = mission_scope());
CREATE POLICY source_metadata_update ON source_metadata FOR UPDATE
  USING (mission_id = mission_scope() AND may_read_source(mission_id, id))
  WITH CHECK (mission_id = mission_scope());

DROP POLICY source_payload_scope ON source_payload;
CREATE POLICY source_payload_select ON source_payload FOR SELECT
  USING (mission_id = mission_scope() AND may_read_source(mission_id, source_id));
CREATE POLICY source_payload_insert ON source_payload FOR INSERT
  WITH CHECK (mission_id = mission_scope());
CREATE POLICY source_payload_update ON source_payload FOR UPDATE
  USING (mission_id = mission_scope() AND may_read_source(mission_id, source_id))
  WITH CHECK (mission_id = mission_scope());

DROP POLICY receipt_scope ON receipt;
CREATE POLICY receipt_select ON receipt FOR SELECT
  USING (mission_id = mission_scope() AND may_read_source(mission_id, source_id));
CREATE POLICY receipt_insert ON receipt FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY receipt_update ON receipt FOR UPDATE
  USING (mission_id = mission_scope() AND may_read_source(mission_id, source_id))
  WITH CHECK (mission_id = mission_scope());

DROP POLICY public_release_scope ON public_release;
CREATE POLICY public_release_select ON public_release FOR SELECT
  USING (mission_id = mission_scope() AND may_read_release(mission_id, id));
CREATE POLICY public_release_insert ON public_release FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY public_release_update ON public_release FOR UPDATE
  USING (mission_id = mission_scope()) WITH CHECK (mission_id = mission_scope());

DROP POLICY context_manifest_scope ON context_manifest;
CREATE POLICY context_manifest_select ON context_manifest FOR SELECT
  USING (mission_id = mission_scope() AND created_by = principal_scope()
    AND invalidated_at IS NULL AND expires_at > now());
CREATE POLICY context_manifest_insert ON context_manifest FOR INSERT
  WITH CHECK (mission_id = mission_scope() AND created_by = principal_scope());
CREATE POLICY context_manifest_update ON context_manifest FOR UPDATE
  USING (mission_id = mission_scope()) WITH CHECK (mission_id = mission_scope());

DROP POLICY source_grant_scope ON source_grant;
CREATE POLICY source_grant_select ON source_grant FOR SELECT
  USING (mission_id = mission_scope() AND (may_read_source(mission_id, source_id)
    OR (grantee = principal_scope() AND principal_scope() <> 'public')
    OR has_mandate('review') OR has_mandate('coordinate')));
CREATE POLICY source_grant_insert ON source_grant FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY source_grant_update ON source_grant FOR UPDATE
  USING (mission_id = mission_scope() AND (may_read_source(mission_id, source_id) OR has_mandate('steward')))
  WITH CHECK (mission_id = mission_scope());

DROP POLICY relation_scope ON relation;
CREATE POLICY relation_select ON relation FOR SELECT
  USING (mission_id = mission_scope() AND (may_read_source(mission_id, source_id) OR has_mandate('review')));
CREATE POLICY relation_insert ON relation FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY relation_update ON relation FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('review')) WITH CHECK (mission_id = mission_scope());

DROP POLICY claim_revision_scope ON claim_revision;
CREATE POLICY claim_revision_select ON claim_revision FOR SELECT
  USING (mission_id = mission_scope() AND (has_mandate('review') OR has_mandate('decide'))
    AND derived_sources_readable('claim',id));
CREATE POLICY claim_revision_insert ON claim_revision FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY claim_revision_update ON claim_revision FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('review')) WITH CHECK (mission_id = mission_scope());

DROP POLICY mandate_scope ON mandate;
CREATE POLICY mandate_select ON mandate FOR SELECT
  USING (mission_id = mission_scope() AND (principal_id = principal_scope() OR has_mandate('steward')));
CREATE POLICY mandate_insert ON mandate FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY mandate_update ON mandate FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('steward')) WITH CHECK (mission_id = mission_scope());

DROP POLICY plan_revision_scope ON plan_revision;
CREATE POLICY plan_revision_select ON plan_revision FOR SELECT
  USING (mission_id = mission_scope() AND (has_mandate('review') OR has_mandate('decide') OR has_mandate('coordinate'))
    AND derived_sources_readable('plan',version::text));
CREATE POLICY plan_revision_insert ON plan_revision FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY plan_revision_update ON plan_revision FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('decide')) WITH CHECK (mission_id = mission_scope());

DROP POLICY decision_scope ON decision;
CREATE POLICY decision_select ON decision FOR SELECT
  USING (mission_id = mission_scope() AND (has_mandate('review') OR has_mandate('decide') OR has_mandate('coordinate'))
    AND derived_sources_readable('decision',id));
CREATE POLICY decision_insert ON decision FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY decision_update ON decision FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('decide')) WITH CHECK (mission_id = mission_scope());

DROP POLICY work_package_scope ON work_package;
CREATE POLICY work_package_select ON work_package FOR SELECT
  USING (mission_id = mission_scope() AND (has_mandate('review') OR has_mandate('coordinate')
    OR (status IN ('open','committed') AND EXISTS (SELECT 1 FROM work_invitation i
      WHERE i.mission_id = work_package.mission_id AND i.work_id = work_package.id
        AND i.principal_id = principal_scope() AND i.status='active')))
    AND derived_sources_readable('work',id));
CREATE POLICY work_package_insert ON work_package FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY work_package_update ON work_package FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('coordinate')) WITH CHECK (mission_id = mission_scope());

DROP POLICY work_invitation_scope ON work_invitation;
CREATE POLICY work_invitation_select ON work_invitation FOR SELECT
  USING (mission_id = mission_scope() AND (principal_id = principal_scope() OR has_mandate('coordinate')));
CREATE POLICY work_invitation_insert ON work_invitation FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY work_invitation_update ON work_invitation FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('coordinate')) WITH CHECK (mission_id = mission_scope());

DROP POLICY offer_scope ON offer;
CREATE POLICY offer_select ON offer FOR SELECT
  USING (mission_id = mission_scope() AND (contributor_id = principal_scope() OR has_mandate('coordinate')));
CREATE POLICY offer_insert ON offer FOR INSERT WITH CHECK (mission_id = mission_scope() AND contributor_id = principal_scope());

DROP POLICY commitment_scope ON commitment;
CREATE POLICY commitment_select ON commitment FOR SELECT
  USING (mission_id = mission_scope() AND (contributor_id = principal_scope() OR has_mandate('coordinate') OR has_mandate('review')));
CREATE POLICY commitment_insert ON commitment FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY commitment_update ON commitment FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('coordinate')) WITH CHECK (mission_id = mission_scope());

DROP POLICY result_scope ON result;
CREATE POLICY result_select ON result FOR SELECT
  USING (mission_id = mission_scope() AND (submitted_by = principal_scope() OR has_mandate('review') OR has_mandate('coordinate'))
    AND derived_sources_readable('result',id));
CREATE POLICY result_insert ON result FOR INSERT WITH CHECK (mission_id = mission_scope() AND submitted_by = principal_scope());
CREATE POLICY result_update ON result FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('review')) WITH CHECK (mission_id = mission_scope());

DROP POLICY finding_scope ON finding;
CREATE POLICY finding_select ON finding FOR SELECT
  USING (mission_id = mission_scope() AND (has_mandate('review') OR has_mandate('coordinate')
    OR EXISTS (SELECT 1 FROM result r WHERE r.mission_id = finding.mission_id
      AND r.id = finding.result_id AND r.submitted_by = principal_scope()))
    AND derived_sources_readable('finding',id));
CREATE POLICY finding_insert ON finding FOR INSERT WITH CHECK (mission_id = mission_scope());
CREATE POLICY finding_update ON finding FOR UPDATE
  USING (mission_id = mission_scope() AND has_mandate('review')) WITH CHECK (mission_id = mission_scope());

DROP POLICY resource_account_scope ON resource_account;
CREATE POLICY resource_account_staff ON resource_account
  USING (mission_id = mission_scope() AND (has_mandate('resource') OR has_mandate('steward')))
  WITH CHECK (mission_id = mission_scope());
DROP POLICY reservation_scope ON reservation;
CREATE POLICY reservation_staff ON reservation
  USING (mission_id = mission_scope() AND (has_mandate('resource') OR has_mandate('steward')))
  WITH CHECK (mission_id = mission_scope());

DROP POLICY lineage_scope ON lineage;
CREATE POLICY lineage_staff ON lineage
  USING (mission_id = mission_scope() AND (has_mandate('review') OR has_mandate('decide') OR has_mandate('coordinate')))
  WITH CHECK (mission_id = mission_scope());
DROP POLICY audit_scope ON audit;
CREATE POLICY audit_staff ON audit
  USING (mission_id = mission_scope() AND has_mandate('steward'))
  WITH CHECK (mission_id = mission_scope());
DROP POLICY outbox_scope ON outbox;
CREATE POLICY outbox_staff ON outbox
  USING (mission_id = mission_scope() AND has_mandate('steward'))
  WITH CHECK (mission_id = mission_scope());

DROP POLICY command_dedupe_scope ON command_dedupe;
CREATE POLICY command_dedupe_bound ON command_dedupe
  USING (mission_id = mission_scope() AND idempotency_key = current_setting('app.idempotency_key', true))
  WITH CHECK (mission_id = mission_scope() AND idempotency_key = current_setting('app.idempotency_key', true));

ALTER TABLE principal ENABLE ROW LEVEL SECURITY;
CREATE POLICY principal_self ON principal FOR SELECT
  USING (id = principal_scope() OR has_mandate('steward'));

GRANT USAGE ON SCHEMA mission_spine TO mission_spine_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mission_spine TO mission_spine_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mission_spine TO mission_spine_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mission_spine TO mission_spine_app;
REVOKE ALL ON principal FROM mission_spine_app;
GRANT SELECT (id, kind, verified) ON principal TO mission_spine_app;
REVOKE SELECT ON source_metadata FROM mission_spine_app;
GRANT SELECT (mission_id, id, submitter_principal, current_revision, standing, created_at, corrected_at)
  ON source_metadata TO mission_spine_app;
