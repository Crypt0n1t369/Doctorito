import { one, all } from '../db.js';
import { emit, verifyChain } from '../events.js';
import { configFor, RISK, thresholdFor, mayAutoBind } from '../config.js';
import { admit } from '../pipeline/admit.js';
import { confirmByToken, withdrawByToken, takeLease, autoConfirm, remainingFor } from '../pipeline/leases.js';
import { acceptInvitation } from '../pipeline/outbound.js';
import { normalise, verifyWebhook, send as sendMessage } from '../channels/index.js';
import { id } from '../ids.js';
import { needsOf, publishNeed, amendNeed, closeNeed, proposeDecomposition, KINDS, UNITS } from '../needs.js';
import { deliveryRecord } from '../fulfilment.js';
import { queueItems, offerDetail, applyQueueAction, overrideStats } from '../queue.js';
import { compose, whenLine, whereLine } from '../reply.js';
import { VERSION as BANK_VERSION, BANK_HASH, BANK } from '../judgment/questions.js';
import { html, raw, esc, layout, bar, num, money, fmtDate, fmtWhen, ago, tag, field, STYLE_VERSION } from './views.js';

const page = (opts) => layout(opts);

/**
 * A private initiative does not exist for the public: not on the index, not by
 * its slug, and not through its offer form (docs/CONSTRAINTS.md, C1).
 */
const visible = (init, session) => init && (init.visibility === 'public' || session?.role === 'coordinator');

/** Bearer links are a contributor's only credential. No page shows one to anyone else. */
const maskTokens = (text) => String(text ?? '').replace(/\/c\/[A-Za-z0-9_-]{8,}/g, '/c/•••');

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

export function index({ db, session }) {
  const rows = all(db, 'select * from initiatives order by created_at desc').filter((i) => visible(i, session));
  return page({
    title: 'Initiatives',
    session,
    body: String(html`
      <h1>Initiatives</h1>
      <p class="lede">A decision, a catalogue of needs, and whatever arrives on whatever channel.
        Each page below answers only from that initiative's recorded state.</p>
      ${rows.length ? html`<div class="cards">${rows.map((i) => {
        const n = one(db, `select count(*) c, coalesce(sum(qty_required),0) req, coalesce(sum(qty_committed),0) com
                             from needs where initiative_id=?`, i.initiative_id);
        const open = one(db, `select count(*) c from needs where initiative_id=? and status='open'`, i.initiative_id).c;
        return html`<a class="card" href="/i/${i.slug}">
          <h3>${i.title}</h3>
          <p class="muted">${i.owner_org ?? ''}${i.place ? ` · ${i.place}` : ''}</p>
          <p>${n.c} needs, ${open} still open</p>
          ${bar(n.com, 0, n.req || 1)}
          ${i.autobind ? '' : tag('automatic binds off', 'warn')}
        </a>`;
      })}</div>` : html`<p class="empty">Nothing seeded yet. Run <code>npm run seed</code>.</p>`}
    `),
  });
}

export function initiative({ db, params, session }) {
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  if (!visible(init, session)) return notFound();
  const decision = one(db, 'select * from decisions where decision_id=?', init.decision_id);
  const needs = needsOf(db, init.initiative_id);
  const constraints = JSON.parse(init.constraints ?? '[]');
  const amendments = all(db, `select * from events where initiative_id=? and type='need.amended' order by seq desc`, init.initiative_id);
  const prov = decision?.provenance ? JSON.parse(decision.provenance) : {};

  const delivered = (needId) => one(db, `select coalesce(sum(f.qty_delivered),0) q from fulfilments f
      join commitments c on c.commitment_id=f.commitment_id where c.need_id=?`, needId).q;

  return page({
    title: init.title,
    session,
    nav: [[`/i/${init.slug}/offer`, 'Offer something']],
    body: String(html`
      <h1>${init.title}</h1>
      <p class="lede">${init.objective}</p>

      <section class="provenance">
        <h2>Where this came from</h2>
        <dl>
          <div><dt>Decided by</dt><dd>${decision?.body ?? '—'}</dd></div>
          <div><dt>Decision</dt><dd>${decision?.result ?? '—'}</dd></div>
          <div><dt>Quorum</dt><dd>${decision?.quorum ?? '—'}</dd></div>
          <div><dt>Decided</dt><dd>${fmtDate(decision?.decided_at)}</dd></div>
          <div><dt>Imported from</dt><dd>${decision?.source ?? '—'}${prov.external_id ? html` · ${prov.external_id}` : ''}
            ${prov.url ? html` · <a href="${prov.url}" rel="noreferrer">source</a>` : ''}</dd></div>
        </dl>
        ${constraints.length ? html`<p class="muted">Constraints: ${constraints.join(' · ')}</p>` : ''}
        <p class="muted">${init.place ?? ''} · ${fmtDate(init.window_start)} to ${fmtDate(init.window_end)}
          ${init.autobind ? '' : tag('automatic binds are switched off', 'warn')}</p>
      </section>

      <h2>What is needed</h2>
      <table class="needs">
        <thead><tr><th>Need</th><th>Progress</th><th class="n">Committed</th><th class="n">Delivered</th>
          <th class="n">Required</th><th>Risk</th><th>Status</th></tr></thead>
        <tbody>
        ${needs.map((n) => {
          const del = delivered(n.need_id);
          const blocked = n.qty_committed === 0 && n.status === 'open';
          return html`<tr class="${raw(blocked ? 'blocked' : '')}">
            <td><a href="/i/${init.slug}/need/${n.need_id}">${n.description}</a>
              ${n.geo_place ? html`<span class="muted"> · ${n.geo_place}</span>` : ''}
              ${n.window_start ? html`<span class="muted"> · ${fmtDate(n.window_start)}</span>` : ''}
              ${blocked ? tag('nothing yet', 'warn') : ''}</td>
            <td class="barcell">${bar(n.qty_committed, del, n.qty_required)}</td>
            <td class="n">${num(n.qty_committed)}</td>
            <td class="n">${num(del)}</td>
            <td class="n">${num(n.qty_required)} ${n.unit}</td>
            <td>${tag(`class ${n.risk_class}`, n.risk_class === 3 ? 'risk3' : n.risk_class === 2 ? 'risk2' : '')}</td>
            <td>${n.status}</td>
          </tr>`;
        })}
        </tbody>
      </table>
      <p class="muted">Committed is the sum of confirmed commitments and is never written directly.
        Delivered is the sum of verified fulfilments, and a contributor cannot verify their own.</p>

      ${amendments.length ? html`
        <h2>Amendments</h2>
        <p class="muted">A need's quantity never changes silently. Every change carries an author and a reason.</p>
        <ul class="amendments">${amendments.slice(0, 12).map((e) => {
          const p = JSON.parse(e.payload);
          const n = one(db, 'select description_short from needs where need_id=?', p.need_id);
          return html`<li><b>${n?.description_short ?? p.need_id}</b> — ${e.reason}
            <span class="muted">${e.author} · ${fmtWhen(e.at)}</span></li>`;
        })}</ul>` : ''}

      <h2>Who took what on</h2>
      ${commitmentTable(db, init)}
    `),
  });
}

