import { one, all } from '../db.js';
import { emit } from '../events.js';
import { id } from '../ids.js';
import { configFor, mayAutoBind, thresholdFor } from '../config.js';
import { detectLanguage } from '../lang.js';
import { extract, quantityFor, reconcileWindow, statesUnit } from '../extract.js';
import { resolveActor, displayNamesFor } from '../actors.js';
import { buildState } from '../judgment/redact.js';
import { widePassQuestions, shortlistQuestions } from '../judgment/questions.js';
import { ask as askModel, CostCapExceeded } from '../judgment/index.js';
import { prefilter, shortForm } from './prefilter.js';
import { takeLease, autoConfirm, withdrawByToken } from './leases.js';
import { send } from '../channels/index.js';
import { compose, whenLine, whereLine } from '../reply.js';

const WIDE_MAX = 60;

/**
 * The admission pipeline. Two model requests per offer, and everything else is
 * ordinary code.
 *
 *   ingest -> extract -> filter in SQL -> wide pass (screen rides along)
 *          -> shortlist of three -> confidence gate -> lease -> reply
 *
 * The screen does not cost a request of its own: the three gate questions run
 * in parallel against the same state as the ranking, so they arrive with it.
 */
export async function admit(db, {
  initiative, channel, handle, displayName = null, text, attachments = [],
  now = new Date(), shadow = false, baseUrl = 'http://localhost:8787',
  providerMessageId = null, claimedContact = null,
}) {
  // A redelivered message is not a new offer. Channels resend on timeouts, and
  // a webhook retried three times must not bind three lorries. Identity of the
  // message comes from the provider, never from its text: two identical
  // messages can be two real offers.
  if (providerMessageId) {
    const seen = one(db, 'select * from offers where initiative_id=? and channel=? and provider_message_id=?',
      initiative.initiative_id, channel, String(providerMessageId));
    if (seen) {
      return { offer_id: seen.offer_id, actor_id: seen.actor_id, decision: seen.state, duplicate_of: seen.offer_id, reply: null };
    }
  }

  const t0 = process.hrtime.bigint();
  const cfg = configFor(initiative);
  const stages = {};
  const mark = (k) => { stages[k] = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10; };

  // --- ingest ---------------------------------------------------------------
  const actor = resolveActor(db, { channel, handle, displayName });
  const language = detectLanguage(text);
  mark('ingest');

  // "I can help sometime" is most real offers. The clarifying question we sent
  // is answered on the same channel, so the answer is parsed together with the
  // message that prompted it rather than as a new, equally vague offer.
  const parent = openAsk(db, initiative, actor, now);
  const threadText = parent ? `${parent.raw_text}\n${text}` : text;

  const gazetteer = gazetteerFor(db, initiative);
  const parsed = extract(threadText, { now, gazetteer });
  const extracted = { ...parsed, window: reconcileWindow(parsed.window, initiative, now), language };
  mark('extract');

  const offerId = id('of');
  emit(db, {
    type: 'offer.received', initiative_id: initiative.initiative_id, author: `actor:${actor.actor_id}`,
    payload: {
      offer_id: offerId, initiative_id: initiative.initiative_id, actor_id: actor.actor_id,
      raw_text: text,                       // verbatim. never rewritten.
      channel, handle, language,
      attachments: { files: attachments, thread_of: parent?.offer_id ?? null },
      extracted, received_at: now.toISOString(), shadow: shadow ? 1 : 0,
      provider_message_id: providerMessageId ? String(providerMessageId) : null,
      claimed_contact: claimedContact,
    },
    at: now.toISOString(),
  });
  const offer = one(db, 'select * from offers where offer_id=?', offerId);

  const finish = (decision, extra = {}) => {
    const latency = Math.round(Number(process.hrtime.bigint() - t0) / 1e6 * 10) / 10;
    emit(db, {
      type: 'offer.decided', initiative_id: initiative.initiative_id, author: 'system',
      payload: { offer_id: offerId, state: shadow ? `shadow:${decision}` : decision, latency_ms: latency, reason: extra.reason ?? null },
      at: now.toISOString(),
    });
    if (!shadow && extra.reply) {
      send(db, { initiative, actorId: actor.actor_id, channel, handle, kind: decision, body: extra.reply });
    }
    return { offer_id: offerId, actor_id: actor.actor_id, decision, latency_ms: latency, stages, language, ...extra };
  };

  // Whatever happens from here on, the offer ends in a state a person can see.
  // A budget refusal or a failure at any stage queues it with the reason; it
  // is never left as 'received', outside every list (docs/CONSTRAINTS.md, C4).
  try {
    return await decide();
  } catch (err) {
    const budget = err instanceof CostCapExceeded;
    if (!budget) console.error(`admit ${offerId}:`, err);
    return finish('queued', {
      reply: compose(language, 'queued', cfg),
      reason: budget ? 'budget' : `error: ${String(err?.message ?? err).slice(0, 120)}`,
    });
  }

  async function decide() {
  // --- filter in SQL, before the model sees anything ------------------------
  const { candidates, blockedByCredentials, counts } = prefilter(db, {
    initiative, actorId: actor.actor_id, extracted, now,
  });
  mark('filter');

  // Needs the actor is not eligible for are still ranked. Eligibility is a
  // pure predicate and it is applied at the gate, not by hiding the need: an
  // offer from someone who says they hold the certificate should reach the
  // right need and then reach a person, rather than fall off the board.
  const rankable = [...candidates, ...blockedByCredentials];
  const blocked = new Set(blockedByCredentials.map((n) => n.need_id));
  const byId = new Map(rankable.map((n) => [n.need_id, n]));
  const wideSet = rankable.slice(0, WIDE_MAX).map((n) => ({
    id: n.need_id, short: shortForm(n, cfg.short_desc_chars),
    language: n.language, kind: n.kind, unit: n.unit,
  }));

  // --- wide pass: screen + ranking, one request ----------------------------
  let wide;
  try {
    const { state } = buildState({
      initiative, offerText: threadText, names: displayNamesFor(db, actor.actor_id),
      extracted, candidates: wideSet,
    });
    wide = await askModel(db, { initiative, offer, pass: 'wide', state, questions: widePassQuestions(wideSet), cfg });
  } catch (err) {
    if (err instanceof CostCapExceeded) {
      // A flood degrades to queueing, not to spending.
      return finish('queued', { reply: compose(language, 'queued', cfg), reason: 'budget', counts });
    }
    throw err;
  }
  mark('wide');

  const A = wide.answers;
  const judgments = [wide.judgment_id];

  // The configured engine did not answer. The fallback's reading is on the
  // record for the coordinator, but nothing is decided on it.
  if (wide.degraded_cause) {
    return finish('queued', { reply: compose(language, 'queued', cfg), reason: `degraded: ${wide.degraded_cause}`, judgments, counts });
  }

  // Offer text is data, never instruction. If it tries to be an instruction we
  // say nothing useful back to it and put it in front of a person.
  if ((A.is_adversarial?.noul ?? 0) >= cfg.gate_adversarial) {
    return finish('rejected', { reply: compose(language, 'screened', cfg), reason: 'adversarial', judgments, counts });
  }

  if ((A.is_withdrawal?.noul ?? 0) >= cfg.gate_withdrawal) {
    const active = one(db,
      `select * from commitments where actor_id=? and initiative_id=? and state in ('proposed','confirmed')
        order by created_at desc limit 1`, actor.actor_id, initiative.initiative_id);
    if (active) {
      if (!shadow) withdrawByToken(db, active.token, 'withdrawn by message', now);
      const need = one(db, 'select * from needs where need_id=?', active.need_id);
      return finish('withdrawn', { reply: compose(language, 'withdrawn', cfg, need.description), need_id: need.need_id, judgments, counts });
    }
    // Nothing to release, but somebody told us in time and should be answered
    // as though it mattered, because next time it will.
    return finish('withdrawn', { reply: compose(language, 'nothing_to_withdraw', cfg), judgments, counts });
  }

  if ((A.is_question?.noul ?? 0) > 0.5 && (A.is_offer?.noul ?? 0) < cfg.gate_is_offer) {
    return finish('answered', { reply: compose(language, 'answered', cfg, answerFromState(db, initiative, language)), judgments, counts });
  }

  if ((A.is_offer?.noul ?? 0) < cfg.gate_is_offer) {
    return finish('not_an_offer', { reply: compose(language, 'not_offer', cfg), judgments, counts });
  }

  // --- shortlist of three, full descriptions, one request ------------------
  const probs = A.which_need?.probabilities ?? {};
  const ranked = Object.entries(probs)
    .filter(([k]) => k !== 'none')
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.shortlist_size)
    .map(([needId, p]) => ({ need: byId.get(needId), p }))
    .filter((r) => r.need);

  // "None of these" has to beat the best candidate by a clear margin before we
  // stop here. With a large catalogue every individual probability is small, so
  // a strict comparison throws away offers the shortlist would have placed.
  if (!ranked.length || (probs.none ?? 0) > ranked[0].p * 1.5) {
    return finish('no_match', {
      reply: compose(language, 'no_match', cfg, openNeedList(db, initiative, language)), judgments, counts,
    });
  }

  // `short` is the full description and goes in the state, where detail helps.
  // `label` is the sixty-character form and is the only thing a question is
  // allowed to name, because the full text carries the credential and capacity
  // clauses that the questions explicitly tell the model to ignore.
  const shortSet = ranked.map((r) => ({
    id: r.need.need_id, short: r.need.description, label: r.need.description_short,
    language: r.need.language, kind: r.need.kind, unit: r.need.unit,
  }));
  const { state: shortState } = buildState({
    initiative, offerText: threadText, names: displayNamesFor(db, actor.actor_id),
    extracted, candidates: shortSet,
  });
  const short = await askModel(db, {
    initiative, offer, pass: 'shortlist', state: shortState, questions: shortlistQuestions(shortSet), cfg,
  });
  judgments.push(short.judgment_id);
  mark('shortlist');
  if (short.degraded_cause) {
    return finish('queued', { reply: compose(language, 'queued', cfg), reason: `degraded: ${short.degraded_cause}`, judgments, counts });
  }

  // Specificity discounts the confidence rather than capping it: a complete
  // offer should lose almost nothing, and a vague one should lose half.
  const specProbs = short.answers.specificity?.probabilities ?? {};
  const specScore = short.answers.specificity?.score ?? 1;
  const specMultiplier = 1 - (0.55 * (specProbs['0'] ?? 0) + 0.18 * (specProbs['1'] ?? 0));

  // Confidence is the *concentration* of the ranking distribution, not the
  // winner's raw probability. A raw probability shrinks mechanically as the
  // catalogue grows — the same certain match scores 0.95 against three needs
  // and 0.30 against two hundred — and a gate built on it would quietly stop
  // binding anything as a customer's catalogue got bigger. Concentration does
  // not have that defect, and it is what the model reports as `confidence`.
  const rankConfidence = A.which_need?.confidence ?? 0;
  const topP = ranked[0]?.p || 1;

  const scored = ranked.map((r) => {
    const fits = short.answers[`fits__${r.need.need_id}`]?.noul ?? 0;
    const base = rankConfidence * (r.p / topP);
    return { ...r, fits, confidence: base * fits * completeness(r.need, extracted, specMultiplier) };
  }).filter((r) => r.fits >= cfg.fits_floor)
    .sort((a, b) => b.confidence - a.confidence);

  if (!scored.length) {
    return finish('no_match', {
      reply: compose(language, 'no_match', cfg, openNeedList(db, initiative, language)), judgments, counts,
    });
  }

  const best = scored[0];
  const need = best.need;
  const confidence = round(best.confidence);
  const threshold = thresholdFor(cfg, need.risk_class);

  const detail = {
    need_id: need.need_id, confidence, threshold,
    risk_class: need.risk_class, judgments, counts,
    specificity: specScore, wide_p: round(best.p), fits: round(best.fits),
    shortlist: scored.map((s) => ({ need_id: s.need.need_id, p: round(s.p), fits: round(s.fits), confidence: round(s.confidence) })),
  };

  // --- the gate ------------------------------------------------------------
  if (blocked.has(need.need_id)) {
    const code = JSON.parse(need.qualifications ?? '[]')[0] ?? 'certificate';
    return finish('queued', {
      reply: compose(language, 'needs_credential', cfg, need.description, code),
      reason: 'credential_required', ...detail,
    });
  }

  const autoAllowed = mayAutoBind(need.risk_class) && initiative.autobind === 1 && confidence >= threshold;

  if (!autoAllowed) {
    if (confidence >= cfg.escalate_floor || !mayAutoBind(need.risk_class)) {
      return finish('queued', {
        reply: compose(language, 'queued', cfg),
        reason: !mayAutoBind(need.risk_class) ? 'risk_class_3'
          : initiative.autobind !== 1 ? 'autobind_off' : 'below_threshold',
        ...detail,
      });
    }
    // Low confidence has two different causes and they deserve two different
    // replies. If the writer was specific and we still cannot place it, the
    // problem is that we do not need it — asking them to be clearer is rude.
    // If they were vague, one question is the whole fix.
    if (specScore >= cfg.vague_below) {
      const { need_id, ...rest } = detail;
      return finish('no_match', {
        reply: compose(language, 'no_match', cfg, openNeedList(db, initiative, language)), ...rest,
      });
    }
    const [key, ...rest] = clarify(scored);
    return finish('asked', { reply: compose(language, key, cfg, ...rest), ...detail });
  }

  if (shadow) return finish('bound', { ...detail, shadow: true });

  // The same person already holds this need. A second message saying the same
  // thing is more often a resend or a follow-up than a second lorry, and the
  // difference is a person's call, not the model's.
  const held = one(db,
    `select commitment_id from commitments where actor_id=? and need_id=? and state in ('proposed','confirmed')`,
    actor.actor_id, need.need_id);
  if (held) {
    return finish('queued', { reply: compose(language, 'queued', cfg), reason: 'possible_duplicate', ...detail });
  }

  // Nothing acts before its judgment is written: both judgment rows are already
  // on the record by the time we get here, and the lease names the second one.
  const qty = quantityFor(extracted.quantities, need.unit) ?? 1;
  const lease = takeLease(db, {
    need, initiative, offer, actorId: actor.actor_id, qty,
    confidence, boundBy: 'auto', judgmentId: short.judgment_id, cfg, now,
  });

  if (!lease.ok && lease.reason !== 'full') {
    // The boundary refused what the gate allowed: the switch was turned off, a
    // credential expired or the need closed while this offer was being read.
    return finish('queued', { reply: compose(language, 'queued', cfg), reason: lease.reason, ...detail });
  }
  if (!lease.ok) {
    // The popular need is oversubscribed: the lease caps it, and the reply
    // offers the nearest open need instead of a silent no.
    const alt = scored.slice(1).find((s) => s.need.qty_required > s.need.qty_committed);
    return finish('full', {
      reply: compose(language, 'full', cfg, alt ? alt.need.description : openNeedList(db, initiative, language)),
      ...detail,
    });
  }

  const link = `${baseUrl}/c/${lease.token}`;
  const confirmNeeded = need.risk_class >= cfg.confirm_required_from_class;
  if (!confirmNeeded) autoConfirm(db, lease.commitment_id, now);
  mark('bind');

  const reply = compose(language, confirmNeeded ? 'proposed' : 'bound', cfg,
    need.description, lease.qty, need.unit, whenLine(language, need), whereLine(language, need), link);

  return finish('bound', {
    ...detail, commitment_id: lease.commitment_id, token: lease.token,
    qty: lease.qty, partial: lease.partial, confirm_needed: confirmNeeded, reply,
  });
  }
}

