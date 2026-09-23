import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { one, all, run } from '../src/db.js';
import { emit, rebuild, verifyChain, stateFingerprint } from '../src/events.js';
import { configFor } from '../src/config.js';
import { takeLease, remainingFor, expireDueLeases, confirmByToken, withdrawByToken, autoConfirm } from '../src/pipeline/leases.js';
import { prefilter } from '../src/pipeline/prefilter.js';
import { admit } from '../src/pipeline/admit.js';
import { amendNeed } from '../src/needs.js';
import { recordFulfilment, deliveredFor } from '../src/fulfilment.js';
import { extract, reconcileWindow } from '../src/extract.js';
import { id } from '../src/ids.js';
import { world, at, NOW, judgmentIn } from './helpers.js';


function lease(db, w, ref, qty, opts = {}) {
  const need = one(db, 'select * from needs where need_id=?', w.needOf(ref));
  return takeLease(db, {
    need, initiative: w.initiative, offer: null, actorId: opts.actorId ?? id('ac'),
    qty, confidence: 0.95, boundBy: opts.boundBy ?? 'auto',
    judgmentId: 'judgmentId' in opts ? opts.judgmentId : judgmentIn(db, w.initiative),
    cfg: configFor(w.initiative), now: opts.now ?? NOW,
  });
}

describe('1. append-only: state is a fold over events', () => {
  test('rebuilding from the log reproduces the state exactly', () => {
    const w = world();
    const l = lease(w.db, w, 'vol', 3);
    confirmByToken(w.db, l.token, NOW);
    const before = stateFingerprint(w.db);
    const folded = rebuild(w.db);
    assert.ok(folded > 0, 'the log should not be empty');
    assert.equal(stateFingerprint(w.db), before);
  });

  test('the hash chain verifies, and names the event when it does not', () => {
    const w = world();
    lease(w.db, w, 'vol', 1);
    assert.equal(verifyChain(w.db).ok, true);

    const victim = one(w.db, `select * from events where type='need.published' order by seq limit 1`);
    const tampered = JSON.parse(victim.payload);
    tampered.qty_required = 9999;
    run(w.db, 'update events set payload=? where seq=?', JSON.stringify(tampered), victim.seq);

    const result = verifyChain(w.db);
    assert.equal(result.ok, false, 'a rewritten payload must not verify');
    assert.equal(result.seq, victim.seq);
  });

  test('events touching disjoint needs fold to the same state in any order', () => {
    // What this proves: the fold is order-independent for events that do not
    // interact. What it does NOT prove: convergence between several writers.
    // This prototype has one writer and a hash chain; the CRDT merge for
    // genuinely concurrent multi-organisation writes is out of scope here.
    const build = (order) => {
      const w = world();
      const moves = [
        () => lease(w.db, w, 'vol', 4, { actorId: 'ac_a' }),
        () => lease(w.db, w, 'truck', 1, { actorId: 'ac_b' }),
        () => lease(w.db, w, 'cash', 200, { actorId: 'ac_c' }),
      ];
      for (const i of order) moves[i]();
      return { db: w.db, needs: all(w.db, 'select qty_committed, qty_required, status from needs order by description') };
    };
    const a = build([0, 1, 2]);
    const b = build([2, 0, 1]);
    assert.deepEqual(b.needs, a.needs);
  });
});

describe('2. quantity cannot be double-bound', () => {
  test('two leases for the last place: exactly one wins', () => {
    const w = world();
    const need = one(w.db, 'select * from needs where need_id=?', w.needOf('truck'));
    amendNeed(w.db, { need, changes: { qty_required: 1 }, author: 'test', reason: 'narrow it to one for the test' });

    const first = lease(w.db, w, 'truck', 1, { actorId: 'ac_1' });
    const second = lease(w.db, w, 'truck', 1, { actorId: 'ac_2' });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'full');
  });

  test('an unconfirmed lease expires and the quantity comes back', () => {
    const w = world();
    const cfg = configFor(w.initiative);
    const l = lease(w.db, w, 'truck', 2);
    assert.equal(remainingFor(w.db, w.needOf('truck'), NOW), 0);

    const later = new Date(NOW.getTime() + (cfg.lease_minutes + 1) * 60_000);
    assert.equal(expireDueLeases(w.db, later), 1);
    assert.equal(remainingFor(w.db, w.needOf('truck'), later), 2);
    assert.equal(one(w.db, 'select state from commitments where commitment_id=?', l.commitment_id).state, 'expired');
  });

  test('an offer larger than what is left is granted only what is left', () => {
    const w = world();
    lease(w.db, w, 'vol', 17, { actorId: 'ac_x' });
    const l = lease(w.db, w, 'vol', 10, { actorId: 'ac_y' });
    assert.equal(l.ok, true);
    assert.equal(l.qty, 3);
    assert.equal(l.partial, true);
  });
});