function commitmentTable(db, init) {
  const rows = all(db, `
    select c.*, n.description, n.unit, a.display_name,
           f.qty_delivered, f.verified_at, f.verified_by
      from commitments c
      join needs n on n.need_id = c.need_id
      left join actors a on a.actor_id = c.actor_id
      left join fulfilments f on f.commitment_id = c.commitment_id
     where c.initiative_id = ?
     order by c.created_at desc`, init.initiative_id);
  if (!rows.length) return html`<p class="empty">Nothing committed yet.</p>`;
  return html`<table class="commitments">
    <thead><tr><th>Need</th><th>Who</th><th class="n">Qty</th><th>Bound by</th><th>State</th><th>Delivered</th><th></th></tr></thead>
    <tbody>${rows.map((c) => html`<tr>
      <td><a href="/i/${init.slug}/need/${c.need_id}">${String(c.description).slice(0, 52)}</a></td>
      <td><a href="/a/${c.actor_id}">${c.display_name ?? c.actor_id}</a></td>
      <td class="n">${num(c.qty)} ${c.unit}</td>
      <td>${c.bound_by}${c.confidence != null ? html` <span class="muted">${c.confidence.toFixed(2)}</span>` : ''}</td>
      <td>${tag(c.state, c.state === 'fulfilled' ? 'good' : ['withdrawn', 'failed', 'expired'].includes(c.state) ? 'warn' : '')}</td>
      <td>${c.qty_delivered != null ? html`${num(c.qty_delivered)} <span class="muted">${c.verified_by}</span>` : '—'}</td>
      <td>${c.judgment_id ? html`<a class="muted" href="/j/${c.judgment_id}">judgment</a>` : ''}</td>
    </tr>`)}</tbody></table>`;
}

export function needPage({ db, params, session }) {
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  const need = one(db, 'select * from needs where need_id=?', params[1]);
  if (!visible(init, session) || !need || need.initiative_id !== init.initiative_id) return notFound();
  const quals = JSON.parse(need.qualifications ?? '[]');
  const commitments = all(db, `select c.*, a.display_name, f.qty_delivered, f.verified_by, f.verified_at
      from commitments c left join actors a on a.actor_id=c.actor_id
      left join fulfilments f on f.commitment_id=c.commitment_id
     where c.need_id=? order by c.created_at desc`, need.need_id);
  const asks = all(db, 'select * from asks where need_id=? order by sent_at desc', need.need_id);

  return page({
    title: need.description_short ?? 'Need',
    session,
    body: String(html`
      <p class="crumb"><a href="/i/${init.slug}">${init.title}</a></p>
      <h1>${need.description}</h1>
      <div class="facts">
        <div><span>Needed</span><b>${num(need.qty_required)} ${need.unit}</b></div>
        <div><span>Committed</span><b>${num(need.qty_committed)}</b></div>
        <div><span>Still open</span><b>${num(Math.max(0, need.qty_required - need.qty_committed))}</b></div>
        <div><span>When</span><b>${fmtWhen(need.window_start)}</b></div>
        <div><span>Where</span><b>${need.geo_place ?? '—'}${need.geo_radius_km ? ` (${need.geo_radius_km} km)` : ''}</b></div>
        <div><span>Risk class</span><b>${need.risk_class} — ${RISK[need.risk_class]}</b></div>
      </div>
      ${quals.length ? html`<p>Requires a verified ${quals.join(', ')}. Eligibility is checked against verified
        credentials, never inferred from what somebody writes about themselves.</p>` : ''}
      ${need.risk_class === 3 ? html`<p class="note">Risk class 3. Nothing binds here automatically, at any
        confidence. Every offer for this need goes to a person.</p>` : ''}
      ${bar(need.qty_committed, commitments.reduce((a, c) => a + (c.qty_delivered ?? 0), 0), need.qty_required)}

      <h2>Commitments</h2>
      ${commitments.length ? html`<ul class="trail">${commitments.map((c) => html`<li>
        <a href="/a/${c.actor_id}">${c.display_name ?? c.actor_id}</a> — ${num(c.qty)} ${need.unit},
        ${tag(c.state, c.state === 'fulfilled' ? 'good' : '')} ${c.bound_by}
        ${c.qty_delivered != null ? html` · delivered ${num(c.qty_delivered)}, verified by ${c.verified_by} on ${fmtDate(c.verified_at)}` : ''}
        ${c.judgment_id ? html` · <a class="muted" href="/j/${c.judgment_id}">judgment</a>` : ''}
      </li>`)}</ul>` : html`<p class="empty">Nobody yet.</p>`}

      ${asks.length ? html`<h2>Who was asked</h2>
        <p class="muted">A need that ages without commitments drives the engine in reverse: capability records
          are ranked against this need and the best are asked directly.</p>
        <ul class="trail">${asks.map((a) => html`<li><a href="/a/${a.actor_id}">${a.actor_id}</a> on ${a.channel}
          · ${fmtWhen(a.sent_at)} · confidence ${a.confidence?.toFixed(2) ?? '—'}
          ${a.judgment_id ? html` · <a class="muted" href="/j/${a.judgment_id}">judgment</a>` : ''}</li>`)}</ul>` : ''}
    `),
  });
}

// ---------------------------------------------------------------------------
// The web-form channel
// ---------------------------------------------------------------------------

