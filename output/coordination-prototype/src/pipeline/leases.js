import { tx, one, all } from '../db.js';
import { emit } from '../events.js';
import { id, token } from '../ids.js';
import { mayAutoBind, thresholdFor } from '../config.js';

/**
 * Invariant 2: quantity cannot be double-bound.
 *
 * A proposed commitment takes a lease on its need's remaining quantity. The
 * whole read-decide-write runs inside one immediate transaction, so two offers
 * arriving 200 ms apart cannot both be told yes for the last place. Unconfirmed
 * leases expire and the quantity returns to the pool.
 *
 * This file is also the command boundary for commitments (docs/OUTCOMES.md, C2).
 * Every path that creates, confirms or ends one — the pipeline, the coordinator
 * console, an outbound invitation, a contributor's link, shadow mode — comes
 * through these functions, and each check runs again inside the transaction
 * that writes, against rows read inside it. A caller cannot skip a check by
 * having made it earlier: what was true when the offer arrived may not be true
 * by the time anyone acts on it.
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
 * Eligibility is a pure predicate over verified credentials (invariant 4). It is
 * the same predicate on every path: a reviewer who decides an offer matches a
 * need has not thereby granted the certificate the need requires.
 */
export function missingCredentials(db, actorId, need, now = new Date()) {
  const quals = JSON.parse(need.qualifications ?? '[]');
  return quals.filter((code) => !one(db,
    `select 1 from credentials where actor_id=? and code=? and (expires_at is null or expires_at > ?)`,
    actorId, code, now.toISOString()));
}

/**
 * The project's side of a commitment (O6). The contributor's side is their own
 * offer, their acceptance of an invitation, or their confirmation; this is the
 * authority on the other side, and it depends on the path.
 */
function projectAuthority({ boundBy, principal, need, initiative, confidence, cfg }) {
  const path = String(boundBy ?? '');
  if (path === 'auto' || path === 'outbound') {
    // A standing authorization from the convener, which exists only where an
    // automatic bind is allowed at all, and only while the one switch is on.
    if (!mayAutoBind(need.risk_class)) return 'risk_class_3';
    if (initiative.autobind !== 1) return 'autobind_off';
    if (path === 'auto' && !(confidence >= thresholdFor(cfg, need.risk_class))) return 'below_threshold';
    return null;
  }
  if (path.startsWith('coordinator:')) {
    return principal?.role === 'coordinator' ? null : 'not_a_coordinator';
  }
  return 'unknown_path';
}

/**
 * Take a lease. Returns { ok, commitment_id, token, qty } or { ok:false, reason }.
 * Must be handed a judgment that exists in the same initiative: a commitment
 * that cannot name the judgment that produced it is one we cannot defend.
 */
export function takeLease(db, {
  need, initiative, offer = null, actorId, qty, confidence, boundBy, principal = null, judgmentId, cfg, now = new Date(),
}) {
  if (!judgmentId) throw new Error('takeLease: refusing to bind without a judgment id');

  return tx(db, () => {
    const n = one(db, 'select * from needs where need_id=?', need.need_id);
    const init = one(db, 'select * from initiatives where initiative_id=?', initiative.initiative_id);
    if (!n || !init || n.initiative_id !== init.initiative_id) return { ok: false, reason: 'not_found' };
    const j = one(db, 'select initiative_id, degraded_cause from judgments where judgment_id=?', judgmentId);
    if (!j) return { ok: false, reason: 'no_such_judgment' };
    if (j.initiative_id !== init.initiative_id) return { ok: false, reason: 'judgment_from_another_initiative' };
    // A fallback's reading can put an offer in front of a person. It is never
    // the reason something binds on its own (docs/OUTCOMES.md, C4).
    if (j.degraded_cause && !String(boundBy ?? '').startsWith('coordinator:')) return { ok: false, reason: 'degraded_judgment' };
    if (init.status !== 'open') return { ok: false, reason: 'initiative_not_open' };
    if (n.status === 'closed') return { ok: false, reason: 'closed' };

    const denied = projectAuthority({ boundBy, principal, need: n, initiative: init, confidence, cfg });
    if (denied) return { ok: false, reason: denied };
    const missing = missingCredentials(db, actorId, n, now);
    if (missing.length) return { ok: false, reason: 'credential_required', missing };

    expireDueLeases(db, now, n.need_id);

    const remaining = remainingFor(db, n.need_id, now);
    if (remaining <= 0) return { ok: false, reason: 'full', remaining: 0 };

    const granted = n.allow_overcommit ? qty : Math.min(qty, remaining);
    if (granted <= 0) return { ok: false, reason: 'full', remaining };

    const commitmentId = id('cm');
    const tok = token();
    const leaseUntil = new Date(now.getTime() + cfg.lease_minutes * 60_000).toISOString();

    emit(db, {
      type: 'commitment.proposed',
      initiative_id: init.initiative_id,
      author: boundBy,
      payload: {
        commitment_id: commitmentId, need_id: n.need_id,
        initiative_id: init.initiative_id, offer_id: offer?.offer_id ?? null,
        actor_id: actorId, qty: granted, confidence, bound_by: boundBy,
        judgment_id: judgmentId, token: tok, lease_expires_at: leaseUntil,
      },
      at: now.toISOString(),
    });

    return { ok: true, commitment_id: commitmentId, token: tok, qty: granted, partial: granted < qty, lease_expires_at: leaseUntil };
  });
}