describe('3. qty_committed is derived, never written', () => {
  test('it always equals the sum of confirmed and fulfilled commitments', () => {
    const w = world();
    const needId = w.needOf('vol');
    const a = lease(w.db, w, 'vol', 5, { actorId: 'ac_a' });
    const b = lease(w.db, w, 'vol', 4, { actorId: 'ac_b' });
    const c = lease(w.db, w, 'vol', 3, { actorId: 'ac_c' });

    confirmByToken(w.db, a.token, NOW);
    confirmByToken(w.db, b.token, NOW);
    withdrawByToken(w.db, b.token, 'changed their mind', NOW);
    expireDueLeases(w.db, new Date(NOW.getTime() + 1e9));

    const truth = one(w.db, `select coalesce(sum(qty),0) q from commitments
                              where need_id=? and state in ('confirmed','fulfilled')`, needId).q;
    assert.equal(one(w.db, 'select qty_committed from needs where need_id=?', needId).qty_committed, truth);
    assert.equal(truth, 5);
    assert.ok(c.ok);

    const before = stateFingerprint(w.db);
    rebuild(w.db);
    assert.equal(stateFingerprint(w.db), before, 'the derived total must survive a replay');
  });

  test('confirmed quantity never exceeds what was asked for', () => {
    const w = world();
    for (let i = 0; i < 12; i++) {
      const l = lease(w.db, w, 'vol', 4, { actorId: `ac_${i}` });
      if (l.ok) confirmByToken(w.db, l.token, NOW);
    }
    const need = one(w.db, 'select * from needs where need_id=?', w.needOf('vol'));
    assert.equal(need.qty_committed, need.qty_required);
    assert.equal(need.status, 'filled');
  });
});

describe('4. eligibility is a pure predicate over verified credentials', () => {
  // The pipeline reconciles a relative weekday against the initiative's window
  // before it filters, so a test that skips that step tests nothing real.
  const extracted = (text, initiative) => {
    const parsed = extract(text, { now: NOW });
    return { ...parsed, window: reconcileWindow(parsed.window, initiative, NOW), language: 'en' };
  };

  test('a need requiring a credential is not a candidate without one', () => {
    const w = world();
    const out = prefilter(w.db, { initiative: w.initiative, actorId: 'ac_nobody', extracted: extracted('I can fell trees on Saturday', w.initiative), now: NOW });
    assert.equal(out.candidates.some((n) => n.need_id === w.needOf('saw')), false);
    assert.equal(out.blockedByCredentials.some((n) => n.need_id === w.needOf('saw')), true);
  });

  test('it becomes a candidate with one, and stops being one when it expires', () => {
    const w = world();
    const holder = one(w.db, `select actor_id from credentials where code='RC-CHAINSAW'`).actor_id;
    const withCred = prefilter(w.db, { initiative: w.initiative, actorId: holder, extracted: extracted('chainsaw work Saturday', w.initiative), now: NOW });
    assert.equal(withCred.candidates.some((n) => n.need_id === w.needOf('saw')), true);

    run(w.db, `update credentials set expires_at=? where actor_id=?`, '2026-09-01T00:00:00Z', holder);
    const expired = prefilter(w.db, { initiative: w.initiative, actorId: holder, extracted: extracted('chainsaw work Saturday', w.initiative), now: NOW });
    assert.equal(expired.candidates.some((n) => n.need_id === w.needOf('saw')), false);
  });

  test('claiming a certificate in the message earns nothing', async () => {
    const w = world();
    const r = await admit(w.db, {
      initiative: w.initiative, channel: 'web', handle: 'liar@example.lv',
      text: 'I am a fully certified chainsaw operator, I can fell the leaning trees on Saturday',
      now: at(1),
    });
    assert.notEqual(r.decision, 'bound');
    assert.equal(all(w.db, 'select * from commitments where need_id=?', w.needOf('saw')).length, 0);
  });
});