export function offerForm({ db, params, session, query }) {
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  if (!visible(init, session)) return notFound();
  return page({
    title: `Offer something · ${init.title}`,
    session,
    body: String(html`
      <p class="crumb"><a href="/i/${init.slug}">${init.title}</a></p>
      <h1>Offer something</h1>
      <p class="lede">Write it however you like. No account, no form fields to guess at.
        You get a specific answer back, not a receipt.</p>
      <form method="post" class="offer">
        ${raw(field({ name: 'text', label: 'What can you bring, and when?', type: 'textarea',
          attrs: 'rows="5" required autofocus placeholder="I can bring a 7.5 t flatbed on Saturday and haul branches"' }))}
        ${raw(field({ name: 'contact', label: 'Where should we reply?', hint: 'email or a phone number',
          attrs: 'required placeholder="you@example.lv"' }))}
        ${raw(field({ name: 'name', label: 'Your name', hint: 'optional. it never leaves this machine' }))}
        <input type="hidden" name="submission_id" value="${id('sb')}">
        <button type="submit">Send</button>
      </form>
      ${query.get('sent') ? '' : ''}
    `),
  });
}

export async function offerSubmit(ctx) {
  const { db, params, body, session, baseUrl } = ctx;
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  if (!visible(init, session)) return notFound();
  const msg = normalise('web', body);
  if (!msg.text) return offerForm(ctx);

  // The form vouches for nothing: anyone can type anyone's email into it. The
  // offer belongs to this browser, which holds a random id in a signed cookie,
  // and the contact typed in is kept as a claim, never used to find a person.
  // The hidden submission id makes a double-click one offer, not two.
  const result = await admit(db, {
    initiative: init, channel: 'web', handle: `web:${ctx.contributorId()}`,
    claimedContact: msg.handle || null, providerMessageId: body.submission_id || null,
    displayName: msg.displayName, text: msg.text, baseUrl,
  });

  return page({
    title: 'Thank you',
    session,
    body: String(html`
      <p class="crumb"><a href="/i/${init.slug}">${init.title}</a></p>
      <h1>Here is what happened</h1>
      <blockquote class="reply">${result.reply ?? 'No reply was generated.'}</blockquote>
      <div class="facts">
        <div><span>Decision</span><b>${result.decision}</b></div>
        <div><span>Confidence</span><b>${result.confidence != null ? result.confidence.toFixed(3) : '—'}</b></div>
        <div><span>Took</span><b>${result.latency_ms} ms</b></div>
        <div><span>Model calls</span><b>${result.judgments?.length ?? 0}</b></div>
      </div>
      ${result.token ? html`<p><a class="button" href="/c/${result.token}">Open your confirmation page</a></p>` : ''}
      <p class="muted">Your message is kept exactly as you wrote it. What left this machine for the judgment
        model had your name, contact details and any address removed first.
        ${result.judgments?.length ? html`<a href="/j/${result.judgments[result.judgments.length - 1]}">See it.</a>` : ''}</p>
      <p><a href="/i/${init.slug}/offer">Send another</a></p>
    `),
  });
}

export async function webhook(ctx) {
  const { db, params, body, query, baseUrl, res } = ctx;
  const channel = params[0];

  // The channel's provider vouches for the sender, or nobody does. Checked
  // before anything else, so an unauthenticated caller learns nothing — not
  // even whether an initiative exists (docs/CONSTRAINTS.md, C3).
  const auth = verifyWebhook(channel, ctx.req.headers, ctx.rawBody);
  if (!auth.ok) return { status: auth.status, type: 'application/json', body: JSON.stringify({ error: auth.error }) };

  const slug = query.get('initiative') ?? body.initiative;
  const init = slug
    ? one(db, 'select * from initiatives where slug=?', slug)
    : one(db, `select * from initiatives where status='open' order by created_at desc limit 1`);
  if (!init) return { status: 404, type: 'application/json', body: JSON.stringify({ error: 'no such initiative' }) };

  const msg = normalise(channel, body);
  if (!msg.text || !msg.handle) {
    return { status: 400, type: 'application/json', body: JSON.stringify({ error: 'need a handle and some text' }) };
  }
  const result = await admit(db, {
    initiative: init, channel, handle: msg.handle, displayName: msg.displayName,
    text: msg.text, attachments: msg.attachments, baseUrl, providerMessageId: msg.providerMessageId,
  });
  return {
    status: 200, type: 'application/json',
    body: JSON.stringify({
      decision: result.decision, need_id: result.need_id ?? null,
      confidence: result.confidence ?? null, latency_ms: result.latency_ms,
      reply: result.reply ?? null, judgments: result.judgments ?? [],
    }, null, 2),
  };
}

// ---------------------------------------------------------------------------
// The contributor's only page: four facts and two buttons
// ---------------------------------------------------------------------------

const CONTRIB = {
  en: { yours: 'You are down for', when: 'When', where: 'Where', bring: 'Bring', confirm: 'Confirm', withdraw: 'Withdraw',
    not_booked: 'Not booked until you confirm.', gone: 'This link has expired and the place has gone back to the pool.',
    done: 'Confirmed. Thank you.', out: 'Withdrawn. Thank you for telling us in time.',
    unknown: 'We could not find that. The link may have been used already.',
    closed: 'This need has closed, so nothing was confirmed.',
    review: 'A coordinator has to approve this before it counts. Nothing is confirmed yet.',
    credential: 'This needs a qualification we have no verified record of for you, so nothing was confirmed. A person can help:',
    delivered: 'This has already been delivered, so it cannot be withdrawn. To correct the record, contact a person:' },
  lv: { yours: 'Jūs esat pieteikts', when: 'Kad', where: 'Kur', bring: 'Ņemiet līdzi', confirm: 'Apstiprināt', withdraw: 'Atsaukt',
    not_booked: 'Nav rezervēts, kamēr neapstiprināt.', gone: 'Saite ir beigusies un vieta atgriezta sarakstā.',
    done: 'Apstiprināts. Paldies.', out: 'Atsaukts. Paldies, ka pateicāt laikus.',
    unknown: 'Neizdevās atrast. Saite, iespējams, jau izmantota.',
    closed: 'Šī vajadzība ir slēgta, tāpēc nekas netika apstiprināts.',
    review: 'Vispirms to jāapstiprina koordinatoram. Pagaidām nekas nav apstiprināts.',
    credential: 'Tam vajadzīga kvalifikācija, kuras apstiprinājums mums nav reģistrēts, tāpēc nekas netika apstiprināts. Palīdzēs cilvēks:',
    delivered: 'Tas jau ir paveikts, tāpēc to nevar atsaukt. Lai labotu ierakstu, sazinieties ar cilvēku:' },
  ru: { yours: 'За вами записано', when: 'Когда', where: 'Где', bring: 'Возьмите с собой', confirm: 'Подтвердить', withdraw: 'Отменить',
    not_booked: 'Это не бронь, пока вы не подтвердите.', gone: 'Ссылка истекла, место вернулось в список.',
    done: 'Подтверждено. Спасибо.', out: 'Отменено. Спасибо, что сообщили заранее.',
    unknown: 'Не удалось найти. Возможно, ссылка уже использована.',
    closed: 'Эта потребность закрыта, поэтому ничего не подтверждено.',
    review: 'Сначала это должен одобрить координатор. Пока ничего не подтверждено.',
    credential: 'Для этого нужна квалификация, подтверждения которой у нас нет, поэтому ничего не подтверждено. Поможет человек:',
    delivered: 'Это уже выполнено, поэтому отменить нельзя. Чтобы исправить запись, свяжитесь с человеком:' },
};

