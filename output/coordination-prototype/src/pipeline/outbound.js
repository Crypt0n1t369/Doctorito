import { all, one, tx } from '../db.js';
import { emit } from '../events.js';
import { id } from '../ids.js';
import { configFor } from '../config.js';
import { ask as askModel, CostCapExceeded } from '../judgment/index.js';
import { outboundQuestions } from '../judgment/questions.js';
import { send } from '../channels/index.js';
import { preferredContact } from '../actors.js';
import { compose, whenLine } from '../reply.js';
import { remainingFor, takeLease, autoConfirm } from './leases.js';
import { buildOutboundState } from '../judgment/redact.js';
import { detectLanguage } from '../lang.js';

/**
 * The outbound path is not optional.
 *
 * A purely inbound system is a passive inbox, and an initiative with no traffic
 * stays empty. When a need ages without commitments, the same engine runs in
 * reverse: rank the capability records against that one need, take the best
 * dozen actors, and ask them directly on whatever channel they use.
 *
 * For a cooperative with 400 members this is the difference between a system
 * that works on day one and a demo.
 */
const CANDIDATE_MAX = 40;

/** Starving needs go first, and they are what the public page shows as blocking. */
const AGEING_SQL = `
select *, (qty_required - qty_committed) as short_by,
       (qty_committed * 1.0 / nullif(qty_required, 0)) as fill_ratio
  from needs
 where initiative_id = :init
   and status = 'open'
   and (qty_required - qty_committed) > 0
   and published_at <= :cutoff
   and (last_ask_at is null or last_ask_at <= :cutoff)
 order by fill_ratio asc, window_start asc
`;

const CANDIDATE_SQL = `
select c.*, a.display_name from capabilities c
  join actors a on a.actor_id = c.actor_id
 where c.initiative_id = :init
   and (:ws is null or c.availability_end   is null or c.availability_end   >= :ws)
   and (:we is null or c.availability_start is null or c.availability_start <= :we)
   and (:lat is null or c.geo_lat is null or (
         abs(c.geo_lat - :lat) <= ((coalesce(c.geo_radius_km, 40) + :radius) / 111.0)
     and abs(c.geo_lon - :lon) <= ((coalesce(c.geo_radius_km, 40) + :radius) / (111.0 * max(0.2, cos(:lat * 3.14159265 / 180))))
   ))
   and not exists (
     select 1 from json_each(:quals) q
      where not exists (
        select 1 from credentials cr
         where cr.actor_id = c.actor_id and cr.code = q.value
           and (cr.expires_at is null or cr.expires_at > :now)))
   and not exists (
     select 1 from commitments cm
      where cm.actor_id = c.actor_id and cm.need_id = :need
        and cm.state in ('proposed','confirmed','fulfilled'))
   and not exists (
     select 1 from asks ak
      where ak.actor_id = c.actor_id and ak.need_id = :need and ak.sent_at > :cooldown)
 limit ${CANDIDATE_MAX}
`;

export async function runOutbound(db, { initiative, now = new Date(), baseUrl = 'http://localhost:8787', maxNeeds = 5 }) {
  const cfg = configFor(initiative);
  // The one switch stops the machine acting on its own, and contacting people
  // unprompted is acting. A convener who pulls it wants the messages to stop too.
  if (initiative.autobind !== 1) return [{ skipped: 'automatic actions are switched off' }];
  const cutoff = new Date(now.getTime() - cfg.ask_after_hours * 3600e3).toISOString();
  const needs = all(db, AGEING_SQL, { init: initiative.initiative_id, cutoff }).slice(0, maxNeeds);

  const report = [];
  for (const need of needs) {
    // Model calls are awaited between needs, and the switch can be pulled while
    // they run. Ask the log again before contacting anyone else.
    const now_ = one(db, 'select autobind from initiatives where initiative_id=?', initiative.initiative_id);
    if (now_?.autobind !== 1) { report.push({ need_id: need.need_id, skipped: 'automatic actions were switched off' }); break; }
    try {
      report.push(await askAround(db, { initiative, need, cfg, now, baseUrl }));
    } catch (err) {
      if (err instanceof CostCapExceeded) { report.push({ need_id: need.need_id, skipped: 'budget' }); break; }
      throw err;
    }
  }
  return report;
}

