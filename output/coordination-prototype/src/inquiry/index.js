import { randomBytes } from 'node:crypto';
import { all, one, run, tx } from '../db.js';
import { emit } from '../events.js';
import { canonical, id, sha256, token } from '../ids.js';

/**
 * A small, deterministic inquiry record. Caller-supplied principals must come
 * from an authenticated session or a signed contributor cookie at the HTTP
 * boundary; arbitrary names supplied in form bodies are never principals.
 *
 * The event log stores only IDs, standing, authority and lineage. Source text,
 * contributions, accounts, and human reasons live in deletable payload rows.
 */

const DISPOSITIONS = new Set(['accepted', 'declined', 'needs_changes']);
const STANDINGS = new Set(['reported', 'checked', 'inference']);
const SOURCE_STATUSES = new Set(['available', 'inaccessible']);
const READ_SCOPES = new Set(['reviewers', 'team', 'public']);
const PRINCIPAL = /^(?:coordinator|web|receipt|actor):[a-z0-9_-]{1,80}$/;

function failure(reason, extra = {}) { return { ok: false, reason, ...extra }; }
function present(s) { return typeof s === 'string' && s.trim().length > 0; }
function bounded(s, max) { return present(s) && s.trim().length <= max; }
function stamp() { return new Date().toISOString(); }
function json(v) { return JSON.stringify(v); }
function parse(v, fallback = null) {
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function command(db, { principal, idempotencyKey, request }, act) {
  if (!present(principal)) return failure('unauthenticated');
  if (!PRINCIPAL.test(principal)) return failure('invalid_principal');
  if (!bounded(idempotencyKey, 200)) return failure('idempotency_key_required');
  return tx(db, () => {
    const prior = one(db, `select * from inquiry_commands where principal=? and idempotency_key=?`,
      principal, idempotencyKey);
    if (prior) {
      if (sha256(prior.salt + canonical(request)) !== prior.request_hash) {
        return failure('idempotency_key_reused');
      }
      return parse(prior.response, failure('idempotency_record_unreadable'));
    }
    const result = act();
    if (!result.ok) return result;
    const salt = randomBytes(24).toString('hex');
    run(db, `insert into inquiry_commands
      (principal,idempotency_key,salt,request_hash,response,created_at) values (?,?,?,?,?,?)`,
      principal, idempotencyKey, salt, sha256(salt + canonical(request)), json(result), stamp());
    return result;
  });
}

function putPayload(db, owner, kind, body) {
  const payloadId = id('ip');
  run(db, `insert into inquiry_payloads
    (payload_id,owner_principal,kind,body,created_at) values (?,?,?,?,?)`,
    payloadId, owner, kind, json(body), stamp());
  return payloadId;
}

function payload(db, payloadId) {
  if (!payloadId) return null;
  const p = one(db, `select body,deleted_at from inquiry_payloads where payload_id=?`, payloadId);
  return p && !p.deleted_at ? parse(p.body) : null;
}

function roleOf(db, inquiryId, principal) {
  if (!present(principal)) return null;
  return one(db, `select role from inquiry_roles where inquiry_id=? and principal=? and active=1`,
    inquiryId, principal)?.role ?? null;
}

function mayReview(role) { return role === 'owner' || role === 'reviewer'; }

function inquiryById(db, inquiryId) {
  return one(db, 'select * from inquiries where inquiry_id=?', inquiryId);
}

function sourceIdsOf(body) {
  return [...new Set(body.findings.flatMap((f) => f.sourceIds))].sort();
}

function normalizeBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return failure('invalid_body');
  if (typeof input.summary !== 'string' || input.summary.length > 10000) return failure('invalid_summary');
  if (!Array.isArray(input.findings) || input.findings.length > 100) return failure('invalid_findings');
  const findings = [];
  for (const item of input.findings) {
    if (!item || !bounded(item.text, 5000)) return failure('invalid_finding_text');
    if (!Array.isArray(item.sourceIds) || !item.sourceIds.length || item.sourceIds.length > 30 ||
        item.sourceIds.some((s) => !bounded(s, 120))) return failure('finding_needs_source');
    const standing = item.standing ?? 'reported';
    if (!STANDINGS.has(standing)) return failure('invalid_standing');
    findings.push({
      text: item.text.trim(), sourceIds: [...new Set(item.sourceIds.map((s) => s.trim()))], standing,
    });
  }
  for (const field of ['uncertainties', 'nextSteps']) {
    if (!Array.isArray(input[field]) || input[field].length > 100 ||
        input[field].some((s) => !bounded(s, 5000))) return failure(`invalid_${field}`);
  }
  return {
    ok: true,
    body: {
      summary: input.summary.trim(), findings,
      uncertainties: input.uncertainties.map((s) => s.trim()),
      nextSteps: input.nextSteps.map((s) => s.trim()),
    },
  };
}