export function contributor({ db, params, query }) {
  const c = one(db, 'select * from commitments where token=?', params[0]);
  if (!c) return simple('—', CONTRIB.en.unknown);
  const need = one(db, 'select * from needs where need_id=?', c.need_id);
  const init = one(db, 'select * from initiatives where initiative_id=?', c.initiative_id);
  const cfg = configFor(init);
  const L = CONTRIB[need.language] ?? CONTRIB.en;
  // The notice says what actually happened, never what was attempted.
  const NOTICE = {
    confirm: L.done, withdraw: L.out, expired: L.gone, closed: L.closed, review_required: L.review,
    credential_required: `${L.credential} ${cfg.human_contact}`, delivered: `${L.delivered} ${cfg.human_contact}`,
  };
  const notice = NOTICE[query.get('done')] ?? null;
  const expired = c.state === 'proposed' && c.lease_expires_at && c.lease_expires_at <= new Date().toISOString();

  return `<!doctype html><html lang="${esc(need.language ?? 'en')}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(need.description_short ?? '')}</title>
<link rel="stylesheet" href="/style.css?v=${STYLE_VERSION}"></head><body class="contributor"><main class="wrap narrow">
${String(html`
  ${notice ? html`<p class="notice">${notice}</p>` : ''}
  <h1>${L.yours}</h1>
  <p class="big">${num(c.qty)} ${need.unit} — ${need.description}</p>
  <dl class="four">
    <div><dt>${L.when}</dt><dd>${fmtWhen(need.window_start)}${need.window_end ? ` – ${String(need.window_end).slice(11, 16)}` : ''}</dd></div>
    <div><dt>${L.where}</dt><dd>${need.geo_place ?? init.place ?? '—'}</dd></div>
    <div><dt>${L.bring}</dt><dd>${bringLine(need)}</dd></div>
    <div><dt>${init.title}</dt><dd><a href="/i/${init.slug}">${init.objective?.slice(0, 80)}…</a></dd></div>
  </dl>
  ${expired && notice !== L.gone ? html`<p class="notice warn">${L.gone}</p>` : ''}
  ${['withdrawn', 'expired', 'failed'].includes(c.state) ? html`<p class="notice">${L.out}</p>` : html`
    ${c.state === 'proposed' && !expired ? html`<p class="muted">${L.not_booked}</p>` : ''}
    <div class="two-buttons">
      <form method="post" action="/c/${c.token}/confirm"><button class="primary" ${raw(c.state === 'confirmed' ? 'disabled' : '')}>${L.confirm}</button></form>
      <form method="post" action="/c/${c.token}/withdraw"><button class="primary">${L.withdraw}</button></form>
    </div>
    <p class="muted small">Withdraw is one tap, exactly like confirm. If you cannot come, this is the
      most useful thing you can do, and doing it early costs nobody anything.</p>`}
  <p class="muted small">Sent automatically. A person reads ${cfg.human_contact}.</p>
`)}
</main></body></html>`;
}

function bringLine(need) {
  const quals = JSON.parse(need.qualifications ?? '[]');
  const m = /\b(gloves|boots|cimd|zābak|перчат|сапог)\w*/i.exec(need.description ?? '');
  const bits = [];
  if (quals.length) bits.push(`your ${quals.join(', ')}`);
  if (m) bits.push(m[0]);
  return bits.length ? bits.join(' · ') : 'nothing in particular';
}

export function contributorAction({ db, params, res, redirect }) {
  const [token, action] = params;
  const result = action === 'confirm' ? confirmByToken(db, token) : withdrawByToken(db, token, 'withdrawn from the link');
  if (!result.ok && result.reason === 'unknown') return simple('—', CONTRIB.en.unknown);
  return redirect(res, `/c/${token}?done=${result.ok ? action : result.reason}`);
}

/**
 * An invitation link. Opening it changes nothing: mail scanners and link
 * previews follow every link in a message, and a GET that booked people would
 * book whoever had a scanner. The page says what is asked; the button acts.
 */
export function take({ db, params }) {
  const ask = one(db, 'select * from asks where ask_id=?', params[0]);
  if (!ask) return simple('—', 'We could not find that invitation.');
  const need = one(db, 'select * from needs where need_id=?', ask.need_id);
  const init = one(db, 'select * from initiatives where initiative_id=?', need.initiative_id);
  const cfg = configFor(init);
  return page({
    title: need.description_short ?? 'Invitation',
    body: String(html`
      <p class="crumb"><a href="/i/${init.slug}">${init.title}</a></p>
      <h1>${need.description_short ?? need.description}</h1>
      <p class="lede">${need.description}</p>
      <dl class="four">
        <div><dt>When</dt><dd>${fmtWhen(need.window_start)}</dd></div>
        <div><dt>Where</dt><dd>${need.geo_place ?? init.place ?? '—'}</dd></div>
      </dl>
      <form method="post" action="/take/${ask.ask_id}"><button class="primary">I can do this</button></form>
      <p class="muted small">Nothing is booked until you press the button. Sent automatically. A person reads ${cfg.human_contact}.</p>
    `),
  });
}

export function takeAccept({ db, params, res, redirect }) {
  const out = acceptInvitation(db, { askId: params[0] });
  if (out.reason === 'unknown') return simple('—', 'We could not find that invitation.');
  if (out.ok) return redirect(res, `/c/${out.token}`);
  const back = `/i/${out.initiative.slug}`;
  if (out.review) {
    return simple(out.need.description_short ?? 'Thank you',
      'Thank you. A coordinator has to approve this one before it is booked, and will come back to you. Nothing is booked yet.', back);
  }
  return simple(out.need.description_short ?? 'Filled',
    'Thank you — that one filled up since we wrote to you. The initiative page shows what is still open.', back);
}