/**
 * What must still be true for a proposed commitment to become a confirmed one.
 * Checked at confirmation, not only at proposal: a need can close, and a
 * credential can expire, while a lease is waiting for a tap.
 */
function confirmable(db, c, now) {
  if (c.lease_expires_at && c.lease_expires_at <= now.toISOString()) return 'expired';
  const need = one(db, 'select * from needs where need_id=?', c.need_id);
  if (!need || need.status === 'closed') return 'closed';
  if (missingCredentials(db, c.actor_id, need, now).length) return 'credential_required';
  if (!mayAutoBind(need.risk_class) && !String(c.bound_by ?? '').startsWith('coordinator:')) return 'review_required';
  // A proposal the machine made stands on the convener's standing authority,
  // and the one switch withdraws that authority for everything not yet
  // confirmed, not only for what arrives after it was pulled.
  if (c.bound_by === 'auto' || c.bound_by === 'outbound') {
    const init = one(db, 'select autobind from initiatives where initiative_id=?', c.initiative_id);
    if (init?.autobind !== 1) return 'paused';
  }
  return null;
}

/** Class 1 binds stand on their own; anything dearer waits for a tap. */
export function autoConfirm(db, commitmentId, now = new Date()) {
  return tx(db, () => {
    const c = one(db, 'select * from commitments where commitment_id=?', commitmentId);
    if (!c || c.state !== 'proposed' || confirmable(db, c, now)) return false;
    emit(db, {
      type: 'commitment.confirmed',
      initiative_id: c.initiative_id,
      author: 'system',
      payload: { commitment_id: commitmentId, need_id: c.need_id },
      at: now.toISOString(),
    });
    return true;
  });
}

export function confirmByToken(db, tok, now = new Date()) {
  return tx(db, () => {
    const c = one(db, 'select * from commitments where token=?', tok);
    if (!c) return { ok: false, reason: 'unknown' };
    if (c.state === 'confirmed' || c.state === 'fulfilled') return { ok: true, already: true, commitment: c };
    if (c.state !== 'proposed') return { ok: false, reason: c.state, commitment: c };
    const blocked = confirmable(db, c, now);
    if (blocked) return { ok: false, reason: blocked, commitment: c };
    emit(db, {
      type: 'commitment.confirmed', initiative_id: c.initiative_id, author: `actor:${c.actor_id}`,
      payload: { commitment_id: c.commitment_id, need_id: c.need_id }, at: now.toISOString(),
    });
    return { ok: true, commitment: one(db, 'select * from commitments where commitment_id=?', c.commitment_id) };
  });
}

/**
 * Withdrawal has to be exactly as easy as confirmation. A withdrawal people
 * cannot make is a no-show found out about on the day, and a no-show is a
 * poisoned training label. What has been delivered cannot be withdrawn: a
 * correction to a delivery is a dispute, with its own author and reason.
 */
export function withdrawByToken(db, tok, reason = null, now = new Date()) {
  return tx(db, () => {
    const c = one(db, 'select * from commitments where token=?', tok);
    if (!c) return { ok: false, reason: 'unknown' };
    if (['withdrawn', 'expired', 'failed'].includes(c.state)) return { ok: true, already: true, commitment: c };
    if (c.state === 'fulfilled') return { ok: false, reason: 'delivered', commitment: c };
    emit(db, {
      type: 'commitment.withdrawn', initiative_id: c.initiative_id, author: `actor:${c.actor_id}`,
      reason, payload: { commitment_id: c.commitment_id, need_id: c.need_id }, at: now.toISOString(),
    });
    return { ok: true, commitment: one(db, 'select * from commitments where commitment_id=?', c.commitment_id) };
  });
}

/** Sweep. Called by the worker and before every lease attempt on the same need. */
export function expireDueLeases(db, now = new Date(), needId = null) {
  return tx(db, () => {
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
  });
}