function sourcesBelong(db, inquiryId, sourceIds) {
  return sourceIds.every((sourceId) => one(db,
    `select 1 from inquiry_sources where inquiry_id=? and source_id=?`, inquiryId, sourceId));
}

function revision(db, revisionId) {
  return one(db, 'select * from inquiry_revisions where revision_id=?', revisionId);
}

function releaseValid(db, publication) {
  if (!publication || publication.audience !== 'public') return false;
  const rev = revision(db, publication.revision_id);
  if (!rev || rev.inquiry_id !== publication.inquiry_id || rev.state !== 'reviewed' ||
      payload(db, rev.payload_id) == null) return false;
  for (const sourceId of parse(rev.source_ids, [])) {
    const s = one(db, 'select * from inquiry_sources where source_id=? and inquiry_id=?',
      sourceId, publication.inquiry_id);
    const sourceContent = s && payload(db, s.payload_id);
    if (!s || s.public_release !== 1 || sourceContent == null ||
        sourceContent.status !== 'available') return false;
  }
  for (const contributionId of parse(rev.contribution_ids, [])) {
    const c = one(db, `select * from inquiry_contributions
      where contribution_id=? and inquiry_id=?`, contributionId, publication.inquiry_id);
    if (!c || c.status !== 'accepted' || c.allow_public_release !== 1 ||
        payload(db, c.payload_id) == null) return false;
  }
  return true;
}

function teamReadableRevision(db, row) {
  if (!row || row.state !== 'reviewed' || payload(db, row.payload_id) == null) return false;
  for (const sourceId of parse(row.source_ids, [])) {
    const s = one(db, 'select * from inquiry_sources where source_id=? and inquiry_id=?',
      sourceId, row.inquiry_id);
    if (!s || !['team', 'public'].includes(s.read_scope) || payload(db, s.payload_id) == null) return false;
  }
  for (const contributionId of parse(row.contribution_ids, [])) {
    const c = one(db, 'select * from inquiry_contributions where contribution_id=? and inquiry_id=?',
      contributionId, row.inquiry_id);
    if (!c || c.status !== 'accepted' || c.allow_team_read !== 1 ||
        payload(db, c.payload_id) == null) return false;
  }
  return true;
}

function publicPublication(db, inquiry) {
  if (!inquiry || inquiry.visibility !== 'public' || !inquiry.latest_publication_id) return null;
  const p = one(db, 'select * from inquiry_publications where publication_id=?',
    inquiry.latest_publication_id);
  return releaseValid(db, p) ? p : null;
}

function describeRevision(db, row, includeReason = false) {
  if (!row) return null;
  const body = payload(db, row.payload_id);
  if (body == null) return null;
  return {
    revision_id: row.revision_id, inquiry_id: row.inquiry_id,
    parent_revision_id: row.parent_revision_id, version: row.version,
    state: row.state, body, source_ids: parse(row.source_ids, []),
    contribution_ids: parse(row.contribution_ids, []),
    author: row.author, reviewer: row.reviewer, created_at: row.created_at,
    ...(includeReason ? { reason: payload(db, row.reason_payload_id) } : {}),
  };
}

export function createInquiry(db, {
  principal, slug, title, question, visibility = 'private', idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'createInquiry', slug, title, question, visibility },
  }, () => {
    // Slugs are event metadata, so they must be opaque. A title-derived slug
    // could otherwise keep deletable personal content in the immutable log.
    if (!/^t-[a-f0-9]{16,40}$/.test(slug ?? '')) return failure('invalid_slug');
    if (!bounded(title, 200)) return failure('invalid_title');
    if (!bounded(question, 2000)) return failure('invalid_question');
    if (!['public', 'private'].includes(visibility)) return failure('invalid_visibility');
    if (one(db, 'select 1 from inquiries where slug=?', slug)) return failure('slug_taken');
    const inquiryId = id('iq');
    const titlePayloadId = putPayload(db, principal, 'inquiry_title', title.trim());
    const questionPayloadId = putPayload(db, principal, 'inquiry_question', question.trim());
    emit(db, {
      type: 'inquiry.created', author: principal,
      payload: {
        inquiry_id: inquiryId, slug, owner_principal: principal,
        title_payload_id: titlePayloadId, question_payload_id: questionPayloadId,
        visibility, owner_role_id: id('ir'),
      },
    });
    return { ok: true, inquiry_id: inquiryId, slug };
  });
}

