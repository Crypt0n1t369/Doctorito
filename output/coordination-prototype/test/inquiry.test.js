import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { open, one } from '../src/db.js';
import { rebuild, stateFingerprint, verifyChain } from '../src/events.js';
import {
  addSource, createInquiry, deleteContributionByToken, deleteInquiryPayload,
  getInquiry, getReceipt,
  grantInquiryRole, listInquiries, listPendingContributions, listSources,
  publishVersion, reviewContribution, reviewDraft, revokeInquiryRole,
  saveDraft, setContributionPublicRelease, setContributionPublicReleaseByToken,
  setContributionTeamReadByToken, setSourcePublicRelease,
  submitContribution,
} from '../src/inquiry/index.js';

const owner = 'coordinator:pilot-owner';
const reviewer = 'coordinator:pilot-reviewer';
const outsider = 'coordinator:other-initiative';
const contributor = 'web:browser-1';

function body(sourceId, text = 'The council reported that the path opened.') {
  return {
    summary: 'What the available record establishes.',
    findings: [{ text, sourceIds: [sourceId], standing: 'reported' }],
    uncertainties: ['No independent site inspection is recorded.'],
    nextSteps: ['Find the signed handover record.'],
  };
}

function setup({ sourceRelease = true, sourceReadScope = 'reviewers', visibility = 'public' } = {}) {
  const db = open(':memory:');
  const created = createInquiry(db, {
    principal: owner, slug: 't-0123456789abcdef01234567', title: 'Public path',
    question: 'What can the documents establish?', visibility, idempotencyKey: 'create-1',
  });
  assert.equal(created.ok, true);
  const inquiryId = created.inquiry_id;
  const source = addSource(db, {
    principal: owner, inquiryId, idempotencyKey: 'source-1',
    source: {
      url: 'https://example.invalid/path', publisher: 'City',
      publishedAt: '2024-07-04', retrievedAt: '2026-10-01',
      locator: 'opening paragraph', status: 'available', language: 'en',
      text: 'City reports that the path opened in July 2024.', publicRelease: sourceRelease,
      readScope: sourceReadScope,
    },
  });
  assert.equal(source.ok, true);
  return { db, inquiryId, sourceId: source.source_id };
}

function initialRelease(db, inquiryId, sourceId) {
  const draft = saveDraft(db, {
    principal: owner, inquiryId, body: body(sourceId), expectedVersion: 0,
    idempotencyKey: 'draft-1',
  });
  assert.equal(draft.ok, true);
  const reviewed = reviewDraft(db, {
    principal: owner, inquiryId, revisionId: draft.revision_id, expectedVersion: 1,
    reason: 'Checked against the cited passage.', idempotencyKey: 'review-draft-1',
  });
  assert.equal(reviewed.ok, true);
  const released = publishVersion(db, {
    principal: owner, inquiryId, revisionId: reviewed.revision_id,
    audience: 'public', idempotencyKey: 'publish-1',
  });
  return { draft, reviewed, released };
}