async function askAround(db, { initiative, need, cfg, now, baseUrl }) {
  const cooldown = new Date(now.getTime() - cfg.ask_cooldown_hours * 3600e3).toISOString();
  const candidates = all(db, CANDIDATE_SQL, {
    init: initiative.initiative_id, ws: need.window_start, we: need.window_end,
    lat: need.geo_lat, lon: need.geo_lon, radius: need.geo_radius_km ?? 25,
    quals: need.qualifications ?? '[]',
    now: now.toISOString(), need: need.need_id, cooldown,
  });

  if (!candidates.length) {
    emit(db, {
      type: 'need.asked', initiative_id: initiative.initiative_id, author: 'system',
      reason: 'no eligible capability records', payload: { need_id: need.need_id }, at: now.toISOString(),
    });
    return { need_id: need.need_id, candidates: 0, asked: 0 };
  }

  const set = candidates.map((c) => ({
    id: c.capability_id,
    capability: `${c.kind}: ${c.description}${c.quantity ? ` (${c.quantity} ${c.unit ?? ''})` : ''}`,
    language: need.language,
  }));

  // The same two-pass shape, run in reverse: one request, one question per
  // candidate capability, against the state of this one need.
  const state = buildOutboundState({ initiative, need, capabilities: set });

  const res = await askModel(db, {
    initiative, pass: 'outbound', state, questions: outboundQuestions(set), cfg,
  });

  // The configured engine did not answer. Contacting people is acting, and a
  // fallback's ranking is not enough to act on (docs/OUTCOMES.md, C4).
  if (res.degraded_cause) {
    emit(db, {
      type: 'need.asked', initiative_id: initiative.initiative_id, author: 'system',
      reason: `no asks sent: degraded judgment (${res.degraded_cause})`, payload: { need_id: need.need_id }, at: now.toISOString(),
    });
    return { need_id: need.need_id, need: need.description_short, candidates: candidates.length, asked: 0, skipped: `degraded: ${res.degraded_cause}` };
  }

  const scored = candidates
    .map((c) => ({ cap: c, p: res.answers[`capfits__${c.capability_id}`]?.noul ?? 0 }))
    .filter((r) => r.p >= cfg.ask_fit_floor)
    .sort((a, b) => b.p - a.p);

  // Never ask the same person twice for one need in one sweep.
  const seen = new Set();
  const chosen = [];
  for (const r of scored) {
    if (seen.has(r.cap.actor_id)) continue;
    seen.add(r.cap.actor_id);
    chosen.push(r);
    if (chosen.length >= cfg.ask_batch) break;
  }

  const language = need.language ?? 'en';
  let sent = 0;
  for (const r of chosen) {
    const contact = preferredContact(db, r.cap.actor_id);
    if (!contact) continue;
    const askId = id('ak');
    const body = compose(language, 'ask_outbound', cfg,
      need.description, whenLine(language, need).trim(), `${baseUrl}/take/${askId}`);

    emit(db, {
      type: 'ask.sent', initiative_id: initiative.initiative_id, author: 'system',
      payload: {
        ask_id: askId, need_id: need.need_id, actor_id: r.cap.actor_id,
        channel: contact.channel, handle: contact.handle, body,
        judgment_id: res.judgment_id, confidence: round(r.p),
      },
      at: now.toISOString(),
    });
    send(db, {
      initiative, actorId: r.cap.actor_id, channel: contact.channel,
      handle: contact.handle, kind: 'outbound_ask', body,
    });
    sent++;
  }

  emit(db, {
    type: 'need.asked', initiative_id: initiative.initiative_id, author: 'system',
    reason: `${sent} asks`, payload: { need_id: need.need_id }, at: now.toISOString(),
  });

  return {
    need_id: need.need_id, need: need.description_short,
    candidates: candidates.length, asked: sent, judgment_id: res.judgment_id,
    remaining: remainingFor(db, need.need_id, now),
  };
}

export function askById(db, askId) {
  return one(db, 'select * from asks where ask_id=?', askId);
}

/**
 * Someone tapped "I can do this" on an invitation. That is their side of the
 * commitment (O6). The project's side is the convener's standing authorization,
 * which covers only what an automatic bind could cover: never risk class 3,
 * never while the switch is off. Anything else becomes a review item, so the
 * acceptance reaches a person instead of being lost or acted on alone.
 */
export function acceptInvitation(db, { askId, now = new Date() }) {
  return tx(db, () => {
    const ask = askById(db, askId);
    if (!ask) return { ok: false, reason: 'unknown' };
    const need = one(db, 'select * from needs where need_id=?', ask.need_id);
    const initiative = need && one(db, 'select * from initiatives where initiative_id=?', need.initiative_id);
    if (!need || !initiative) return { ok: false, reason: 'unknown' };
    const cfg = configFor(initiative);

    const existing = one(db, `select * from commitments where need_id=? and actor_id=? and state in ('proposed','confirmed','fulfilled')`,
      ask.need_id, ask.actor_id);
    if (existing) return { ok: true, already: true, token: existing.token, need, initiative };
    if (need.status === 'closed' || remainingFor(db, need.need_id, now) <= 0) return { ok: false, reason: 'full', need, initiative };

    const lease = takeLease(db, {
      need, initiative, offer: null, actorId: ask.actor_id, qty: 1,
      confidence: ask.confidence, boundBy: 'outbound', judgmentId: ask.judgment_id, cfg, now,
    });
    if (lease.ok) {
      if (need.risk_class < cfg.confirm_required_from_class) autoConfirm(db, lease.commitment_id, now);
      return { ok: true, token: lease.token, need, initiative };
    }
    if (lease.reason === 'full') return { ok: false, reason: 'full', need, initiative };

    const offerId = id('of');
    const text = `Accepted an invitation to: ${need.description_short ?? need.description}`;
    emit(db, {
      type: 'offer.received', initiative_id: initiative.initiative_id, author: `actor:${ask.actor_id}`,
      payload: {
        offer_id: offerId, initiative_id: initiative.initiative_id, actor_id: ask.actor_id,
        raw_text: text, channel: ask.channel, handle: ask.handle, language: need.language ?? detectLanguage(text),
        attachments: { ask_id: ask.ask_id, judgment_id: ask.judgment_id, need_id: need.need_id },
        extracted: { quantities: [{ value: 1, unit: need.unit }] }, received_at: now.toISOString(),
      },
      at: now.toISOString(),
    });
    emit(db, {
      type: 'offer.decided', initiative_id: initiative.initiative_id, author: 'system',
      payload: { offer_id: offerId, state: 'queued', latency_ms: 0, reason: `review_required: ${lease.reason}` },
      at: now.toISOString(),
    });
    return { ok: false, review: true, reason: lease.reason, offer_id: offerId, need, initiative };
  });
}

function round(x) { return Math.round(x * 1e4) / 1e4; }
