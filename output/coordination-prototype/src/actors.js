import { one, all } from './db.js';
import { emit } from './events.js';
import { id } from './ids.js';

/**
 * No account is required to make an offer. An actor is whatever a channel
 * authenticated: the address a signed email webhook vouches for, the chat
 * account Telegram vouches for, or — on the web form, which vouches for
 * nothing — a random id held in the contributor's own browser.
 *
 * Identity is never guessed (docs/CONSTRAINTS.md, C3). The same person writing
 * from Telegram and then from email stays two actors until they prove they
 * control both and link them. Being asked twice is a small cost; acting as the
 * wrong person is not.
 */
export function normaliseHandle(channel, handle) {
  const h = String(handle ?? '').trim().toLowerCase();
  if (channel === 'email') return h.replace(/^mailto:/, '');
  if (channel === 'telegram') return h.replace(/^@/, '');
  return h;
}

export function findActor(db, channel, handle) {
  const h = normaliseHandle(channel, handle);
  const contact = one(db, 'select * from contacts where channel=? and handle=?', channel, h);
  return contact ? one(db, 'select * from actors where actor_id=?', contact.actor_id) : null;
}

export function resolveActor(db, { channel, handle, displayName = null, kind = 'person' }) {
  const existing = findActor(db, channel, handle);
  if (existing) return existing;

  const h = normaliseHandle(channel, handle);
  const actorId = id('ac');
  emit(db, {
    type: 'actor.registered', author: `channel:${channel}`,
    payload: { actor_id: actorId, kind, display_name: displayName ?? h },
  });

  emit(db, {
    type: 'actor.contact_added', author: `channel:${channel}`,
    payload: { contact_id: id('ct'), actor_id: actorId, channel, handle: h, verified: 0 },
  });

  return one(db, 'select * from actors where actor_id=?', actorId);
}

export function linkContact(db, actorId, channel, handle) {
  const h = normaliseHandle(channel, handle);
  const existing = one(db, 'select * from contacts where channel=? and handle=?', channel, h);
  if (existing) return existing.actor_id === actorId;
  emit(db, {
    type: 'actor.contact_added', author: 'system',
    payload: { contact_id: id('ct'), actor_id: actorId, channel, handle: h, verified: 1 },
  });
  return true;
}

export function contactsOf(db, actorId) {
  return all(db, 'select * from contacts where actor_id=?', actorId);
}

export function preferredContact(db, actorId) {
  const order = { telegram: 0, email: 1, web: 2 };
  const rows = contactsOf(db, actorId);
  rows.sort((a, b) => (order[a.channel] ?? 9) - (order[b.channel] ?? 9));
  return rows[0] ?? null;
}

export function credentialsOf(db, actorId, now = new Date()) {
  return all(db,
    'select * from credentials where actor_id=? and (expires_at is null or expires_at > ?)',
    actorId, now.toISOString());
}

export function verifyCredential(db, { actorId, code, issuer, expiresAt = null, verifier }) {
  emit(db, {
    type: 'credential.verified', author: verifier,
    payload: { credential_id: id('cr'), actor_id: actorId, code, issuer, expires_at: expiresAt },
  });
}

export function declareCapability(db, cap) {
  const capabilityId = cap.capability_id ?? id('cp');
  emit(db, { type: 'capability.declared', author: cap.author ?? 'system', payload: { ...cap, capability_id: capabilityId } });
  return capabilityId;
}

export function displayNamesFor(db, actorId) {
  const a = one(db, 'select * from actors where actor_id=?', actorId);
  const names = a?.display_name ? [a.display_name] : [];
  for (const c of contactsOf(db, actorId)) names.push(c.handle);
  return names;
}
