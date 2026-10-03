import { id, sha256 } from '../ids.js';
import {
  createInquiry, addSource as saveSource, saveDraft as saveAccount, reviewDraft as acceptDraft,
  submitContribution, reviewContribution, publishVersion, deleteContributionByToken,
  setContributionPublicReleaseByToken, setSourcePublicRelease,
  listInquiries, getInquiry, listSources, listPendingContributions, getReceipt,
} from '../inquiry/index.js';
import { html, raw, layout, field, tag, fmtWhen } from './views.js';

// This prototype has one shared coordinator credential. The audit identifier is
// stable across logins and restarts, and never contains a person's display name.
const principalOf = (session) => session ? 'coordinator:local' : null;
const unavailable = () => ({ status: 404, type: 'text/plain; charset=utf-8', body: 'Not found.' });

function noStore(ctx) {
  ctx.res.setHeader('cache-control', 'no-store');
  ctx.res.setHeader('referrer-policy', 'no-referrer');
}

function page(ctx, title, body, nav = []) {
  noStore(ctx);
  return layout({ title, session: ctx.session, body: String(body), nav });
}

function problem(ctx, title, explanation, status = 400) {
  return { status, type: 'text/html; charset=utf-8', body: page(ctx, title, html`
    <h1>${title}</h1><p>${explanation}</p><p><a href="/topics">Topics</a></p>`) };
}

function inquiryView(ctx) {
  return getInquiry(ctx.db, { slug: ctx.params[0], principal: principalOf(ctx.session) });
}