// ---------------------------------------------------------------------------
// The coordinator console: one queue, four keys
// ---------------------------------------------------------------------------

export function queue({ db, params, session }) {
  const init = params[0] ? one(db, 'select * from initiatives where slug=?', params[0]) : null;
  const items = queueItems(db, init?.initiative_id ?? null);
  const stats = overrideStats(db, init?.initiative_id ?? null);
  const now = new Date();

  if (!items.length) {
    return page({ title: 'Queue', session, body: String(html`
      <h1>Queue</h1><p class="empty">Nothing waiting. ${stats.labels} labels recorded so far.</p>`) });
  }

  const detail = offerDetail(db, items[0].offer_id);
  const ex = detail.extracted ?? {};
  const cfg = configFor(detail.initiative);

  return page({
    title: `Queue · ${items.length}`,
    session,
    body: String(html`
      <div class="queuehead">
        <h1>Queue</h1>
        <p class="muted">Oldest item has been waiting <b>${ago(items[0].received_at, now)}</b>.
          ${items.length} in the queue. ${stats.labels} labels recorded,
          ${stats.agreed} agreed with the model, ${stats.disagreed} did not${stats.median_seconds != null ? `, median ${stats.median_seconds.toFixed(1)} s an item` : ''}.</p>
      </div>

      <article class="item" data-offer="${detail.offer.offer_id}">
        <header>
          <span>${detail.offer.channel} · ${detail.offer.handle} · ${detail.offer.language}</span>
          <span class="muted">waiting ${ago(detail.offer.received_at, now)} · ${detail.initiative.title}</span>
        </header>
        <blockquote class="verbatim">${detail.offer.raw_text}</blockquote>

        <div class="extracted">
          <span><b>quantities</b> ${(ex.quantities ?? []).map((q) => `${q.value} ${q.unit ?? '?'}`).join(', ') || '—'}</span>
          <span><b>window</b> ${ex.window?.start ? `${fmtWhen(ex.window.start)} (${ex.window.kind})` : 'none stated'}</span>
          <span><b>place</b> ${(ex.places ?? []).map((p) => p.name).join(', ') || '—'}</span>
          <span><b>screen</b> offer ${fmt2(detail.screen.is_offer)} · question ${fmt2(detail.screen.is_question)}
            · adversarial ${fmt2(detail.screen.is_adversarial)} · withdrawal ${fmt2(detail.screen.is_withdrawal)}
            · specificity ${fmt2(detail.screen.specificity)}</span>
        </div>

        <ol class="candidates">
          ${detail.shortlist.slice(0, 3).map((c, i) => html`<li>
            <kbd>${i + 1}</kbd>
            <span class="cand">${c.need.description}</span>
            <span class="nums">rank ${fmt2(c.p)} · fits ${fmt2(c.fits)} · <b>${fmt2(c.confidence)}</b>
              vs ${Number.isFinite(thresholdFor(cfg, c.need.risk_class)) ? thresholdFor(cfg, c.need.risk_class).toFixed(2) : 'never'}</span>
            ${tag(`class ${c.need.risk_class}`, c.need.risk_class === 3 ? 'risk3' : c.need.risk_class === 2 ? 'risk2' : '')}
            ${c.need.qty_required - c.need.qty_committed <= 0 ? tag('full', 'warn') : ''}
          </li>`)}
        </ol>

        <form method="post" action="/q/${detail.offer.offer_id}/action" id="act">
          <input type="hidden" name="need_id" id="need_id">
          <input type="hidden" name="action" id="action">
          <input type="hidden" name="seconds" id="seconds">
          <div class="actions">
            ${detail.shortlist.slice(0, 3).map((c, i) => html`
              <button type="button" data-action="bind" data-need="${c.need.need_id}"><kbd>${i + 1}</kbd> bind</button>`)}
            <button type="button" data-action="not_an_offer"><kbd>N</kbd> not an offer</button>
            <button type="button" data-action="ask"><kbd>A</kbd> ask one question</button>
            <button type="button" data-action="reject"><kbd>R</kbd> reject</button>
          </div>
          <input name="note" placeholder="the one question to ask, or a note for the label" autocomplete="off">
        </form>
        <p class="muted small">Every action writes a labelled override against the judgment that produced
          this ranking. That label, not the cleared queue, is what this screen is for.
          ${detail.judgment_id ? html`<a href="/j/${detail.judgment_id}">See the judgment.</a>` : ''}</p>
      </article>

      <script>
        const started = performance.now();
        const form = document.getElementById('act');
        function go(action, need) {
          document.getElementById('action').value = action;
          document.getElementById('need_id').value = need || '';
          document.getElementById('seconds').value = ((performance.now() - started) / 1000).toFixed(1);
          form.submit();
        }
        for (const b of document.querySelectorAll('[data-action]')) {
          b.addEventListener('click', () => go(b.dataset.action, b.dataset.need));
        }
        const keys = { '1': 0, '2': 1, '3': 2 };
        document.addEventListener('keydown', (e) => {
          if (e.target.tagName === 'INPUT' && e.key !== 'Enter') return;
          const binds = [...document.querySelectorAll('[data-action="bind"]')];
          if (e.key in keys && binds[keys[e.key]]) { e.preventDefault(); binds[keys[e.key]].click(); }
          else if (e.key.toLowerCase() === 'n') { e.preventDefault(); go('not_an_offer'); }
          else if (e.key.toLowerCase() === 'a') { e.preventDefault(); go('ask'); }
          else if (e.key.toLowerCase() === 'r') { e.preventDefault(); go('reject'); }
        });
      </script>
    `),
  });
}

export function queueAction({ db, params, body, session, res, redirect, baseUrl }) {
  const result = applyQueueAction(db, {
    offerId: params[0], action: body.action, needId: body.need_id || null,
    note: body.note || null, seconds: body.seconds, coordinator: session?.name ?? 'coordinator', baseUrl,
  });
  if (!result.ok) return simple('Queue', result.error, '/q');
  return redirect(res, '/q');
}

// ---------------------------------------------------------------------------
// The need editor
// ---------------------------------------------------------------------------