// ---------------------------------------------------------------------------

/**
 * How much of what this particular need requires did the writer actually state?
 *
 * The model's specificity reading is generic: it counts a missing time against
 * every offer. But a need's schedule usually belongs to the need. Asking a
 * timber supplier which day they mean, when the need already says 19–23
 * October, is noise that costs a bind. Only people's time has to come from the
 * person offering it, so that is the only case where a missing time counts.
 *
 * The model's reading is kept as a floor, so a genuinely vague message still
 * loses what it should.
 */
function completeness(need, extracted, modelMultiplier) {
  const timeMatters = need.kind === 'labour' || need.kind === 'expertise';
  const saidQty = statesUnit(extracted.quantities, need.unit) ||
    quantityFor(extracted.quantities, need.unit) != null;
  const saidTime = extracted.window?.kind !== 'none';

  const required = 1 + (timeMatters ? 1 : 0);
  const stated = (saidQty ? 1 : 0) + (timeMatters && saidTime ? 1 : 0);
  const deterministic = 0.55 + 0.45 * (stated / required);
  return Math.max(modelMultiplier, deterministic);
}

/** One question, chosen by what is actually missing. Never a form. */
function clarify(scored) {
  const close = scored.filter((s) => s.confidence >= scored[0].confidence * 0.7);
  if (close.length > 1) {
    const list = close.map((s, i) => `${i + 1}. ${s.need.description}`).join('\n');
    return ['ask_which', list];
  }
  return ['ask_quantity', scored[0].need.description];
}

