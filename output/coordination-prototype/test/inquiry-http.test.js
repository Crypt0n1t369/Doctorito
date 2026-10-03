import { test } from 'node:test';
import assert from 'node:assert/strict';
import { open, one } from '../src/db.js';
import { createApp, COORDINATOR_KEY } from '../src/web/server.js';
import { getInquiry, listSources } from '../src/inquiry/index.js';

const OPERATOR = 'coordinator:local';

async function serve(db) {
  const app = createApp(db, { baseUrl: 'http://127.0.0.1' });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  const request = (path, { method = 'GET', form = null, cookie = null } = {}) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    let body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    return fetch(base + path, { method, body, headers, redirect: 'manual' });
  };
  const login = async () => (await request(`/login?key=${COORDINATOR_KEY}`)).headers.get('set-cookie').split(';')[0];
  return { request, login, close: () => new Promise((resolve) => app.close(resolve)) };
}

function accountForm(sourceId, version, summary) {
  return {
    summary,
    finding_1: 'The first path segment was reported complete.',
    finding_1_sources: sourceId,
    finding_1_standing: 'reported',
    uncertainties: 'Independent on-site condition remains unverified.',
    next_steps: 'Check the current condition with a dated observation.',
    expected_version: String(version),
    command_id: `cmd_${summary.replace(/\W/g, '_')}`,
  };
}

function hiddenValue(markup, name) {
  const match = new RegExp(`<input type="hidden" name="${name}" value="([^"]*)">`).exec(markup);
  assert.ok(match, `missing hidden ${name} field`);
  return match[1];
}

async function publishTopic(app, db, cookie, { title, summary = 'The source reports a result.' }) {
  const created = await app.request('/topics', { method: 'POST', cookie, form: {
    title, question: 'What can this record establish?', visibility: 'public', command_id: 'cmd_create_topic',
  } });
  assert.equal(created.status, 303);
  const topicPath = created.headers.get('location');
  assert.match(topicPath, /^\/topics\/[a-z0-9-]+$/);
  const slug = topicPath.slice('/topics/'.length);
  const inquiry = getInquiry(db, { slug, principal: OPERATOR }).inquiry;
  assert.equal((await app.request(`/topics/${slug}/sources`, { method: 'POST', cookie, form: {
    url: 'https://example.org/source', publisher: 'Source publisher', locator: 'Paragraph 1',
    text: 'The source reports a result.', public_release: 'yes',
    retrieved_at: '2026-10-01T12:00:00.000Z', command_id: 'cmd_first_source',
  } })).status, 303);
  const sourceId = listSources(db, { principal: OPERATOR, inquiryId: inquiry.inquiry_id })[0].source_id;
  assert.equal((await app.request(`/topics/${slug}/draft`, { method: 'POST', cookie,
    form: accountForm(sourceId, 0, summary) })).status, 303);
  let view = getInquiry(db, { slug, principal: OPERATOR });
  assert.equal((await app.request(`/topics/${slug}/review-draft`, { method: 'POST', cookie, form: {
    revision_id: view.account.revision_id, expected_version: String(view.inquiry.version),
    reason: 'The source and limits were checked.', command_id: 'cmd_first_review',
  } })).status, 303);
  view = getInquiry(db, { slug, principal: OPERATOR });
  assert.equal((await app.request(`/topics/${slug}/publish`, { method: 'POST', cookie, form: {
    revision_id: view.account.revision_id, command_id: 'cmd_first_publish',
  } })).status, 303);
  return { topicPath, slug, inquiryId: inquiry.inquiry_id, sourceId };
}

