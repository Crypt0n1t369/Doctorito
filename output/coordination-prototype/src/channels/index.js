import { createHmac, timingSafeEqual } from 'node:crypto';
import { emit } from '../events.js';
import { id } from '../ids.js';

/**
 * Channel adapters, in order of effort: a web form, inbound email through a
 * mail provider's webhook, and Telegram. They share one interface, because the
 * pipeline must not know which one an offer arrived on.
 *
 * Outbound here writes to an outbox table rather than to a network, so a demo
 * run is inspectable and a test run sends nothing to anybody. Pointing `send`
 * at a real provider is the smallest change in this repository.
 */
export const CHANNELS = ['web', 'email', 'telegram'];

export function send(db, { initiative, actorId, channel, handle, kind, body }) {
  const messageId = id('ms');
  emit(db, {
    type: 'message.sent',
    initiative_id: initiative?.initiative_id ?? null,
    author: 'system',
    payload: {
      message_id: messageId,
      initiative_id: initiative?.initiative_id ?? null,
      actor_id: actorId, channel, handle, kind, body,
    },
  });
  if (process.env.SHOW_OUTBOX === '1') {
    process.stdout.write(`\n[outbox:${channel}] -> ${handle}\n${body}\n`);
  }
  return messageId;
}

/**
 * The channel's provider vouches for who sent a message, or nobody does.
 *
 * Telegram sends the secret token it was given when the webhook was
 * registered, in X-Telegram-Bot-Api-Secret-Token. The email adapter expects
 * the mail provider's relay to sign the raw body with a shared secret, as
 * "sha256=<hex hmac>" in X-Signature. With no secret configured the webhook
 * fails closed: an unauthenticated webhook would let anyone post as anyone.
 */
const SECRETS = { telegram: 'TELEGRAM_WEBHOOK_SECRET', email: 'EMAIL_WEBHOOK_SECRET' };

export function verifyWebhook(channel, headers, rawBody) {
  const secret = process.env[SECRETS[channel] ?? ''];
  if (!secret) return { ok: false, status: 503, error: `the ${channel} webhook is not configured` };
  if (channel === 'telegram') {
    const got = String(headers['x-telegram-bot-api-secret-token'] ?? '');
    return same(got, secret) ? { ok: true } : { ok: false, status: 401, error: 'not authenticated' };
  }
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody ?? '').digest('hex');
  return same(String(headers['x-signature'] ?? ''), expected) ? { ok: true } : { ok: false, status: 401, error: 'not authenticated' };
}

function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Normalise a provider payload into the one shape the pipeline accepts. */
export function normalise(channel, payload) {
  if (channel === 'email') {
    return {
      channel: 'email',
      handle: (payload.from ?? '').replace(/^.*<|>.*$/g, '').trim().toLowerCase(),
      displayName: (payload.from ?? '').replace(/<.*$/, '').replace(/"/g, '').trim() || null,
      text: [payload.subject, payload.text].filter(Boolean).join('\n').trim(),
      attachments: payload.attachments ?? [],
      received_at: payload.date ?? new Date().toISOString(),
      providerMessageId: payload.message_id ?? payload.headers?.['message-id'] ?? null,
    };
  }
  if (channel === 'telegram') {
    const from = payload.message?.from ?? {};
    return {
      channel: 'telegram',
      handle: (from.username ?? String(from.id ?? '')).toLowerCase(),
      displayName: [from.first_name, from.last_name].filter(Boolean).join(' ') || null,
      text: payload.message?.text ?? '',
      attachments: [],
      received_at: payload.message?.date
        ? new Date(payload.message.date * 1000).toISOString()
        : new Date().toISOString(),
      providerMessageId: payload.message?.message_id != null
        ? `${payload.message.chat?.id ?? from.id ?? ''}:${payload.message.message_id}` : null,
    };
  }
  return {
    channel: 'web',
    handle: String(payload.contact ?? '').trim().toLowerCase(),
    displayName: payload.name ?? null,
    text: String(payload.text ?? '').trim(),
    attachments: [],
    received_at: new Date().toISOString(),
  };
}