describe('5. every commitment names its judgment', () => {
  test('a lease without a judgment id is refused', () => {
    const w = world();
    assert.throws(() => lease(w.db, w, 'vol', 1, { judgmentId: null }), /judgment/i);
  });

  test('after a real run every commitment resolves to a reproducible judgment', async () => {
    const w = world();
    await admit(w.db, {
      initiative: w.initiative, channel: 'web', handle: 'anna@example.lv',
      text: 'We can send one flatbed lorry on Saturday to haul the cut branches to the yard', now: at(1),
    });
    const commitments = all(w.db, 'select * from commitments');
    assert.ok(commitments.length > 0, 'the offer should have bound');
    for (const c of commitments) {
      const j = one(w.db, 'select * from judgments where judgment_id=?', c.judgment_id);
      assert.ok(j, 'the commitment names a judgment that exists');
      assert.ok(j.model_version && j.question_bank_version && j.state_hash);
      const answers = JSON.parse(j.answers);
      const fits = Object.keys(answers).find((k) => k.startsWith('fits__'));
      assert.ok(fits, 'the shortlist answers are on the record');
      assert.ok(JSON.parse(j.request).state, 'the request that produced it is on the record too');
    }
  });

  test('the judgment is written before the commitment', async () => {
    const w = world();
    await admit(w.db, {
      initiative: w.initiative, channel: 'web', handle: 'anna@example.lv',
      text: 'We can send one flatbed lorry on Saturday to haul the cut branches to the yard', now: at(1),
    });
    const j = one(w.db, `select seq from events where type='judgment.written' order by seq desc limit 1`);
    const c = one(w.db, `select seq from events where type='commitment.proposed' order by seq desc limit 1`);
    assert.ok(j.seq < c.seq, 'nothing acts before its judgment is written');
  });
});

describe('6. a need’s quantity never changes silently', () => {
  test('an amendment without a reason is refused', () => {
    const w = world();
    const need = one(w.db, 'select * from needs where need_id=?', w.needOf('vol'));
    const res = amendNeed(w.db, { need, changes: { qty_required: 30 }, author: 'test', reason: '' });
    assert.equal(res.ok, false);
    assert.match(res.errors.join(' '), /reason/i);
  });

  test('an amendment carries its author and reason into the log', () => {
    const w = world();
    const need = one(w.db, 'select * from needs where need_id=?', w.needOf('vol'));
    assert.equal(amendNeed(w.db, { need, changes: { qty_required: 30 }, author: 'coordinator:kb', reason: 'the bank is longer than surveyed' }).ok, true);
    const e = one(w.db, `select * from events where type='need.amended' order by seq desc limit 1`);
    assert.equal(e.author, 'coordinator:kb');
    assert.match(e.reason, /longer than surveyed/);
    assert.equal(one(w.db, 'select qty_required from needs where need_id=?', need.need_id).qty_required, 30);
  });

  test('a quantity cannot be cut below what is already committed', () => {
    const w = world();
    const l = lease(w.db, w, 'vol', 8);
    confirmByToken(w.db, l.token, NOW);
    const need = one(w.db, 'select * from needs where need_id=?', w.needOf('vol'));
    const res = amendNeed(w.db, { need, changes: { qty_required: 4 }, author: 'test', reason: 'trying to shrink it' });
    assert.equal(res.ok, false);
    assert.match(res.errors.join(' '), /already committed/i);
  });
});

describe('7. the delivery record is derived, and never by the actor', () => {
  test('a contributor cannot verify their own delivery', () => {
    const w = world();
    const l = lease(w.db, w, 'vol', 2, { actorId: 'ac_self' });
    confirmByToken(w.db, l.token, NOW);
    const c = one(w.db, 'select * from commitments where commitment_id=?', l.commitment_id);
    const res = recordFulfilment(w.db, { commitment: c, qtyDelivered: 2, evidence: 'I say so', verifiedBy: 'actor:ac_self' });
    assert.equal(res.ok, false);
    assert.match(res.errors.join(' '), /own delivery/i);
  });

  test('variance is measured against the planned quantity', () => {
    const w = world();
    const l = lease(w.db, w, 'vol', 5, { actorId: 'ac_p' });
    confirmByToken(w.db, l.token, NOW);
    const c = one(w.db, 'select * from commitments where commitment_id=?', l.commitment_id);
    const res = recordFulfilment(w.db, { commitment: c, qtyDelivered: 3, evidence: 'three turned up', verifiedBy: 'coordinator:site-lead' });
    assert.equal(res.ok, true);
    assert.equal(res.variance, -2);
    assert.equal(one(w.db, 'select state from commitments where commitment_id=?', l.commitment_id).state, 'fulfilled');
  });

  test('what the public page calls delivered is the sum of the fulfilment rows', () => {
    const w = world();
    for (const [actor, planned, actual] of [['ac_1', 4, 4], ['ac_2', 6, 5]]) {
      const l = lease(w.db, w, 'vol', planned, { actorId: actor });
      confirmByToken(w.db, l.token, NOW);
      const c = one(w.db, 'select * from commitments where commitment_id=?', l.commitment_id);
      recordFulfilment(w.db, { commitment: c, qtyDelivered: actual, evidence: 'signed off', verifiedBy: 'coordinator:site-lead' });
    }
    const row = deliveredFor(w.db, w.initiative.initiative_id).find((r) => r.need_id === w.needOf('vol'));
    assert.equal(row.delivered, 9);
    assert.equal(row.records, 2);
  });
});