/** The initiative page answers from state and nothing else. So does this. */
export function answerFromState(db, initiative, language = 'en') {
  const rows = all(db,
    `select * from needs where initiative_id=? and status='open' order by (qty_required-qty_committed) desc limit 6`,
    initiative.initiative_id);
  const head = { en: 'Open right now:', lv: 'Šobrīd atvērts:', ru: 'Сейчас открыто:' }[language] ?? 'Open right now:';
  const still = { en: 'still needed', lv: 'vēl vajag', ru: 'ещё нужно' }[language] ?? 'still needed';
  if (!rows.length) return { en: 'Everything is covered right now.', lv: 'Šobrīd viss ir nosegts.', ru: 'Сейчас всё закрыто.' }[language];
  return `${head}\n` + rows.map((n) =>
    `• ${n.description} — ${still} ${fmt(n.qty_required - n.qty_committed)} ${n.unit}` +
    (n.window_start ? ` (${n.window_start.slice(0, 10)})` : '')).join('\n');
}

function openNeedList(db, initiative, language) {
  return answerFromState(db, initiative, language).split('\n').slice(1).join('\n');
}

function openAsk(db, initiative, actor, now) {
  const since = new Date(now.getTime() - 24 * 3600e3).toISOString();
  return one(db,
    `select * from offers where initiative_id=? and actor_id=? and state='asked' and received_at > ?
      order by received_at desc limit 1`,
    initiative.initiative_id, actor.actor_id, since);
}

function gazetteerFor(db, initiative) {
  const g = [];
  if (initiative.place) g.push({ name: initiative.place, lat: initiative.geo_lat, lon: initiative.geo_lon });
  for (const n of all(db, 'select distinct geo_place, geo_lat, geo_lon from needs where initiative_id=? and geo_place is not null', initiative.initiative_id)) {
    g.push({ name: n.geo_place, lat: n.geo_lat, lon: n.geo_lon });
  }
  const extra = JSON.parse(initiative.config ?? '{}').gazetteer ?? [];
  return [...g, ...extra];
}

function fmt(n) { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
function round(x) { return Math.round(x * 1e4) / 1e4; }