export function grantInquiryRole(db, {
  principal, inquiryId, targetPrincipal, role, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'grantInquiryRole', inquiryId, targetPrincipal, role },
  }, () => {
    if (roleOf(db, inquiryId, principal) !== 'owner') return failure('forbidden');
    if (!PRINCIPAL.test(targetPrincipal ?? '') || !['reviewer', 'reader'].includes(role)) return failure('invalid_role');
    const inq = inquiryById(db, inquiryId);
    if (targetPrincipal === inq.owner_principal) return failure('owner_role_immutable');
    emit(db, { type: 'inquiry.role_granted', author: principal,
      payload: { role_id: id('ir'), inquiry_id: inquiryId, principal: targetPrincipal, role } });
    return { ok: true, inquiry_id: inquiryId, principal: targetPrincipal, role };
  });
}

export function revokeInquiryRole(db, {
  principal, inquiryId, targetPrincipal, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'revokeInquiryRole', inquiryId, targetPrincipal },
  }, () => {
    if (roleOf(db, inquiryId, principal) !== 'owner') return failure('forbidden');
    const inq = inquiryById(db, inquiryId);
    if (targetPrincipal === inq.owner_principal) return failure('owner_role_immutable');
    if (!roleOf(db, inquiryId, targetPrincipal)) return failure('no_active_role');
    emit(db, { type: 'inquiry.role_revoked', author: principal,
      payload: { inquiry_id: inquiryId, principal: targetPrincipal } });
    return { ok: true };
  });
}

export function addSource(db, { principal, inquiryId, source, idempotencyKey }) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'addSource', inquiryId, source },
  }, () => {
    if (!mayReview(roleOf(db, inquiryId, principal))) return failure('forbidden');
    if (!source || typeof source !== 'object') return failure('invalid_source');
    const status = source.status ?? 'available';
    const readScope = source.readScope ?? 'reviewers';
    if (!SOURCE_STATUSES.has(status) || !READ_SCOPES.has(readScope)) return failure('invalid_source_scope');
    if (source.url != null && (typeof source.url !== 'string' || source.url.length > 3000)) return failure('invalid_source_url');
    if (!bounded(source.publisher, 500) || !bounded(source.locator, 2000)) return failure('source_needs_publisher_and_locator');
    if (status === 'available' && !bounded(source.text, 100000)) return failure('source_needs_text');
    const normalized = {
      url: source.url?.trim() || null,
      publisher: source.publisher.trim(),
      publishedAt: source.publishedAt || null,
      eventAt: source.eventAt || null,
      retrievedAt: source.retrievedAt || stamp(),
      locator: source.locator.trim(), status,
      language: source.language || null,
      originalLanguage: source.originalLanguage || source.language || null,
      text: status === 'available' ? source.text.trim() : null,
    };
    const sourceId = id('is');
    const payloadId = putPayload(db, principal, 'source', normalized);
    emit(db, { type: 'inquiry.source_added', author: principal,
      payload: {
        source_id: sourceId, inquiry_id: inquiryId, payload_id: payloadId,
        read_scope: readScope, public_release: source.publicRelease === true,
      } });
    return { ok: true, source_id: sourceId };
  });
}

export function setSourcePublicRelease(db, {
  principal, inquiryId, sourceId, publicRelease, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'setSourcePublicRelease', inquiryId, sourceId, publicRelease },
  }, () => {
    const source = one(db, 'select * from inquiry_sources where source_id=? and inquiry_id=?', sourceId, inquiryId);
    const inq = inquiryById(db, inquiryId);
    if (!source || !inq) return failure('not_found');
    if (principal !== source.added_by && principal !== inq.owner_principal) return failure('forbidden');
    if (typeof publicRelease !== 'boolean') return failure('invalid_release_value');
    if (publicRelease && payload(db, source.payload_id) == null) return failure('source_content_missing');
    emit(db, { type: 'inquiry.source_release_set', author: principal,
      payload: { inquiry_id: inquiryId, source_id: sourceId, public_release: publicRelease } });
    return { ok: true, public_release: publicRelease };
  });
}

