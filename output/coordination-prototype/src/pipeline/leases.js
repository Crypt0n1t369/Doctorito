import { tx, one, all } from '../db.js';
import { emit } from '../events.js';
import { id, token } from '../ids.js';

/**
 * Invariant 2: quantity cannot be double-bound.
 *
 * A proposed commitment takes a lease on its need's remaining quantity. The
 * whole read-decide-write runs inside one immediate transaction, so two offers
 * arriving 200 ms apart cannot both be told yes for the last place. Unconfirmed
 * leases expire and the quantity returns to the pool.
 */

export function remainingFor(db, needId, now = new Date()) {
  const need = one(db, 'select * from needs where need_id=?', needId);
  if (!need) return 0;
  const leased = one(db,
    `select coalesce(sum(qty),0) q from commitments
      where need_id=? and state='proposed' and (lease_expires_at is null or lease_expires_at > ?)`,
    needId, now.toISOString()).q;
  const remaining = need.qty_required - need.qty_committed - leased;
  return need.allow_overcommit ? Math.max(remaining, need.qty_required) : remaining;
}

/**
 * Take a lease. Returns { ok, commitment_id, token, qty } or { ok:false, reason }.
 * Must be handed a judgment id: a commitment that cannot name the judgment that
 * produced it is a commitment we cannot defend.
 */
export function takeLease(db, {
  need, initiative, offer = null, actorId, qty, confidence, boundBy, judgmentId, cfg, now = new Date(),
}) {
  if (!judgmentId) throw new Error('takeLease: refusing to bind without a judgment id');

  return tx(db, () => {
    expireDueLeases(db, now, need.need_id);

    const remaining = remainingFor(db, need.need_id, now);
    if (remaining <= 0) return { ok: false, reason: 'full', remaining: 0 };

    const granted = need.allow_overcommit ? qty : Math.min(qty, remaining);
    if (granted <= 0) return { ok: false, reason: 'full', remaining };

    const commitmentId = id('cm');
    const tok = token();
    const leaseUntil = new Date(now.getTime() + cfg.lease_minutes * 60_000).toISOString();

    emit(db, {
      type: 'commitment.proposed',
      initiative_id: initiative.initiative_id,
      author: boundBy,
      payload: {
        commitment_id: commitmentId, need_id: need.need_id,
        initiative_id: initiative.initiative_id, offer_id: offer?.offer_id ?? null,
        actor_id: actorId, qty: granted, confidence, bound_by: boundBy,
        judgment_id: judgmentId, token: tok, lease_expires_at: leaseUntil,
      },
      at: now.toISOString(),
    });

    return { ok: true, commitment_id: commitmentId, token: tok, qty: granted, partial: granted < qty, lease_expires_at: leaseUntil };
  });
}

/** Class 1 binds stand on their own; anything dearer waits for a tap. */
export function autoConfirm(db, commitmentId, now = new Date()) {
  const c = one(db, 'select * from commitments where commitment_id=?', commitmentId);
  if (!c || c.state !== 'proposed') return false;
  emit(db, {
    type: 'commitment.confirmed',
    initiative_id: c.initiative_id,
    author: 'system',
    payload: { commitment_id: commitmentId, need_id: c.need_id },
    at: now.toISOString(),
  });
  return true;
}

export function confirmByToken(db, tok, now = new Date()) {
  const c = one(db, 'select * from commitments where token=?', tok);
  if (!c) return { ok: false, reason: 'unknown' };
  if (c.state === 'confirmed' || c.state === 'fulfilled') return { ok: true, already: true, commitment: c };
  if (c.state !== 'proposed') return { ok: false, reason: c.state, commitment: c };
  if (c.lease_expires_at && c.lease_expires_at <= now.toISOString()) {
    return { ok: false, reason: 'expired', commitment: c };
  }
  emit(db, {
    type: 'commitment.confirmed', initiative_id: c.initiative_id, author: `actor:${c.actor_id}`,
    payload: { commitment_id: c.commitment_id, need_id: c.need_id }, at: now.toISOString(),
  });
  return { ok: true, commitment: one(db, 'select * from commitments where commitment_id=?', c.commitment_id) };
}

/**
 * Withdrawal has to be exactly as easy as confirmation. A withdrawal people
 * cannot make is a no-show found out about on the day, and a no-show is a
 * poisoned training label.
 */
export function withdrawByToken(db, tok, reason = null, now = new Date()) {
  const c = one(db, 'select * from commitments where token=?', tok);
  if (!c) return { ok: false, reason: 'unknown' };
  if (['withdrawn', 'expired', 'failed'].includes(c.state)) return { ok: true, already: true, commitment: c };
  emit(db, {
    type: 'commitment.withdrawn', initiative_id: c.initiative_id, author: `actor:${c.actor_id}`,
    reason, payload: { commitment_id: c.commitment_id, need_id: c.need_id }, at: now.toISOString(),
  });
  return { ok: true, commitment: one(db, 'select * from commitments where commitment_id=?', c.commitment_id) };
}

/** Sweep. Called by the worker and before every lease attempt on the same need. */
export function expireDueLeases(db, now = new Date(), needId = null) {
  const rows = needId
    ? all(db, `select * from commitments where need_id=? and state='proposed' and lease_expires_at <= ?`, needId, now.toISOString())
    : all(db, `select * from commitments where state='proposed' and lease_expires_at <= ?`, now.toISOString());
  for (const c of rows) {
    emit(db, {
      type: 'commitment.expired', initiative_id: c.initiative_id, author: 'system',
      reason: 'lease expired unconfirmed',
      payload: { commitment_id: c.commitment_id, need_id: c.need_id }, at: now.toISOString(),
    });
  }
  return rows.length;
}
