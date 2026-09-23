import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { one, all } from '../src/db.js';
import { admit } from '../src/pipeline/admit.js';
import { queueItems, offerDetail, applyQueueAction, overrideStats } from '../src/queue.js';
import { world, at } from './helpers.js';

const CHAINSAW = 'I can fell the three leaning trees over the path on Saturday, I hold the certificate';

async function queued(w) {
  const holder = one(w.db, `select actor_id from credentials where code='RC-CHAINSAW'`).actor_id;
  const contact = one(w.db, 'select * from contacts where actor_id=?', holder);
  const r = await admit(w.db, {
    initiative: w.initiative, channel: contact.channel, handle: contact.handle,
    text: CHAINSAW, now: at(1),
  });
  assert.equal(r.decision, 'queued');
  return r;
}

describe('the console shows the coordinator what the model was choosing between', () => {
  test('the shortlist is reconstructed from the stored judgments', async () => {
    const w = world();
    const r = await queued(w);

    const items = queueItems(w.db, w.initiative.initiative_id);
    assert.equal(items.length, 1);
    assert.equal(items[0].offer_id, r.offer_id);

    const detail = offerDetail(w.db, r.offer_id);
    assert.equal(detail.offer.raw_text, CHAINSAW, 'shown verbatim');
    assert.ok(detail.shortlist.length >= 1);
    assert.equal(detail.shortlist[0].need.need_id, w.needOf('saw'));
    for (const c of detail.shortlist) {
      assert.ok(c.fits !== null && c.confidence !== null, 'every candidate carries its numbers');
    }
    assert.ok(detail.extracted, 'the fields the parsers found are on screen too');
    assert.ok(detail.screen.is_offer > 0.5);
    assert.ok(detail.judgment_id, 'there is a judgment to write the label against');
  });
});

describe('every action leaves a label', () => {
  test('binding from the console records agreement with the model', async () => {
    const w = world();
    const r = await queued(w);
    const detail = offerDetail(w.db, r.offer_id);

    const result = applyQueueAction(w.db, {
      offerId: r.offer_id, action: 'bind', needId: detail.model_pick,
      seconds: 4.2, coordinator: 'kb',
    });
    assert.equal(result.ok, true);

    const ov = one(w.db, 'select * from overrides where offer_id=?', r.offer_id);
    assert.equal(ov.action, 'bind');
    assert.equal(ov.agreed, 1);
    assert.equal(ov.coordinator, 'kb');
    assert.equal(ov.seconds_taken, 4.2);
    assert.equal(ov.judgment_id, detail.judgment_id);

    const c = one(w.db, 'select * from commitments where offer_id=?', r.offer_id);
    assert.equal(c.bound_by, 'coordinator:kb');
    assert.equal(c.judgment_id, detail.judgment_id, 'a console bind names its judgment too');
    assert.equal(c.need_id, w.needOf('saw'));
  });

  test('binding somewhere else records the disagreement', async () => {
    const w = world();
    const r = await queued(w);
    const detail = offerDetail(w.db, r.offer_id);

    applyQueueAction(w.db, { offerId: r.offer_id, action: 'bind', needId: w.needOf('vol'), seconds: 6, coordinator: 'kb' });

    const ov = one(w.db, 'select * from overrides where offer_id=?', r.offer_id);
    assert.equal(ov.agreed, 0);
    assert.equal(ov.chosen_need_id, w.needOf('vol'));
    assert.equal(ov.model_need_id, detail.model_pick);
  });

  test('the actions that do not bind still leave a label', async () => {
    for (const action of ['not_an_offer', 'ask', 'reject']) {
      const w = world();
      const r = await queued(w);
      const result = applyQueueAction(w.db, { offerId: r.offer_id, action, note: 'which day?', seconds: 3, coordinator: 'kb' });
      assert.equal(result.ok, true, action);
      assert.equal(one(w.db, 'select count(*) c from overrides').c, 1, action);
      assert.equal(all(w.db, 'select * from commitments').length, 0, action);
    }
  });

  test('an item cannot be cleared twice', async () => {
    const w = world();
    const r = await queued(w);
    assert.equal(applyQueueAction(w.db, { offerId: r.offer_id, action: 'not_an_offer', coordinator: 'kb' }).ok, true);
    const second = applyQueueAction(w.db, { offerId: r.offer_id, action: 'reject', coordinator: 'kb' });
    assert.equal(second.ok, false);
    assert.match(second.error, /already/);
  });

  test('the console reports what its labels are worth so far', async () => {
    const w = world();
    const r = await queued(w);
    const detail = offerDetail(w.db, r.offer_id);
    applyQueueAction(w.db, { offerId: r.offer_id, action: 'bind', needId: detail.model_pick, seconds: 5, coordinator: 'kb' });

    const stats = overrideStats(w.db, w.initiative.initiative_id);
    assert.equal(stats.labels, 1);
    assert.equal(stats.agreed, 1);
    assert.equal(stats.disagreed, 0);
    assert.equal(stats.median_seconds, 5);
  });
});

describe('a console bind still obeys the ledger', () => {
  test('it cannot overfill a need', async () => {
    const w = world();
    const r = await queued(w);
    const detail = offerDetail(w.db, r.offer_id);
    applyQueueAction(w.db, { offerId: r.offer_id, action: 'bind', needId: detail.model_pick, coordinator: 'kb' });

    const need = one(w.db, 'select * from needs where need_id=?', w.needOf('saw'));
    assert.ok(need.qty_committed <= need.qty_required);
  });
});
