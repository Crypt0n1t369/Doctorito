import { id, sha256, canonical } from './ids.js';
import { DERIVED, all, one, run, tx } from './db.js';

const GENESIS = '0'.repeat(64);

function clean(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

function insert(db, table, obj) {
  const keys = Object.keys(obj);
  const sql = `insert into ${table} (${keys.join(',')}) values (${keys.map(() => '?').join(',')})`;
  db.prepare(sql).run(...keys.map((k) => clean(obj[k])));
}

function upsert(db, table, pk, obj) {
  const keys = Object.keys(obj);
  const sets = keys.filter((k) => k !== pk).map((k) => `${k}=excluded.${k}`).join(',');
  const sql = `insert into ${table} (${keys.join(',')}) values (${keys.map(() => '?').join(',')})
               on conflict(${pk}) do update set ${sets}`;
  db.prepare(sql).run(...keys.map((k) => clean(obj[k])));
}

function patch(db, table, pk, pkv, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  const sql = `update ${table} set ${keys.map((k) => `${k}=?`).join(',')} where ${pk}=?`;
  db.prepare(sql).run(...keys.map((k) => clean(obj[k])), pkv);
}

// ---------------------------------------------------------------------------
// Invariant 3: qty_committed is derived, never written. Invariant 7: the
// delivery record is derived from fulfilments. Both are recomputed here and
// nowhere else, from the only rows that are allowed to say so.
// ---------------------------------------------------------------------------
export function recomputeNeed(db, needId) {
  const need = one(db, 'select * from needs where need_id=?', needId);
  if (!need) return;
  const sum = one(db,
    `select coalesce(sum(qty),0) q from commitments
      where need_id=? and state in ('confirmed','fulfilled')`, needId).q;
  let status = need.status;
  if (status !== 'closed') status = sum >= need.qty_required ? 'filled' : 'open';
  run(db, 'update needs set qty_committed=?, status=? where need_id=?', sum, status, needId);
}

// ---------------------------------------------------------------------------
// The fold. One function per event type. Nothing else writes derived tables.
// ---------------------------------------------------------------------------
const APPLY = {
  'decision.imported'(db, e, p) {
    upsert(db, 'decisions', 'decision_id', {
      decision_id: p.decision_id, source: p.source, body: p.body, result: p.result,
      quorum: p.quorum, decided_at: p.decided_at, provenance: p.provenance,
    });
  },

  'initiative.opened'(db, e, p) {
    upsert(db, 'initiatives', 'initiative_id', {
      initiative_id: p.initiative_id, slug: p.slug, decision_id: p.decision_id,
      title: p.title, objective: p.objective, constraints: p.constraints,
      window_start: p.window_start, window_end: p.window_end, place: p.place,
      geo_lat: p.geo_lat, geo_lon: p.geo_lon, owner_org: p.owner_org,
      visibility: p.visibility ?? 'public', status: 'open',
      autobind: p.autobind ?? 1, config: p.config, created_at: e.at,
    });
  },

  'initiative.configured'(db, e, p) {
    patch(db, 'initiatives', 'initiative_id', p.initiative_id, { config: p.config });
  },

  // The one switch. Effective immediately, usable without calling us.
  'initiative.autobind_set'(db, e, p) {
    patch(db, 'initiatives', 'initiative_id', p.initiative_id, { autobind: p.autobind ? 1 : 0 });
  },

  'initiative.closed'(db, e, p) {
    patch(db, 'initiatives', 'initiative_id', p.initiative_id, { status: 'closed' });
  },

  'need.published'(db, e, p) {
    insert(db, 'needs', {
      need_id: p.need_id, initiative_id: p.initiative_id, kind: p.kind,
      description: p.description, description_short: p.description_short,
      qty_required: p.qty_required, qty_committed: 0, unit: p.unit,
      window_start: p.window_start, window_end: p.window_end,
      geo_place: p.geo_place, geo_lat: p.geo_lat, geo_lon: p.geo_lon,
      geo_radius_km: p.geo_radius_km ?? 25, qualifications: p.qualifications ?? [],
      risk_class: p.risk_class, allow_overcommit: p.allow_overcommit ?? 0,
      status: 'open', language: p.language ?? 'en', published_at: e.at,
    });
  },

  // Invariant 6: a need's quantity never changes silently. The event carries
  // an author and a reason, and the public page shows that it was amended.
  'need.amended'(db, e, p) {
    const fields = {};
    for (const k of ['kind', 'description', 'description_short', 'qty_required', 'unit',
      'window_start', 'window_end', 'geo_place', 'geo_radius_km', 'qualifications',
      'risk_class', 'allow_overcommit']) {
      if (p[k] !== undefined) fields[k] = p[k];
    }
    patch(db, 'needs', 'need_id', p.need_id, fields);
    recomputeNeed(db, p.need_id);
  },

  'need.closed'(db, e, p) {
    patch(db, 'needs', 'need_id', p.need_id, { status: 'closed' });
  },

  'need.asked'(db, e, p) {
    patch(db, 'needs', 'need_id', p.need_id, { last_ask_at: e.at });
  },

  'actor.registered'(db, e, p) {
    upsert(db, 'actors', 'actor_id', {
      actor_id: p.actor_id, kind: p.kind, display_name: p.display_name, created_at: e.at,
    });
  },

  'actor.contact_added'(db, e, p) {
    upsert(db, 'contacts', 'contact_id', {
      contact_id: p.contact_id, actor_id: p.actor_id, channel: p.channel,
      handle: p.handle, verified: p.verified ?? 0,
    });
  },

  // Invariant 4: eligibility is a pure predicate over *verified* credentials.
  // The only way a credential exists is this event, written by a verifier.
  'credential.verified'(db, e, p) {
    upsert(db, 'credentials', 'credential_id', {
      credential_id: p.credential_id, actor_id: p.actor_id, code: p.code,
      issuer: p.issuer, verified_at: e.at, expires_at: p.expires_at,
    });
  },

  'capability.declared'(db, e, p) {
    upsert(db, 'capabilities', 'capability_id', {
      capability_id: p.capability_id, actor_id: p.actor_id, kind: p.kind,
      description: p.description, quantity: p.quantity, unit: p.unit,
      availability_start: p.availability_start, availability_end: p.availability_end,
      geo_place: p.geo_place, geo_lat: p.geo_lat, geo_lon: p.geo_lon,
      geo_radius_km: p.geo_radius_km ?? 40, evidence: p.evidence,
      initiative_id: p.initiative_id ?? e.initiative_id ?? legacyScope(db, e), created_at: e.at,
    });
  },

  'offer.received'(db, e, p) {
    insert(db, 'offers', {
      offer_id: p.offer_id, initiative_id: p.initiative_id, actor_id: p.actor_id,
      raw_text: p.raw_text, channel: p.channel, handle: p.handle,
      attachments: p.attachments, language: p.language, extracted: p.extracted,
      received_at: p.received_at ?? e.at, state: 'received', shadow: p.shadow ?? 0,
      provider_message_id: p.provider_message_id ?? null, claimed_contact: p.claimed_contact ?? null,
    });
  },

  'offer.decided'(db, e, p) {
    // Before 23 September a coordinator's "reject" was recorded as 'rejected',
    // the same word the screen uses for a message it sets aside for a person.
    // Only the screen's kind is still waiting for someone; a person's is done.
    const state = p.state === 'rejected' && e.author !== 'system' ? 'screened_out' : p.state;
    patch(db, 'offers', 'offer_id', p.offer_id, {
      state, latency_ms: p.latency_ms, decided_at: e.at,
      ...(p.reason !== undefined ? { decision_reason: p.reason } : {}),
      ...(p.reply !== undefined ? { reply: p.reply } : {}),
    });
  },

  // Invariant 5 / "nothing acts before its judgment is written": this row lands
  // before the lease and before the commitment, in that order, always.
  'judgment.written'(db, e, p) {
    insert(db, 'judgments', {
      judgment_id: p.judgment_id, offer_id: p.offer_id, initiative_id: p.initiative_id,
      pass: p.pass, question_bank_version: p.question_bank_version,
      model_version: p.model_version, engine: p.engine, state_hash: p.state_hash,
      request: p.request, answers: p.answers, confidence: p.confidence,
      latency_ms: p.latency_ms, input_tokens: p.input_tokens, cost_usd: p.cost_usd,
      degraded_cause: p.degraded_cause ?? null, created_at: e.at,
    });
    const day = e.at.slice(0, 10);
    run(db, `insert into spend (initiative_id, day, calls, cost_usd) values (?,?,1,?)
             on conflict(initiative_id, day) do update set
               calls = calls + 1, cost_usd = cost_usd + excluded.cost_usd`,
      p.initiative_id, day, p.cost_usd ?? 0);
  },

  // Invariant 2: the lease. Quantity leaves the pool the moment it is proposed.
  'commitment.proposed'(db, e, p) {
    insert(db, 'commitments', {
      commitment_id: p.commitment_id, need_id: p.need_id, initiative_id: p.initiative_id,
      offer_id: p.offer_id, actor_id: p.actor_id, qty: p.qty, confidence: p.confidence,
      bound_by: p.bound_by, judgment_id: p.judgment_id, state: 'proposed',
      token: p.token, lease_expires_at: p.lease_expires_at, created_at: e.at,
    });
    recomputeNeed(db, p.need_id);
  },

  'commitment.confirmed'(db, e, p) {
    patch(db, 'commitments', 'commitment_id', p.commitment_id, {
      state: 'confirmed', confirmed_at: e.at, lease_expires_at: null,
    });
    recomputeNeed(db, p.need_id);
  },

  'commitment.withdrawn'(db, e, p) {
    patch(db, 'commitments', 'commitment_id', p.commitment_id, { state: 'withdrawn', ended_at: e.at });
    recomputeNeed(db, p.need_id);
  },

  'commitment.expired'(db, e, p) {
    patch(db, 'commitments', 'commitment_id', p.commitment_id, { state: 'expired', ended_at: e.at });
    recomputeNeed(db, p.need_id);
  },

  'commitment.failed'(db, e, p) {
    patch(db, 'commitments', 'commitment_id', p.commitment_id, { state: 'failed', ended_at: e.at });
    recomputeNeed(db, p.need_id);
  },

  'fulfilment.recorded'(db, e, p) {
    insert(db, 'fulfilments', {
      fulfilment_id: p.fulfilment_id, commitment_id: p.commitment_id, need_id: p.need_id,
      qty_delivered: p.qty_delivered, variance: p.variance, evidence: p.evidence,
      verified_by: p.verified_by, verified_at: e.at,
    });
    patch(db, 'commitments', 'commitment_id', p.commitment_id, { state: 'fulfilled', ended_at: e.at });
    recomputeNeed(db, p.need_id);
  },

  'coordinator.override'(db, e, p) {
    insert(db, 'overrides', {
      override_id: p.override_id, judgment_id: p.judgment_id, offer_id: p.offer_id,
      coordinator: p.coordinator, action: p.action, chosen_need_id: p.chosen_need_id,
      model_need_id: p.model_need_id, agreed: p.agreed, note: p.note,
      seconds_taken: p.seconds_taken, decided_at: e.at,
    });
  },

  'ask.sent'(db, e, p) {
    insert(db, 'asks', {
      ask_id: p.ask_id, need_id: p.need_id, actor_id: p.actor_id, channel: p.channel,
      handle: p.handle, body: p.body, judgment_id: p.judgment_id, confidence: p.confidence,
      sent_at: e.at,
    });
  },

  'message.sent'(db, e, p) {
    insert(db, 'outbox', {
      message_id: p.message_id, initiative_id: p.initiative_id, actor_id: p.actor_id,
      channel: p.channel, handle: p.handle, kind: p.kind, body: p.body, sent_at: e.at,
    });
  },

  // Inquiry events contain references and decision metadata only. Text lives
  // in inquiry_payloads, which is intentionally not rebuilt from this log.
  'inquiry.created'(db, e, p) {
    insert(db, 'inquiries', {
      inquiry_id: p.inquiry_id, slug: p.slug, owner_principal: p.owner_principal,
      title_payload_id: p.title_payload_id, question_payload_id: p.question_payload_id,
      visibility: p.visibility, version: 0, created_at: e.at,
    });
    insert(db, 'inquiry_roles', {
      role_id: p.owner_role_id, inquiry_id: p.inquiry_id,
      principal: p.owner_principal, role: 'owner', active: 1,
    });
  },

  'inquiry.role_granted'(db, e, p) {
    run(db, `insert into inquiry_roles (role_id,inquiry_id,principal,role,active)
             values (?,?,?,?,1) on conflict(inquiry_id,principal) do update set
             role_id=excluded.role_id, role=excluded.role, active=1`,
      p.role_id, p.inquiry_id, p.principal, p.role);
  },

  'inquiry.role_revoked'(db, e, p) {
    run(db, 'update inquiry_roles set active=0 where inquiry_id=? and principal=?',
      p.inquiry_id, p.principal);
  },

  'inquiry.source_added'(db, e, p) {
    insert(db, 'inquiry_sources', {
      source_id: p.source_id, inquiry_id: p.inquiry_id, payload_id: p.payload_id,
      added_by: e.author, read_scope: p.read_scope,
      public_release: p.public_release ? 1 : 0, created_at: e.at,
    });
  },

  'inquiry.source_release_set'(db, e, p) {
    patch(db, 'inquiry_sources', 'source_id', p.source_id,
      { public_release: p.public_release ? 1 : 0 });
  },

  'inquiry.draft_saved'(db, e, p) {
    insert(db, 'inquiry_revisions', {
      revision_id: p.revision_id, inquiry_id: p.inquiry_id,
      parent_revision_id: p.parent_revision_id, version: p.version,
      state: 'saved_draft', payload_id: p.payload_id,
      source_ids: p.source_ids, contribution_ids: p.contribution_ids,
      author: e.author, reason_payload_id: p.reason_payload_id,
      created_at: e.at,
    });
    patch(db, 'inquiries', 'inquiry_id', p.inquiry_id,
      { version: p.version, current_revision_id: p.revision_id });
  },

  'inquiry.draft_reviewed'(db, e, p) {
    insert(db, 'inquiry_revisions', {
      revision_id: p.revision_id, inquiry_id: p.inquiry_id,
      parent_revision_id: p.parent_revision_id, version: p.version,
      state: 'reviewed', payload_id: p.payload_id,
      source_ids: p.source_ids, contribution_ids: p.contribution_ids,
      author: e.author, reviewer: e.author,
      reason_payload_id: p.reason_payload_id, created_at: e.at,
    });
    patch(db, 'inquiries', 'inquiry_id', p.inquiry_id, {
      version: p.version, current_revision_id: p.revision_id,
      reviewed_revision_id: p.revision_id,
    });
  },

  'inquiry.contribution_submitted'(db, e, p) {
    insert(db, 'inquiry_contributions', {
      contribution_id: p.contribution_id, inquiry_id: p.inquiry_id,
      principal: e.author, payload_id: p.payload_id, source_ids: p.source_ids,
      allow_team_read: p.allow_team_read ? 1 : 0,
      allow_public_release: p.allow_public_release ? 1 : 0,
      status: 'submitted_for_review', submitted_at: e.at, receipt_id: p.receipt_id,
    });
    insert(db, 'inquiry_receipts', {
      receipt_id: p.receipt_id, contribution_id: p.contribution_id,
      inquiry_id: p.inquiry_id, status: 'submitted_for_review', made_available_at: e.at,
    });
  },

  'inquiry.contribution_release_set'(db, e, p) {
    patch(db, 'inquiry_contributions', 'contribution_id', p.contribution_id,
      { allow_public_release: p.allow_public_release ? 1 : 0 });
  },

  'inquiry.contribution_team_read_set'(db, e, p) {
    patch(db, 'inquiry_contributions', 'contribution_id', p.contribution_id,
      { allow_team_read: p.allow_team_read ? 1 : 0 });
  },

  'inquiry.contribution_withdrawn'(db, e, p) {
    patch(db, 'inquiry_contributions', 'contribution_id', p.contribution_id,
      { status: 'withdrawn', allow_public_release: 0 });
    patch(db, 'inquiry_receipts', 'receipt_id', p.receipt_id,
      { status: 'withdrawn', made_available_at: e.at });
  },

  'inquiry.contribution_reviewed'(db, e, p) {
    if (p.revision_id) {
      insert(db, 'inquiry_revisions', {
        revision_id: p.revision_id, inquiry_id: p.inquiry_id,
        parent_revision_id: p.parent_revision_id, version: p.version,
        state: 'reviewed', payload_id: p.payload_id,
        source_ids: p.source_ids, contribution_ids: p.contribution_ids,
        author: e.author, reviewer: e.author,
        reason_payload_id: p.reason_payload_id, created_at: e.at,
      });
      patch(db, 'inquiries', 'inquiry_id', p.inquiry_id, {
        version: p.version, current_revision_id: p.revision_id,
        reviewed_revision_id: p.revision_id,
      });
    }
    patch(db, 'inquiry_contributions', 'contribution_id', p.contribution_id, {
      status: p.disposition, reviewer: e.author,
      review_reason_payload_id: p.reason_payload_id, reviewed_at: e.at,
      resulting_revision_id: p.revision_id ?? null,
    });
    patch(db, 'inquiry_receipts', 'receipt_id', p.receipt_id, {
      status: p.disposition, reason_payload_id: p.reason_payload_id,
      revision_id: p.revision_id ?? null, made_available_at: e.at,
    });
  },

  'inquiry.published'(db, e, p) {
    insert(db, 'inquiry_publications', {
      publication_id: p.publication_id, inquiry_id: p.inquiry_id,
      revision_id: p.revision_id, audience: p.audience,
      published_by: e.author, published_at: e.at,
    });
    patch(db, 'inquiries', 'inquiry_id', p.inquiry_id,
      { latest_publication_id: p.publication_id });
  },

  'inquiry.payload_deleted'() {
    // The payload is physically erased by the command transaction. Replay
    // retains this audit event and reconstructs references to missing content.
  },
};

/**
 * Capabilities declared before 23 September carry no initiative. Seeding always
 * opened the initiative and then declared its actors' capabilities, so the
 * scope of an unscoped declaration is the initiative opened most recently
 * before it in the log. Deterministic, so replay agrees; used only for those
 * old events, since every new declaration names its initiative.
 */
function legacyScope(db, e) {
  if (e.seq == null) return null;
  return one(db, `select initiative_id from events where type='initiative.opened' and seq < ? order by seq desc limit 1`, e.seq)?.initiative_id ?? null;
}

export function apply(db, event) {
  const fn = APPLY[event.type];
  if (!fn) throw new Error(`no fold for event type ${event.type}`);
  fn(db, event, typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload);
}

/**
 * Append one event and fold it, as one unit. If the fold throws, the append is
 * rolled back with it: an event that cannot be folded never enters the log,
 * because a hash-valid event that breaks replay is worse than no event.
 * Inside a caller's transaction this is a savepoint, so several events still
 * land together or not at all (see leases.js).
 */
export function emit(db, event) {
  return tx(db, () => append(db, event));
}

function append(db, { type, initiative_id = null, payload = {}, author = 'system', reason = null, at = null }) {
  const prev = one(db, 'select hash from events order by seq desc limit 1');
  const prevHash = prev?.hash ?? GENESIS;
  const eventId = id('ev');
  const when = at ?? new Date().toISOString();
  const body = canonical({ event_id: eventId, type, initiative_id, payload, author, reason, at: when });
  const hash = sha256(prevHash + body);
  const inserted = run(db,
    `insert into events (event_id, initiative_id, type, payload, author, reason, at, prev_hash, hash)
     values (?,?,?,?,?,?,?,?,?)`,
    eventId, initiative_id, type, JSON.stringify(payload), author, reason, when, prevHash, hash);
  apply(db, { seq: Number(inserted.lastInsertRowid), event_id: eventId, type, initiative_id, payload, author, reason, at: when });
  return eventId;
}

/** Drop every derived table and fold the whole log again. */
export function rebuild(db) {
  for (const t of DERIVED) db.exec(`delete from ${t}`);
  const rows = all(db, 'select * from events order by seq asc');
  for (const r of rows) apply(db, r);
  return rows.length;
}

/** Verify the hash chain. A log that does not verify is not evidence of anything. */
export function verifyChain(db) {
  const rows = all(db, 'select * from events order by seq asc');
  let prevHash = GENESIS;
  for (const r of rows) {
    const body = canonical({
      event_id: r.event_id, type: r.type, initiative_id: r.initiative_id,
      payload: JSON.parse(r.payload), author: r.author, reason: r.reason, at: r.at,
    });
    const h = sha256(prevHash + body);
    if (r.prev_hash !== prevHash) return { ok: false, seq: r.seq, why: 'prev_hash mismatch' };
    if (h !== r.hash) return { ok: false, seq: r.seq, why: 'hash mismatch' };
    prevHash = h;
  }
  return { ok: true, count: rows.length, head: prevHash };
}

/** A fingerprint of derived state, for "two readers compute the same state". */
export function stateFingerprint(db) {
  const parts = [];
  for (const t of DERIVED) {
    const pk = all(db, `pragma table_info(${t})`)[0].name;
    const rows = all(db, `select * from ${t} order by ${pk}`);
    parts.push(t + ':' + canonical(rows));
  }
  return sha256(parts.join('|'));
}
