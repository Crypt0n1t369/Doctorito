import { one, all, tx } from './db.js';
import { emit } from './events.js';
import { id } from './ids.js';
import { configFor } from './config.js';
import { takeLease, autoConfirm } from './pipeline/leases.js';
import { send } from './channels/index.js';
import { compose, whenLine, whereLine } from './reply.js';
import { answerFromState } from './pipeline/admit.js';

/**
 * The read model behind the coordinator console, and the write that closes an
 * item.
 *
 * The console exists to clear the queue, but its real output is the labelled
 * override stream: the only supervised data anybody has about which binds were
 * wrong and why. So every action here writes one, including the ones where the
 * coordinator agreed with the model.
 */
/**
 * What is waiting for a person. "Rejected" is here too: the screen set the
 * message aside as a possible attack, and the reply it got says a person will
 * look, so a person has to be able to.
 */
export const IN_REVIEW = ['queued', 'rejected'];

export function queueItems(db, initiativeId = null) {
  const rows = initiativeId
    ? all(db, `select * from offers where state in ('queued','rejected') and initiative_id=? order by received_at asc`, initiativeId)
    : all(db, `select * from offers where state in ('queued','rejected') order by received_at asc`);
  return rows.map((o) => ({ ...o, initiative: one(db, 'select * from initiatives where initiative_id=?', o.initiative_id) }));
}

/** Everything the console needs about one item, reconstructed from its judgments. */
export function offerDetail(db, offerId) {
  const offer = one(db, 'select * from offers where offer_id=?', offerId);
  if (!offer) return null;
  const initiative = one(db, 'select * from initiatives where initiative_id=?', offer.initiative_id);
  const judgments = all(db, 'select * from judgments where offer_id=? order by created_at', offerId);
  const wide = judgments.find((j) => j.pass === 'wide');
  const shortJ = judgments.find((j) => j.pass === 'shortlist');

  const wideAnswers = wide ? JSON.parse(wide.answers) : {};
  const shortAnswers = shortJ ? JSON.parse(shortJ.answers) : {};
  const probs = wideAnswers.which_need?.probabilities ?? {};
  const specProbs = shortAnswers.specificity?.probabilities ?? {};
  const specMultiplier = 1 - (0.55 * (specProbs['0'] ?? 0) + 0.18 * (specProbs['1'] ?? 0));
  const rankConfidence = wideAnswers.which_need?.confidence ?? 0;
  const topP = Math.max(...Object.entries(probs).filter(([k]) => k !== 'none').map(([, v]) => v), 1e-9);

  // An accepted invitation has no wide or shortlist pass of its own: the ask it
  // answers names the need and the outbound judgment that chose this person.
  const attach = offer.attachments ? JSON.parse(offer.attachments) : {};

  const candidateIds = shortJ
    ? (JSON.parse(shortJ.request).state.candidate_needs ?? []).map((c) => c.id)
    : attach.need_id ? [attach.need_id]
      : Object.keys(probs).filter((k) => k !== 'none').sort((a, b) => probs[b] - probs[a]).slice(0, 3);

  const shortlist = candidateIds.map((needId) => {
    const need = one(db, 'select * from needs where need_id=?', needId);
    const p = probs[needId] ?? 0;
    const fits = shortAnswers[`fits__${needId}`]?.noul ?? null;
    return { need, p, fits, confidence: fits == null ? null : rankConfidence * (p / topP) * fits * specMultiplier };
  }).filter((c) => c.need).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

  return {
    offer, initiative, judgments, wide, shortlist,
    screen: {
      is_offer: wideAnswers.is_offer?.noul ?? null,
      is_question: wideAnswers.is_question?.noul ?? null,
      is_adversarial: wideAnswers.is_adversarial?.noul ?? null,
      is_withdrawal: wideAnswers.is_withdrawal?.noul ?? null,
      none: probs.none ?? null,
      specificity: shortAnswers.specificity?.score ?? null,
    },
    extracted: offer.extracted ? JSON.parse(offer.extracted) : null,
    model_pick: shortlist[0]?.need?.need_id ?? null,
    judgment_id: shortJ?.judgment_id ?? wide?.judgment_id ?? attach.judgment_id ?? null,
  };
}

/**
 * Clear one item. Four actions and nothing else, because a console with a
 * dozen options is a console nobody clears in ten seconds.
 */