function strings(lines) {
  return String(lines ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

function accountFromForm(form) {
  const findings = [];
  const count = Math.min(100, Math.max(3, Number(form.finding_count) || 3));
  for (let i = 1; i <= count; i++) {
    const text = String(form[`finding_${i}`] ?? '').trim();
    if (!text) continue;
    findings.push({
      text,
      sourceIds: String(form[`finding_${i}_sources`] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      standing: form[`finding_${i}_standing`] || 'reported',
    });
  }
  return {
    summary: String(form.summary ?? '').trim(),
    findings,
    uncertainties: strings(form.uncertainties),
    nextSteps: strings(form.next_steps),
  };
}

function accountEditor(account = null, prefix = '') {
  const body = account?.body ?? {};
  const findings = Array.isArray(body.findings) ? body.findings : [];
  const count = Math.min(100, Math.max(3, findings.length + 1));
  const scoped = (args) => field({ ...args, id: `${prefix}${args.name}` });
  return html`
    <input type="hidden" name="finding_count" value="${count}">
    ${scoped({ name: 'summary', label: 'Current account', value: body.summary ?? '', type: 'textarea',
      hint: 'A short account someone can resume from.', attrs: 'rows="4"' })}
    <p class="muted small">Each finding names the source IDs that support it. Keep uncertainty and alternatives visible.</p>
    ${Array.from({ length: count }, (_, n) => n + 1).map((i) => html`
      <details class="card" ${raw(findings[i - 1] || i === 1 ? 'open' : '')}>
        <summary>Finding ${i}${findings[i - 1]?.text ? `: ${findings[i - 1].text.slice(0, 60)}` : ''}</summary>
        ${scoped({ name: `finding_${i}`, label: 'Finding or observation', value: findings[i - 1]?.text ?? '',
          type: 'textarea', attrs: 'rows="2"' })}
        ${scoped({ name: `finding_${i}_sources`, label: 'Supporting source IDs',
          hint: 'Comma separated, from the source list below.',
          value: (findings[i - 1]?.sourceIds ?? []).join(', ') })}
        ${scoped({ name: `finding_${i}_standing`, label: 'Standing',
          value: findings[i - 1]?.standing ?? 'reported',
          options: [['reported', 'Reported'], ['checked', 'Source checked by editor'], ['inference', 'Inference']] })}
      </details>`)}
    ${scoped({ name: 'uncertainties', label: 'Uncertainties and alternatives',
      hint: 'One per line. A corrected premise belongs here too.',
      value: (body.uncertainties ?? []).join('\n'), type: 'textarea', attrs: 'rows="3"' })}
    ${scoped({ name: 'next_steps', label: 'Useful next steps', hint: 'One per line.',
      value: (body.nextSteps ?? []).join('\n'), type: 'textarea', attrs: 'rows="3"' })}
  `;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function sourceList(sources, { editableSlug = null } = {}) {
  if (!sources.length) return html`<p class="empty">No sources recorded for this view yet.</p>`;
  return html`<ol class="trail">${sources.map((s) => {
    const url = safeUrl(s.url);
    return html`<li id="source-${s.source_id}"><b>${s.source_id}</b> ·
      ${url ? html`<a href="${url}" rel="noreferrer">${s.publisher || url}</a>` : (s.publisher || 'Source')}
      ${s.locator ? html` · ${s.locator}` : ''}
      ${s.status ? html` · ${tag(s.status)}` : ''}
      ${s.publicRelease ? tag('may be released', 'good') : tag('internal only', 'warn')}
      ${s.text ? html`<p class="muted">${s.text}</p>` : ''}
      ${editableSlug ? html`<form method="post" action="/topics/${editableSlug}/sources/${s.source_id}/release">
        <label><input type="checkbox" name="public_release" value="yes" ${raw(s.publicRelease ? 'checked' : '')}> Permit this source in a public release</label>
        <input type="hidden" name="command_id" value="${id('cmd')}">
        <button type="submit">Save source sharing</button>
      </form>` : ''}
    </li>`;
  })}</ol>`;
}

function accountView(account, sources) {
  if (!account) return html`<p class="empty">No reviewed account exists yet.</p>`;
  const body = account.body ?? {};
  const available = new Set(sources.map((s) => s.source_id));
  return html`
    <p class="muted">Version ${account.version} · ${account.state === 'reviewed' ? 'reviewed by project operator' : 'saved draft'} · ${account.revision_id}</p>
    <p class="lede">${body.summary || 'No summary yet.'}</p>
    <h2>What the record says</h2>
    ${body.findings?.length ? html`<ul class="trail">${body.findings.map((f) => html`<li>
      ${f.text} ${tag(f.standing === 'checked' ? 'source checked by editor' : (f.standing || 'reported'))}
      <span class="muted">${(f.sourceIds ?? []).filter((sid) => available.has(sid)).map((sid) => html` <a href="#source-${sid}">${sid}</a>`)}</span>
    </li>`)}</ul>` : html`<p class="empty">No findings reviewed yet.</p>`}
    <h2>What remains uncertain</h2>
    ${body.uncertainties?.length ? html`<ul>${body.uncertainties.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="muted">No uncertainties recorded in this version.</p>`}
    <h2>Useful next steps</h2>
    ${body.nextSteps?.length ? html`<ul>${body.nextSteps.map((x) => html`<li>${x}</li>`)}</ul>` : html`<p class="muted">No next step recorded.</p>`}
  `;
}

export function index(ctx) {
  const rows = listInquiries(ctx.db, { principal: principalOf(ctx.session) });
  return page(ctx, 'Topics', html`
    <h1>Topics</h1>
    <p class="lede">Questions people are developing. A public topic shows only an explicitly released account.</p>
    ${ctx.session ? html`<p><a class="button" href="/topics/new">Start a topic</a></p>` : ''}
    ${rows.length ? html`<div class="cards">${rows.map((r) => html`<a class="card" href="/topics/${r.slug}">
      <h3>${r.title}</h3><p>${r.question}</p><p class="muted">${r.visibility} · version ${r.version ?? 0}</p>
    </a>`)}</div>` : html`<p class="empty">No topics are available yet.</p>`}
  `);
}

export function newForm(ctx) {
  return page(ctx, 'Start a topic', html`
    <h1>Start a topic</h1>
    <p class="lede">Begin with a question worth answering or an artifact worth developing. The account stays private until a reviewed version is released.</p>
    <form method="post" action="/topics">
      ${field({ name: 'title', label: 'Title', attrs: 'required maxlength="120"' })}
      ${field({ name: 'question', label: 'Question or intended result', type: 'textarea', attrs: 'rows="3" required' })}
      ${field({ name: 'visibility', label: 'Who may find this topic?', value: 'private',
        options: [['private', 'Only the project operator'], ['public', 'Everyone after release']] })}
      <input type="hidden" name="command_id" value="${id('cmd')}">
      <button type="submit">Create topic</button>
    </form>
  `);
}

export function create(ctx) {
  const title = String(ctx.body.title ?? '').trim();
  // Slugs are immutable event metadata, so never derive one from a deletable
  // title. The command key makes retries land on the same opaque URL.
  const slug = `t-${sha256(String(ctx.body.command_id ?? '')).slice(0, 24)}`;
  const result = createInquiry(ctx.db, {
    principal: principalOf(ctx.session), slug, title, question: String(ctx.body.question ?? '').trim(),
    visibility: ctx.body.visibility === 'public' ? 'public' : 'private',
    idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Topic not created', result.reason);
  return ctx.redirect(ctx.res, `/topics/${slug}`);
}

export function topic(ctx) {
  const releasedView = ctx.query.get('view') === 'public';
  const view = releasedView
    ? getInquiry(ctx.db, { slug: ctx.params[0], principal: null })
    : inquiryView(ctx);
  if (!view) return unavailable();
  const sources = listSources(ctx.db, { principal: releasedView ? null : principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id });
  const canEdit = !releasedView && (view.role === 'owner' || view.role === 'reviewer');
  const publicView = view.inquiry.visibility === 'public' && view.publication;
  return page(ctx, view.inquiry.title, html`
    <p class="crumb"><a href="/topics">Topics</a></p>
    <h1>${view.inquiry.title}</h1>
    <p class="lede">${view.inquiry.question}</p>
    ${canEdit ? html`<p class="note">This is the working account. Drafts and accepted changes shown here may not be released.</p>` : ''}
    <p class="muted">${view.publication ? html`Latest public release ${fmtWhen(view.publication.published_at)}` : 'No version released yet.'}
      ${canEdit && view.publication ? html` · <a href="/topics/${view.inquiry.slug}?view=public">View the released account</a>` : ''}</p>
    ${accountView(view.account, sources)}
    <h2>Sources and limits</h2>${sourceList(sources, { editableSlug: canEdit ? view.inquiry.slug : null })}
    ${publicView ? html`<p><a class="button" href="/topics/${view.inquiry.slug}/contribute">Add evidence, a correction or an idea</a></p>` : ''}
    ${canEdit ? html`
      <p><a href="/topics/${view.inquiry.slug}/review">Review contributions</a></p>
      <h2>Add a source</h2>
      <form method="post" action="/topics/${view.inquiry.slug}/sources">
        ${field({ name: 'url', label: 'Source URL', hint: 'Optional for a local observation or physical artifact.', type: 'url' })}
        ${field({ name: 'publisher', label: 'Publisher or origin', attrs: 'required' })}
        ${field({ name: 'locator', label: 'Exact passage or location', attrs: 'required' })}
        ${field({ name: 'text', label: 'Relevant passage or observation', type: 'textarea', attrs: 'rows="3" required' })}
        ${field({ name: 'published_at', label: 'Source date', hint: 'Optional, if known.', type: 'date' })}
        <label><input type="checkbox" name="public_release" value="yes"> May be included in a public release</label>
        <input type="hidden" name="retrieved_at" value="${new Date().toISOString()}">
        <input type="hidden" name="command_id" value="${id('cmd')}">
        <p><button type="submit">Save source</button></p>
      </form>
      <h2>Current account</h2>
      <form method="post" action="/topics/${view.inquiry.slug}/draft">
        ${accountEditor(view.account)}
        ${canEdit && view.account?.contribution_ids?.length ? html`<details class="card"><summary>Repair contribution lineage</summary>
          <p class="muted small">If a contributor withdraws text or an earlier contribution no longer supports this account, revise the account above and remove its ID here. The reason is kept in the review record.</p>
          ${view.account.contribution_ids.map((contributionId) => html`<label><input type="checkbox" name="exclude_${contributionId}" value="yes"> Remove ${contributionId} from this new version</label>`)}
          ${field({ name: 'lineage_reason', label: 'Reason for removing contribution IDs', type: 'textarea', attrs: 'rows="2"' })}
        </details>` : ''}
        <input type="hidden" name="expected_version" value="${view.inquiry.version ?? 0}">
        <input type="hidden" name="command_id" value="${id('cmd')}">
        <button type="submit">Save draft</button>
      </form>
      ${view.account?.state === 'saved_draft' ? html`<form method="post" action="/topics/${view.inquiry.slug}/review-draft">
        <input type="hidden" name="revision_id" value="${view.account.revision_id}">
        <input type="hidden" name="expected_version" value="${view.inquiry.version ?? 0}">
        <input type="hidden" name="command_id" value="${id('cmd')}">
        ${field({ name: 'reason', label: 'Review reason', hint: 'Why this account is ready to share with its intended audience.', attrs: 'required' })}
        <button type="submit">Mark this version reviewed</button>
      </form>` : ''}
      ${view.role === 'owner' && view.account?.state === 'reviewed' ? html`<form method="post" action="/topics/${view.inquiry.slug}/publish">
        <input type="hidden" name="revision_id" value="${view.account.revision_id}">
        <input type="hidden" name="command_id" value="${id('cmd')}">
        <button type="submit">Release this reviewed version</button>
        <p class="muted small">Release is separate from saving. Every cited source and incorporated contribution must permit it.</p>
      </form>` : ''}
    ` : ''}
  `);
}

export function addSource(ctx) {
  const view = inquiryView(ctx);
  if (!view) return unavailable();
  const result = saveSource(ctx.db, {
    principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id,
    source: {
      url: ctx.body.url, publisher: ctx.body.publisher, locator: ctx.body.locator,
      text: ctx.body.text, publishedAt: ctx.body.published_at || null,
      eventAt: null, retrievedAt: ctx.body.retrieved_at || null, status: 'available',
      language: null, originalLanguage: null, publicRelease: ctx.body.public_release === 'yes',
    }, idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Source not saved', result.reason);
  return ctx.redirect(ctx.res, `/topics/${view.inquiry.slug}#source-${result.source_id}`);
}

export function setSourceRelease(ctx) {
  const view = inquiryView(ctx);
  if (!view) return unavailable();
  const result = setSourcePublicRelease(ctx.db, {
    principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id,
    sourceId: ctx.params[1], publicRelease: ctx.body.public_release === 'yes',
    idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Source sharing not saved', result.reason);
  return ctx.redirect(ctx.res, `/topics/${view.inquiry.slug}#source-${ctx.params[1]}`);
}

export function saveDraft(ctx) {
  const view = inquiryView(ctx);
  if (!view) return unavailable();
  const excludeContributionIds = Object.entries(ctx.body)
    .filter(([name, value]) => /^exclude_[a-z0-9_]+$/.test(name) && value === 'yes')
    .map(([name]) => name.slice('exclude_'.length));
  const result = saveAccount(ctx.db, {
    principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id,
    body: accountFromForm(ctx.body), expectedVersion: Number(ctx.body.expected_version),
    excludeContributionIds, lineageReason: ctx.body.lineage_reason || null,
    idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Account not saved', result.reason, result.reason === 'version_conflict' ? 409 : 400);
  return ctx.redirect(ctx.res, `/topics/${view.inquiry.slug}`);
}

export function reviewDraft(ctx) {
  const view = inquiryView(ctx);
  if (!view) return unavailable();
  const result = acceptDraft(ctx.db, {
    principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id,
    revisionId: ctx.body.revision_id, expectedVersion: Number(ctx.body.expected_version),
    reason: ctx.body.reason, idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Draft not reviewed', result.reason, result.reason === 'version_conflict' ? 409 : 400);
  return ctx.redirect(ctx.res, `/topics/${view.inquiry.slug}`);
}

export function contributeForm(ctx) {
  const view = getInquiry(ctx.db, { slug: ctx.params[0], principal: null });
  if (!view?.publication) return unavailable();
  return page(ctx, `Contribute · ${view.inquiry.title}`, html`
    <p class="crumb"><a href="/topics/${view.inquiry.slug}">${view.inquiry.title}</a></p>
    <h1>Add something useful</h1>
    <p class="lede">Share a source, correction, observation or idea. It is saved for review, and you receive a private receipt. It does not become public automatically.</p>
    <form method="post">
      ${field({ name: 'text', label: 'What did you find or suggest?', type: 'textarea', attrs: 'rows="6" required' })}
      ${field({ name: 'target', label: 'Which question or finding does it address?', hint: 'Optional.',
        value: ctx.query.get('reply_to') ? `Follow-up to contribution ${ctx.query.get('reply_to')}` : '' })}
      ${field({ name: 'source_ids', label: 'Existing source IDs', hint: 'Optional, comma separated.' })}
      <label><input type="checkbox" name="allow_public" value="yes"> I permit this contribution to be incorporated in a reviewed public account.</label>
      <p class="muted small">Leaving this unchecked keeps it available to the reviewer. You can grant or revoke public release later from your private receipt.</p>
      <input type="hidden" name="contributor_token" value="${ctx.contributorFormToken()}">
      <input type="hidden" name="command_id" value="${id('cmd')}">
      <button type="submit">Save contribution</button>
    </form>
  `);
}

export function contribute(ctx) {
  const view = getInquiry(ctx.db, { slug: ctx.params[0], principal: null });
  if (!view?.publication) return unavailable();
  const result = submitContribution(ctx.db, {
    principal: `web:${ctx.contributorId()}`, inquiryId: view.inquiry.inquiry_id,
    text: ctx.body.text, target: ctx.body.target || null,
    sourceIds: String(ctx.body.source_ids ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    allowPublicRelease: ctx.body.allow_public === 'yes', idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Contribution not saved', result.reason);
  return ctx.redirect(ctx.res, `/receipt/${result.receipt_token}`);
}

export function receipt(ctx) {
  noStore(ctx);
  const receipt = getReceipt(ctx.db, { token: ctx.params[0] });
  if (!receipt) return unavailable();
  return page(ctx, 'Your contribution receipt', html`
    <h1>Your contribution receipt</h1>
    <p class="lede">Your contribution was received. This page shows what happened to it; keep its link private.</p>
    <dl class="four">
      <div><dt>Contribution</dt><dd>${receipt.contribution_id}</dd></div>
      <div><dt>Status</dt><dd>${receipt.status}</dd></div>
      <div><dt>Made available</dt><dd>${fmtWhen(receipt.made_available_at)}</dd></div>
      <div><dt>Account revision</dt><dd>${receipt.revision_id || 'None yet'}</dd></div>
    </dl>
    ${receipt.reason ? html`<h2>Review reason</h2><p>${receipt.reason}</p>` : ''}
    ${receipt.account_effect ? html`<h2>What changed</h2><p>${receipt.account_effect}</p>` : ''}
    ${receipt.status === 'needs_changes' && receipt.inquiry_slug ? html`<p><a href="/topics/${receipt.inquiry_slug}/contribute?reply_to=${receipt.contribution_id}">Send a clarified follow-up</a>. The new submission gets its own receipt.</p>` : ''}
    ${receipt.status !== 'withdrawn' ? html`<form method="post" action="/receipt/${ctx.params[0]}/release">
      <label><input type="checkbox" name="allow_public" value="yes" ${raw(receipt.allow_public_release ? 'checked' : '')}> Permit use in a reviewed public account</label>
      <input type="hidden" name="command_id" value="${id('cmd')}">
      <button type="submit">Save sharing choice</button>
    </form>` : ''}
    <p class="muted">Available here is not the same as delivered or read. A later result may still be pending.</p>
    ${receipt.status !== 'withdrawn' ? html`<form method="post" action="/receipt/${ctx.params[0]}/delete">
      <input type="hidden" name="command_id" value="${id('cmd')}">
      <button type="submit">Withdraw my submitted text</button>
      <p class="muted small">The minimal action history remains. If a released account depends on this text, it is hidden until reviewed again.</p>
    </form>` : ''}
  `);
}

export function deleteContribution(ctx) {
  const result = deleteContributionByToken(ctx.db, { token: ctx.params[0], idempotencyKey: ctx.body.command_id });
  if (!result.ok) return problem(ctx, 'Contribution not withdrawn', result.reason);
  return ctx.redirect(ctx.res, `/receipt/${ctx.params[0]}`);
}

export function setContributionRelease(ctx) {
  const result = setContributionPublicReleaseByToken(ctx.db, {
    token: ctx.params[0], allowPublicRelease: ctx.body.allow_public === 'yes',
    idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Sharing choice not saved', result.reason);
  return ctx.redirect(ctx.res, `/receipt/${ctx.params[0]}`);
}

export function reviewQueue(ctx) {
  const view = inquiryView(ctx);
  if (!view) return unavailable();
  const pending = listPendingContributions(ctx.db, { principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id });
  const sources = listSources(ctx.db, { principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id });
  return page(ctx, `Review · ${view.inquiry.title}`, html`
    <p class="crumb"><a href="/topics/${view.inquiry.slug}">${view.inquiry.title}</a></p>
    <h1>Review contributions</h1>
    <p class="lede">Each submission needs a reasoned disposition. Accepting one and changing the account happen together.</p>
    <p>${pending.length} awaiting review.</p>
    ${pending.map((c) => html`<article class="item">
      <header><b>${c.contribution_id}</b><span class="muted">${fmtWhen(c.submitted_at)}</span></header>
      <blockquote>${c.text || 'Content unavailable.'}</blockquote>
      ${c.target ? html`<p>Addresses: ${c.target}</p>` : ''}
      ${c.sourceIds?.length ? html`<p>Sources: ${c.sourceIds.join(', ')}</p>` : ''}
      <p>${c.allowPublicRelease ? tag('public incorporation permitted', 'good') : tag('public incorporation not permitted', 'warn')}</p>
      ${!c.allowPublicRelease ? html`<p class="note">You may accept this into the working account, but public release will wait until the contributor grants permission from their receipt.</p>` : ''}
      <form method="post" action="/topics/${view.inquiry.slug}/review/${c.contribution_id}">
        ${field({ name: 'disposition', id: `decision_${c.contribution_id}`, label: 'Decision', value: c.allowPublicRelease ? 'accepted' : 'needs_changes',
          options: [['accepted', 'Accept and revise the account'], ['declined', 'Decline with reason'], ['needs_changes', 'Ask for clarification']] })}
        ${field({ name: 'reason', id: `reason_${c.contribution_id}`, label: 'Reason for the contributor', type: 'textarea', attrs: 'rows="2" required' })}
        <details><summary>Account after acceptance</summary>${accountEditor(view.account, `${c.contribution_id}_`)}</details>
        <input type="hidden" name="expected_version" value="${view.inquiry.version ?? 0}">
        <input type="hidden" name="command_id" value="${id('cmd')}">
        <button type="submit">Record review and receipt</button>
      </form>
    </article>`)}
    <h2>Available sources</h2>${sourceList(sources)}
  `);
}

export function review(ctx) {
  const view = inquiryView(ctx);
  if (!view) return unavailable();
  const disposition = ctx.body.disposition;
  const result = reviewContribution(ctx.db, {
    principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id,
    contributionId: ctx.params[1], disposition,
    reason: ctx.body.reason,
    ...(disposition === 'accepted' ? { body: accountFromForm(ctx.body) } : {}),
    expectedVersion: Number(ctx.body.expected_version), idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Review not recorded', result.reason, result.reason === 'version_conflict' ? 409 : 400);
  return ctx.redirect(ctx.res, `/topics/${view.inquiry.slug}/review`);
}

export function publish(ctx) {
  const view = inquiryView(ctx);
  if (!view) return unavailable();
  const result = publishVersion(ctx.db, {
    principal: principalOf(ctx.session), inquiryId: view.inquiry.inquiry_id,
    revisionId: ctx.body.revision_id, audience: 'public', idempotencyKey: ctx.body.command_id,
  });
  if (!result.ok) return problem(ctx, 'Version not released', result.reason);
  return ctx.redirect(ctx.res, `/topics/${view.inquiry.slug}`);
}
