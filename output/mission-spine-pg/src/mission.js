import { invariant } from './errors.js';
import { enumValue, identifier, integer, nonempty, receiptToken, sha256, stringArray } from './validation.js';
import { planAt, requireHuman, requireMandate, sourceReadGrant } from './tx.js';

function id(value, name) { return identifier(value, name); }
function text(value, name, max = 4000) { return nonempty(value, name, max); }
function cents(value, name) { return integer(value, name, 0, 1_000_000_000_00); }

async function edge(tx, mission, parentKind, parentId, childKind, childId, type) {
  await tx.query(
    `INSERT INTO lineage (mission_id,parent_kind,parent_id,child_kind,child_id,edge_type)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
    [mission, parentKind, parentId, childKind, childId, type]
  );
}

function change(response, subjectKind, subjectId, extra = {}) {
  return { response, subjectKind, subjectId, ...extra };
}

export function missionCommands(spine) {
  return {
    async createMission(meta, body) {
      const b = {
        name: text(body.name, 'mission name', 200),
        purpose: text(body.purpose, 'purpose'),
        boundary: text(body.boundary, 'boundary'),
        plan: text(body.plan, 'initial plan'),
        acceptanceTest: text(body.acceptanceTest, 'acceptance test')
      };
      return spine.command(meta, 'create_mission', b, async (tx, s) => {
        await requireHuman(tx, s.actor);
        await tx.query('INSERT INTO mission (id,name,created_by) VALUES ($1,$2,$3)',
          [s.mission, b.name, s.actor.principal]);
        await tx.query(
          'INSERT INTO charter_revision (mission_id,revision,purpose,boundary,created_by) VALUES ($1,1,$2,$3,$4)',
          [s.mission, b.purpose, b.boundary, s.actor.principal]
        );
        await tx.query(
          `INSERT INTO plan_revision (mission_id,version,statement,acceptance_test,created_by)
           VALUES ($1,1,$2,$3,$4)`, [s.mission, b.plan, b.acceptanceTest, s.actor.principal]
        );
        for (const action of ['steward', 'review', 'decide', 'coordinate', 'resource', 'publish']) {
          await tx.query(
            `INSERT INTO mandate (mission_id,id,principal_id,action,granted_by)
             VALUES ($1,$2,$3,$4,$3)`,
            [s.mission, `mandate:${s.actor.principal}:${action}`, s.actor.principal, action]
          );
        }
        return change({ mission: s.mission, planVersion: 1, status: 'active' },
          'mission', s.mission, { authorityRef: 'verified-founder', planVersion: 1 });
      });
    },

    async grantMandate(meta, body) {
      const b = { principalId: id(body.principalId, 'principal id'), action: enumValue(body.action,
        'action', ['review', 'decide', 'coordinate', 'resource', 'publish', 'steward']) };
      return spine.command(meta, 'grant_mandate', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'steward');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const person = await tx.query('SELECT kind,verified FROM principal WHERE id=$1', [b.principalId]);
        // The owner-only identity registry cannot be read through another principal's RLS row.
        // A steward cannot infer verification from a name; provisioning must expose a verified ID.
        invariant(person.rowCount && person.rows[0].kind === 'human' && person.rows[0].verified,
          'unverified_principal', 'mandate recipient must have a verified human identity');
        const mandateId = `mandate:${b.principalId}:${b.action}`;
        await tx.query(
          `INSERT INTO mandate (mission_id,id,principal_id,action,granted_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [s.mission, mandateId, b.principalId, b.action, s.actor.principal]
        );
        return change({ mandateId }, 'mandate', mandateId,
          { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async createIssue(meta, body) {
      const b = { issueId: id(body.issueId, 'issue id'), title: text(body.title, 'issue title', 300) };
      return spine.command(meta, 'create_issue', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'review');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        await tx.query('INSERT INTO issue (mission_id,id,title,created_by) VALUES ($1,$2,$3,$4)',
          [s.mission, b.issueId, b.title, s.actor.principal]);
        return change({ issueId: b.issueId, status: 'open' }, 'issue', b.issueId,
          { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async pauseMission(meta, body) {
      const b = { reason: text(body.reason, 'pause reason', 1000),
        revivalTrigger: text(body.revivalTrigger, 'revival trigger', 1000) };
      return spine.command(meta, 'pause_mission', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'steward');
        const mission = await planAt(tx, s.mission, meta.expectedPlanVersion);
        invariant(mission.status === 'active', 'invalid_state', 'mission is already paused or closed');
        await tx.query(
          `UPDATE mission SET status='paused',pause_reason=$2,revival_trigger=$3,updated_at=now()
           WHERE id=$1`, [s.mission, b.reason, b.revivalTrigger]
        );
        await tx.query(
          `UPDATE work_package SET status='pending_reconfirmation' WHERE mission_id=$1
           AND status IN ('open','committed')`, [s.mission]
        );
        await tx.query(
          `UPDATE commitment SET status='pending_reconfirmation' WHERE mission_id=$1 AND status='active'`,
          [s.mission]
        );
        await tx.query(
          `UPDATE work_invitation SET status='revoked' WHERE mission_id=$1 AND status='active'`, [s.mission]
        );
        return change({ mission: s.mission, status: 'paused',
          reason: b.reason, revivalTrigger: b.revivalTrigger,
          liveObligations: 'pending_reconfirmation' }, 'mission', s.mission,
        { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async submitSource(meta, body) {
      const b = {
        sourceId: id(body.sourceId, 'source id'),
        body: text(body.body, 'source text', 10000),
        receiptToken: meta.actor?.kind === 'bearer' ? receiptToken(meta.actor.token) : null,
        grants: Array.isArray(body.grants) ? body.grants.map((g, n) => ({
          id: id(g.id, `grant ${n} id`),
          grantee: id(g.grantee, `grant ${n} grantee`),
          purpose: id(g.purpose, `grant ${n} purpose`),
          action: id(g.action, `grant ${n} action`),
          provider: id(g.provider ?? 'none', `grant ${n} provider`),
          read: g.read === true, process: g.process === true,
          publish: g.publish === true, train: g.train === true
        })) : []
      };
      invariant(b.grants.length <= 20, 'invalid_input', 'at most 20 grants may accompany intake');
      invariant(meta.actor?.kind === 'bearer' || meta.actor?.kind === 'principal',
        'unauthorized', 'intake requires an authenticated principal or private bearer');
      return spine.command(meta, 'submit_source', { ...b, receiptToken: undefined }, async (tx, s) => {
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        if (s.actor.kind === 'principal') await requireHuman(tx, s.actor);
        await tx.query(
          `INSERT INTO source_metadata (mission_id,id,submitter_principal,receipt_hash)
           VALUES ($1,$2,$3,$4)`,
          [s.mission, b.sourceId, s.actor.principal || null, s.actor.receiptHash || null]
        );
        await tx.query(
          'INSERT INTO source_payload (mission_id,source_id,revision,body) VALUES ($1,$2,1,$3)',
          [s.mission, b.sourceId, b.body]
        );
        for (const g of b.grants) {
          invariant(g.read || g.process || g.publish || g.train, 'invalid_input', 'grant needs a right');
          await tx.query(
            `INSERT INTO source_grant (mission_id,id,source_id,grantee,purpose,action,provider,
              allow_read,allow_process,allow_publish,allow_train)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [s.mission, g.id, b.sourceId, g.grantee, g.purpose, g.action, g.provider,
              g.read, g.process, g.publish, g.train]
          );
        }
        return change({ sourceId: b.sourceId, sourceRevision: 1, standing: 'unreviewed',
          privateReceipt: s.actor.kind === 'bearer' ? 'bearer-held' : 'authenticated' },
        'source', b.sourceId, { planVersion: meta.expectedPlanVersion, sourceRefs: [b.sourceId],
          effectKind: 'source_received', sourceId: b.sourceId });
      });
    },

    async reviewRelation(meta, body) {
      const b = {
        relationId: id(body.relationId, 'relation id'),
        sourceId: id(body.sourceId, 'source id'),
        issueId: id(body.issueId, 'issue id'),
        claimId: id(body.claimId, 'claim id'),
        claimText: body.claimText == null ? null : text(body.claimText, 'claim text'),
        type: enumValue(body.type, 'relation type', ['similar', 'supports', 'disputes'])
      };
      return spine.command(meta, 'review_relation', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'review');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        await sourceReadGrant(tx, s.mission, b.sourceId, s.actor.principal,
          'review', 'review_relation');
        const source = await tx.query(
          'SELECT current_revision,standing FROM source_metadata WHERE mission_id=$1 AND id=$2 FOR SHARE',
          [s.mission, b.sourceId]
        );
        invariant(source.rowCount && source.rows[0].standing !== 'withdrawn', 'not_found', 'source unavailable');
        const issue = await tx.query('SELECT id FROM issue WHERE mission_id=$1 AND id=$2',
          [s.mission, b.issueId]);
        invariant(issue.rowCount, 'not_found', 'issue unavailable');
        if (b.claimText) {
          await tx.query(
            `INSERT INTO claim_revision (mission_id,id,issue_id,claim_text,reviewed_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [s.mission, b.claimId, b.issueId, b.claimText, s.actor.principal]
          );
        } else {
          const claim = await tx.query(
            'SELECT id FROM claim_revision WHERE mission_id=$1 AND id=$2 AND stale=false',
            [s.mission, b.claimId]
          );
          invariant(claim.rowCount, 'not_found', 'current claim unavailable');
        }
        await tx.query(
          `INSERT INTO relation (mission_id,id,source_id,source_revision,issue_id,claim_id,relation_type,reviewed_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [s.mission, b.relationId, b.sourceId, source.rows[0].current_revision,
            b.issueId, b.claimId, b.type, s.actor.principal]
        );
        await edge(tx, s.mission, 'source', b.sourceId, 'relation', b.relationId, b.type);
        await edge(tx, s.mission, 'relation', b.relationId, 'claim', b.claimId, 'evidence');
        await tx.query('UPDATE source_metadata SET standing=$3 WHERE mission_id=$1 AND id=$2',
          [s.mission, b.sourceId, 'reviewed']);
        return change({ relationId: b.relationId, claimId: b.claimId, type: b.type,
          standing: 'accepted' }, 'relation', b.relationId,
          { authorityRef, planVersion: meta.expectedPlanVersion, sourceRefs: [b.sourceId] });
      });
    },

    async amendPlan(meta, body) {
      const b = {
        decisionId: id(body.decisionId, 'decision id'),
        plan: text(body.plan, 'plan'),
        acceptanceTest: text(body.acceptanceTest, 'acceptance test'),
        reason: text(body.reason, 'decision reason'),
        unresolvedObjection: text(body.unresolvedObjection, 'unresolved objection'),
        relationIds: stringArray(body.relationIds, 'relation ids')
      };
      invariant(b.relationIds.length > 0, 'invalid_input', 'decision needs at least one reviewed relation');
      return spine.command(meta, 'amend_plan', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'decide');
        await planAt(tx, s.mission, meta.expectedPlanVersion, { active: true });
        const relationRows = await tx.query(
          `SELECT id,source_id,status FROM relation WHERE mission_id=$1 AND id=ANY($2::text[])`,
          [s.mission, b.relationIds]
        );
        invariant(relationRows.rowCount === b.relationIds.length && relationRows.rows.every(r => r.status === 'accepted'),
          'invalid_reference', 'all decision inputs must be accepted current relations');
        const sourceIds = [...new Set(relationRows.rows.map(r => r.source_id))];
        for (const sourceId of sourceIds) {
          await sourceReadGrant(tx, s.mission, sourceId, s.actor.principal,
            'decision', 'amend_plan');
        }
        const next = meta.expectedPlanVersion + 1;
        await tx.query(
          `INSERT INTO decision (mission_id,id,previous_version,next_version,reason,
            unresolved_objection,approved_by,mandate_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [s.mission, b.decisionId, meta.expectedPlanVersion, next, b.reason,
            b.unresolvedObjection, s.actor.principal, authorityRef]
        );
        await tx.query(
          `INSERT INTO plan_revision (mission_id,version,statement,acceptance_test,created_by,decision_id)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [s.mission, next, b.plan, b.acceptanceTest, s.actor.principal, b.decisionId]
        );
        await tx.query('UPDATE mission SET plan_version=$2,updated_at=now() WHERE id=$1', [s.mission, next]);
        await tx.query(
          `UPDATE work_package SET status='pending_reconfirmation'
           WHERE mission_id=$1 AND plan_version<$2 AND status IN ('open','committed')`,
          [s.mission, next]
        );
        await tx.query(
          `UPDATE commitment SET status='pending_reconfirmation'
           WHERE mission_id=$1 AND plan_version<$2 AND status='active'`,
          [s.mission, next]
        );
        for (const relationId of b.relationIds) {
          await edge(tx, s.mission, 'relation', relationId, 'decision', b.decisionId, 'considered');
        }
        await edge(tx, s.mission, 'decision', b.decisionId, 'plan', String(next), 'approved');
        return change({ decisionId: b.decisionId, planVersion: next,
          previousVersion: meta.expectedPlanVersion, status: 'approved' },
        'decision', b.decisionId, { authorityRef, planVersion: next, sourceRefs: sourceIds });
      });
    },

    async createWork(meta, body) {
      const b = {
        workId: id(body.workId, 'work id'),
        outcome: text(body.outcome, 'outcome'),
        acceptanceTest: text(body.acceptanceTest, 'acceptance test'),
        riskClass: integer(body.riskClass, 'risk class', 0, 2),
        requiresReservation: body.requiresReservation === true,
        mentorId: id(body.mentorId, 'mentor id'),
        reviewerId: id(body.reviewerId, 'reviewer id'),
        capacityHours: integer(body.capacityHours, 'capacity hours', 1, 1000),
        dueAt: text(body.dueAt, 'due date', 40),
        compensation: text(body.compensation, 'compensation', 1000),
        rights: text(body.rights, 'rights', 1000),
        stopCondition: text(body.stopCondition, 'stop condition', 1000)
      };
      invariant(!Number.isNaN(Date.parse(b.dueAt)) && Date.parse(b.dueAt) > Date.now(),
        'invalid_input', 'due date must be in the future');
      return spine.command(meta, 'create_work', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'coordinate');
        await planAt(tx, s.mission, meta.expectedPlanVersion, { active: true });
        const plan = await tx.query(
          'SELECT decision_id,stale FROM plan_revision WHERE mission_id=$1 AND version=$2',
          [s.mission, meta.expectedPlanVersion]
        );
        invariant(plan.rowCount && plan.rows[0].decision_id && !plan.rows[0].stale,
          'invalid_state', 'work requires a current human-approved plan amendment');
        const people = await tx.query(
          `SELECT verified_human($1) AS mentor_ok,
            verified_mandate($2,$3,'review') AS reviewer_ok`,
          [b.mentorId, s.mission, b.reviewerId]
        );
        invariant(people.rows[0].mentor_ok && people.rows[0].reviewer_ok,
          'capacity_missing', 'verified mentor and active named reviewer are required');
        await tx.query(
          `INSERT INTO work_package (mission_id,id,plan_version,decision_id,outcome,acceptance_test,
            risk_class,requires_reservation,mentor_id,reviewer_id,capacity_hours,due_at,
            compensation,rights,stop_condition,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [s.mission, b.workId, meta.expectedPlanVersion, plan.rows[0].decision_id,
            b.outcome, b.acceptanceTest, b.riskClass, b.requiresReservation, b.mentorId, b.reviewerId,
            b.capacityHours, b.dueAt, b.compensation, b.rights, b.stopCondition, s.actor.principal]
        );
        await edge(tx, s.mission, 'decision', plan.rows[0].decision_id, 'work', b.workId, 'implements');
        return change({ workId: b.workId, status: 'open', planVersion: meta.expectedPlanVersion },
          'work', b.workId, { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async inviteWork(meta, body) {
      const b = { invitationId: id(body.invitationId, 'invitation id'),
        workId: id(body.workId, 'work id'), principalId: id(body.principalId, 'principal id') };
      return spine.command(meta, 'invite_work', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'coordinate');
        await planAt(tx, s.mission, meta.expectedPlanVersion, { active: true });
        const person = await tx.query('SELECT verified_human($1) AS eligible', [b.principalId]);
        invariant(person.rows[0].eligible, 'unverified_principal', 'invitation needs a verified human');
        const work = await tx.query(
          'SELECT status,plan_version,reviewer_id,requires_reservation FROM work_package WHERE mission_id=$1 AND id=$2',
          [s.mission, b.workId]
        );
        invariant(work.rowCount && work.rows[0].status === 'open'
          && work.rows[0].plan_version === meta.expectedPlanVersion,
        'invalid_state', 'work must be open on the current plan');
        const reviewer = await tx.query(
          "SELECT verified_mandate($1,$2,'review') AS ready",
          [s.mission, work.rows[0].reviewer_id]
        );
        invariant(reviewer.rows[0].ready, 'capacity_missing', 'named reviewer is no longer available');
        if (work.rows[0].requires_reservation) {
          const funding = await tx.query(
            'SELECT has_active_reservation($1,$2) AS ready',
            [s.mission, b.workId]
          );
          invariant(funding.rows[0].ready, 'funding_missing',
            'work requires an active reservation before invitation');
        }
        const sources = await tx.query(
          `WITH RECURSIVE ancestors(kind,id) AS (
             SELECT l.parent_kind,l.parent_id FROM lineage l
             WHERE l.mission_id=$1 AND l.child_kind='work' AND l.child_id=$2
             UNION
             SELECT l.parent_kind,l.parent_id FROM lineage l JOIN ancestors a
               ON l.child_kind=a.kind AND l.child_id=a.id WHERE l.mission_id=$1
           ) SELECT DISTINCT id FROM ancestors WHERE kind='source'`,
          [s.mission, b.workId]
        );
        invariant(sources.rowCount > 0, 'invalid_state', 'work needs source lineage before invitation');
        for (const row of sources.rows) {
          await sourceReadGrant(tx, s.mission, row.id, b.principalId, 'work', 'join');
        }
        await tx.query(
          `INSERT INTO work_invitation (mission_id,id,work_id,principal_id,created_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [s.mission, b.invitationId, b.workId, b.principalId, s.actor.principal]
        );
        await edge(tx, s.mission, 'work', b.workId, 'invitation', b.invitationId, 'bounded_join');
        return change({ invitationId: b.invitationId, status: 'active' },
          'invitation', b.invitationId, { authorityRef, planVersion: meta.expectedPlanVersion,
            recipientPrincipal: b.principalId });
      });
    },

    async offerWork(meta, body) {
      const b = {
        offerId: id(body.offerId, 'offer id'), workId: id(body.workId, 'work id'),
        capacityHours: integer(body.capacityHours, 'capacity hours', 1, 1000),
        acceptedTerms: body.acceptedTerms === true
      };
      invariant(b.acceptedTerms, 'invalid_input', 'contributor must accept the fixed work terms');
      return spine.command(meta, 'offer_work', b, async (tx, s) => {
        await requireHuman(tx, s.actor);
        await planAt(tx, s.mission, meta.expectedPlanVersion, { active: true });
        const invitation = await tx.query(
          `SELECT id FROM work_invitation WHERE mission_id=$1 AND work_id=$2
           AND principal_id=$3 AND status='active'`,
          [s.mission, b.workId, s.actor.principal]
        );
        invariant(invitation.rowCount, 'forbidden', 'a current invitation is required to join this card');
        const work = await tx.query(
          'SELECT status,capacity_hours,plan_version FROM work_package WHERE mission_id=$1 AND id=$2',
          [s.mission, b.workId]
        );
        invariant(work.rowCount && work.rows[0].status === 'open' &&
          work.rows[0].plan_version === meta.expectedPlanVersion, 'invalid_state', 'work is not open on this plan');
        invariant(b.capacityHours <= work.rows[0].capacity_hours, 'capacity_exceeded', 'offer exceeds card capacity');
        await tx.query(
          `INSERT INTO offer (mission_id,id,work_id,contributor_id,accepted_terms,capacity_hours)
           VALUES ($1,$2,$3,$4,true,$5)`,
          [s.mission, b.offerId, b.workId, s.actor.principal, b.capacityHours]
        );
        await edge(tx, s.mission, 'work', b.workId, 'offer', b.offerId, 'offered');
        return change({ offerId: b.offerId, status: 'offered' }, 'offer', b.offerId,
          { authorityRef: invitation.rows[0].id, planVersion: meta.expectedPlanVersion });
      });
    },

    async approveCommitment(meta, body) {
      const b = { commitmentId: id(body.commitmentId, 'commitment id'),
        offerId: id(body.offerId, 'offer id') };
      return spine.command(meta, 'approve_commitment', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'coordinate');
        await planAt(tx, s.mission, meta.expectedPlanVersion, { active: true });
        const offer = await tx.query(
          `SELECT o.work_id,o.contributor_id,o.accepted_terms,o.capacity_hours,
            w.status,w.plan_version,w.risk_class,w.capacity_hours AS work_capacity
           FROM offer o JOIN work_package w ON w.mission_id=o.mission_id AND w.id=o.work_id
           WHERE o.mission_id=$1 AND o.id=$2 FOR UPDATE OF w`,
          [s.mission, b.offerId]
        );
        invariant(offer.rowCount, 'not_found', 'offer not found');
        const o = offer.rows[0];
        invariant(o.contributor_id !== s.actor.principal, 'two_sided_required',
          'the mission approver must be distinct from the contributor');
        invariant(o.accepted_terms && o.status === 'open' && o.plan_version === meta.expectedPlanVersion,
          'invalid_state', 'offer is not eligible for commitment on this plan');
        invariant(o.risk_class < 3 && o.capacity_hours <= o.work_capacity,
          'ineligible', 'risk or capacity gate not met');
        await tx.query(
          `INSERT INTO commitment (mission_id,id,work_id,offer_id,contributor_id,
            authorized_by,mandate_id,plan_version)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [s.mission, b.commitmentId, o.work_id, b.offerId, o.contributor_id,
            s.actor.principal, authorityRef, meta.expectedPlanVersion]
        );
        await tx.query('UPDATE work_package SET status=$3 WHERE mission_id=$1 AND id=$2',
          [s.mission, o.work_id, 'committed']);
        await edge(tx, s.mission, 'offer', b.offerId, 'commitment', b.commitmentId, 'accepted_by_mission');
        return change({ commitmentId: b.commitmentId, status: 'active',
          contributorId: o.contributor_id }, 'commitment', b.commitmentId,
          { authorityRef, planVersion: meta.expectedPlanVersion, recipientPrincipal: o.contributor_id });
      });
    },

    async createResourceAccount(meta, body) {
      const b = { accountId: id(body.accountId, 'account id'),
        custodian: text(body.custodian, 'external custodian', 300) };
      return spine.command(meta, 'create_resource_account', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'resource');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        await tx.query(
          'INSERT INTO resource_account (mission_id,id,custodian) VALUES ($1,$2,$3)',
          [s.mission, b.accountId, b.custodian]
        );
        return change({ accountId: b.accountId, pledgedCents: 0, clearedCents: 0 },
          'resource_account', b.accountId, { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async recordPledge(meta, body) {
      const b = { accountId: id(body.accountId, 'account id'), amountCents: cents(body.amountCents, 'pledged cents') };
      invariant(b.amountCents > 0, 'invalid_input', 'pledge must be positive');
      return spine.command(meta, 'record_pledge', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'resource');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const row = await tx.query(
          `UPDATE resource_account SET pledged_cents=pledged_cents+$3
           WHERE mission_id=$1 AND id=$2 RETURNING pledged_cents,cleared_cents`,
          [s.mission, b.accountId, b.amountCents]
        );
        invariant(row.rowCount, 'not_found', 'resource account not found');
        return change({ accountId: b.accountId, pledgedCents: Number(row.rows[0].pledged_cents),
          clearedCents: Number(row.rows[0].cleared_cents) }, 'resource_account', b.accountId,
        { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async recordClearing(meta, body) {
      const b = { accountId: id(body.accountId, 'account id'), amountCents: cents(body.amountCents, 'cleared cents'),
        custodyReference: id(body.custodyReference, 'custody reference') };
      invariant(b.amountCents > 0, 'invalid_input', 'clearing must be positive');
      return spine.command(meta, 'record_clearing', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'resource');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const row = await tx.query(
          `UPDATE resource_account SET cleared_cents=cleared_cents+$3
           WHERE mission_id=$1 AND id=$2 AND cleared_cents+$3<=pledged_cents
           RETURNING pledged_cents,cleared_cents`,
          [s.mission, b.accountId, b.amountCents]
        );
        invariant(row.rowCount, 'insufficient_pledge', 'cleared amount exceeds recorded pledge or account missing');
        return change({ accountId: b.accountId, pledgedCents: Number(row.rows[0].pledged_cents),
          clearedCents: Number(row.rows[0].cleared_cents), custodyReference: b.custodyReference },
        'resource_account', b.accountId, { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async reserve(meta, body) {
      const b = { reservationId: id(body.reservationId, 'reservation id'),
        accountId: id(body.accountId, 'account id'), workId: id(body.workId, 'work id'),
        amountCents: cents(body.amountCents, 'reservation cents') };
      invariant(b.amountCents > 0, 'invalid_input', 'reservation must be positive');
      return spine.command(meta, 'reserve', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'resource');
        await planAt(tx, s.mission, meta.expectedPlanVersion, { active: true });
        const account = await tx.query(
          `SELECT cleared_cents,spent_cents FROM resource_account
           WHERE mission_id=$1 AND id=$2 FOR UPDATE`, [s.mission, b.accountId]
        );
        invariant(account.rowCount, 'not_found', 'resource account unavailable');
        const work = await tx.query(
          'SELECT status,plan_version FROM work_package WHERE mission_id=$1 AND id=$2',
          [s.mission, b.workId]
        );
        invariant(work.rowCount && ['open', 'committed'].includes(work.rows[0].status)
          && work.rows[0].plan_version === meta.expectedPlanVersion,
        'invalid_state', 'work cannot reserve on a stale or paused plan');
        const active = await tx.query(
          `SELECT COALESCE(SUM(amount_cents),0)::bigint AS held FROM reservation
           WHERE mission_id=$1 AND account_id=$2 AND status='active'`,
          [s.mission, b.accountId]
        );
        const available = Number(account.rows[0].cleared_cents) - Number(account.rows[0].spent_cents)
          - Number(active.rows[0].held);
        invariant(available >= b.amountCents, 'insufficient_cleared_funds',
          'reservation exceeds cleared unreserved funds', { availableCents: available });
        await tx.query(
          `INSERT INTO reservation (mission_id,id,account_id,work_id,amount_cents,authorized_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [s.mission, b.reservationId, b.accountId, b.workId, b.amountCents, s.actor.principal]
        );
        await edge(tx, s.mission, 'work', b.workId, 'reservation', b.reservationId, 'funds');
        return change({ reservationId: b.reservationId, reservedCents: b.amountCents,
          availableAfterCents: available - b.amountCents }, 'reservation', b.reservationId,
        { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async settleReservation(meta, body) {
      const b = { reservationId: id(body.reservationId, 'reservation id'),
        spentCents: cents(body.spentCents, 'spent cents'),
        custodyReference: id(body.custodyReference, 'custody reference') };
      return spine.command(meta, 'settle_reservation', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'resource');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const reservation = await tx.query(
          `SELECT account_id,amount_cents,status FROM reservation
           WHERE mission_id=$1 AND id=$2 FOR UPDATE`, [s.mission, b.reservationId]
        );
        invariant(reservation.rowCount && reservation.rows[0].status === 'active',
          'invalid_state', 'reservation is not active');
        const r = reservation.rows[0];
        invariant(b.spentCents <= Number(r.amount_cents), 'overspend', 'spend exceeds reservation');
        await tx.query(
          `UPDATE resource_account SET spent_cents=spent_cents+$3
           WHERE mission_id=$1 AND id=$2 AND spent_cents+$3<=cleared_cents`,
          [s.mission, r.account_id, b.spentCents]
        );
        await tx.query(
          `UPDATE reservation SET status='settled',spent_cents=$3,settled_at=now()
           WHERE mission_id=$1 AND id=$2`,
          [s.mission, b.reservationId, b.spentCents]
        );
        return change({ reservationId: b.reservationId, spentCents: b.spentCents,
          releasedCents: Number(r.amount_cents) - b.spentCents, custodyReference: b.custodyReference },
        'reservation', b.reservationId, { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async submitResult(meta, body) {
      const b = { resultId: id(body.resultId, 'result id'),
        commitmentId: id(body.commitmentId, 'commitment id'),
        summary: text(body.summary, 'result summary'), limits: text(body.limits, 'result limits') };
      return spine.command(meta, 'submit_result', b, async (tx, s) => {
        await requireHuman(tx, s.actor);
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const commitment = await tx.query(
          `SELECT status,plan_version FROM commitment WHERE mission_id=$1 AND id=$2
           AND contributor_id=$3`, [s.mission, b.commitmentId, s.actor.principal]
        );
        invariant(commitment.rowCount && commitment.rows[0].status === 'active'
          && commitment.rows[0].plan_version === meta.expectedPlanVersion,
        'invalid_state', 'only the active contributor may submit on this plan');
        await tx.query(
          `INSERT INTO result (mission_id,id,commitment_id,submitted_by,summary,limits)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [s.mission, b.resultId, b.commitmentId, s.actor.principal, b.summary, b.limits]
        );
        await edge(tx, s.mission, 'commitment', b.commitmentId, 'result', b.resultId, 'submitted');
        return change({ resultId: b.resultId, status: 'pending_review' },
          'result', b.resultId, { authorityRef: 'own-active-commitment',
            planVersion: meta.expectedPlanVersion });
      });
    },

    async reviewResult(meta, body) {
      const b = { findingId: id(body.findingId, 'finding id'), resultId: id(body.resultId, 'result id'),
        conclusion: text(body.conclusion, 'limited conclusion'), limits: text(body.limits, 'finding limits') };
      return spine.command(meta, 'review_result', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'review');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const result = await tx.query(
          `SELECT r.submitted_by,r.status,w.reviewer_id,c.status AS commitment_status
           FROM result r JOIN commitment c ON c.mission_id=r.mission_id AND c.id=r.commitment_id
           JOIN work_package w ON w.mission_id=c.mission_id AND w.id=c.work_id
           WHERE r.mission_id=$1 AND r.id=$2 FOR UPDATE OF r`,
          [s.mission, b.resultId]
        );
        invariant(result.rowCount && result.rows[0].status === 'pending_review'
          && result.rows[0].commitment_status === 'active',
        'invalid_state', 'result is not pending review on an active commitment');
        invariant(result.rows[0].submitted_by !== s.actor.principal
          && result.rows[0].reviewer_id === s.actor.principal,
        'independent_review_required', 'the named independent reviewer must decide');
        await tx.query(
          `INSERT INTO finding (mission_id,id,result_id,conclusion,limits,reviewed_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [s.mission, b.findingId, b.resultId, b.conclusion, b.limits, s.actor.principal]
        );
        await tx.query("UPDATE result SET status='reviewed' WHERE mission_id=$1 AND id=$2",
          [s.mission, b.resultId]);
        await edge(tx, s.mission, 'result', b.resultId, 'finding', b.findingId, 'independently_reviewed');
        return change({ findingId: b.findingId, status: 'reviewed',
          limits: b.limits }, 'finding', b.findingId,
        { authorityRef, planVersion: meta.expectedPlanVersion });
      });
    },

    async issueReceipt(meta, body) {
      const b = { receiptId: id(body.receiptId, 'receipt id'),
        sourceId: id(body.sourceId, 'source id'), findingId: id(body.findingId, 'finding id') };
      return spine.command(meta, 'issue_receipt', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'review');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const source = await tx.query(
          'SELECT standing,submitter_principal FROM source_metadata WHERE mission_id=$1 AND id=$2',
          [s.mission, b.sourceId]
        );
        invariant(source.rowCount && source.rows[0].standing === 'reviewed',
          'invalid_state', 'receipt requires a reviewed source');
        const finding = await tx.query(
          'SELECT stale FROM finding WHERE mission_id=$1 AND id=$2', [s.mission, b.findingId]
        );
        invariant(finding.rowCount && !finding.rows[0].stale, 'invalid_state', 'finding is not current');
        const linked = await tx.query(
          `WITH RECURSIVE path(kind,id) AS (
             SELECT 'source'::text,$2::text
             UNION SELECT l.child_kind,l.child_id FROM lineage l JOIN path p
               ON l.parent_kind=p.kind AND l.parent_id=p.id WHERE l.mission_id=$1
           ) SELECT 1 FROM path WHERE kind='finding' AND id=$3 LIMIT 1`,
          [s.mission, b.sourceId, b.findingId]
        );
        invariant(linked.rowCount, 'invalid_reference', 'source was not in this finding lineage');
        const message = 'Your report was considered in a reviewed mission test. The finding is limited to that test; it does not prove full winter durability or community deployment. Ask a steward for the approved public brief.';
        await tx.query(
          `INSERT INTO receipt (mission_id,id,source_id,finding_id,status,message,created_by)
           VALUES ($1,$2,$3,$4,'available',$5,$6)`,
          [s.mission, b.receiptId, b.sourceId, b.findingId, message, s.actor.principal]
        );
        await edge(tx, s.mission, 'finding', b.findingId, 'receipt', b.receiptId, 'disposition');
        await edge(tx, s.mission, 'source', b.sourceId, 'receipt', b.receiptId, 'returned_to_reporter');
        return change({ receiptId: b.receiptId, status: 'available', message },
          'receipt', b.receiptId, { authorityRef, planVersion: meta.expectedPlanVersion,
            sourceRefs: [b.sourceId], effectKind: 'receipt_available', sourceId: b.sourceId,
            recipientPrincipal: source.rows[0].submitter_principal });
      });
    },

    async correctSource(meta, body) {
      const b = { sourceId: id(body.sourceId, 'source id'),
        expectedSourceRevision: integer(body.expectedSourceRevision, 'expected source revision', 1),
        body: text(body.body, 'corrected source text', 10000) };
      return spine.command(meta, 'correct_source', { sourceId: b.sourceId,
        expectedSourceRevision: b.expectedSourceRevision, bodyDigest: sha256(b.body) }, async (tx, s) => {
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const control = await tx.query('SELECT controls_source($1,$2) AS allowed', [s.mission, b.sourceId]);
        invariant(control.rows[0].allowed, 'forbidden', 'source holder required');
        const source = await tx.query(
          'SELECT current_revision,standing FROM source_metadata WHERE mission_id=$1 AND id=$2 FOR UPDATE',
          [s.mission, b.sourceId]
        );
        invariant(source.rowCount && source.rows[0].standing !== 'withdrawn', 'invalid_state', 'source unavailable');
        invariant(source.rows[0].current_revision === b.expectedSourceRevision,
          'version_conflict', 'source changed; reload before correcting',
          { currentRevision: source.rows[0].current_revision });
        const next = b.expectedSourceRevision + 1;
        await tx.query(
          'INSERT INTO source_payload (mission_id,source_id,revision,body) VALUES ($1,$2,$3,$4)',
          [s.mission, b.sourceId, next, b.body]
        );
        await tx.query(
          `UPDATE source_metadata SET current_revision=$3,standing='unreviewed',corrected_at=now()
           WHERE mission_id=$1 AND id=$2`, [s.mission, b.sourceId, next]
        );
        await tx.query('SELECT mark_source_stale($1,$2)', [s.mission, b.sourceId]);
        return change({ sourceId: b.sourceId, sourceRevision: next,
          standing: 'unreviewed', dependents: 'pending_review' },
        'source', b.sourceId, { authorityRef: 'source-holder', planVersion: meta.expectedPlanVersion,
          sourceRefs: [b.sourceId], sourceId: b.sourceId });
      });
    },

    async revokeGrant(meta, body) {
      const b = { sourceId: id(body.sourceId, 'source id'), grantId: id(body.grantId, 'grant id') };
      return spine.command(meta, 'revoke_grant', b, async (tx, s) => {
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const control = await tx.query('SELECT controls_source($1,$2) AS allowed', [s.mission, b.sourceId]);
        invariant(control.rows[0].allowed, 'forbidden', 'source holder required');
        const row = await tx.query(
          `UPDATE source_grant SET revoked_at=now() WHERE mission_id=$1 AND id=$2
           AND source_id=$3 AND revoked_at IS NULL RETURNING id`,
          [s.mission, b.grantId, b.sourceId]
        );
        invariant(row.rowCount, 'not_found', 'active grant not found');
        await tx.query('SELECT mark_source_stale($1,$2)', [s.mission, b.sourceId]);
        return change({ grantId: b.grantId, status: 'revoked', dependents: 'pending_review' },
          'source_grant', b.grantId, { authorityRef: 'source-holder',
            planVersion: meta.expectedPlanVersion, sourceRefs: [b.sourceId], sourceId: b.sourceId });
      });
    },

    async withdrawSource(meta, body) {
      const b = { sourceId: id(body.sourceId, 'source id') };
      return spine.command(meta, 'withdraw_source', b, async (tx, s) => {
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const control = await tx.query('SELECT controls_source($1,$2) AS allowed', [s.mission, b.sourceId]);
        invariant(control.rows[0].allowed, 'forbidden', 'source holder required');
        await tx.query('UPDATE source_grant SET revoked_at=now() WHERE mission_id=$1 AND source_id=$2 AND revoked_at IS NULL',
          [s.mission, b.sourceId]);
        await tx.query('SELECT mark_source_stale($1,$2)', [s.mission, b.sourceId]);
        await tx.query(
          `UPDATE source_payload SET body=NULL,erased_at=now()
           WHERE mission_id=$1 AND source_id=$2 AND body IS NOT NULL`,
          [s.mission, b.sourceId]
        );
        await tx.query(
          `UPDATE source_metadata SET standing='withdrawn',corrected_at=now()
           WHERE mission_id=$1 AND id=$2`, [s.mission, b.sourceId]
        );
        return change({ sourceId: b.sourceId, standing: 'withdrawn',
          payload: 'erased', audit: 'minimal-lineage-retained' },
        'source', b.sourceId, { authorityRef: 'source-holder',
          planVersion: meta.expectedPlanVersion, sourceRefs: [b.sourceId], sourceId: b.sourceId });
      });
    },

    async compileContext(meta, body) {
      const b = {
        manifestId: id(body.manifestId, 'manifest id'), issueId: id(body.issueId, 'issue id'),
        purpose: id(body.purpose, 'purpose'), audience: enumValue(body.audience, 'audience', ['reviewer', 'model']),
        action: id(body.action, 'action'), provider: id(body.provider ?? 'none', 'provider'),
        policyVersion: integer(body.policyVersion, 'policy version', 1),
        modelVersion: id(body.modelVersion ?? 'none', 'model version'),
        costBound: integer(body.costBound, 'cost bound', 0, 1_000_000),
        expiresAt: text(body.expiresAt, 'expiry', 40)
      };
      invariant(!Number.isNaN(Date.parse(b.expiresAt)) && Date.parse(b.expiresAt) > Date.now(),
        'invalid_input', 'expiry must be in the future');
      invariant(b.audience === 'reviewer' && b.provider === 'none' && b.modelVersion === 'none',
        'model_disabled', 'hosted model processing is disabled in this first build');
      const manifest = await spine.command(meta, 'compile_context', b, async (tx, s) => {
        const authorityRef = await requireMandate(tx, s.mission, s.actor, 'review');
        await planAt(tx, s.mission, meta.expectedPlanVersion);
        const relations = await tx.query(
          `SELECT id,source_id,source_revision,relation_type FROM relation
           WHERE mission_id=$1 AND issue_id=$2 AND status='accepted' ORDER BY id`,
          [s.mission, b.issueId]
        );
        const included = []; const omitted = [];
        for (const r of relations.rows) {
          const grant = await tx.query(
            `SELECT id FROM source_grant WHERE mission_id=$1 AND source_id=$2
             AND grantee=$3 AND purpose=$4 AND action=$5 AND provider='none'
             AND allow_read AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) LIMIT 1`,
            [s.mission, r.source_id, s.actor.principal, b.purpose, b.action]
          );
          if (!grant.rowCount) {
            omitted.push({ relationId: r.id, category: 'no_read_grant' });
            continue;
          }
          const payload = await tx.query(
            `SELECT body FROM source_payload WHERE mission_id=$1 AND source_id=$2 AND revision=$3
             AND erased_at IS NULL`, [s.mission, r.source_id, r.source_revision]
          );
          if (!payload.rowCount || payload.rows[0].body == null) {
            omitted.push({ relationId: r.id, category: 'erased_or_unavailable' });
            continue;
          }
          included.push({ sourceId: r.source_id, revision: r.source_revision,
            relationType: r.relation_type, relationId: r.id, grantId: grant.rows[0].id,
            reason: 'accepted_relation_for_issue' });
        }
        const limits = { incompleteEvidence: omitted.length > 0,
          note: 'A packet is a bounded view, not an exhaustive truth claim.' };
        await tx.query(
          `INSERT INTO context_manifest (mission_id,id,created_by,purpose,audience,provider,action,
            plan_version,policy_version,model_version,cost_bound,included,omitted,limits,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [s.mission, b.manifestId, s.actor.principal, b.purpose, b.audience, b.provider,
            b.action, meta.expectedPlanVersion, b.policyVersion, b.modelVersion, b.costBound,
            JSON.stringify(included), JSON.stringify(omitted), JSON.stringify(limits), b.expiresAt]
        );
        return change({ manifestId: b.manifestId, planVersion: meta.expectedPlanVersion,
          included, omitted, limits }, 'context_manifest', b.manifestId,
        { authorityRef, planVersion: meta.expectedPlanVersion,
          sourceRefs: included.map(x => x.sourceId), effectKind: 'context_compiled' });
      });
      // This read is deliberately separate from the durable idempotency response.
      // It rechecks the manifest, source revision and grants after the write commits.
      const packet = await spine.read(meta, async (tx, s) => {
        const row = await tx.query(
          `SELECT included,purpose,action,provider,plan_version FROM context_manifest
           WHERE mission_id=$1 AND id=$2 AND invalidated_at IS NULL AND expires_at>now()`,
          [s.mission, b.manifestId]
        );
        invariant(row.rowCount, 'context_expired', 'context manifest is no longer usable');
        const m = row.rows[0];
        const current = await tx.query('SELECT plan_version FROM mission WHERE id=$1', [s.mission]);
        invariant(current.rowCount && current.rows[0].plan_version === m.plan_version,
          'version_conflict', 'plan changed before context retrieval');
        const items = [];
        for (const source of m.included) {
          await sourceReadGrant(tx, s.mission, source.sourceId, s.actor.principal,
            m.purpose, m.action, m.provider, 'allow_read');
          const payload = await tx.query(
            `SELECT p.body FROM source_payload p JOIN source_metadata sm
              ON sm.mission_id=p.mission_id AND sm.id=p.source_id
             WHERE p.mission_id=$1 AND p.source_id=$2 AND p.revision=$3
               AND sm.current_revision=$3 AND sm.standing='reviewed' AND p.erased_at IS NULL`,
            [s.mission, source.sourceId, source.revision]
          );
          invariant(payload.rowCount && payload.rows[0].body != null,
            'context_expired', 'source changed or was erased before retrieval');
          items.push({ sourceId: source.sourceId, revision: source.revision,
            relationType: source.relationType, body: payload.rows[0].body });
        }
        return items;
      });
      return { ...manifest, packet };
    },

    async publishSourceExcerpt(meta, body) {
      const b = { releaseId: id(body.releaseId, 'release id'),
        sourceId: id(body.sourceId, 'source id'), excerpt: text(body.excerpt, 'single-source excerpt', 1000) };
      return spine.command(meta, 'publish_source_excerpt', { ...b, excerptDigest: sha256(b.excerpt), excerpt: undefined },
        async (tx, s) => {
          const authorityRef = await requireMandate(tx, s.mission, s.actor, 'publish');
          await planAt(tx, s.mission, meta.expectedPlanVersion);
          await sourceReadGrant(tx, s.mission, b.sourceId, 'public', 'public-brief', 'publish', 'none', 'allow_read');
          await sourceReadGrant(tx, s.mission, b.sourceId, 'public', 'public-brief', 'publish', 'none', 'allow_publish');
          const source = await tx.query(
            `SELECT p.body FROM source_metadata s JOIN source_payload p
              ON p.mission_id=s.mission_id AND p.source_id=s.id AND p.revision=s.current_revision
             WHERE s.mission_id=$1 AND s.id=$2 AND s.standing='reviewed' AND p.erased_at IS NULL`,
            [s.mission, b.sourceId]
          );
          invariant(source.rowCount && source.rows[0].body.includes(b.excerpt),
            'invalid_input', 'public release must be a verbatim excerpt from one current source');
          await tx.query(
            `INSERT INTO public_release (mission_id,id,source_id,body,approved_by)
             VALUES ($1,$2,$3,$4,$5)`,
            [s.mission, b.releaseId, b.sourceId, b.excerpt, s.actor.principal]
          );
          await edge(tx, s.mission, 'source', b.sourceId, 'public_release', b.releaseId, 'approved_excerpt');
          return change({ releaseId: b.releaseId, status: 'published' },
            'public_release', b.releaseId, { authorityRef, planVersion: meta.expectedPlanVersion,
              sourceRefs: [b.sourceId], sourceId: b.sourceId });
        });
    },

    async readPublicRelease(meta, releaseId) {
      invariant(meta.actor?.kind === 'public', 'unauthorized', 'public read context required');
      return spine.read(meta, async (tx, s) => {
        const row = await tx.query(
          `SELECT id,body,created_at FROM public_release WHERE mission_id=$1 AND id=$2
           AND status='published'`, [s.mission, id(releaseId, 'release id')]
        );
        return row.rows[0] ?? null;
      });
    },

    async readReceipt(meta, sourceId) {
      return spine.read(meta, async (tx, s) => {
        const row = await tx.query(
          `SELECT id,status,message,created_at FROM receipt WHERE mission_id=$1 AND source_id=$2
           ORDER BY created_at DESC`, [s.mission, id(sourceId, 'source id')]
        );
        return row.rows;
      });
    }
  };
}