export function saveDraft(db, {
  principal, inquiryId, body, expectedVersion,
  excludeContributionIds = [], lineageReason = null, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'saveDraft', inquiryId, body, expectedVersion,
      excludeContributionIds, lineageReason },
  }, () => {
    if (!mayReview(roleOf(db, inquiryId, principal))) return failure('forbidden');
    const inq = inquiryById(db, inquiryId);
    if (inq.version !== expectedVersion) return failure('version_conflict', { currentVersion: inq.version });
    const checked = normalizeBody(body);
    if (!checked.ok) return checked;
    const sourceIds = sourceIdsOf(checked.body);
    if (!sourcesBelong(db, inquiryId, sourceIds)) return failure('source_from_another_inquiry');
    const parent = inq.current_revision_id ? revision(db, inq.current_revision_id) : null;
    const inherited = parse(parent?.contribution_ids, []);
    if (!Array.isArray(excludeContributionIds) ||
        excludeContributionIds.some((x) => !inherited.includes(x))) return failure('invalid_lineage_exclusion');
    const excluded = new Set(excludeContributionIds);
    if (excluded.size && !bounded(lineageReason, 5000)) return failure('lineage_repair_reason_required');
    const retained = inherited.filter((x) => !excluded.has(x));
    const revisionId = id('iv');
    const payloadId = putPayload(db, principal, 'account_revision', checked.body);
    const reasonPayloadId = excluded.size
      ? putPayload(db, principal, 'lineage_repair_reason', lineageReason.trim()) : null;
    const version = inq.version + 1;
    emit(db, { type: 'inquiry.draft_saved', author: principal,
      payload: {
        inquiry_id: inquiryId, revision_id: revisionId,
        parent_revision_id: inq.current_revision_id,
        version, payload_id: payloadId, source_ids: sourceIds,
        contribution_ids: retained, reason_payload_id: reasonPayloadId,
      } });
    return { ok: true, revision_id: revisionId, version };
  });
}

export function reviewDraft(db, {
  principal, inquiryId, revisionId, expectedVersion, reason, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'reviewDraft', inquiryId, revisionId, expectedVersion, reason },
  }, () => {
    if (!mayReview(roleOf(db, inquiryId, principal))) return failure('forbidden');
    const inq = inquiryById(db, inquiryId);
    if (inq.version !== expectedVersion) return failure('version_conflict', { currentVersion: inq.version });
    const draft = revision(db, revisionId);
    if (!draft || draft.inquiry_id !== inquiryId || draft.state !== 'saved_draft' ||
        inq.current_revision_id !== revisionId) return failure('not_current_draft');
    if (!bounded(reason, 5000)) return failure('review_reason_required');
    const reviewedBody = payload(db, draft.payload_id);
    if (reviewedBody == null) return failure('draft_content_missing');
    const reviewedId = id('iv');
    const reasonPayloadId = putPayload(db, principal, 'review_reason', reason.trim());
    const reviewedPayloadId = putPayload(db, principal, 'account_revision', reviewedBody);
    const version = inq.version + 1;
    emit(db, { type: 'inquiry.draft_reviewed', author: principal,
      payload: {
        inquiry_id: inquiryId, revision_id: reviewedId,
        parent_revision_id: revisionId, version,
        payload_id: reviewedPayloadId, source_ids: parse(draft.source_ids, []),
        contribution_ids: parse(draft.contribution_ids, []),
        reason_payload_id: reasonPayloadId,
      } });
    return { ok: true, revision_id: reviewedId, version };
  });
}