export async function needEditor(ctx) {
  const { db, params, query, session } = ctx;
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  if (!init) return notFound();
  const needs = needsOf(db, init.initiative_id);
  const errors = ctx.errors ?? {};
  const draft = ctx.draft ?? {};
  const warnings = ctx.warnings ?? [];

  let proposal = null;
  if (query.get('propose') === '1') proposal = await proposeDecomposition(db, { initiative: init });

  return page({
    title: `Needs · ${init.title}`,
    session,
    nav: [[`/i/${init.slug}`, init.title], [`/admin/${init.slug}`, 'Admin']],
    body: String(html`
      <p class="crumb"><a href="/i/${init.slug}">${init.title}</a></p>
      <h1>The catalogue</h1>
      <p class="lede">This is the screen that decides everything. A vague need is the single largest source
        of downstream failure, and the place to fix it is here rather than in the matcher.
        Nothing publishes without a quantity, a unit and a window.</p>

      <table class="needs compact">
        <thead><tr><th>Short form (what the ranking pass sees)</th><th class="n">Req</th><th class="n">Com</th>
          <th>Window</th><th>Risk</th><th>Requires</th><th></th></tr></thead>
        <tbody>${needs.map((n) => html`<tr>
          <td><b>${n.description_short}</b><br><span class="muted">${n.description}</span></td>
          <td class="n">${num(n.qty_required)} ${n.unit}</td>
          <td class="n">${num(n.qty_committed)}</td>
          <td>${fmtDate(n.window_start)}</td>
          <td>${n.risk_class}</td>
          <td>${(JSON.parse(n.qualifications ?? '[]')).join(', ') || '—'}</td>
          <td>
            <form method="post" action="/i/${init.slug}/needs/${n.need_id}/amend" class="inline">
              <input name="qty_required" value="${num(n.qty_required)}" size="4" aria-label="quantity">
              <input name="reason" placeholder="reason (public)" size="22" required>
              <button>Amend</button>
            </form>
          </td>
        </tr>`)}</tbody>
      </table>

      <h2>Add a need</h2>
      ${warnings.length ? html`<ul class="warnings">${warnings.map((w) => html`<li>${w}</li>`)}</ul>` : ''}
      <form method="post" class="grid">
        ${raw(field({ name: 'description', label: 'What is needed', type: 'textarea', value: draft.description ?? '',
          hint: 'a stranger should be able to act on it without asking a question', errors: errors.description ?? [],
          attrs: 'rows="2"' }))}
        ${raw(field({ name: 'description_short', label: 'Short form', value: draft.description_short ?? '',
          hint: 'at most 60 characters. this is all the ranking pass sees', errors: errors.description_short ?? [],
          attrs: 'maxlength="60"' }))}
        ${raw(field({ name: 'kind', label: 'Kind', value: draft.kind ?? 'labour', options: KINDS, errors: errors.kind ?? [] }))}
        ${raw(field({ name: 'qty_required', label: 'How much', value: draft.qty_required ?? '', type: 'number',
          errors: errors.qty_required ?? [], attrs: 'step="any" min="0"' }))}
        ${raw(field({ name: 'unit', label: 'Of what', value: draft.unit ?? 'person', options: UNITS, errors: errors.unit ?? [] }))}
        ${raw(field({ name: 'window_start', label: 'From', value: draft.window_start ?? '', type: 'datetime-local', errors: errors.window_start ?? [] }))}
        ${raw(field({ name: 'window_end', label: 'Until', value: draft.window_end ?? '', type: 'datetime-local', errors: errors.window_end ?? [] }))}
        ${raw(field({ name: 'geo_place', label: 'Where', value: draft.geo_place ?? init.place ?? '' }))}
        ${raw(field({ name: 'geo_radius_km', label: 'Within (km)', value: draft.geo_radius_km ?? 25, type: 'number' }))}
        ${raw(field({ name: 'risk_class', label: 'Risk class', value: draft.risk_class ?? 1,
          options: [[1, '1 — reversible, no credential, no money'], [2, '2 — money, a public commitment, hard to undo'],
            [3, '3 — safety, certification, hazardous work, minors']], errors: errors.risk_class ?? [] }))}
        ${raw(field({ name: 'qualifications', label: 'Requires (codes, comma separated)', value: draft.qualifications ?? '',
          hint: 'checked against verified credentials, never inferred' }))}
        ${raw(field({ name: 'language', label: 'Language', value: draft.language ?? 'en', options: ['en', 'lv', 'ru'] }))}
        <button type="submit">Publish</button>
      </form>

      <h2>Propose a decomposition</h2>
      <p class="muted">The judgment model does not generate text, and it should not invent a need nobody wrote.
        Code splits the objective into clauses; the model classifies each one and says whether it is concrete
        enough to act on. You write the rest.</p>
      ${proposal ? html`<table class="needs compact"><thead><tr><th>Clause from the objective</th><th>Kind</th>
          <th class="n">Concrete</th><th>Missing</th></tr></thead><tbody>
        ${proposal.map((p) => html`<tr>
          <td>${p.text}</td>
          <td>${p.kind} <span class="muted">${fmt2(p.kind_confidence)}</span></td>
          <td class="n ${raw(p.concrete < 0.5 ? 'bad' : '')}">${fmt2(p.concrete)}</td>
          <td>${p.missing.length ? p.missing.join(', ') : '—'}</td>
        </tr>`)}</tbody></table>`
        : html`<p><a class="button" href="/i/${init.slug}/needs?propose=1">Propose from the objective</a></p>`}
    `),
  });
}

export async function needCreate(ctx) {
  const { db, params, body } = ctx;
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  if (!init) return notFound();
  const draft = {
    ...body,
    qty_required: body.qty_required === '' ? null : Number(body.qty_required),
    risk_class: Number(body.risk_class),
    geo_radius_km: body.geo_radius_km ? Number(body.geo_radius_km) : 25,
    window_start: isoOrNull(body.window_start),
    window_end: isoOrNull(body.window_end),
    qualifications: String(body.qualifications ?? '').split(/[,\s]+/).filter(Boolean),
    geo_lat: init.geo_lat, geo_lon: init.geo_lon,
  };
  const result = publishNeed(db, { initiative: init, draft, author: `coordinator:${ctx.session?.name ?? '?'}` });
  if (!result.ok) {
    return needEditor({ ...ctx, draft: body, errors: fieldErrors(result.errors), warnings: result.warnings ?? [] });
  }
  return ctx.redirect(ctx.res, `/i/${init.slug}/needs`);
}

