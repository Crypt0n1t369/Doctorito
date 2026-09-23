import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { one, all } from '../src/db.js';
import { admit } from '../src/pipeline/admit.js';
import { prefilter } from '../src/pipeline/prefilter.js';
import { extract, reconcileWindow } from '../src/extract.js';
import { configFor } from '../src/config.js';
import { world, at, NOW } from './helpers.js';

const LORRY = 'We can send one flatbed lorry on Saturday to haul the cut branches to the yard';

async function offer(w, text, minutes, over = {}) {
  const live = one(w.db, 'select * from initiatives where initiative_id=?', w.initiative.initiative_id);
  return admit(w.db, {
    initiative: live, channel: over.channel ?? 'web', handle: over.handle ?? 'a@example.lv',
    text, now: at(minutes), ...over,
  });
}

describe('a clear offer binds and gets a specific answer', () => {
  test('the reply names the need, the quantity and the link', async () => {
    const w = world();
    const r = await offer(w, LORRY, 1);
    assert.equal(r.decision, 'bound');
    assert.equal(r.need_id, w.needOf('truck'));
    assert.match(r.reply, /flatbed lorry/i);
    assert.match(r.reply, /\/c\/[a-z0-9]+/);
    assert.ok(r.token);
  });

  test('two model requests, and the whole thing is fast', async () => {
    const w = world();
    const r = await offer(w, LORRY, 1);
    assert.equal(r.judgments.length, 2, 'one wide pass and one shortlist');
    assert.ok(r.latency_ms < 5000, `offer to reply took ${r.latency_ms} ms`);
  });
});

describe('a vague offer is asked exactly one question, and the answer is threaded', () => {
  test('"I can help sometime" gets a question, not a form and not a bind', async () => {
    const w = world();
    const r = await offer(w, 'I can help sometime, let me know what you need', 1, { handle: 'vague@example.lv' });
    assert.equal(r.decision, 'asked');
    assert.equal(all(w.db, 'select * from commitments').length, 0);
    assert.ok(r.reply.split('\n').filter((l) => l.trim().endsWith('?')).length <= 2, 'one question, not an interrogation');
  });

  test('the answer is read together with the message that prompted it', async () => {
    const w = world();
    const asked = await offer(w, 'I can help sometime', 1, { handle: 'vague@example.lv' });
    assert.equal(asked.decision, 'asked');

    const answered = await offer(w, 'four of us, Saturday morning, we have gloves', 30, { handle: 'vague@example.lv' });
    assert.notEqual(answered.decision, 'asked', 'the second message should not be treated as vague all over again');
    assert.equal(answered.need_id, w.needOf('vol'));

    const threaded = JSON.parse(one(w.db, 'select attachments from offers where offer_id=?', answered.offer_id).attachments);
    assert.equal(threaded.thread_of, asked.offer_id);
  });
});

describe('the other things that arrive in an inbox', () => {
  test('a question is answered from the initiative’s state', async () => {
    const w = world();
    const r = await offer(w, 'What time does it start on Saturday?', 1, { handle: 'asker@example.lv' });
    assert.equal(r.decision, 'answered');
    assert.match(r.reply, /volunteers|lorry|skip hire/i, 'the answer comes from the catalogue');
  });

  test('chatter is not an offer', async () => {
    const w = world();
    const r = await offer(w, 'thanks for organising this, great initiative', 1, { handle: 'fan@example.lv' });
    assert.ok(['not_an_offer', 'answered'].includes(r.decision), `got ${r.decision}`);
    assert.equal(all(w.db, 'select * from commitments').length, 0);
  });

  test('an offer of something nobody asked for is told so', async () => {
    const w = world();
    const r = await offer(w, 'We can supply 300 tulip bulbs and a piano', 1, { handle: 'tulips@example.lv' });
    assert.equal(r.decision, 'no_match');
    assert.equal(all(w.db, 'select * from commitments').length, 0);
  });

  test('a withdrawal releases the quantity it was holding', async () => {
    const w = world();
    const bound = await offer(w, LORRY, 1, { handle: 'hauler@example.lv' });
    assert.equal(bound.decision, 'bound');
    assert.equal(one(w.db, 'select qty_committed from needs where need_id=?', w.needOf('truck')).qty_committed, 1);

    const gone = await offer(w, 'sorry, something came up, I cannot make Saturday after all', 60, { handle: 'hauler@example.lv' });
    assert.equal(gone.decision, 'withdrawn');
    assert.equal(one(w.db, 'select state from commitments where commitment_id=?', bound.commitment_id).state, 'withdrawn');
    assert.equal(one(w.db, 'select qty_committed from needs where need_id=?', w.needOf('truck')).qty_committed, 0);
  });
});

describe('an oversubscribed need caps itself', () => {
  test('the quantity never goes past what was asked for', async () => {
    const w = world();
    for (let i = 0; i < 5; i++) await offer(w, LORRY, i + 1, { handle: `hauler${i}@example.lv` });
    const need = one(w.db, 'select * from needs where need_id=?', w.needOf('truck'));
    assert.ok(need.qty_committed <= need.qty_required, `${need.qty_committed} of ${need.qty_required}`);
  });
});

describe('every automated message says it is automated', () => {
  test('and gives one way to reach a person', async () => {
    const w = world();
    const cfg = configFor(w.initiative);
    const messages = [];
    for (const [i, text] of [LORRY, 'I can help sometime', 'What time does it start?', 'We can supply 300 tulip bulbs'].entries()) {
      const r = await offer(w, text, i + 1, { handle: `person${i}@example.lv` });
      if (r.reply) messages.push([text, r.reply]);
    }
    assert.ok(messages.length >= 3);
    for (const [text, reply] of messages) {
      assert.match(reply, /automatically|automātiski|автоматически/i, `no disclosure on the reply to "${text}"`);
      assert.ok(reply.includes(cfg.human_contact), `no way to reach a person on the reply to "${text}"`);
    }
  });
});

describe('the filter runs before the model', () => {
  test('needs out of window or out of radius never reach the ranking', () => {
    const w = world();
    const parsed = extract('I can come on 12 October in Ogre', { now: NOW });
    const extracted = { ...parsed, window: reconcileWindow(parsed.window, w.initiative, NOW), language: 'en' };

    const out = prefilter(w.db, { initiative: w.initiative, actorId: 'ac_none', extracted, now: NOW });
    assert.equal(out.counts.open_needs, 4);
    // Three of the four needs happen on 3 October; only the month-long money
    // need overlaps 12 October, and the certificate one is blocked besides.
    assert.equal(out.counts.eliminated, 3);
    assert.equal(out.candidates.length, 1);
    assert.equal(out.candidates[0].need_id, w.needOf('cash'));
  });
});