describe('inquiry: a durable, permissioned contribution-to-result loop', () => {
  test('explicit review and release are required before any anonymous topic read or intake', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      assert.deepEqual(listInquiries(db), []);
      assert.equal(submitContribution(db, {
        principal: contributor, inquiryId, text: 'I found a correction.', idempotencyKey: 'early',
      }).reason, 'intake_not_open');
      const draft = saveDraft(db, {
        principal: owner, inquiryId, body: body(sourceId), expectedVersion: 0,
        idempotencyKey: 'draft-1',
      });
      assert.equal(draft.ok, true);
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: draft.revision_id, idempotencyKey: 'premature',
      }).reason, 'revision_not_reviewed');
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      const reviewed = reviewDraft(db, {
        principal: owner, inquiryId, revisionId: draft.revision_id, expectedVersion: 1,
        reason: 'Source checked.', idempotencyKey: 'review-draft-1',
      });
      assert.equal(reviewed.ok, true);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: reviewed.revision_id, idempotencyKey: 'publish-1',
      }).ok, true);
      const publicRead = getInquiry(db, { slug: 't-0123456789abcdef01234567' });
      assert.equal(publicRead.account.state, 'reviewed');
      assert.equal(publicRead.account.body.findings[0].standing, 'reported');
      assert.equal(publicRead.inquiry.owner_principal, null);
      assert.equal(listInquiries(db).length, 1);
      assert.equal(listSources(db, { inquiryId }).length, 1);
    } finally { db.close(); }
  });

  test('review writes the revised account, disposition and bearer receipt once', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      initialRelease(db, inquiryId, sourceId);
      const sub = submitContribution(db, {
        principal: contributor, inquiryId, text: 'The source says reported, not independently checked.',
        sourceIds: [sourceId], allowPublicRelease: true, idempotencyKey: 'submission-1',
      });
      assert.equal(sub.ok, true);
      assert.equal(submitContribution(db, {
        principal: contributor, inquiryId, text: 'The source says reported, not independently checked.',
        sourceIds: [sourceId], allowPublicRelease: true, idempotencyKey: 'submission-1',
      }).receipt_token, sub.receipt_token);
      assert.equal(submitContribution(db, {
        principal: contributor, inquiryId, text: 'Different text', idempotencyKey: 'submission-1',
      }).reason, 'idempotency_key_reused');
      assert.equal(getReceipt(db, { token: sub.receipt_token }).status, 'submitted_for_review');
      const reviewerRead = listPendingContributions(db, { principal: owner, inquiryId });
      assert.equal(reviewerRead.length, 1);
      assert.equal(reviewerRead[0].text, 'The source says reported, not independently checked.');
      assert.deepEqual(listPendingContributions(db, { principal: outsider, inquiryId }), []);
      const review = reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Corrected the standing.',
        body: body(sourceId, 'The city reported opening; no independent check is established.'),
        expectedVersion: 2, idempotencyKey: 'review-1',
      });
      assert.equal(review.ok, true);
      assert.equal(reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Corrected the standing.',
        body: body(sourceId, 'The city reported opening; no independent check is established.'),
        expectedVersion: 2, idempotencyKey: 'review-1',
      }).revision_id, review.revision_id);
      assert.equal(listPendingContributions(db, { principal: owner, inquiryId }).length, 0);
      const receipt = getReceipt(db, { token: sub.receipt_token });
      assert.equal(receipt.status, 'accepted');
      assert.equal(receipt.revision_id, review.revision_id);
      assert.equal(receipt.reason, 'Corrected the standing.');
      assert.equal(receipt.delivered_at, null);
      assert.equal(getReceipt(db, { token: 'wrong' }), null);
      // Accepted into the working account is not a public release.
      assert.notEqual(getInquiry(db, { slug: 't-0123456789abcdef01234567' }).account.revision_id, review.revision_id);
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: review.revision_id, idempotencyKey: 'publish-2',
      }).ok, true);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }).account.revision_id, review.revision_id);
    } finally { db.close(); }
  });

  test('scoped authority, stale version and cross-inquiry source checks leave work pending', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      initialRelease(db, inquiryId, sourceId);
      const other = createInquiry(db, {
        principal: outsider, slug: 't-fedcba9876543210fedcba98', title: 'Other work', question: 'Another question?',
        visibility: 'private', idempotencyKey: 'other-create',
      });
      assert.equal(other.ok, true);
      assert.equal(saveDraft(db, {
        principal: outsider, inquiryId, body: body(sourceId), expectedVersion: 2,
        idempotencyKey: 'outsider-draft',
      }).reason, 'forbidden');
      assert.equal(saveDraft(db, {
        principal: outsider, inquiryId: other.inquiry_id, body: body(sourceId), expectedVersion: 0,
        idempotencyKey: 'foreign-source',
      }).reason, 'source_from_another_inquiry');
      const sub = submitContribution(db, {
        principal: contributor, inquiryId, text: 'A correction with evidence.',
        sourceIds: [sourceId], idempotencyKey: 'sub-scope',
      });
      assert.equal(reviewContribution(db, {
        principal: outsider, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Looks good.', body: body(sourceId),
        expectedVersion: 2, idempotencyKey: 'review-outsider',
      }).reason, 'forbidden');
      assert.equal(reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Looks good.', body: body(sourceId),
        expectedVersion: 1, idempotencyKey: 'review-stale',
      }).reason, 'version_conflict');
      assert.equal(getReceipt(db, { token: sub.receipt_token }).status, 'submitted_for_review');
      assert.equal(grantInquiryRole(db, {
        principal: owner, inquiryId, targetPrincipal: reviewer, role: 'reviewer', idempotencyKey: 'grant-reviewer',
      }).ok, true);
      assert.equal(listPendingContributions(db, { principal: reviewer, inquiryId }).length, 1);
      assert.equal(revokeInquiryRole(db, {
        principal: owner, inquiryId, targetPrincipal: reviewer, idempotencyKey: 'revoke-reviewer',
      }).ok, true);
      assert.deepEqual(listPendingContributions(db, { principal: reviewer, inquiryId }), []);
    } finally { db.close(); }
  });

  test('release rights are checked at publication and again for every public read', () => {
    const { db, inquiryId, sourceId } = setup({ sourceRelease: false });
    try {
      const { reviewed, released } = initialRelease(db, inquiryId, sourceId);
      assert.equal(released.reason, 'release_permission_missing');
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      assert.equal(setSourcePublicRelease(db, {
        principal: owner, inquiryId, sourceId, publicRelease: true, idempotencyKey: 'source-grant',
      }).ok, true);
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: reviewed.revision_id, idempotencyKey: 'publish-after-grant',
      }).ok, true);
      const sub = submitContribution(db, {
        principal: contributor, inquiryId, text: 'Clarification.', sourceIds: [sourceId],
        allowPublicRelease: false, idempotencyKey: 'sub-no-release',
      });
      const review = reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Useful.', body: body(sourceId),
        expectedVersion: 2, idempotencyKey: 'review-no-release',
      });
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: review.revision_id, idempotencyKey: 'publish-blocked',
      }).reason, 'release_permission_missing');
      assert.equal(setContributionPublicRelease(db, {
        principal: contributor, inquiryId, contributionId: sub.contribution_id,
        allowPublicRelease: true, idempotencyKey: 'contribution-grant',
      }).ok, true);
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: review.revision_id, idempotencyKey: 'publish-granted',
      }).ok, true);
      assert.ok(getInquiry(db, { slug: 't-0123456789abcdef01234567' }));
      setContributionPublicRelease(db, {
        principal: contributor, inquiryId, contributionId: sub.contribution_id,
        allowPublicRelease: false, idempotencyKey: 'contribution-revoke',
      });
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      assert.deepEqual(listInquiries(db), []);
      assert.equal(listSources(db, { inquiryId }).length, 0);
      assert.ok(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: owner }));
    } finally { db.close(); }
  });

  test('private drafts do not alter the anonymous released account or version', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      initialRelease(db, inquiryId, sourceId);
      const before = getInquiry(db, { slug: 't-0123456789abcdef01234567' });
      const draft = saveDraft(db, {
        principal: owner, inquiryId, body: body(sourceId, 'PRIVATE NEW DRAFT FINDING'),
        expectedVersion: 2, idempotencyKey: 'private-next-draft',
      });
      assert.equal(draft.ok, true);
      const after = getInquiry(db, { slug: 't-0123456789abcdef01234567' });
      assert.equal(after.inquiry.version, before.inquiry.version);
      assert.deepEqual(after.account.body, before.account.body);
      assert.equal(listInquiries(db)[0].version, before.inquiry.version);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: owner }).inquiry.version, 3);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: owner }).account.state, 'saved_draft');
    } finally { db.close(); }
  });

  test('a private reader sees only team-granted reviewed lineage and cannot write', () => {
    const { db, inquiryId, sourceId } = setup({ visibility: 'private', sourceReadScope: 'team' });
    try {
      const draft = saveDraft(db, {
        principal: owner, inquiryId, body: body(sourceId), expectedVersion: 0,
        idempotencyKey: 'team-draft',
      });
      reviewDraft(db, {
        principal: owner, inquiryId, revisionId: draft.revision_id,
        expectedVersion: 1, reason: 'Source checked.', idempotencyKey: 'team-review',
      });
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      grantInquiryRole(db, {
        principal: owner, inquiryId, targetPrincipal: reviewer, role: 'reader',
        idempotencyKey: 'team-reader-grant',
      });
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: reviewer }).account.state, 'reviewed');
      assert.equal(listSources(db, { principal: reviewer, inquiryId }).length, 1);
      assert.equal(saveDraft(db, {
        principal: reviewer, inquiryId, body: body(sourceId), expectedVersion: 2,
        idempotencyKey: 'reader-write',
      }).reason, 'forbidden');
      const sub = submitContribution(db, {
        principal: contributor, inquiryId, text: 'A private suggestion.',
        allowTeamRead: false, idempotencyKey: 'team-sub',
      });
      // Only members may contribute to a private inquiry; add contributor as a
      // reader, then retry the same command key after the previous refusal.
      assert.equal(sub.reason, 'intake_not_open');
      grantInquiryRole(db, {
        principal: owner, inquiryId, targetPrincipal: contributor, role: 'reader',
        idempotencyKey: 'team-contributor-grant',
      });
      const submitted = submitContribution(db, {
        principal: contributor, inquiryId, text: 'A private suggestion.',
        allowTeamRead: false, idempotencyKey: 'team-sub',
      });
      const accepted = reviewContribution(db, {
        principal: owner, inquiryId, contributionId: submitted.contribution_id,
        disposition: 'accepted', reason: 'Useful distinction.', body: body(sourceId),
        expectedVersion: 2, idempotencyKey: 'team-accept',
      });
      assert.equal(accepted.ok, true);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: reviewer }).account, null);
      assert.equal(setContributionTeamReadByToken(db, {
        token: submitted.receipt_token, allowTeamRead: true, idempotencyKey: 'team-consent',
      }).ok, true);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: reviewer }).account.revision_id,
        accepted.revision_id);
      assert.equal(getReceipt(db, { token: submitted.receipt_token }).allow_team_read, true);
      setContributionTeamReadByToken(db, {
        token: submitted.receipt_token, allowTeamRead: false, idempotencyKey: 'team-revoke',
      });
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: reviewer }).account, null);
    } finally { db.close(); }
  });

  test('receipt consent and an explicit corrected revision repair withdrawn lineage', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      initialRelease(db, inquiryId, sourceId);
      const sub = submitContribution(db, {
        principal: contributor, inquiryId, text: 'A claim later withdrawn.',
        sourceIds: [sourceId], idempotencyKey: 'repair-sub',
      });
      const review = reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Initially included.', body: body(sourceId),
        expectedVersion: 2, idempotencyKey: 'repair-review',
      });
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: review.revision_id,
        idempotencyKey: 'repair-blocked-release',
      }).reason, 'release_permission_missing');
      assert.equal(setContributionPublicReleaseByToken(db, {
        token: sub.receipt_token, allowPublicRelease: true,
        idempotencyKey: 'repair-consent',
      }).ok, true);
      assert.equal(getReceipt(db, { token: sub.receipt_token }).allow_public_release, true);
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: review.revision_id,
        idempotencyKey: 'repair-published',
      }).ok, true);
      deleteContributionByToken(db, { token: sub.receipt_token, idempotencyKey: 'repair-withdraw' });
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      assert.equal(saveDraft(db, {
        principal: owner, inquiryId, body: body(sourceId, 'Corrected account omitting withdrawn claim.'),
        expectedVersion: 3, excludeContributionIds: [sub.contribution_id],
        idempotencyKey: 'repair-no-reason',
      }).reason, 'lineage_repair_reason_required');
      const corrected = saveDraft(db, {
        principal: owner, inquiryId, body: body(sourceId, 'Corrected account omitting withdrawn claim.'),
        expectedVersion: 3, excludeContributionIds: [sub.contribution_id],
        lineageReason: 'The contributor withdrew the observation; this account relies only on the city source.',
        idempotencyKey: 'repair-draft',
      });
      assert.equal(corrected.ok, true);
      const reviewed = reviewDraft(db, {
        principal: owner, inquiryId, revisionId: corrected.revision_id,
        expectedVersion: 4, reason: 'Checked that the withdrawn observation is absent.',
        idempotencyKey: 'repair-reviewed',
      });
      assert.equal(reviewed.ok, true);
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: reviewed.revision_id,
        idempotencyKey: 'repair-republished',
      }).ok, true);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }).account.body.findings[0].text,
        'Corrected account omitting withdrawn claim.');
      assert.deepEqual(getInquiry(db, { slug: 't-0123456789abcdef01234567' }).account.contribution_ids, []);
      assert.match(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: owner }).account.reason,
        /withdrawn observation/);
    } finally { db.close(); }
  });

  test('deleting source content removes the public release but leaves an action record', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      initialRelease(db, inquiryId, sourceId);
      const source = one(db, 'select payload_id from inquiry_sources where source_id=?', sourceId);
      assert.equal(deleteInquiryPayload(db, {
        principal: outsider, payloadId: source.payload_id, idempotencyKey: 'outsider-delete',
      }).reason, 'forbidden');
      assert.equal(deleteInquiryPayload(db, {
        principal: owner, payloadId: source.payload_id, idempotencyKey: 'source-delete',
      }).ok, true);
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      assert.equal(one(db, 'select body from inquiry_payloads where payload_id=?', source.payload_id).body, null);
      assert.ok(one(db, `select 1 from events where type='inquiry.payload_deleted'`));
    } finally { db.close(); }
  });

  test('receipt bearer withdraws content; release closes, but audit and replay remain coherent', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      initialRelease(db, inquiryId, sourceId);
      const sub = submitContribution(db, {
        principal: contributor, inquiryId, text: 'Private observation that should be erasable.',
        sourceIds: [sourceId], allowPublicRelease: true, idempotencyKey: 'sub-delete',
      });
      const review = reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Used in account.', body: body(sourceId),
        expectedVersion: 2, idempotencyKey: 'review-delete',
      });
      assert.equal(publishVersion(db, {
        principal: owner, inquiryId, revisionId: review.revision_id, idempotencyKey: 'pub-delete',
      }).ok, true);
      assert.ok(getInquiry(db, { slug: 't-0123456789abcdef01234567' }));
      const withdrawn = deleteContributionByToken(db, {
        token: sub.receipt_token, idempotencyKey: 'delete-by-receipt',
      });
      assert.equal(withdrawn.status, 'withdrawn');
      assert.equal(getReceipt(db, { token: sub.receipt_token }).status, 'withdrawn');
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
      const row = one(db, `select p.body,p.deleted_at from inquiry_payloads p
        join inquiry_contributions c on c.payload_id=p.payload_id where c.contribution_id=?`, sub.contribution_id);
      assert.equal(row.body, null);
      assert.ok(row.deleted_at);
      assert.equal(one(db, 'pragma secure_delete').secure_delete, 1);
      const before = stateFingerprint(db);
      assert.ok(verifyChain(db).ok);
      rebuild(db);
      assert.equal(stateFingerprint(db), before);
      assert.equal(getReceipt(db, { token: sub.receipt_token }).status, 'withdrawn');
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567' }), null);
    } finally { db.close(); }
  });

  test('a projection failure rolls back review, revision payload and receipt together', () => {
    const { db, inquiryId, sourceId } = setup();
    try {
      initialRelease(db, inquiryId, sourceId);
      const sub = submitContribution(db, {
        principal: contributor, inquiryId, text: 'Useful new evidence.',
        sourceIds: [sourceId], idempotencyKey: 'sub-rollback',
      });
      const payloadsBefore = one(db, 'select count(*) n from inquiry_payloads').n;
      db.exec(`create trigger fail_review before insert on inquiry_revisions
        when new.state='reviewed' begin select raise(abort, 'injected review failure'); end`);
      assert.throws(() => reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Would accept.', body: body(sourceId),
        expectedVersion: 2, idempotencyKey: 'review-rollback',
      }));
      assert.equal(one(db, 'select count(*) n from inquiry_payloads').n, payloadsBefore);
      assert.equal(getReceipt(db, { token: sub.receipt_token }).status, 'submitted_for_review');
      assert.equal(getInquiry(db, { slug: 't-0123456789abcdef01234567', principal: owner }).inquiry.version, 2);
      db.exec('drop trigger fail_review');
      assert.equal(reviewContribution(db, {
        principal: owner, inquiryId, contributionId: sub.contribution_id,
        disposition: 'accepted', reason: 'Would accept.', body: body(sourceId),
        expectedVersion: 2, idempotencyKey: 'review-rollback',
      }).ok, true);
    } finally { db.close(); }
  });
});