export function submitContribution(db, {
  principal, inquiryId, text, target = null, sourceIds = [],
  allowTeamRead = false, allowPublicRelease = false, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'submitContribution', inquiryId, text, target, sourceIds,
      allowTeamRead, allowPublicRelease },
  }, () => {
    const inq = inquiryById(db, inquiryId);
    if (!inq) return failure('not_found');
    const role = roleOf(db, inquiryId, principal);
    if (!role && !publicPublication(db, inq)) return failure('intake_not_open');
    if (!bounded(text, 20000)) return failure('invalid_contribution');
    if (target != null && (typeof target !== 'string' || target.length > 500)) return failure('invalid_target');
    if (!Array.isArray(sourceIds) || sourceIds.length > 30 ||
        sourceIds.some((s) => !bounded(s, 120))) return failure('invalid_source_ids');
    const uniqueSourceIds = [...new Set(sourceIds)];
    if (!sourcesBelong(db, inquiryId, uniqueSourceIds)) return failure('source_from_another_inquiry');
    if (!mayReview(role)) {
      const pub = publicPublication(db, inq);
      const rev = pub && revision(db, pub.revision_id);
      const released = new Set(parse(rev?.source_ids, []));
      if (uniqueSourceIds.some((s) => !released.has(s))) return failure('source_not_visible_to_contributor');
    }
    if (typeof allowTeamRead !== 'boolean' || typeof allowPublicRelease !== 'boolean') {
      return failure('invalid_release_value');
    }
    const contributionId = id('ic');
    const receiptId = id('irt');
    const receiptToken = token();
    const payloadId = putPayload(db, principal, 'contribution', { text: text.trim(), target: target?.trim() || null });
    run(db, 'insert into inquiry_receipt_secrets (receipt_id,token_hash) values (?,?)',
      receiptId, sha256(receiptToken));
    emit(db, { type: 'inquiry.contribution_submitted', author: principal,
      payload: {
        inquiry_id: inquiryId, contribution_id: contributionId,
        payload_id: payloadId, source_ids: uniqueSourceIds,
        allow_team_read: allowTeamRead,
        allow_public_release: allowPublicRelease, receipt_id: receiptId,
      } });
    return { ok: true, contribution_id: contributionId, receipt_id: receiptId,
      receipt_token: receiptToken, status: 'submitted_for_review' };
  });
}

export function setContributionPublicRelease(db, {
  principal, inquiryId, contributionId, allowPublicRelease, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'setContributionPublicRelease', inquiryId, contributionId, allowPublicRelease },
  }, () => {
    const c = one(db, `select * from inquiry_contributions
      where contribution_id=? and inquiry_id=?`, contributionId, inquiryId);
    if (!c) return failure('not_found');
    if (c.principal !== principal) return failure('forbidden');
    if (typeof allowPublicRelease !== 'boolean') return failure('invalid_release_value');
    if (allowPublicRelease && (c.status === 'withdrawn' || payload(db, c.payload_id) == null)) {
      return failure('contribution_content_missing');
    }
    emit(db, { type: 'inquiry.contribution_release_set', author: principal,
      payload: { inquiry_id: inquiryId, contribution_id: contributionId,
        allow_public_release: allowPublicRelease } });
    return { ok: true, allow_public_release: allowPublicRelease };
  });
}

function contributionForReceipt(db, receiptToken) {
  if (!present(receiptToken)) return null;
  const secret = one(db, 'select receipt_id from inquiry_receipt_secrets where token_hash=?', sha256(receiptToken));
  return secret ? one(db, 'select * from inquiry_contributions where receipt_id=?', secret.receipt_id) : null;
}

/** A receipt bearer may grant or revoke this contribution's release right. */
export function setContributionPublicReleaseByToken(db, {
  token: receiptToken, allowPublicRelease, idempotencyKey,
}) {
  const c = contributionForReceipt(db, receiptToken);
  if (!c) return failure('unknown_receipt');
  return command(db, {
    principal: `receipt:${c.receipt_id}`, idempotencyKey,
    request: { type: 'setContributionPublicReleaseByToken',
      contributionId: c.contribution_id, allowPublicRelease },
  }, () => {
    const current = one(db, 'select * from inquiry_contributions where contribution_id=?', c.contribution_id);
    if (typeof allowPublicRelease !== 'boolean') return failure('invalid_release_value');
    if (allowPublicRelease && (current.status === 'withdrawn' || payload(db, current.payload_id) == null)) {
      return failure('contribution_content_missing');
    }
    emit(db, { type: 'inquiry.contribution_release_set', author: `receipt:${c.receipt_id}`,
      payload: { inquiry_id: c.inquiry_id, contribution_id: c.contribution_id,
        allow_public_release: allowPublicRelease } });
    return { ok: true, allow_public_release: allowPublicRelease };
  });
}