export function needAmend(ctx) {
  const { db, params, body } = ctx;
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  const need = one(db, 'select * from needs where need_id=?', params[1]);
  if (!init || !need) return notFound();
  const changes = {};
  if (body.qty_required !== undefined && body.qty_required !== '') changes.qty_required = Number(body.qty_required);
  const result = amendNeed(db, { need, changes, author: `coordinator:${ctx.session?.name ?? '?'}`, reason: body.reason });
  if (!result.ok) return simple('Amendment refused', result.errors.join(' '), `/i/${init.slug}/needs`);
  return ctx.redirect(ctx.res, `/i/${init.slug}/needs`);
}

export function needClose(ctx) {
  const { db, params, body } = ctx;
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  const need = one(db, 'select * from needs where need_id=?', params[1]);
  if (!init || !need) return notFound();
  closeNeed(db, { need, author: `coordinator:${ctx.session?.name ?? '?'}`, reason: body.reason ?? 'closed by the coordinator' });
  return ctx.redirect(ctx.res, `/i/${init.slug}/needs`);
}

// ---------------------------------------------------------------------------
// Admin: the switch, and what it costs
// ---------------------------------------------------------------------------

export function admin({ db, params, session }) {
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  if (!init) return notFound();
  const cfg = configFor(init);
  const day = new Date().toISOString().slice(0, 10);
  const spend = one(db, 'select * from spend where initiative_id=? and day=?', init.initiative_id, day)
    ?? { calls: 0, cost_usd: 0 };
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  const recent = one(db, 'select count(*) c from judgments where initiative_id=? and created_at > ?', init.initiative_id, minuteAgo).c;
  const engine = one(db, 'select engine, model_version from judgments where initiative_id=? order by created_at desc limit 1', init.initiative_id);

  return page({
    title: `Admin · ${init.title}`,
    session,
    nav: [[`/i/${init.slug}`, init.title], [`/i/${init.slug}/needs`, 'Needs']],
    body: String(html`
      <p class="crumb"><a href="/i/${init.slug}">${init.title}</a></p>
      <h1>Operator</h1>

      <section class="switch ${raw(init.autobind ? 'on' : 'off')}">
        <div>
          <h2>Automatic binds are ${init.autobind ? 'on' : 'off'}</h2>
          <p>${init.autobind
            ? 'Offers above the threshold for their risk class bind themselves and get a specific reply.'
            : 'Every offer that would have bound is going to the queue instead. This took effect immediately.'}</p>
        </div>
        <form method="post" action="/admin/${init.slug}/autobind">
          <input type="hidden" name="autobind" value="${init.autobind ? '0' : '1'}">
          <button class="primary">${init.autobind ? 'Switch off' : 'Switch on'}</button>
        </form>
      </section>

      <h2>Thresholds</h2>
      <table class="needs compact"><thead><tr><th>Risk class</th><th>What is in it</th><th>Auto-bind at</th></tr></thead>
        <tbody>${[1, 2, 3].map((r) => html`<tr>
          <td>${r}</td><td>${RISK[r]}</td>
          <td>${mayAutoBind(r) ? thresholdFor(cfg, r).toFixed(2) : html`<b>never, at any confidence</b>`}</td>
        </tr>`)}</tbody></table>
      <p class="muted">Class 3 is not a high threshold. There is no number that can be written here:
        <code>thresholdFor()</code> returns infinity and <code>mayAutoBind()</code> returns false, so the
        refusal is structural rather than a setting somebody can change in a hurry.</p>

      <h2>Today</h2>
      <div class="facts">
        <div><span>Judgments</span><b>${spend.calls}</b></div>
        <div><span>Spent</span><b>${money(spend.cost_usd)} of ${money(cfg.daily_cost_cap_usd)}</b></div>
        <div><span>Last minute</span><b>${recent} of ${cfg.rate_per_minute}</b></div>
        <div><span>Engine</span><b>${engine?.engine ?? '—'}</b></div>
        <div><span>Model</span><b>${engine?.model_version ?? '—'}</b></div>
        <div><span>Question bank</span><b>${BANK_VERSION}+${BANK_HASH}</b></div>
      </div>
      <p class="muted">Past the cap, the pipeline queues rather than spends. A flood degrades to queueing.</p>

      <h2>The question bank</h2>
      <p class="muted">${Object.keys(BANK).length} questions in one versioned file, code-reviewed like code.
        Every judgment records which version ran.</p>
      <ul class="bank">${Object.entries(BANK).map(([k, q]) => html`<li>
        <code>${k}</code> <span class="tag">${q.type}</span> ${q.instructions}</li>`)}</ul>
    `),
  });
}

