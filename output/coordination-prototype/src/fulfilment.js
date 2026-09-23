import { one, all } from './db.js';
import { emit } from './events.js';
import { id } from './ids.js';

/**
 * Invariant 7: the delivery record is derived from fulfilments, never written
 * directly, and never by the actor themselves.
 *
 * The prototype records what was delivered and computes no score from it. A
 * reputation model built on a hundred data points is worse than none, and the
 * variance against the planned quantity is the training label we actually want.
 */
export function recordFulfilment(db, { commitment, qtyDelivered, evidence, verifiedBy }) {
  if (!verifiedBy) return { ok: false, errors: ['A fulfilment needs a verifier.'] };
  if (verifiedBy === `actor:${commitment.actor_id}` || verifiedBy === commitment.actor_id) {
    return { ok: false, errors: ['A contributor cannot verify their own delivery.'] };
  }
  if (!['proposed', 'confirmed'].includes(commitment.state)) {
    return { ok: false, errors: [`This commitment is ${commitment.state}; there is nothing to deliver.`] };
  }
  const qty = Number(qtyDelivered);
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, errors: ['Delivered quantity must be a number.'] };

  const fulfilmentId = id('fl');
  emit(db, {
    type: 'fulfilment.recorded', initiative_id: commitment.initiative_id, author: verifiedBy,
    payload: {
      fulfilment_id: fulfilmentId, commitment_id: commitment.commitment_id,
      need_id: commitment.need_id, qty_delivered: qty,
      variance: qty - commitment.qty, evidence, verified_by: verifiedBy,
    },
  });
  return { ok: true, fulfilment_id: fulfilmentId, variance: qty - commitment.qty };
}

/** A no-show. Recorded as what it is, because a poisoned label is worse than a gap. */
export function markFailed(db, { commitment, reason, author }) {
  if (!reason) return { ok: false, errors: ['Say why. It becomes a training label.'] };
  emit(db, {
    type: 'commitment.failed', initiative_id: commitment.initiative_id, author, reason,
    payload: { commitment_id: commitment.commitment_id, need_id: commitment.need_id },
  });
  return { ok: true };
}

/** Derived. Displayed as a record of what happened, never reduced to a score. */
export function deliveryRecord(db, actorId) {
  const rows = all(db, `
    select c.commitment_id, c.qty, c.state, n.description, n.unit,
           f.qty_delivered, f.variance, f.verified_at, f.verified_by
      from commitments c
      join needs n on n.need_id = c.need_id
      left join fulfilments f on f.commitment_id = c.commitment_id
     where c.actor_id = ?
     order by c.created_at desc`, actorId);
  return {
    commitments: rows.length,
    fulfilled: rows.filter((r) => r.state === 'fulfilled').length,
    withdrawn: rows.filter((r) => r.state === 'withdrawn').length,
    failed: rows.filter((r) => r.state === 'failed').length,
    rows,
  };
}

/** What the public page shows as delivered. Derived, in one query. */
export function deliveredFor(db, initiativeId) {
  return all(db, `
    select n.need_id, n.description, n.unit,
           coalesce(sum(f.qty_delivered), 0) as delivered,
           count(f.fulfilment_id) as records
      from needs n
      left join commitments c on c.need_id = n.need_id
      left join fulfilments f on f.commitment_id = c.commitment_id
     where n.initiative_id = ?
     group by n.need_id
     order by n.published_at`, initiativeId);
}

export function commitmentByToken(db, tok) {
  return one(db, 'select * from commitments where token=?', tok);
}