/** Team reading is separate from public distribution and can be revoked. */
export function setContributionTeamReadByToken(db, {
  token: receiptToken, allowTeamRead, idempotencyKey,
}) {
  const c = contributionForReceipt(db, receiptToken);
  if (!c) return failure('unknown_receipt');
  return command(db, {
    principal: `receipt:${c.receipt_id}`, idempotencyKey,
    request: { type: 'setContributionTeamReadByToken',
      contributionId: c.contribution_id, allowTeamRead },
  }, () => {
    const current = one(db, 'select * from inquiry_contributions where contribution_id=?', c.contribution_id);
    if (typeof allowTeamRead !== 'boolean') return failure('invalid_read_value');
    if (allowTeamRead && (current.status === 'withdrawn' || payload(db, current.payload_id) == null)) {
      return failure('contribution_content_missing');
    }
    emit(db, { type: 'inquiry.contribution_team_read_set', author: `receipt:${c.receipt_id}`,
      payload: { inquiry_id: c.inquiry_id, contribution_id: c.contribution_id,
        allow_team_read: allowTeamRead } });
    return { ok: true, allow_team_read: allowTeamRead };
  });
}

export function reviewContribution(db, {
  principal, inquiryId, contributionId, disposition, reason,
  body = null, expectedVersion = null, idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'reviewContribution', inquiryId, contributionId, disposition, reason, body, expectedVersion },
  }, () => {
    if (!mayReview(roleOf(db, inquiryId, principal))) return failure('forbidden');
    const inq = inquiryById(db, inquiryId);
    const c = one(db, `select * from inquiry_contributions
      where contribution_id=? and inquiry_id=?`, contributionId, inquiryId);
    if (!c) return failure('not_found');
    if (c.status !== 'submitted_for_review') return failure('already_reviewed');
    if (!DISPOSITIONS.has(disposition)) return failure('invalid_disposition');
    if (!bounded(reason, 5000)) return failure('review_reason_required');
    let revisionId = null;
    let version = null;
    let revisionPayloadId = null;
    let sourceIds = null;
    let contributionIds = null;
    if (disposition === 'accepted') {
      if (inq.version !== expectedVersion) return failure('version_conflict', { currentVersion: inq.version });
      if (payload(db, c.payload_id) == null) return failure('contribution_content_missing');
      const checked = normalizeBody(body);
      if (!checked.ok) return checked;
      sourceIds = sourceIdsOf(checked.body);
      if (!sourcesBelong(db, inquiryId, sourceIds)) return failure('source_from_another_inquiry');
      const parent = inq.current_revision_id ? revision(db, inq.current_revision_id) : null;
      contributionIds = [...new Set([...parse(parent?.contribution_ids, []), contributionId])];
      revisionId = id('iv');
      version = inq.version + 1;
      revisionPayloadId = putPayload(db, principal, 'account_revision', checked.body);
    }
    const reasonPayloadId = putPayload(db, principal, 'review_reason', reason.trim());
    emit(db, { type: 'inquiry.contribution_reviewed', author: principal,
      payload: {
        inquiry_id: inquiryId, contribution_id: contributionId,
        receipt_id: c.receipt_id, disposition,
        reason_payload_id: reasonPayloadId, revision_id: revisionId,
        parent_revision_id: inq.current_revision_id, version,
        payload_id: revisionPayloadId, source_ids: sourceIds,
        contribution_ids: contributionIds,
      } });
    return { ok: true, receipt_id: c.receipt_id, disposition,
      revision_id: revisionId, version };
  });
}

export function publishVersion(db, {
  principal, inquiryId, revisionId, audience = 'public', idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'publishVersion', inquiryId, revisionId, audience },
  }, () => {
    if (roleOf(db, inquiryId, principal) !== 'owner') return failure('forbidden');
    const inq = inquiryById(db, inquiryId);
    const rev = revision(db, revisionId);
    if (!inq || !rev || rev.inquiry_id !== inquiryId) return failure('not_found');
    if (inq.visibility !== 'public' || audience !== 'public') return failure('unsupported_audience');
    if (rev.state !== 'reviewed') return failure('revision_not_reviewed');
    if (inq.reviewed_revision_id !== revisionId) return failure('revision_not_current');
    const publicationId = id('ipub');
    const proposed = { publication_id: publicationId, inquiry_id: inquiryId, revision_id: revisionId, audience };
    if (!releaseValid(db, proposed)) return failure('release_permission_missing');
    emit(db, { type: 'inquiry.published', author: principal, payload: proposed });
    return { ok: true, publication_id: publicationId, revision_id: revisionId, audience };
  });
}

