import { one, all, tx } from './db.js';
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
  const qty = Number(qtyDelivered);
  if (!Number.isFinite(qty) || qty < 0) return { ok: false, errors: ['Delivered quantity must be a number.'] };

  // Read again inside the transaction: the object a caller holds can be stale,
  // and a commitment withdrawn a minute ago must not be marked delivered now.
  return tx(db, () => {
    const c = one(db, 'select * from commitments where commitment_id=?', commitment.commitment_id);
    if (!c) return { ok: false, errors: ['No such commitment.'] };
    if (verifiedBy === `actor:${c.actor_id}` || verifiedBy === c.actor_id) {
      return { ok: false, errors: ['A contributor cannot verify their own delivery.'] };
    }
    // Only a confirmed commitment can be delivered. A proposal nobody confirmed,
    // or a lease that expired, was never a promise, so it cannot be kept.
    if (c.state !== 'confirmed') {
      return { ok: false, errors: [`This commitment is ${c.state}; only a confirmed one can be delivered.`] };
    }

    const fulfilmentId = id('fl');
    emit(db, {
      type: 'fulfilment.recorded', initiative_id: c.initiative_id, author: verifiedBy,
      payload: {
        fulfilment_id: fulfilmentId, commitment_id: c.commitment_id,
        need_id: c.need_id, qty_delivered: qty,
        variance: qty - c.qty, evidence, verified_by: verifiedBy,
      },
    });
    return { ok: true, fulfilment_id: fulfilmentId, variance: qty - c.qty };
  });
}

/**
 * A no-show. Recorded as what it is, because a poisoned label is worse than a
 * gap. Only a confirmed commitment can fail: one that was delivered did not,
 * and correcting a delivery is a dispute with its own author and reason.
 */
export function markFailed(db, { commitment, reason, author }) {
  if (!reason) return { ok: false, errors: ['Say why. It becomes a training label.'] };
  return tx(db, () => {
    const c = one(db, 'select * from commitments where commitment_id=?', commitment.commitment_id);
    if (!c) return { ok: false, errors: ['No such commitment.'] };
    if (c.state !== 'confirmed') return { ok: false, errors: [`This commitment is ${c.state}; only a confirmed one can fail.`] };
    emit(db, {
      type: 'commitment.failed', initiative_id: c.initiative_id, author, reason,
      payload: { commitment_id: c.commitment_id, need_id: c.need_id },
    });
    return { ok: true };
  });
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