test('a reviewed topic releases only a selected version, and a contribution receives closure', async () => {
  const db = open(':memory:');
  const app = await serve(db);
  try {
    const cookie = await app.login();
    assert.equal((await app.request('/topics/new')).status, 303);

    const created = await app.request('/topics', { method: 'POST', cookie, form: {
      title: 'Riverside path', question: 'What can the public record establish?',
      visibility: 'public', command_id: 'cmd_create_path',
    } });
    assert.equal(created.status, 303);
    const topicPath = created.headers.get('location');
    assert.match(topicPath, /^\/topics\/[a-z0-9-]+$/);
    const slug = topicPath.slice('/topics/'.length);
    assert.ok(!(await (await app.request('/topics')).text()).includes('Riverside path'));
    assert.equal((await app.request(topicPath)).status, 404);

    const inquiry = getInquiry(db, { slug, principal: OPERATOR }).inquiry;
    const source = await app.request(`${topicPath}/sources`, { method: 'POST', cookie, form: {
      url: 'https://example.org/path/notice', publisher: 'Council notice',
      locator: 'Section 2, completion paragraph', text: 'The council reported completion.',
      published_at: '2024-07-01', public_release: 'yes', command_id: 'cmd_source_one',
    } });
    assert.equal(source.status, 303);
    const sourceId = listSources(db, { principal: OPERATOR, inquiryId: inquiry.inquiry_id })[0].source_id;

    const draft = await app.request(`${topicPath}/draft`, { method: 'POST', cookie,
      form: accountForm(sourceId, 0, 'The public record reports a completed first segment.') });
    assert.equal(draft.status, 303);
    let view = getInquiry(db, { slug, principal: OPERATOR });
    assert.equal(view.account.state, 'saved_draft');
    assert.equal((await app.request(`${topicPath}/publish`, { method: 'POST', cookie, form: {
      revision_id: view.account.revision_id, command_id: 'cmd_premature_publish',
    } })).status, 400);

    const reviewed = await app.request(`${topicPath}/review-draft`, { method: 'POST', cookie, form: {
      revision_id: view.account.revision_id, expected_version: String(view.inquiry.version),
      reason: 'Source and uncertainty checked for this version.', command_id: 'cmd_review_initial',
    } });
    assert.equal(reviewed.status, 303);
    view = getInquiry(db, { slug, principal: OPERATOR });
    assert.equal(view.account.state, 'reviewed');

    const released = await app.request(`${topicPath}/publish`, { method: 'POST', cookie, form: {
      revision_id: view.account.revision_id, command_id: 'cmd_release_initial',
    } });
    assert.equal(released.status, 303);
    assert.ok((await (await app.request('/topics')).text()).includes('Riverside path'));
    assert.ok((await (await app.request(topicPath)).text()).includes('The public record reports a completed first segment.'));

    const submitted = await app.request(`${topicPath}/contribute`, { method: 'POST', form: {
      text: 'The notice says the first segment was completed; can we check its current condition? <script>alert(1)</script>',
      target: 'current condition', source_ids: sourceId, allow_public: 'yes', command_id: 'cmd_contribution_one',
    } });
    assert.equal(submitted.status, 303);
    const receiptPath = submitted.headers.get('location');
    assert.match(receiptPath, /^\/receipt\/[a-z0-9_]+$/);
    assert.equal((await app.request(receiptPath)).headers.get('cache-control'), 'no-store');
    assert.ok((await (await app.request(receiptPath)).text()).includes('received'));
    assert.ok(!(await (await app.request(topicPath)).text()).includes('can we check its current condition?'));
    assert.equal((await app.request(`${topicPath}/review`)).status, 303);

    const queue = await (await app.request(`${topicPath}/review`, { cookie })).text();
    assert.ok(queue.includes('can we check its current condition?'));
    assert.ok(queue.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(!queue.includes('<script>alert(1)</script>'));
    const pendingId = /action="\/topics\/[a-z0-9-]+\/review\/([a-z0-9_]+)"/.exec(queue)?.[1];
    assert.ok(pendingId);
    const current = getInquiry(db, { slug, principal: OPERATOR });
    const accepted = await app.request(`${topicPath}/review/${pendingId}`, { method: 'POST', cookie, form: {
      ...accountForm(sourceId, current.inquiry.version, 'The public record reports completion; a site check is open.'),
      disposition: 'accepted', reason: 'Useful question added to the current account.',
      command_id: 'cmd_accept_contribution',
    } });
    assert.equal(accepted.status, 303);
    assert.ok((await (await app.request(receiptPath)).text()).includes('Useful question added'));
    assert.ok(!(await (await app.request(topicPath)).text()).includes('a site check is open'));

    view = getInquiry(db, { slug, principal: OPERATOR });
    assert.equal(view.account.state, 'reviewed');
    assert.equal((await app.request(`${topicPath}/publish`, { method: 'POST', cookie, form: {
      revision_id: view.account.revision_id, command_id: 'cmd_release_second',
    } })).status, 303);
    assert.ok((await (await app.request(topicPath)).text()).includes('a site check is open'));
  } finally {
    await app.close();
    db.close();
  }
});

test('a private topic and a contributor receipt do not leak through public pages', async () => {
  const db = open(':memory:');
  const app = await serve(db);
  try {
    const cookie = await app.login();
    const created = await app.request('/topics', { method: 'POST', cookie, form: {
      title: 'Private build', question: 'How should the joint work?', visibility: 'private', command_id: 'cmd_private',
    } });
    assert.equal(created.status, 303);
    const topicPath = created.headers.get('location');
    assert.match(topicPath, /^\/topics\/[a-z0-9-]+$/);
    assert.equal((await app.request(topicPath)).status, 404);
    assert.ok(!(await (await app.request('/topics')).text()).includes('Private build'));
    assert.ok((await (await app.request(topicPath, { cookie })).text()).includes('Private build'));
    assert.equal((await app.request('/receipt/unknown_token')).status, 404);
  } finally {
    await app.close();
    db.close();
  }
});

test('anonymous readers see the released version while editors save a later draft', async () => {
  const db = open(':memory:');
  const app = await serve(db);
  try {
    const cookie = await app.login();
    const { topicPath, slug, sourceId } = await publishTopic(app, db, cookie, {
      title: 'Version boundary', summary: 'Released account only.',
    });
    const draft = await app.request(`${topicPath}/draft`, { method: 'POST', cookie, form: {
      ...accountForm(sourceId, 2, 'PRIVATE DRAFT ACCOUNT'), command_id: 'cmd_private_draft',
    } });
    assert.equal(draft.status, 303);
    const publicIndex = await (await app.request('/topics')).text();
    const publicTopic = await (await app.request(topicPath)).text();
    assert.ok(publicIndex.includes('version 2'));
    assert.ok(!publicIndex.includes('version 3'));
    assert.ok(publicTopic.includes('Released account only.'));
    assert.ok(!publicTopic.includes('PRIVATE DRAFT ACCOUNT'));
    assert.ok((await (await app.request(topicPath, { cookie })).text()).includes('PRIVATE DRAFT ACCOUNT'));
    const releasedPreview = await (await app.request(`${topicPath}?view=public`, { cookie })).text();
    assert.ok(releasedPreview.includes('Released account only.'));
    assert.ok(!releasedPreview.includes('PRIVATE DRAFT ACCOUNT'));
    assert.equal(getInquiry(db, { slug }).inquiry.version, 2);
  } finally {
    await app.close();
    db.close();
  }
});

test('lost-cookie contribution and source retries are idempotent', async () => {
  const db = open(':memory:');
  const app = await serve(db);
  try {
    const cookie = await app.login();
    const { topicPath, inquiryId } = await publishTopic(app, db, cookie, { title: 'Retry boundary' });
    const editor = await (await app.request(topicPath, { cookie })).text();
    const sourceForm = {
      publisher: 'Local observer', locator: 'Site photo 1', text: 'The railing remains open.',
      retrieved_at: hiddenValue(editor, 'retrieved_at'), command_id: 'cmd_source_retry',
    };
    const firstSource = await app.request(`${topicPath}/sources`, { method: 'POST', cookie, form: sourceForm });
    const retrySource = await app.request(`${topicPath}/sources`, { method: 'POST', cookie, form: sourceForm });
    assert.equal(firstSource.status, 303);
    assert.equal(retrySource.status, 303);
    assert.equal(retrySource.headers.get('location'), firstSource.headers.get('location'));
    assert.equal(listSources(db, { principal: OPERATOR, inquiryId }).length, 2);

    const formPage = await (await app.request(`${topicPath}/contribute`)).text();
    const contributionForm = {
      text: 'I can inspect the railing next week.',
      contributor_token: hiddenValue(formPage, 'contributor_token'),
      command_id: hiddenValue(formPage, 'command_id'),
    };
    // Deliberately omit the cookie even though GET set it: the form token must
    // preserve the principal when a response or browser cookie is lost.
    const first = await app.request(`${topicPath}/contribute`, { method: 'POST', form: contributionForm });
    const retry = await app.request(`${topicPath}/contribute`, { method: 'POST', form: contributionForm });
    assert.equal(first.status, 303);
    assert.equal(retry.status, 303);
    assert.equal(retry.headers.get('location'), first.headers.get('location'));
    assert.equal(one(db, 'select count(*) as n from inquiry_contributions where inquiry_id=?', inquiryId).n, 1);
  } finally {
    await app.close();
    db.close();
  }
});

test('editor preserves more than three findings and contributor can grant later release', async () => {
  const db = open(':memory:');
  const app = await serve(db);
  try {
    const cookie = await app.login();
    const { topicPath, slug, sourceId } = await publishTopic(app, db, cookie, { title: 'Long account' });
    const findings = { finding_count: '4' };
    for (let i = 1; i <= 4; i++) {
      findings[`finding_${i}`] = `Finding ${i}`;
      findings[`finding_${i}_sources`] = sourceId;
      findings[`finding_${i}_standing`] = 'reported';
    }
    assert.equal((await app.request(`${topicPath}/draft`, { method: 'POST', cookie, form: {
      ...findings, summary: 'Four parts.', expected_version: '2', command_id: 'cmd_four_findings',
    } })).status, 303);
    const editor = await (await app.request(topicPath, { cookie })).text();
    assert.ok(editor.includes('name="finding_4"'));
    assert.ok(editor.includes('Finding 4'));
    assert.equal((await app.request(`${topicPath}/draft`, { method: 'POST', cookie, form: {
      ...findings, summary: 'Still four parts.', expected_version: '3', command_id: 'cmd_four_again',
    } })).status, 303);
    assert.equal(getInquiry(db, { slug, principal: OPERATOR }).account.body.findings.length, 4);

    const submission = await app.request(`${topicPath}/contribute`, { method: 'POST', form: {
      text: 'One additional observation.', command_id: 'cmd_later_consent',
    } });
    const receiptPath = submission.headers.get('location');
    assert.equal(submission.status, 303);
    assert.equal((await app.request(`${receiptPath}/release`, { method: 'POST', form: {
      allow_public: 'yes', command_id: 'cmd_grant_from_receipt',
    } })).status, 303);
    const receipt = await (await app.request(receiptPath)).text();
    assert.ok(receipt.includes('name="allow_public" value="yes" checked'));
  } finally {
    await app.close();
    db.close();
  }
});