export function deleteInquiryPayload(db, {
  principal, payloadId, reason = 'owner requested deletion', idempotencyKey,
}) {
  return command(db, {
    principal, idempotencyKey,
    request: { type: 'deleteInquiryPayload', payloadId, reason },
  }, () => {
    const row = one(db, 'select * from inquiry_payloads where payload_id=?', payloadId);
    if (!row) return failure('not_found');
    if (row.owner_principal !== principal) return failure('forbidden');
    if (row.deleted_at) return failure('already_deleted');
    run(db, 'update inquiry_payloads set body=null, deleted_at=? where payload_id=?', stamp(), payloadId);
    emit(db, { type: 'inquiry.payload_deleted', author: principal,
      reason: 'payload deletion', payload: { payload_id: payloadId, kind: row.kind } });
    return { ok: true, payload_id: payloadId };
  });
}

/** A receipt bearer can erase their submitted text without retaining a cookie. */
export function deleteContributionByToken(db, { token: receiptToken, idempotencyKey }) {
  if (!present(receiptToken)) return failure('unknown_receipt');
  const tokenHash = sha256(receiptToken);
  const secret = one(db, 'select receipt_id from inquiry_receipt_secrets where token_hash=?', tokenHash);
  if (!secret) return failure('unknown_receipt');
  // The high-entropy bearer token is the principal for this one command. It is
  // never copied into the event log or passed on as a human identity.
  return command(db, {
    principal: `receipt:${secret.receipt_id}`, idempotencyKey,
    request: { type: 'deleteContributionByToken', receiptId: secret.receipt_id },
  }, () => {
    const c = one(db, 'select * from inquiry_contributions where receipt_id=?', secret.receipt_id);
    if (!c) return failure('unknown_receipt');
    const p = one(db, 'select * from inquiry_payloads where payload_id=?', c.payload_id);
    if (!p) return failure('contribution_content_missing');
    if (p.deleted_at || c.status === 'withdrawn') {
      return { ok: true, contribution_id: c.contribution_id, status: 'withdrawn' };
    }
    const at = stamp();
    run(db, 'update inquiry_payloads set body=null, deleted_at=? where payload_id=?', at, c.payload_id);
    emit(db, { type: 'inquiry.contribution_withdrawn', author: `receipt:${c.receipt_id}`,
      payload: { inquiry_id: c.inquiry_id, contribution_id: c.contribution_id,
        receipt_id: c.receipt_id, payload_id: c.payload_id }, at });
    return { ok: true, contribution_id: c.contribution_id, status: 'withdrawn' };
  });
}

export function listInquiries(db, { principal = null } = {}) {
  const rows = all(db, 'select * from inquiries order by created_at desc');
  const out = [];
  for (const row of rows) {
    const role = roleOf(db, row.inquiry_id, principal);
    const publication = publicPublication(db, row);
    if (!role && !publication) continue;
    const teamRevision = role === 'reader' ? revision(db, row.reviewed_revision_id) : null;
    const visibleVersion = mayReview(role) ? row.version
      : teamReadableRevision(db, teamRevision) ? teamRevision.version
        : publication ? revision(db, publication.revision_id)?.version ?? null : null;
    out.push({
      inquiry_id: row.inquiry_id, slug: row.slug,
      title: payload(db, row.title_payload_id), question: payload(db, row.question_payload_id),
      visibility: row.visibility, version: visibleVersion, role,
    });
  }
  return out;
}