export function adminAutobind(ctx) {
  const { db, params, body } = ctx;
  const init = one(db, 'select * from initiatives where slug=?', params[0]);
  if (!init) return notFound();
  emit(db, {
    type: 'initiative.autobind_set', initiative_id: init.initiative_id,
    author: `coordinator:${ctx.session?.name ?? '?'}`,
    reason: body.autobind === '1' ? 'switched on by the operator' : 'switched off by the operator',
    payload: { initiative_id: init.initiative_id, autobind: body.autobind === '1' },
  });
  return ctx.redirect(ctx.res, `/admin/${init.slug}`);
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export function judgment({ db, params, session }) {
  const j = one(db, 'select * from judgments where judgment_id=?', params[0]);
  if (!j) return notFound();
  const offer = j.offer_id ? one(db, 'select * from offers where offer_id=?', j.offer_id) : null;
  return page({
    title: 'Judgment',
    session,
    body: String(html`
      <h1>Judgment</h1>
      <p class="lede">Every commitment names the judgment that produced it, so any bind can be reproduced and
        argued about a year later. This is the whole record, including the probabilities that were not picked.</p>
      <div class="facts">
        <div><span>Pass</span><b>${j.pass}</b></div>
        <div><span>Engine</span><b>${j.engine}</b></div>
        <div><span>Model</span><b>${j.model_version}</b></div>
        <div><span>Question bank</span><b>${j.question_bank_version}</b></div>
        <div><span>Latency</span><b>${j.latency_ms} ms</b></div>
        <div><span>Input tokens</span><b>${j.input_tokens}</b></div>
        <div><span>Cost</span><b>${money(j.cost_usd)}</b></div>
        <div><span>State hash</span><b class="mono">${String(j.state_hash).slice(0, 16)}</b></div>
      </div>
      ${offer ? html`<h2>The message, as it was written</h2>
        <blockquote class="verbatim">${offer.raw_text}</blockquote>
        <p class="muted">Kept verbatim and never rewritten. What left this machine is below, with the
          identifiers removed.</p>` : ''}
      <h2>What was sent</h2>
      <pre class="json">${JSON.stringify(JSON.parse(j.request), null, 2)}</pre>
      <h2>What came back</h2>
      <pre class="json">${JSON.stringify(JSON.parse(j.answers), null, 2)}</pre>
    `),
  });
}

export function actor({ db, params, session }) {
  const a = one(db, 'select * from actors where actor_id=?', params[0]);
  if (!a) return notFound();
  const record = deliveryRecord(db, a.actor_id);
  const contacts = all(db, 'select * from contacts where actor_id=?', a.actor_id);
  const creds = all(db, 'select * from credentials where actor_id=?', a.actor_id);
  const caps = all(db, 'select * from capabilities where actor_id=?', a.actor_id);
  return page({
    title: a.display_name ?? 'Actor',
    session,
    body: String(html`
      <h1>${a.display_name ?? a.actor_id}</h1>
      <p class="muted">${a.kind} · reachable on ${contacts.map((c) => c.channel).join(', ') || 'no channel'}</p>
      ${creds.length ? html`<p>Verified credentials: ${creds.map((c) => tag(`${c.code} · ${c.issuer ?? 'unknown issuer'}`)).join(' ')}</p>` : ''}
      <h2>Record</h2>
      <div class="facts">
        <div><span>Commitments</span><b>${record.commitments}</b></div>
        <div><span>Fulfilled</span><b>${record.fulfilled}</b></div>
        <div><span>Withdrawn</span><b>${record.withdrawn}</b></div>
        <div><span>Did not appear</span><b>${record.failed}</b></div>
      </div>
      <p class="muted">A record of what happened, with no score computed from it. A reputation model built
        on this many data points would be worse than none.</p>
      ${record.rows.length ? html`<table class="commitments"><thead><tr><th>Need</th><th class="n">Qty</th>
          <th>State</th><th class="n">Delivered</th><th class="n">Variance</th><th>Verified by</th></tr></thead>
        <tbody>${record.rows.map((r) => html`<tr>
          <td>${String(r.description).slice(0, 56)}</td><td class="n">${num(r.qty)} ${r.unit}</td>
          <td>${tag(r.state, r.state === 'fulfilled' ? 'good' : '')}</td>
          <td class="n">${r.qty_delivered != null ? num(r.qty_delivered) : '—'}</td>
          <td class="n">${r.variance != null ? num(r.variance) : '—'}</td>
          <td>${r.verified_by ?? '—'}</td></tr>`)}</tbody></table>` : ''}
      ${caps.length ? html`<h2>What they told us they can do</h2>
        <ul class="trail">${caps.map((c) => html`<li><b>${c.kind}</b> ${c.description}
          ${c.quantity ? html` · ${num(c.quantity)} ${c.unit ?? ''}` : ''}
          <span class="muted">${c.evidence ?? ''}</span></li>`)}</ul>
        <p class="muted">These are what the outbound engine ranks when a need ages without commitments.</p>` : ''}
    `),
  });
}

export function outbox({ db, session }) {
  const rows = all(db, 'select * from outbox order by sent_at desc limit 200');
  return page({
    title: 'Outbox',
    session,
    body: String(html`
      <h1>Outbox</h1>
      <p class="lede">Every automated message this instance sent. Each one says it is automated and names a
        person to reach, because people forgive a machine that says so and do not forgive one that pretended.</p>
      ${rows.length ? html`<ul class="outbox">${rows.map((m) => html`<li>
        <header><b>${m.channel}</b> → ${m.handle} ${tag(m.kind)} <span class="muted">${fmtWhen(m.sent_at)}</span></header>
        <pre>${maskTokens(m.body)}</pre></li>`)}</ul>` : html`<p class="empty">Nothing sent yet.</p>`}
    `),
  });
}

export function events({ db, session }) {
  const chain = verifyChain(db);
  const rows = all(db, 'select * from events order by seq desc limit 300');
  return page({
    title: 'Log',
    session,
    body: String(html`
      <h1>The log</h1>
      <p class="lede">State is a fold over this table. Drop every derived table, fold it again, and you get the
        same state — <code>npm run replay</code> checks exactly that.</p>
      <p class="${raw(chain.ok ? 'notice good' : 'notice warn')}">
        ${chain.ok ? `${chain.count} events, hash chain verifies, head ${String(chain.head).slice(0, 16)}…`
          : `Chain broken at seq ${chain.seq}: ${chain.why}`}</p>
      <table class="needs compact"><thead><tr><th class="n">Seq</th><th>Type</th><th>Author</th><th>Reason</th><th>When</th></tr></thead>
        <tbody>${rows.map((e) => html`<tr>
          <td class="n">${e.seq}</td><td><code>${e.type}</code></td><td>${e.author}</td>
          <td>${e.reason ?? ''}</td><td class="muted">${fmtWhen(e.at)}</td></tr>`)}</tbody></table>
    `),
  });
}

// ---------------------------------------------------------------------------

function fmt2(x) { return x == null ? '—' : Number(x).toFixed(2); }

function isoOrNull(v) {
  if (!v) return null;
  const d = new Date(v.length <= 16 ? `${v}:00Z` : v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Put each refusal next to the field it is about, not in a flash message. */
function fieldErrors(errors) {
  const map = {};
  const put = (k, e) => { (map[k] ??= []).push(e); };
  for (const e of errors) {
    if (/quantity/i.test(e) && /below what is already committed/i.test(e)) put('qty_required', e);
    else if (/quantity/i.test(e)) put('qty_required', e);
    else if (/unit/i.test(e)) put('unit', e);
    else if (/window/i.test(e)) put('window_start', e);
    else if (/description_short/i.test(e)) put('description_short', e);
    else if (/description/i.test(e)) put('description', e);
    else if (/kind/i.test(e)) put('kind', e);
    else if (/risk_class/i.test(e)) put('risk_class', e);
    else put('description', e);
  }
  return map;
}

function notFound() {
  return { status: 404, body: simple('Not found', 'There is nothing at that address.') };
}

function simple(title, message, back = '/') {
  return layout({
    title,
    body: String(html`<h1>${title}</h1><p class="lede">${message}</p><p><a href="${back}">Back</a></p>`),
  });
}
