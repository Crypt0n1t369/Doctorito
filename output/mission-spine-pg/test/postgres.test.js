import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { missionCommands } from '../src/mission.js';
import { Spine } from '../src/tx.js';
import { newBearerToken } from '../src/validation.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const migrationPath = fileURLToPath(new URL('../sql/001_init.sql', import.meta.url));

test('real PostgreSQL synthetic episode, concurrency and recipient isolation',
  { skip: databaseUrl ? false : 'Set TEST_DATABASE_URL for a dedicated real PostgreSQL test database' },
  async () => {
    assert.equal(process.env.TEST_DATABASE_RESET, 'YES_I_OWN_THIS_DATABASE',
      'Set TEST_DATABASE_RESET=YES_I_OWN_THIS_DATABASE only for a disposable test database');
    const { Client, Pool } = await import('pg');
    const owner = new Client({ connectionString: databaseUrl });
    await owner.connect();
    const databaseName = (await owner.query('SELECT current_database() AS name')).rows[0].name;
    assert.match(databaseName, /test/i, 'test database name must contain test');
    await owner.query('DROP SCHEMA IF EXISTS mission_spine CASCADE');
    await owner.query(await readFile(migrationPath, 'utf8'));
    await owner.query(
      `INSERT INTO mission_spine.principal (id,kind,authenticated_by,verified) VALUES
       ('alice','human','fixture:alice',true),
       ('daria','human','fixture:daria',true),
       ('maker','human','fixture:maker',true),
       ('stranger','human','fixture:stranger',true),
       ('model','model','fixture:model',true)`
    );
    const pool = new Pool({ connectionString: databaseUrl, max: 8 });
    const spine = new Spine(pool);
    const api = missionCommands(spine);
    let serial = 0;
    const mission = 'mission-plasti-test';
    const meta = (actor, version = 1, suffix = 'cmd') => ({
      mission, actor, expectedPlanVersion: version,
      idempotencyKey: `${suffix}-${++serial}`
    });
    const human = id => ({ kind: 'principal', id });
    const token1 = newBearerToken(); const token2 = newBearerToken();
    const bearer1 = { kind: 'bearer', token: token1 };
    const bearer2 = { kind: 'bearer', token: token2 };
    const grant = (source, grantee, purpose, action, extra = {}) => ({
      id: `${source}-${grantee}-${purpose}-${action}`,
      grantee, purpose, action, provider: 'none', read: true, ...extra
    });
    const sourceGrants = source => [
      grant(source, 'alice', 'review', 'review_relation'),
      grant(source, 'alice', 'decision', 'amend_plan'),
      grant(source, 'alice', 'context', 'compile'),
      grant(source, 'daria', 'review', 'review_relation'),
      grant(source, 'maker', 'work', 'join')
    ];
    try {
      await api.createMission(meta(human('alice'), 1, 'found'), {
        name: 'Plasti', purpose: 'Test frost-tolerant planters with local makers',
        boundary: 'No durability claim without a real test',
        plan: 'Investigate conflicting cold test reports',
        acceptanceTest: 'Choose a bounded repeatable test'
      });
      await api.grantMandate(meta(human('alice'), 1, 'grant-review'),
        { principalId: 'daria', action: 'review' });
      await api.createIssue(meta(human('alice'), 1, 'issue'),
        { issueId: 'thin-wall', title: 'Does a thin wall crack in cold exposure?' });
      const privateOne = 'PVT-SENTINEL-A: The thin-wall planter cracked after a two-hour freezer test.';
      const privateTwo = 'PVT-SENTINEL-B: An identical thin-wall planter stayed intact in a two-hour freezer test.';
      await api.submitSource(meta(bearer1, 1, 'source-one'), {
        sourceId: 'source-one', body: privateOne,
        grants: [...sourceGrants('source-one'),
          grant('source-one', 'public', 'public-brief', 'publish', { publish: true })]
      });
      await api.submitSource(meta(bearer2, 1, 'source-two'), {
        sourceId: 'source-two', body: privateTwo, grants: sourceGrants('source-two')
      });
      const sourceIsolation = await spine.read({ mission, actor: bearer1 },
        tx => tx.query('SELECT body FROM source_payload WHERE mission_id=$1 AND source_id=$2',
          [mission, 'source-two']));
      assert.equal(sourceIsolation.rowCount, 0, 'a bearer receipt cannot read another source');
      const strangerRead = await spine.read({ mission, actor: human('stranger') },
        tx => tx.query('SELECT body FROM source_payload WHERE mission_id=$1', [mission]));
      assert.equal(strangerRead.rowCount, 0, 'another principal cannot read private payloads');
      const crossMission = await spine.read({ mission: 'unrelated-mission', actor: human('alice') },
        tx => tx.query('SELECT body FROM source_payload WHERE mission_id=$1', [mission]));
      assert.equal(crossMission.rowCount, 0, 'a bound other mission cannot read these payloads');

      await api.reviewRelation(meta(human('alice'), 1, 'relation-one'), {
        relationId: 'relation-one', sourceId: 'source-one', issueId: 'thin-wall',
        claimId: 'cold-claim', claimText: 'Thin walls may fail in short cold exposure', type: 'supports'
      });
      await api.reviewRelation(meta(human('alice'), 1, 'relation-two'), {
        relationId: 'relation-two', sourceId: 'source-two', issueId: 'thin-wall',
        claimId: 'cold-claim', type: 'disputes'
      });
      const decisionBody = n => ({ decisionId: `decision-${n}`,
        plan: `Repeat the test with controlled samples; proposal ${n}`,
        acceptanceTest: 'Record the short cold exposure and inspect for cracking',
        reason: 'Reports conflict and need a comparable test',
        unresolvedObjection: 'The two reports used different material batches',
        relationIds: ['relation-one', 'relation-two'] });
      const planRace = await Promise.allSettled([
        api.amendPlan(meta(human('alice'), 1, 'amend-a'), decisionBody('a')),
        api.amendPlan(meta(human('alice'), 1, 'amend-b'), decisionBody('b'))
      ]);
      assert.equal(planRace.filter(r => r.status === 'fulfilled').length, 1,
        'one plan amendment must win');
      assert.equal(planRace.filter(r => r.status === 'rejected').length, 1,
        'the stale amendment must fail');
      assert.equal(planRace.find(r => r.status === 'rejected').reason.code, 'version_conflict');
      const winningDecision = planRace.find(r => r.status === 'fulfilled').value.decisionId;
      const dueAt = new Date(Date.now() + 7 * 86400000).toISOString();
      await api.createWork(meta(human('alice'), 2, 'work'), {
        workId: 'cold-test-card', outcome: 'Run a bounded cold test on thin and thick samples',
        acceptanceTest: 'Record temperature, duration, sample count and visible cracking',
        riskClass: 1, requiresReservation: true, mentorId: 'alice', reviewerId: 'daria',
        capacityHours: 8, dueAt, compensation: 'Paid test materials only',
        rights: 'Report retained by maker; approved summary may be shared',
        stopCondition: 'Stop on unsafe handling or missing materials'
      });
      await api.createResourceAccount(meta(human('alice'), 2, 'account'),
        { accountId: 'materials', custodian: 'Fixture cooperative custodian' });
      await api.recordPledge(meta(human('alice'), 2, 'pledge'),
        { accountId: 'materials', amountCents: 60000 });
      await api.recordClearing(meta(human('alice'), 2, 'clearing'),
        { accountId: 'materials', amountCents: 8000, custodyReference: 'fixture-cleared-80' });
      const reserveA = { reservationId: 'reserve-a', accountId: 'materials',
        workId: 'cold-test-card', amountCents: 8000 };
      const reserveB = { ...reserveA, reservationId: 'reserve-b' };
      const reservationRace = await Promise.allSettled([
        api.reserve(meta(human('alice'), 2, 'reserve-a'), reserveA),
        api.reserve(meta(human('alice'), 2, 'reserve-b'), reserveB)
      ]);
      assert.equal(reservationRace.filter(r => r.status === 'fulfilled').length, 1,
        'one €80 reservation must win against €80 cleared');
      assert.equal(reservationRace.find(r => r.status === 'rejected').reason.code,
        'insufficient_cleared_funds');
      const winner = reservationRace.find(r => r.status === 'fulfilled').value.reservationId;
      await api.inviteWork(meta(human('alice'), 2, 'invite'),
        { invitationId: 'invite-maker', workId: 'cold-test-card', principalId: 'maker' });
      await api.offerWork(meta(human('maker'), 2, 'offer'),
        { offerId: 'offer-maker', workId: 'cold-test-card', capacityHours: 8, acceptedTerms: true });
      await api.approveCommitment(meta(human('alice'), 2, 'commit'),
        { commitmentId: 'commit-maker', offerId: 'offer-maker' });
      await api.submitResult(meta(human('maker'), 2, 'result'), {
        resultId: 'short-test-result', commitmentId: 'commit-maker',
        summary: 'Two of four thin samples cracked after short cold exposure',
        limits: 'Short bench test only; no full winter or field deployment evidence'
      });
      await assert.rejects(api.reviewResult(meta(human('maker'), 2, 'self-review'), {
        findingId: 'invalid-finding', resultId: 'short-test-result',
        conclusion: 'Cracks observed', limits: 'Only short test'
      }), error => ['forbidden', 'independent_review_required'].includes(error.code));
      await api.reviewResult(meta(human('daria'), 2, 'review-result'), {
        findingId: 'limited-finding', resultId: 'short-test-result',
        conclusion: 'Two of four thin samples cracked in this short test',
        limits: 'Cannot infer full winter durability or twenty installed planters'
      });
      const settled = await api.settleReservation(meta(human('alice'), 2, 'settle'), {
        reservationId: winner, spentCents: 7200, custodyReference: 'fixture-spent-72'
      });
      assert.equal(settled.releasedCents, 800);
      for (const sourceId of ['source-one', 'source-two']) {
        await api.issueReceipt(meta(human('daria'), 2, `receipt-${sourceId}`), {
          receiptId: `receipt-${sourceId}`, sourceId, findingId: 'limited-finding'
        });
      }
      assert.equal((await api.readReceipt({ mission, actor: bearer1 }, 'source-one')).length, 1);
      assert.equal((await api.readReceipt({ mission, actor: bearer2 }, 'source-two')).length, 1);
      const context = await api.compileContext(meta(human('alice'), 2, 'context'), {
        manifestId: 'review-context', issueId: 'thin-wall', purpose: 'context',
        audience: 'reviewer', action: 'compile', provider: 'none', modelVersion: 'none',
        policyVersion: 1, costBound: 0,
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      });
      assert.equal(context.packet.length, 2);
      assert.deepEqual(new Set(context.packet.map(x => x.relationType)), new Set(['supports', 'disputes']));
      const durable = await spine.read({ mission, actor: human('alice') }, async tx => {
        const rows = await Promise.all([
          tx.query('SELECT response::text AS text FROM command_dedupe WHERE mission_id=$1', [mission]),
          tx.query('SELECT source_refs::text AS text FROM audit WHERE mission_id=$1', [mission]),
          tx.query('SELECT subject_id AS text FROM outbox WHERE mission_id=$1', [mission])
        ]);
        return JSON.stringify(rows.flatMap(x => x.rows));
      });
      assert.ok(!durable.includes('PVT-SENTINEL-A') && !durable.includes('PVT-SENTINEL-B'),
        'raw private content must be absent from dedupe, audit and outbox');
      await api.publishSourceExcerpt(meta(human('alice'), 2, 'public-excerpt'), {
        releaseId: 'one-source-excerpt', sourceId: 'source-one',
        excerpt: 'The thin-wall planter cracked after a two-hour freezer test.'
      });
      const publicMeta = { mission, actor: { kind: 'public' } };
      assert.ok(await api.readPublicRelease(publicMeta, 'one-source-excerpt'));
      const publicRaw = await spine.read(publicMeta,
        tx => tx.query('SELECT body FROM source_payload WHERE mission_id=$1', [mission]));
      assert.equal(publicRaw.rowCount, 0, 'public release grant must not expose full originals');
      await api.revokeGrant(meta(bearer1, 2, 'revoke-public'), {
        sourceId: 'source-one', grantId: 'source-one-public-public-brief-publish'
      });
      assert.equal(await api.readPublicRelease(publicMeta, 'one-source-excerpt'), null,
        'public read must be suppressed immediately after revoke');
      const stale = await spine.read({ mission, actor: human('alice') }, async tx => {
        const work = await tx.query('SELECT status FROM work_package WHERE mission_id=$1 AND id=$2',
          [mission, 'cold-test-card']);
        const manifests = await tx.query(
          'SELECT invalidated_at FROM context_manifest WHERE mission_id=$1 AND id=$2',
          [mission, 'review-context']);
        return { work: work.rows[0], manifest: manifests.rows[0] };
      });
      assert.equal(stale.work.status, 'pending_reconfirmation');
      assert.ok(stale.manifest.invalidated_at);
      await api.correctSource(meta(bearer2, 2, 'correct-two'), {
        sourceId: 'source-two', expectedSourceRevision: 1,
        body: 'Correction: the intact sample was a thicker wall from another batch.'
      });
      assert.equal(winningDecision.startsWith('decision-'), true);
    } finally {
      await pool.end();
      await owner.end();
    }
  });