export function getInquiry(db, { slug, principal = null }) {
  const row = one(db, 'select * from inquiries where slug=?', slug);
  if (!row) return null;
  const role = roleOf(db, row.inquiry_id, principal);
  const publication = publicPublication(db, row);
  if (!role && !publication) return null;
  const teamRevision = role === 'reader' ? revision(db, row.reviewed_revision_id) : null;
  const accountRow = mayReview(role)
    ? revision(db, row.current_revision_id)
    : teamReadableRevision(db, teamRevision) ? teamRevision
      : publication ? revision(db, publication.revision_id) : null;
  const visibleVersion = mayReview(role) ? row.version : accountRow?.version ?? null;
  return {
    inquiry: {
      inquiry_id: row.inquiry_id, slug: row.slug,
      title: payload(db, row.title_payload_id), question: payload(db, row.question_payload_id),
      visibility: row.visibility, version: visibleVersion,
      owner_principal: role === 'owner' ? row.owner_principal : null,
    },
    account: describeRevision(db, accountRow, mayReview(role)),
    publication: publication ? {
      publication_id: publication.publication_id, revision_id: publication.revision_id,
      audience: publication.audience, published_at: publication.published_at,
    } : null,
    role,
  };
}

export function getRevision(db, { principal = null, revisionId }) {
  const row = revision(db, revisionId);
  if (!row) return null;
  const role = roleOf(db, row.inquiry_id, principal);
  if (!mayReview(role) && !(role === 'reader' && teamReadableRevision(db, row))) {
    const inq = inquiryById(db, row.inquiry_id);
    const pub = publicPublication(db, inq);
    if (!pub || pub.revision_id !== revisionId) return null;
  }
  return describeRevision(db, row, mayReview(role));
}

export function listSources(db, { principal = null, inquiryId }) {
  const inq = inquiryById(db, inquiryId);
  if (!inq) return [];
  const role = roleOf(db, inquiryId, principal);
  const pub = publicPublication(db, inq);
  if (!role && !pub) return [];
  const publicIds = pub ? new Set(parse(revision(db, pub.revision_id).source_ids, [])) : new Set();
  const rows = all(db, 'select * from inquiry_sources where inquiry_id=? order by created_at', inquiryId);
  return rows.filter((s) => mayReview(role) ||
      (role === 'reader' && ['team', 'public'].includes(s.read_scope)) ||
      (pub && publicIds.has(s.source_id) && s.public_release === 1))
    .map((s) => {
      const content = payload(db, s.payload_id);
      return {
        source_id: s.source_id, inquiry_id: inquiryId, ...content,
        publicRelease: s.public_release === 1, readScope: s.read_scope,
        contentAvailable: content != null,
      };
    });
}

export function listPendingContributions(db, { principal, inquiryId }) {
  if (!mayReview(roleOf(db, inquiryId, principal))) return [];
  return all(db, `select * from inquiry_contributions
    where inquiry_id=? and status='submitted_for_review' order by submitted_at`, inquiryId)
    .map((c) => {
      const content = payload(db, c.payload_id);
      return {
        contribution_id: c.contribution_id, principal: c.principal,
        text: content?.text ?? null, target: content?.target ?? null,
        sourceIds: parse(c.source_ids, []), submitted_at: c.submitted_at,
        allowTeamRead: c.allow_team_read === 1,
        allowPublicRelease: c.allow_public_release === 1,
        contentAvailable: content != null,
      };
    });
}

export function getReceipt(db, { token: receiptToken }) {
  if (!present(receiptToken)) return null;
  const secret = one(db, 'select receipt_id from inquiry_receipt_secrets where token_hash=?', sha256(receiptToken));
  if (!secret) return null;
  const r = one(db, 'select * from inquiry_receipts where receipt_id=?', secret.receipt_id);
  if (!r) return null;
  const contribution = one(db, 'select * from inquiry_contributions where contribution_id=?', r.contribution_id);
  const inquiry = inquiryById(db, r.inquiry_id);
  const reason = payload(db, r.reason_payload_id);
  const accountEffect = r.status === 'accepted' && r.revision_id
    ? `Accepted into account revision ${r.revision_id}.`
    : r.status === 'declined' ? 'Not used in the account.'
      : r.status === 'needs_changes' ? 'Clarification requested before use.'
        : r.status === 'withdrawn' ? 'Submission withdrawn; its text is no longer available.'
        : 'Waiting for human review.';
  return {
    receipt_id: r.receipt_id, contribution_id: r.contribution_id,
    inquiry_slug: inquiry?.slug ?? null,
    status: r.status, reason, revision_id: r.revision_id,
    allow_public_release: contribution?.allow_public_release === 1,
    allow_team_read: contribution?.allow_team_read === 1,
    account_effect: accountEffect, made_available_at: r.made_available_at,
    delivered_at: null, acknowledged_at: null,
  };
}
