import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { Spine } from '../src/tx.js';
import { missionCommands } from '../src/mission.js';

const db = new PGlite();
const sql = await readFile(new URL('../sql/001_init.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec("INSERT INTO mission_spine.principal(id,kind,authenticated_by,verified) VALUES ('mara','human','fixture',true),('elina','human','fixture',true),('nia','human','fixture',true),('ivo','human','fixture',true)");
const pool = { async connect() { return { query: (...args) => db.query(...args), release() {} }; } };
const api = missionCommands(new Spine(pool));
const mission = 'plasti_1';
let counter = 0;
const key = () => `test_${++counter}`;
const future = days => new Date(Date.now() + days * 86400000).toISOString();
const human = id => ({ kind: 'principal', id });
const bearer = token => ({ kind: 'bearer', token });
const tokenNia = randomBytes(32).toString('base64url');
const tokenTomas = randomBytes(32).toString('base64url');
const m = (actor, version = 1) => ({ mission, actor, expectedPlanVersion: version, idempotencyKey: key() });
const grant = (source, suffix, grantee, purpose, action, rights) => ({ id: `${source}_${suffix}`, grantee, purpose, action, provider: 'none', ...rights });
const sourceGrants = (source, publicRelease = false) => [
  grant(source, 'review', 'elina', 'review', 'review_relation', { read: true }),
  grant(source, 'context', 'elina', 'review', 'compile_context', { read: true }),
  grant(source, 'decision', 'mara', 'decision', 'amend_plan', { read: true }),
  grant(source, 'join', 'nia', 'work', 'join', { read: true }),
  ...(publicRelease ? [grant(source, 'public', 'public', 'public-brief', 'publish', { read: true, publish: true })] : [])
];
async function step(name, fn) {
  try {
    const value = await fn();
    process.stdout.write(`PASS ${name}\n`);
    return value;
  } catch (error) {
    process.stderr.write(`FAIL ${name}: ${error.code || ''} ${error.message}\n`);
    throw error;
  }
}
async function rejectAs(name, code, fn) {
  try {
    await fn();
    throw new Error(`expected ${code}`);
  } catch (error) {
    if (error.code !== code) throw error;
    process.stdout.write(`PASS ${name}\n`);
  }
}

try {
  await step('create mission', () => api.createMission(m(human('mara')), {
    name: 'Plasti', purpose: 'Test local planter designs', boundary: 'No city installation authority',
    plan: 'Compare two early designs', acceptanceTest: 'A short cold test is recorded'
  }));
  await step('grant independent reviewer', () => api.grantMandate(m(human('mara')), { principalId: 'elina', action: 'review' }));
  await step('create issue', () => api.createIssue(m(human('elina')), { issueId: 'cold', title: 'Cold cracking' }));
  await step('anonymous source A', () => api.submitSource(m(bearer(tokenNia)), {
    sourceId: 's_nia', body: 'UNRELEASED_NIA_9f68: a thin planter cracked after frost.',
    grants: sourceGrants('s_nia')
  }));
  await step('anonymous source B', () => api.submitSource(m(bearer(tokenTomas)), {
    sourceId: 's_tomas', body: 'Tomas sample survived cold with a thicker wall.',
    grants: sourceGrants('s_tomas', true)
  }));
  const unrelated = await new Spine(pool).read({ mission, actor: human('ivo') }, tx =>
    tx.query('SELECT body FROM source_payload WHERE mission_id=$1', [mission]));
  assert.equal(unrelated.rowCount, 0);
  process.stdout.write('PASS unrelated principal direct SQL sees no source payload\n');
  await step('review supporting relation', () => api.reviewRelation(m(human('elina')), {
    relationId: 'rel_nia', sourceId: 's_nia', issueId: 'cold', claimId: 'wall_claim',
    claimText: 'Wall thickness may affect cracking', type: 'supports'
  }));
  await step('review disputing relation', () => api.reviewRelation(m(human('elina')), {
    relationId: 'rel_tomas', sourceId: 's_tomas', issueId: 'cold', claimId: 'wall_claim', type: 'disputes'
  }));
  await step('human plan amendment', () => api.amendPlan(m(human('mara')), {
    decisionId: 'decision_2', plan: 'Test thin and thick walls', acceptanceTest: 'Measure four samples',
    reason: 'Two observations conflict; compare controlled samples', unresolvedObjection: 'Winter durability still unknown',
    relationIds: ['rel_nia', 'rel_tomas']
  }));
  await rejectAs('stale plan amendment rejected', 'version_conflict', () => api.amendPlan(m(human('mara')), {
    decisionId: 'decision_stale', plan: 'Ignore frost', acceptanceTest: 'No test',
    reason: 'stale attempt', unresolvedObjection: 'none', relationIds: ['rel_nia']
  }));
  const v2 = a => m(a, 2);
  await step('create work', () => api.createWork(v2(human('mara')), {
    workId: 'work_2', outcome: 'Document four sample measurements',
    acceptanceTest: 'Four measurements and methods checked by Elina', riskClass: 0,
    requiresReservation: true,
    mentorId: 'ivo', reviewerId: 'elina', capacityHours: 2,
    dueAt: future(7), compensation: 'voluntary', rights: 'private until released',
    stopCondition: 'Pause if test safety is not approved'
  }));
  await rejectAs('funded work invitation waits for cleared reservation', 'funding_missing', () =>
    api.inviteWork(v2(human('mara')), {
      invitationId: 'invite_early', workId: 'work_2', principalId: 'nia'
    }));
  await step('resource account', () => api.createResourceAccount(v2(human('mara')), {
    accountId: 'fund', custodian: 'synthetic workshop custodian'
  }));
  await step('record pledge', () => api.recordPledge(v2(human('mara')), { accountId: 'fund', amountCents: 60000 }));
  await step('record clearing', () => api.recordClearing(v2(human('mara')), {
    accountId: 'fund', amountCents: 60000, custodyReference: 'fixture_bank_1'
  }));
  const reservationMeta = v2(human('mara'));
  const reservationBody = { reservationId: 'reserve_80', accountId: 'fund', workId: 'work_2', amountCents: 8000 };
  const firstReserve = await step('reserve funds', () => api.reserve(reservationMeta, reservationBody));
  const retriedReserve = await step('idempotent reservation retry', () => api.reserve(reservationMeta, reservationBody));
  assert.deepEqual(retriedReserve, firstReserve);
  await rejectAs('sequential overspend rejected', 'insufficient_cleared_funds', () => api.reserve(v2(human('mara')), {
    reservationId: 'reserve_bad', accountId: 'fund', workId: 'work_2', amountCents: 60000
  }));
  await step('invite contributor', () => api.inviteWork(v2(human('mara')), {
    invitationId: 'invite_nia', workId: 'work_2', principalId: 'nia'
  }));
  await step('contributor offers work', () => api.offerWork(v2(human('nia')), {
    offerId: 'offer_nia', workId: 'work_2', capacityHours: 2, acceptedTerms: true
  }));
  await step('mission accepts offer', () => api.approveCommitment(v2(human('mara')), {
    commitmentId: 'commit_nia', offerId: 'offer_nia'
  }));
  await step('submit result', () => api.submitResult(v2(human('nia')), {
    resultId: 'result_1', commitmentId: 'commit_nia', summary: 'Thick samples passed a short test, thin cracked',
    limits: 'One short test, winter durability not measured'
  }));
  await step('independent review', () => api.reviewResult(v2(human('elina')), {
    findingId: 'finding_1', resultId: 'result_1', conclusion: 'Thin wall failed this short test',
    limits: 'Cannot claim full winter durability'
  }));
  await step('receipt A', () => api.issueReceipt(v2(human('elina')), {
    receiptId: 'receipt_nia', sourceId: 's_nia', findingId: 'finding_1'
  }));
  await step('receipt B', () => api.issueReceipt(v2(human('elina')), {
    receiptId: 'receipt_tomas', sourceId: 's_tomas', findingId: 'finding_1'
  }));
  const ownReceipt = await step('bearer reads own receipt', () => api.readReceipt({ mission, actor: bearer(tokenNia) }, 's_nia'));
  assert.equal(ownReceipt.length, 1);
  const otherReceipt = await step('bearer cannot read other receipt', () => api.readReceipt({ mission, actor: bearer(tokenNia) }, 's_tomas'));
  assert.equal(otherReceipt.length, 0);
  await rejectAs('hosted model path disabled', 'model_disabled', () => api.compileContext(v2(human('elina')), {
    manifestId: 'manifest_model', issueId: 'cold', purpose: 'review', audience: 'model',
    action: 'compile_context', provider: 'hosted', policyVersion: 1, modelVersion: 'llm',
    costBound: 100, expiresAt: future(1)
  }));
  const context = await step('compile private context', () => api.compileContext(v2(human('elina')), {
    manifestId: 'manifest_1', issueId: 'cold', purpose: 'review', audience: 'reviewer',
    action: 'compile_context', provider: 'none', policyVersion: 1, modelVersion: 'none',
    costBound: 0, expiresAt: future(1)
  }));
  assert(context.packet.some(x => x.body.includes('UNRELEASED_NIA_9f68')));
  const internal = await db.query("SELECT (SELECT string_agg(response::text,'') FROM mission_spine.command_dedupe) AS dedupe, (SELECT string_agg(source_refs::text,'') FROM mission_spine.audit) AS audit, (SELECT string_agg(kind,'') FROM mission_spine.outbox) AS outbox");
  assert(!JSON.stringify(internal.rows[0]).includes('UNRELEASED_NIA_9f68'));
  process.stdout.write('PASS private packet absent from dedupe/audit/outbox\n');
  await step('publish one-source excerpt', () => api.publishSourceExcerpt(v2(human('mara')), {
    releaseId: 'release_tomas', sourceId: 's_tomas', excerpt: 'Tomas sample survived cold'
  }));
  const publicMeta = { mission, actor: { kind: 'public' } };
  const before = await step('public read before revoke', () => api.readPublicRelease(publicMeta, 'release_tomas'));
  assert(before?.body.includes('Tomas sample survived cold'));
  const publicOriginals = await new Spine(pool).read(publicMeta, tx =>
    tx.query('SELECT body FROM source_payload WHERE mission_id=$1', [mission]));
  assert.equal(publicOriginals.rowCount, 0);
  process.stdout.write('PASS public excerpt grant does not expose original payloads\n');
  await step('revoke public grant', () => api.revokeGrant(v2(bearer(tokenTomas)), {
    sourceId: 's_tomas', grantId: 's_tomas_public'
  }));
  const after = await step('public read after revoke', () => api.readPublicRelease(publicMeta, 'release_tomas'));
  assert.equal(after, null);
  process.stdout.write('PASS public excerpt immediately suppressed\n');
  const record = await db.query("SELECT status FROM mission_spine.work_package WHERE mission_id=$1 AND id='work_2'", [mission]);
  assert.equal(record.rows[0].status, 'pending_reconfirmation');
  process.stdout.write('PASS dependent work marked for reconfirmation\n');
  const stale = await db.query("SELECT invalidated_at FROM mission_spine.context_manifest WHERE mission_id=$1 AND id='manifest_1'", [mission]);
  assert(stale.rows[0].invalidated_at);
  process.stdout.write('PASS revoked source invalidates context manifest\n');
  const otherMeta = { mission: 'other_mission', actor: human('mara'), expectedPlanVersion: 1, idempotencyKey: key() };
  await step('create second mission', () => api.createMission(otherMeta, {
    name: 'Another mission', purpose: 'Separate scope', boundary: 'No shared sources',
    plan: 'Observe', acceptanceTest: 'One observation'
  }));
  const crossTenant = await new Spine(pool).read({ mission: 'other_mission', actor: human('mara') }, tx =>
    tx.query("SELECT body FROM source_payload WHERE mission_id='plasti_1'"));
  assert.equal(crossTenant.rowCount, 0);
  process.stdout.write('PASS direct SQL cross-mission payload isolation\n');
  await step('source holder correction', () => api.correctSource(v2(bearer(tokenNia)), {
    sourceId: 's_nia', expectedSourceRevision: 1,
    body: 'CORRECTED_NIA_4812: this crack was measured on a different batch.'
  }));
  const correction = await db.query("SELECT current_revision,standing FROM mission_spine.source_metadata WHERE mission_id=$1 AND id='s_nia'", [mission]);
  assert.equal(correction.rows[0].current_revision, 2);
  assert.equal(correction.rows[0].standing, 'unreviewed');
  const oldReceipt = await db.query("SELECT status FROM mission_spine.receipt WHERE mission_id=$1 AND id='receipt_nia'", [mission]);
  assert.equal(oldReceipt.rows[0].status, 'superseded');
  process.stdout.write('PASS correction makes old disposition stale\n');
} finally {
  await db.close();
}