export function applyQueueAction(db, {
  offerId, action, needId = null, note = null, seconds = null,
  coordinator = 'coordinator', baseUrl = 'http://localhost:8787', now = new Date(),
}) {
  // One transaction: the action, its label and its reply land together or not
  // at all. A label for an action that failed would be a training example of
  // something that never happened.
  return tx(db, () => {
    const detail = offerDetail(db, offerId);
    if (!detail) return { ok: false, error: 'no such offer' };
    const { offer, initiative } = detail;
    if (!IN_REVIEW.includes(offer.state)) return { ok: false, error: `this item is already ${offer.state}` };

    const cfg = configFor(initiative);
    const language = offer.language ?? 'en';

    let reply = null;
    let state = action;

    if (action === 'bind') {
      const need = one(db, 'select * from needs where need_id=?', needId);
      if (!need) return { ok: false, error: 'no such need' };
      if (!detail.judgment_id) return { ok: false, error: 'this offer has no judgment to bind against' };

      const extracted = detail.extracted ?? {};
      const qty = pickQty(extracted.quantities, need.unit);
      const lease = takeLease(db, {
        need, initiative, offer, actorId: offer.actor_id, qty,
        confidence: detail.shortlist.find((c) => c.need.need_id === needId)?.confidence ?? null,
        boundBy: `coordinator:${coordinator}`, principal: { role: 'coordinator', name: coordinator },
        judgmentId: detail.judgment_id, cfg, now,
      });
      if (!lease.ok) {
        const why = lease.reason === 'credential_required'
          ? `this person holds no verified ${(lease.missing ?? []).join(', ')}; a reviewer cannot waive a credential`
          : lease.reason;
        return { ok: false, error: `could not bind: ${why}` };
      }

      const confirmNeeded = need.risk_class >= cfg.confirm_required_from_class;
      if (!confirmNeeded) autoConfirm(db, lease.commitment_id, now);

      reply = compose(language, confirmNeeded ? 'proposed' : 'bound', cfg,
        need.description, lease.qty, need.unit, whenLine(language, need), whereLine(language, need),
        `${baseUrl}/c/${lease.token}`);
      state = 'bound';
    } else if (action === 'ask') {
      reply = compose(language, 'ask_quantity', cfg, note || answerFromState(db, initiative, language));
      state = 'asked';
    } else if (action === 'not_an_offer') {
      reply = compose(language, 'not_offer', cfg);
    } else if (action === 'reject') {
      reply = null;                       // an attack gets an acknowledgement, not a conversation
      state = 'screened_out';             // a person has looked; it leaves the queue
    } else {
      return { ok: false, error: `unknown action ${action}` };
    }

    emit(db, {
      type: 'coordinator.override', initiative_id: initiative.initiative_id, author: coordinator,
      payload: {
        override_id: id('ov'), judgment_id: detail.judgment_id, offer_id: offerId,
        coordinator, action, chosen_need_id: needId, model_need_id: detail.model_pick,
        agreed: needId && detail.model_pick ? (needId === detail.model_pick ? 1 : 0) : null,
        note, seconds_taken: seconds == null ? null : Number(seconds),
      },
      at: now.toISOString(),
    });

    emit(db, {
      type: 'offer.decided', initiative_id: initiative.initiative_id, author: coordinator,
      payload: { offer_id: offerId, state, latency_ms: offer.latency_ms, reason: `coordinator: ${action}` }, at: now.toISOString(),
    });

    if (reply) {
      send(db, {
        initiative, actorId: offer.actor_id, channel: offer.channel,
        handle: offer.handle, kind: state, body: reply,
      });
    }
    return { ok: true, state, reply };
  });
}

function pickQty(quantities, unit) {
  const exact = (quantities ?? []).find((q) => q.unit === unit);
  if (exact) return exact.value;
  const bare = (quantities ?? []).find((q) => q.unit === null && Number.isInteger(q.value) && q.value <= 50);
  return bare ? bare.value : 1;
}

/** What the console's labels are worth so far. Shown at the top of the queue. */
export function overrideStats(db, initiativeId = null) {
  const where = initiativeId ? 'where o.initiative_id = ?' : '';
  const params = initiativeId ? [initiativeId] : [];
  const rows = all(db, `select ov.* from overrides ov join offers o on o.offer_id = ov.offer_id ${where}`, ...params);
  const withPick = rows.filter((r) => r.agreed !== null);
  const timed = rows.filter((r) => r.seconds_taken != null).map((r) => r.seconds_taken).sort((a, b) => a - b);
  return {
    labels: rows.length,
    agreed: withPick.filter((r) => r.agreed === 1).length,
    disagreed: withPick.filter((r) => r.agreed === 0).length,
    median_seconds: timed.length ? timed[Math.floor(timed.length / 2)] : null,
  };
}
