/* The v1 API. */

import crypto from "node:crypto";
import {
  Router, HttpError, badRequest, unauthorized, forbidden, notFound, quotaExceeded,
  readBody, parseJson, parseMultipart, send,
} from "./http.js";
import { planOf, currentPeriod, checkQuota, publicPlans, METRICS } from "./plans.js";
import { generateChannelKey, signWith, verifyRaw } from "./signing.js";
import {
  PROFILES, PROFILE_NAMES, DEFAULT_PROFILE, capacityPerFrame,
  fragment, buildSigned, cardBody, MAX_MESSAGE, SIGNED_OVERHEAD, profileOf,
} from "../modem/frame.js";
import { FS } from "../modem/core.js";
import {
  render, encodeWav, decodeWav, decodeAudio, estimate, compareProfiles, MAX_REPEATS, Detector,
} from "../modem/audio.js";
import { applyChannel, describeConditions, CONDITION_NAMES } from "../modem/simulate.js";
import { PATHS, PATH_IDS, BANDS, BAND_IDS, assess, pathOf, survives } from "../modem/paths.js";
import {
  validateTemplate, encodeAnnouncement, decodeAnnouncement, renderAll, renderAnnouncement,
  announcementBytes, isAnnouncement, SEVERITIES, SEVERITY_NAMES, SLOT_TYPES, SLOT_TYPE_NAMES,
} from "../announce/template.js";

const MAX_DECODE_SECONDS = 600;
const MAX_CARD_BYTES = 256 * 1024;

// ------------------------------------------------------------------ helpers
function bytesOf(obj) {
  if (typeof obj.data === "string") {
    const b = Buffer.from(obj.data, "base64");
    // Buffer.from is permissive; round-trip so text that merely looks like
    // base64 is rejected rather than silently truncated.
    const normalised = obj.data.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    if (b.toString("base64").replace(/=+$/, "") !== normalised) {
      throw badRequest("`data` must be valid base64");
    }
    return new Uint8Array(b);
  }
  if (typeof obj.text === "string") return new Uint8Array(Buffer.from(obj.text, "utf8"));
  if (obj.json !== undefined) return new Uint8Array(Buffer.from(JSON.stringify(obj.json), "utf8"));
  return null;
}

function asInt(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`\`${name}\` must be an integer between ${min} and ${max}`);
  }
  return n;
}

const CONTROL_CHARS = /[\x00-\x08\x0e-\x1f]/;
function utf8OrNull(bytes) {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return CONTROL_CHARS.test(s) ? null : s;
  } catch { return null; }
}

const iso = (v) => (v == null ? null : new Date(Number(v)).toISOString());

const channelJson = (c, keys = []) => ({
  id: c.id,
  number: Number(c.num),
  name: c.name,
  signed: !!c.signed,
  receive_token: c.receive_token,
  created_at: iso(c.created_at),
  keys: keys.map(k => ({
    key_id: Number(k.key_id),
    public_key: k.public_raw,
    algorithm: "ed25519",
    created_at: iso(k.created_at),
    retired_at: iso(k.retired_at),
  })),
});

const txJson = (t, base) => ({
  id: t.id,
  channel: Number(t.channel_num),
  channel_id: t.channel_id,
  profile: t.profile,
  repeats: Number(t.repeats),
  signed: !!t.signed,
  card_code: t.card_code == null ? null : Number(t.card_code),
  body_bytes: Number(t.body_bytes),
  frames: Number(t.frames),
  seconds: Number(t.seconds),
  audio_bytes: Number(t.audio_bytes),
  label: t.label,
  created_at: iso(t.created_at),
  expires_at: iso(t.expires_at),
  audio_url: `${base}/v1/transmissions/${t.id}/audio.wav`,
});

const cardJson = (c) => ({
  code: Number(c.code),
  label: c.label,
  content_type: c.content_type,
  version: Number(c.version),
  bytes: c.payload.length,
  data: Buffer.from(c.payload).toString("base64"),
  updated_at: iso(c.updated_at),
});

// -------------------------------------------------------------------- routes
export function buildApi({ store, limiter }) {
  const router = new Router();

  /** Resolve an account from a bearer token. */
  function authenticate(ctx, { scope = "secret" } = {}) {
    const header = ctx.req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7).trim()
      : (ctx.url.searchParams.get("token") || "").trim();
    if (!token) throw unauthorized();

    if (token.startsWith("rk_")) {
      const channel = store.getChannelByToken(token);
      if (!channel) throw unauthorized("That receive token is not valid");
      if (scope === "secret") {
        throw forbidden("A receive token cannot be used here. Use a secret key (ck_live_...).");
      }
      return { channel, account: store.getAccount(channel.account_id), receiveOnly: true };
    }
    const key = store.findApiKey(token);
    if (!key) throw unauthorized("That API key is not valid or has been revoked");
    const account = store.getAccount(key.account_id);
    if (!account) throw unauthorized("The account for that key no longer exists");
    return { account, key };
  }

  function meter(account, metric, cost = 1) {
    if (!METRICS.includes(metric)) throw new Error(`unknown metric ${metric}`);
    const plan = planOf(account.plan);
    const period = currentPeriod();
    const used = store.usageFor(account.id, period, metric);
    const q = checkQuota(plan, metric, used, cost);
    if (!q.allowed) {
      throw quotaExceeded(q.reason, {
        metric, limit: q.limit, used: q.used, plan: plan.id,
      });
    }
    store.bumpUsage(account.id, metric, cost, period);
    return { plan, quota: q, period };
  }

  function rateLimit(ctx, key, cost = 1) {
    const r = limiter.take(key, cost);
    ctx.res.setHeader("x-ratelimit-remaining", String(r.remaining));
    ctx.res.setHeader("x-ratelimit-reset", String(r.resetSeconds));
    if (!r.allowed) {
      throw quotaExceeded(`Too many requests. Try again in ${r.resetSeconds}s.`, { retry_after: r.resetSeconds });
    }
  }

  // ------------------------------------------------------------ public info
  router.get("/v1/health", (ctx) => send(ctx.res, 200, {
    status: "ok",
    version: 1,
    sample_rate: FS,
    band_hz: [672, 2313],
    profiles: PROFILE_NAMES,
    time: new Date().toISOString(),
  }));

  router.get("/v1/profiles", (ctx) => send(ctx.res, 200, {
    default: DEFAULT_PROFILE,
    profiles: PROFILE_NAMES.map(name => {
      const p = PROFILES[name];
      const soloCap = capacityPerFrame(name, true);
      const multiCap = capacityPerFrame(name, false);
      const one = estimate(soloCap, { profile: name, repeats: 1 });
      const perFrame = multiCap || soloCap;
      return {
        name,
        label: p.label,
        note: p.note,
        frame_bytes: p.frameBytes,
        max_single_frame_bytes: soloCap,
        bytes_per_extra_frame: multiCap || null,
        solo_only: !!p.soloOnly,
        burst_seconds: one.burstSeconds,
        throughput_bytes_per_second: Number((perFrame / (one.burstSeconds + 0.3)).toFixed(1)),
      };
    }),
  }));

  router.get("/v1/conditions", (ctx) => send(ctx.res, 200, {
    conditions: describeConditions(),
    caveat: "These are models of an acoustic path, not measurements of one. "
      + "Verify anything you deploy on the real speaker, room and microphone.",
  }));

  router.get("/v1/plans", (ctx) => send(ctx.res, 200, { plans: publicPlans() }));

  /**
   * Where is this audio going? The most expensive mistake in data-over-sound is
   * picking a band the delivery path silently removes: the audio plays, nothing
   * is received, and it looks like a decoder fault. Ask before you record.
   */
  router.get("/v1/paths", (ctx) => {
    const want = ctx.url.searchParams.get("path");
    if (want) { pathOf(want); send(ctx.res, 200, assess(want)); return; }
    send(ctx.res, 200, {
      paths: PATH_IDS.map(assess),
      bands: BAND_IDS.map(id => ({ id, ...BANDS[id] })),
      note: "Cutoffs come from the relevant standard where one exists, and from measured codec "
        + "behaviour otherwise. experiments/ultrasonic.mjs runs the real modem through each.",
    });
  });

  function recommend(bodyLength, repeats) {
    const usable = compareProfiles(bodyLength, { repeats }).filter(r => r.usable);
    if (!usable.length) return null;
    const fastest = usable.reduce((a, b) => (b.seconds < a.seconds ? b : a));
    const robust = usable.find(r => r.profile === "robust") ?? fastest;
    return {
      shortest_airtime: fastest.profile,
      most_robust_that_fits: robust.profile,
      note: bodyLength > 200
        ? "Consider a card reference: publish this payload once, then broadcast its 4-byte code in a micro frame."
        : "This fits comfortably. Prefer robust unless airtime is tight.",
    };
  }

  /** Airtime calculator. Free and unmetered: it is arithmetic. */
  router.get("/v1/capacity", (ctx) => {
    const q = ctx.url.searchParams;
    const bytes = asInt(q.get("bytes") ?? "128", "bytes", { min: 1, max: MAX_MESSAGE });
    const repeats = asInt(q.get("repeats") ?? "2", "repeats", { min: 1, max: MAX_REPEATS });
    const signed = q.get("signed") === "true";
    const bodyLength = bytes + (signed ? SIGNED_OVERHEAD : 0);
    const profile = q.get("profile");
    if (profile) profileOf(profile);
    const path = q.get("path");
    const band = q.get("band") ?? "audible";
    let delivery;
    if (path) {
      pathOf(path);
      const a = assess(path);
      delivery = {
        path: a.path,
        cutoff_hz: a.cutoff_hz,
        band,
        survives: survives(band, path),
        ...(survives(band, path) ? {} : {
          warning: a.bands.find(b => b.band === band)?.reason,
          use_band: a.recommended_band,
        }),
      };
    }
    send(ctx.res, 200, {
      payload_bytes: bytes,
      signed,
      signature_overhead_bytes: signed ? SIGNED_OVERHEAD : 0,
      body_bytes: bodyLength,
      repeats,
      ...(delivery ? { delivery } : {}),
      chosen: profile ? estimate(bodyLength, { profile, repeats }) : undefined,
      profiles: compareProfiles(bodyLength, { repeats }),
      recommendation: recommend(bodyLength, repeats),
    });
  });

  // ---------------------------------------------------------- transmissions
  router.post("/v1/transmissions", async (ctx) => {
    const { account } = authenticate(ctx);
    rateLimit(ctx, account.id, 2);
    const body = parseJson(await readBody(ctx.req));

    const profile = body.profile ?? DEFAULT_PROFILE;
    profileOf(profile);
    const repeats = asInt(body.repeats ?? 2, "repeats", { min: 1, max: MAX_REPEATS });
    const label = String(body.label ?? "").slice(0, 200);

    let channel = null;
    if (body.channel) {
      channel = store.getChannel(account.id, body.channel);
      if (!channel) throw notFound(`No channel ${body.channel} on this account`);
    }
    const channelNum = channel ? Number(channel.num) : 0;

    // Three ways to say what to send: raw bytes, text/json, or a card reference.
    let payload, isCard = false, cardCode = null;
    if (body.card !== undefined) {
      if (!channel) throw badRequest("`card` needs a `channel`, because card codes are scoped to a channel");
      cardCode = asInt(body.card, "card", { min: 0, max: 0xffffffff });
      if (!store.getCard(channel.id, cardCode)) {
        throw notFound(`Channel has no card ${cardCode}. Create it with POST /v1/channels/${channel.id}/cards`);
      }
      payload = cardBody(cardCode);
      isCard = true;
    } else {
      payload = bytesOf(body);
      if (!payload) throw badRequest("Supply one of `data` (base64), `text`, `json` or `card`");
      if (payload.length === 0) throw badRequest("The payload is empty");
      if (payload.length > MAX_MESSAGE) {
        throw badRequest(`Payload is ${payload.length} bytes; the transport limit is ${MAX_MESSAGE}`);
      }
    }

    let messageBody = payload, signed = false;
    if (channel?.signed) {
      const plan = planOf(account.plan);
      if (!plan.signing) {
        throw forbidden(`Signed channels need the Pro plan or above; this account is on ${plan.label}.`);
      }
      const key = store.activeChannelKey(channel.id);
      if (!key) throw new HttpError(500, "This channel is marked signed but has no active key");
      messageBody = await buildSigned(payload, Number(key.key_id), signWith(key.private_pem), channelNum);
      signed = true;
    }

    let frames;
    try {
      frames = fragment(messageBody, { profile, channel: channelNum, signed, card: isCard });
    } catch (e) {
      throw badRequest(e.message, {
        payload_bytes: payload.length,
        body_bytes: messageBody.length,
        alternatives: compareProfiles(messageBody.length, { repeats }),
      });
    }

    meter(account, "render");
    const samples = render(frames, { repeats });
    const wav = Buffer.from(encodeWav(samples));
    const plan = planOf(account.plan);
    const expiresAt = plan.audioRetentionHours === Infinity
      ? null
      : Date.now() + plan.audioRetentionHours * 3600_000;

    const row = store.createTransmission(account.id, {
      channelId: channel?.id ?? null, channelNum, profile, repeats, signed,
      cardCode, bodyBytes: messageBody.length, frames: frames.length,
      seconds: samples.length / FS, label, expiresAt,
    }, wav);

    send(ctx.res, 201, {
      ...txJson(row, ctx.base),
      payload_bytes: payload.length,
      estimate: estimate(messageBody.length, { profile, repeats }),
    });
  });

  router.get("/v1/transmissions", (ctx) => {
    const { account } = authenticate(ctx);
    const limit = asInt(ctx.url.searchParams.get("limit") ?? "50", "limit", { min: 1, max: 200 });
    send(ctx.res, 200, {
      transmissions: store.listTransmissions(account.id, limit).map(t => txJson(t, ctx.base)),
    });
  });

  router.get("/v1/transmissions/:id", (ctx) => {
    const { account } = authenticate(ctx);
    const row = store.getTransmission(account.id, ctx.params.id);
    if (!row) throw notFound("No such transmission");
    send(ctx.res, 200, txJson(row, ctx.base));
  });

  router.get("/v1/transmissions/:id/audio.wav", (ctx) => {
    const { account } = authenticate(ctx);
    const row = store.getTransmission(account.id, ctx.params.id);
    if (!row) throw notFound("No such transmission");
    const audio = store.readTransmissionAudio(row);
    if (!audio) throw notFound("The audio for this transmission has expired and been swept");
    send(ctx.res, 200, audio, {
      "content-type": "audio/wav",
      "content-disposition": `attachment; filename="${row.id}.wav"`,
    });
  });

  /** Raw frames, for a transmitter with its own modulator (embedded, DSP, SDR). */
  router.get("/v1/transmissions/:id/frames", (ctx) => {
    const { account } = authenticate(ctx);
    const row = store.getTransmission(account.id, ctx.params.id);
    if (!row) throw notFound("No such transmission");
    const audio = store.readTransmissionAudio(row);
    if (!audio) throw notFound("The audio for this transmission has expired and been swept");
    const { samples, sampleRate } = decodeWav(new Uint8Array(audio));
    const seen = [];
    const det = new Detector(f => seen.push(Buffer.from(f).toString("base64")));
    det.push(samples);
    det.finish();
    send(ctx.res, 200, {
      id: row.id,
      profile: row.profile,
      frame_bytes: PROFILES[row.profile].frameBytes,
      sample_rate: sampleRate,
      repeats: Number(row.repeats),
      frames: [...new Set(seen)],
      note: "Base64 frames exactly as handed to the modulator. Modulate each at 8 kHz, or just replay the WAV.",
    });
  });

  router.delete("/v1/transmissions/:id", (ctx) => {
    const { account } = authenticate(ctx);
    if (!store.deleteTransmission(account.id, ctx.params.id)) throw notFound("No such transmission");
    send(ctx.res, 200, { deleted: true, id: ctx.params.id });
  });

  // ----------------------------------------------------------------- decode
  /** Trust every active key on every channel this account owns. */
  function buildTrustVerifier(accountId) {
    const byChannel = new Map();
    for (const ch of store.listChannels(accountId)) {
      for (const k of store.listChannelKeys(ch.id)) {
        byChannel.set(`${Number(ch.num)}/${Number(k.key_id)}`, k.public_raw);
      }
    }
    return ({ channel, keyId, covered, signature }) => {
      const raw = byChannel.get(`${channel}/${keyId}`);
      if (!raw) return false;
      try { return verifyRaw(raw, covered, signature); } catch { return false; }
    };
  }

  function describeMessage(m, channelsByNum) {
    const out = {
      channel: m.channel,
      at_seconds: Number(m.at.toFixed(3)),
      signed: m.signed,
      verified: m.verified,
      key_id: m.keyId ?? null,
      bytes: m.body.length,
      data: Buffer.from(m.body).toString("base64"),
      text: m.card ? null : utf8OrNull(m.body),
    };
    if (m.card) {
      const view = new DataView(m.body.buffer, m.body.byteOffset, m.body.byteLength);
      const code = view.getUint32(0);
      out.card = { code, resolved: null };
      const ch = channelsByNum.get(m.channel);
      const card = ch ? store.getCard(ch.id, code) : null;
      if (card) {
        out.card.resolved = {
          label: card.label,
          content_type: card.content_type,
          version: Number(card.version),
          bytes: card.payload.length,
          data: Buffer.from(card.payload).toString("base64"),
          text: utf8OrNull(new Uint8Array(card.payload)),
        };
      }
    }
    return out;
  }

  router.post("/v1/decode", async (ctx) => {
    const { account } = authenticate(ctx);
    rateLimit(ctx, account.id, 4);
    const raw = await readBody(ctx.req);
    const type = (ctx.req.headers["content-type"] || "").toLowerCase();

    let audioBytes = null, wantChannel = null;
    if (type.startsWith("multipart/form-data")) {
      const parts = parseMultipart(raw, ctx.req.headers["content-type"]);
      const file = parts.file ?? parts.audio;
      if (!file) throw badRequest("Send the recording as a `file` part");
      audioBytes = new Uint8Array(file.data);
      if (parts.channel) wantChannel = Number(parts.channel.data.toString());
    } else if (type.startsWith("application/json") || (!type && raw.length && raw[0] === 0x7b)) {
      const body = parseJson(raw);
      if (typeof body.audio_base64 !== "string") {
        throw badRequest("Supply `audio_base64`, or post the WAV bytes directly with Content-Type: audio/wav");
      }
      audioBytes = new Uint8Array(Buffer.from(body.audio_base64, "base64"));
      if (body.channel !== undefined) wantChannel = Number(body.channel);
    } else {
      if (!raw.length) throw badRequest("Empty body. Post a WAV, or JSON with `audio_base64`.");
      audioBytes = new Uint8Array(raw);
    }

    const { samples, sampleRate, channels } = decodeWav(audioBytes);
    const seconds = samples.length / sampleRate;
    if (seconds > MAX_DECODE_SECONDS) {
      throw badRequest(`Recording is ${seconds.toFixed(0)}s; the limit is ${MAX_DECODE_SECONDS}s. Split it.`);
    }
    // Longer recordings cost proportionally more CPU, so they cost more units.
    meter(account, "decode", Math.max(1, Math.ceil(seconds / 30)));

    const channelsByNum = new Map(store.listChannels(account.id).map(c => [Number(c.num), c]));
    const started = Date.now();
    const { messages, stats } = await decodeAudio(samples, sampleRate, {
      verify: buildTrustVerifier(account.id),
    });

    send(ctx.res, 200, {
      audio: { seconds: Number(seconds.toFixed(3)), sample_rate: sampleRate, channels },
      decode_ms: Date.now() - started,
      stats,
      messages: messages
        .filter(m => wantChannel == null || m.channel === wantChannel)
        .map(m => describeMessage(m, channelsByNum)),
    });
  });

  // --------------------------------------------------------------- simulate
  router.post("/v1/simulate", async (ctx) => {
    const { account } = authenticate(ctx);
    rateLimit(ctx, account.id, 4);
    const body = parseJson(await readBody(ctx.req));
    const condition = body.condition ?? "office";
    if (!CONDITION_NAMES.includes(condition)) {
      throw badRequest(`Unknown condition "${condition}". Use one of: ${CONDITION_NAMES.join(", ")}`);
    }
    const trials = asInt(body.trials ?? 5, "trials", { min: 1, max: 25 });
    const repeats = asInt(body.repeats ?? 2, "repeats", { min: 1, max: MAX_REPEATS });
    const profiles = body.profiles ?? [body.profile ?? DEFAULT_PROFILE];
    if (!Array.isArray(profiles) || !profiles.length) throw badRequest("`profiles` must be a non-empty array");
    for (const p of profiles) profileOf(p);

    let payload = null, storedSamples = null;
    if (body.transmission) {
      const row = store.getTransmission(account.id, body.transmission);
      if (!row) throw notFound("No such transmission");
      const audio = store.readTransmissionAudio(row);
      if (!audio) throw notFound("That transmission's audio has expired");
      storedSamples = decodeWav(new Uint8Array(audio)).samples;
    } else {
      payload = bytesOf(body);
      if (!payload) throw badRequest("Supply `data`, `text`, `json`, or a `transmission` id");
    }

    meter(account, "simulate", trials * profiles.length);
    const results = [];
    for (const profile of profiles) {
      let delivered = 0, framesSeen = 0, framesOk = 0, seconds = 0;
      let renderError = null;
      for (let t = 0; t < trials; t++) {
        let samples;
        if (storedSamples) samples = storedSamples;
        else {
          try { samples = render(fragment(payload, { profile, channel: 0 }), { repeats }); }
          catch (e) { renderError = e.message; break; }
        }
        seconds = samples.length / FS;
        const heard = applyChannel(samples, condition, { seed: 7919 + t * 31, snrDb: body.snr_db });
        const { messages, stats } = await decodeAudio(heard, FS);
        framesSeen += stats.detected;
        framesOk += stats.decoded;
        const got = messages[0];
        const matches = got && (!payload || Buffer.compare(Buffer.from(got.body), Buffer.from(payload)) === 0);
        if (matches) delivered++;
      }
      if (renderError) { results.push({ profile, usable: false, reason: renderError }); continue; }
      results.push({
        profile,
        usable: true,
        trials,
        delivered,
        delivery_rate: Number((delivered / trials).toFixed(3)),
        airtime_seconds: Number(seconds.toFixed(3)),
        frames_detected: framesSeen,
        frames_decoded: framesOk,
      });
    }
    send(ctx.res, 200, {
      condition,
      snr_db: body.snr_db ?? null,
      repeats,
      results,
      caveat: "A model of an acoustic path, not a measurement of one. "
        + "Confirm on the real speaker, room and microphone before you rely on it.",
    });
  });

  // --------------------------------------------------------------- channels
  router.post("/v1/channels", async (ctx) => {
    const { account } = authenticate(ctx);
    const body = parseJson(await readBody(ctx.req));
    const name = String(body.name ?? "").trim();
    if (!name) throw badRequest("`name` is required");
    const plan = planOf(account.plan);
    if (store.countChannels(account.id) >= plan.channels) {
      throw forbidden(`The ${plan.label} plan allows ${plan.channels} channel(s).`);
    }
    const wantSigned = !!body.signed;
    if (wantSigned && !plan.signing) {
      throw forbidden(`Signed channels need the Pro plan or above; this account is on ${plan.label}.`);
    }
    const channel = store.createChannel(account.id, { name, signed: wantSigned });
    if (wantSigned) store.addChannelKey(channel.id, generateChannelKey(store.nextKeyId(channel.id)));
    send(ctx.res, 201, channelJson(channel, store.listChannelKeys(channel.id)));
  });

  router.get("/v1/channels", (ctx) => {
    const { account } = authenticate(ctx);
    send(ctx.res, 200, {
      channels: store.listChannels(account.id).map(c => channelJson(c, store.listChannelKeys(c.id))),
    });
  });

  router.get("/v1/channels/:id", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    send(ctx.res, 200, channelJson(c, store.listChannelKeys(c.id)));
  });

  router.post("/v1/channels/:id/rotate", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    if (!c.signed) throw badRequest("This channel is not signed; there is nothing to rotate");
    store.retireChannelKeys(c.id);
    store.addChannelKey(c.id, generateChannelKey(store.nextKeyId(c.id)));
    send(ctx.res, 200, {
      ...channelJson(c, store.listChannelKeys(c.id)),
      note: "Receivers must keep trusting the retired key until every transmitter has picked up the new one. "
        + "A broadcast has no return channel to coordinate a cutover.",
    });
  });

  /** What a receiver pins. Readable with a receive token, so devices need no secret. */
  router.get("/v1/channels/:id/trust", (ctx) => {
    const auth = authenticate(ctx, { scope: "receive" });
    const c = auth.receiveOnly ? auth.channel : store.getChannel(auth.account.id, ctx.params.id);
    if (!c || c.id !== ctx.params.id) throw notFound("No such channel");
    send(ctx.res, 200, {
      channel: Number(c.num),
      name: c.name,
      signed: !!c.signed,
      keys: store.listChannelKeys(c.id)
        .filter(k => !k.retired_at || Date.now() - Number(k.retired_at) < 90 * 86400_000)
        .map(k => ({
          key_id: Number(k.key_id),
          public_key: k.public_raw,
          algorithm: "ed25519",
          retired: !!k.retired_at,
        })),
    });
  });

  router.delete("/v1/channels/:id", (ctx) => {
    const { account } = authenticate(ctx);
    if (!store.deleteChannel(account.id, ctx.params.id)) throw notFound("No such channel");
    send(ctx.res, 200, { deleted: true, id: ctx.params.id });
  });

  // ------------------------------------------------------------------ cards
  router.post("/v1/channels/:id/cards", async (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    const body = parseJson(await readBody(ctx.req));
    const plan = planOf(account.plan);
    const code = body.code === undefined
      ? store.nextCardCode(c.id)
      : asInt(body.code, "code", { min: 0, max: 0xffffffff });
    if (!store.getCard(c.id, code) && store.countCards(account.id) >= plan.cards) {
      throw forbidden(`The ${plan.label} plan allows ${plan.cards} cards.`);
    }
    const payload = bytesOf(body);
    if (!payload) throw badRequest("Supply the card content as `data` (base64), `text` or `json`");
    if (payload.length > MAX_CARD_BYTES) throw badRequest(`A card is limited to ${MAX_CARD_BYTES} bytes`);
    const card = store.upsertCard(c.id, {
      code,
      label: String(body.label ?? "").slice(0, 200),
      contentType: String(body.content_type ?? (body.json !== undefined ? "application/json" : "text/plain")),
      payload: Buffer.from(payload),
    });
    send(ctx.res, 201, cardJson(card));
  });

  router.get("/v1/channels/:id/cards", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    send(ctx.res, 200, { cards: store.listCards(c.id).map(cardJson) });
  });

  /**
   * The offline bundle a receiver caches. Broadcasting a 4-byte code instead of
   * the payload is the point: airtime is the scarce resource, storage is not.
   */
  router.get("/v1/channels/:id/cards/bundle", (ctx) => {
    const auth = authenticate(ctx, { scope: "receive" });
    const c = auth.receiveOnly ? auth.channel : store.getChannel(auth.account.id, ctx.params.id);
    if (!c || c.id !== ctx.params.id) throw notFound("No such channel");
    const cards = store.listCards(c.id).map(cardJson);
    const etag = crypto.createHash("sha256").update(JSON.stringify(cards)).digest("hex").slice(0, 32);
    if (ctx.req.headers["if-none-match"] === etag) {
      ctx.res.writeHead(304, { etag });
      ctx.res.end();
      return;
    }
    if (!auth.receiveOnly) meter(auth.account, "card_sync");
    send(ctx.res, 200, {
      channel: Number(c.num),
      name: c.name,
      generated_at: new Date().toISOString(),
      etag,
      cards,
    }, { etag, "cache-control": "private, max-age=60" });
  });

  router.delete("/v1/channels/:id/cards/:code", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    const code = asInt(ctx.params.code, "code", { min: 0, max: 0xffffffff });
    if (!store.deleteCard(c.id, code)) throw notFound("No such card");
    send(ctx.res, 200, { deleted: true, code });
  });

  // ------------------------------------------------------------ announcements
  /**
   * Templates and lists are the whole economy of this feature: they are synced
   * to phones over an ordinary network connection, so the air carries only a
   * template number and its values — the same nine bytes whether the venue
   * publishes in two languages or twelve.
   */
  const templateJson = t => ({
    id: t.id, severity: t.severity, label: t.label,
    slots: t.slots, text: t.text,
    languages: Object.keys(t.text),
    version: t.version,
    air_bytes: announcementBytes(t, Object.fromEntries(t.slots.map(x => [x.name, 0]))),
    updated_at: iso(t.updatedAt),
  });

  router.get("/v1/announce/slot-types", (ctx) => send(ctx.res, 200, {
    slot_types: SLOT_TYPE_NAMES.map(n => ({ name: n, ...SLOT_TYPES[n] })),
    severities: SEVERITY_NAMES.map(n => ({ name: n, ...SEVERITIES[n] })),
  }));

  router.post("/v1/channels/:id/templates", async (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    const body = parseJson(await readBody(ctx.req));
    const id = body.id === undefined ? store.nextTemplateId(c.id) : asInt(body.id, "id", { min: 0, max: 0xffff });
    const checked = validateTemplate({ ...body, id });
    const saved = store.upsertTemplate(c.id, { ...checked, label: String(body.label ?? "").slice(0, 200) });
    send(ctx.res, 201, templateJson(saved));
  });

  router.get("/v1/channels/:id/templates", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    send(ctx.res, 200, { templates: store.listTemplates(c.id).map(templateJson) });
  });

  router.delete("/v1/channels/:id/templates/:tid", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    const tid = asInt(ctx.params.tid, "tid", { min: 0, max: 0xffff });
    if (!store.deleteTemplate(c.id, tid)) throw notFound("No such template");
    send(ctx.res, 200, { deleted: true, id: tid });
  });

  router.post("/v1/channels/:id/lists", async (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    const body = parseJson(await readBody(ctx.req));
    const name = String(body.name ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw badRequest("`name` must be a plain identifier");
    if (!Array.isArray(body.entries)) throw badRequest("`entries` must be an array");
    if (body.entries.length > 65536) throw badRequest("A list holds at most 65536 entries");
    send(ctx.res, 201, store.upsertList(c.id, name, body.entries));
  });

  router.get("/v1/channels/:id/lists", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    send(ctx.res, 200, { lists: store.listLists(c.id) });
  });

  router.delete("/v1/channels/:id/lists/:name", (ctx) => {
    const { account } = authenticate(ctx);
    const c = store.getChannel(account.id, ctx.params.id);
    if (!c) throw notFound("No such channel");
    if (!store.deleteList(c.id, ctx.params.name)) throw notFound("No such list");
    send(ctx.res, 200, { deleted: true, name: ctx.params.name });
  });

  /** Everything a phone needs to render announcements offline, in one document. */
  router.get("/v1/channels/:id/announce/bundle", (ctx) => {
    const auth = authenticate(ctx, { scope: "receive" });
    const c = auth.receiveOnly ? auth.channel : store.getChannel(auth.account.id, ctx.params.id);
    if (!c || c.id !== ctx.params.id) throw notFound("No such channel");
    const templates = store.listTemplates(c.id);
    const lists = Object.fromEntries(store.listLists(c.id).map(l => [l.name, l.entries]));
    const languages = [...new Set(templates.flatMap(t => Object.keys(t.text)))].sort();
    const payload = { templates: templates.map(templateJson), lists, languages };
    const etag = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 32);
    if (ctx.req.headers["if-none-match"] === etag) { ctx.res.writeHead(304, { etag }); ctx.res.end(); return; }
    if (!auth.receiveOnly) meter(auth.account, "card_sync");
    send(ctx.res, 200, {
      channel: Number(c.num), name: c.name, signed: !!c.signed,
      generated_at: new Date().toISOString(), etag, ...payload,
    }, { etag, "cache-control": "private, max-age=60" });
  });

  /** Compose an announcement, without spending a render on it. */
  router.post("/v1/announcements/preview", async (ctx) => {
    const { account } = authenticate(ctx);
    const body = parseJson(await readBody(ctx.req));
    const { channel, template, values } = await resolveAnnouncement(account, body);
    const encoded = encodeAnnouncement(template, values);
    const lists = Object.fromEntries(store.listLists(channel.id).map(l => [l.name, l.entries]));
    const decoded = decodeAnnouncement(encoded, { [template.id]: template });
    const bodyBytes = encoded.length + (channel.signed ? SIGNED_OVERHEAD : 0);
    const repeats = asInt(body.repeats ?? 2, "repeats", { min: 1, max: MAX_REPEATS });
    const profile = chooseProfile(bodyBytes, repeats, body.profile);
    send(ctx.res, 200, {
      template_id: template.id,
      severity: template.severity,
      air_bytes: encoded.length,
      signed: !!channel.signed,
      signature_overhead_bytes: channel.signed ? SIGNED_OVERHEAD : 0,
      body_bytes: bodyBytes,
      rendered: renderAll(decoded, { lists }),
      estimate: estimate(bodyBytes, { profile, repeats }),
    });
  });

  /** Shortest profile that can carry this body, unless the caller names one. */
  function chooseProfile(bodyBytes, repeats, requested) {
    if (requested) { profileOf(requested); return requested; }
    const fits = compareProfiles(bodyBytes, { repeats }).filter(r => r.usable);
    if (!fits.length) {
      throw badRequest(`No profile can carry ${bodyBytes} bytes`, {
        alternatives: compareProfiles(bodyBytes, { repeats }),
      });
    }
    return fits.reduce((a, b) => (b.seconds < a.seconds ? b : a)).profile;
  }

  async function resolveAnnouncement(account, body) {
    const channel = body.channel ? store.getChannel(account.id, body.channel) : null;
    if (!channel) throw badRequest("`channel` is required — templates are scoped to a channel");
    const tid = asInt(body.template, "template", { min: 0, max: 0xffff });
    const template = store.getTemplate(channel.id, tid);
    if (!template) throw notFound(`Channel has no template ${tid}`);
    return { channel, template, values: body.values ?? {} };
  }

  /** Compose and render an announcement to audio the PA can play. */
  router.post("/v1/announcements", async (ctx) => {
    const { account } = authenticate(ctx);
    rateLimit(ctx, account.id, 2);
    const body = parseJson(await readBody(ctx.req));
    const { channel, template, values } = await resolveAnnouncement(account, body);

    const payload = encodeAnnouncement(template, values);
    const repeats = asInt(body.repeats ?? 2, "repeats", { min: 1, max: MAX_REPEATS });

    let messageBody = payload, signed = false;
    if (channel.signed) {
      const plan = planOf(account.plan);
      if (!plan.signing) throw forbidden(`Signed channels need the Pro plan or above; this account is on ${plan.label}.`);
      const key = store.activeChannelKey(channel.id);
      if (!key) throw new HttpError(500, "This channel is marked signed but has no active key");
      messageBody = await buildSigned(payload, Number(key.key_id), signWith(key.private_pem), Number(channel.num));
      signed = true;
    }

    const profile = chooseProfile(messageBody.length, repeats, body.profile);

    let frames;
    try {
      frames = fragment(messageBody, { profile, channel: Number(channel.num), signed, announce: true });
    } catch (e) {
      throw badRequest(e.message, { alternatives: compareProfiles(messageBody.length, { repeats }) });
    }

    meter(account, "render");
    const samples = render(frames, { repeats });
    const wav = Buffer.from(encodeWav(samples));
    const plan = planOf(account.plan);
    const lists = Object.fromEntries(store.listLists(channel.id).map(l => [l.name, l.entries]));
    const rendered = renderAll(decodeAnnouncement(payload, { [template.id]: template }), { lists });

    const row = store.createTransmission(account.id, {
      channelId: channel.id, channelNum: Number(channel.num), profile, repeats, signed,
      cardCode: null, bodyBytes: messageBody.length, frames: frames.length,
      seconds: samples.length / FS,
      label: String(body.label ?? rendered.en ?? Object.values(rendered)[0] ?? "").slice(0, 200),
      expiresAt: plan.audioRetentionHours === Infinity ? null : Date.now() + plan.audioRetentionHours * 3600_000,
    }, wav);

    send(ctx.res, 201, {
      ...txJson(row, ctx.base),
      template_id: template.id,
      severity: template.severity,
      air_bytes: payload.length,
      rendered,
      estimate: estimate(messageBody.length, { profile, repeats }),
    });
  });

  // --------------------------------------------------------------- receipts
  /** A receiver reports what it heard, authenticated by the channel receive token. */
  router.post("/v1/receipts", async (ctx) => {
    const auth = authenticate(ctx, { scope: "receive" });
    const body = parseJson(await readBody(ctx.req));
    const ch = auth.receiveOnly
      ? auth.channel
      : (body.channel_id ? store.getChannel(auth.account.id, body.channel_id) : null);
    if (!ch) throw badRequest("Use a channel receive token, or supply `channel_id` with a secret key");
    rateLimit(ctx, `rcpt:${ch.id}`, 1);
    const plan = planOf(auth.account.plan);
    const id = store.addReceipt({
      accountId: ch.account_id,
      channelId: ch.id,
      transmissionId: body.transmission_id ? String(body.transmission_id).slice(0, 64) : null,
      device: String(body.device ?? "").slice(0, 120),
      outcome: ["decoded", "partial", "failed"].includes(body.outcome) ? body.outcome : "decoded",
      latencyMs: Number.isInteger(body.latency_ms) ? body.latency_ms : null,
      detail: (typeof body.detail === "object" && body.detail) ? body.detail : {},
      expiresAt: plan.receiptRetentionDays === Infinity
        ? null
        : Date.now() + plan.receiptRetentionDays * 86400_000,
    });
    send(ctx.res, 201, { id, recorded: true });
  });

  router.get("/v1/receipts", (ctx) => {
    const { account } = authenticate(ctx);
    const q = ctx.url.searchParams;
    const limit = asInt(q.get("limit") ?? "100", "limit", { min: 1, max: 500 });
    const rows = store.listReceipts(account.id, { channelId: q.get("channel_id"), limit });
    send(ctx.res, 200, {
      receipts: rows.map(r => ({
        id: r.id,
        channel_id: r.channel_id,
        transmission_id: r.transmission_id,
        device: r.device,
        outcome: r.outcome,
        latency_ms: r.latency_ms == null ? null : Number(r.latency_ms),
        detail: JSON.parse(r.detail),
        created_at: iso(r.created_at),
      })),
    });
  });

  // ------------------------------------------------------------------ usage
  router.get("/v1/usage", (ctx) => {
    const { account } = authenticate(ctx);
    const plan = planOf(account.plan);
    const period = currentPeriod();
    const used = store.getUsage(account.id, period);
    const metrics = {};
    let overageCost = 0;
    for (const m of METRICS) {
      const u = used[m] ?? 0;
      const limit = plan.limits[m];
      const over = limit === Infinity ? 0 : Math.max(0, u - limit);
      const rate = plan.overage?.[m];
      if (over > 0 && rate) overageCost += (over / 1000) * rate;
      metrics[m] = {
        used: u,
        limit: limit === Infinity ? "unlimited" : limit,
        remaining: limit === Infinity ? "unlimited" : Math.max(0, limit - u),
        over,
      };
    }
    send(ctx.res, 200, {
      account: { id: account.id, email: account.email, plan: plan.id, plan_label: plan.label },
      period,
      metrics,
      channels: {
        used: store.countChannels(account.id),
        limit: plan.channels === Infinity ? "unlimited" : plan.channels,
      },
      cards: {
        used: store.countCards(account.id),
        limit: plan.cards === Infinity ? "unlimited" : plan.cards,
      },
      stored_audio_bytes: store.audioFootprint(account.id),
      estimated_charges_usd: Number(((plan.priceMonthly ?? 0) + overageCost).toFixed(2)),
    });
  });

  // --------------------------------------------------------------- api keys
  router.get("/v1/keys", (ctx) => {
    const { account } = authenticate(ctx);
    send(ctx.res, 200, {
      keys: store.listApiKeys(account.id).map(k => ({
        id: k.id,
        prefix: k.prefix,
        label: k.label,
        created_at: iso(k.created_at),
        last_used_at: iso(k.last_used_at),
        revoked: !!k.revoked_at,
      })),
    });
  });

  router.post("/v1/keys", async (ctx) => {
    const { account } = authenticate(ctx);
    const body = parseJson(await readBody(ctx.req));
    const created = store.createApiKey(account.id, String(body.label ?? "").slice(0, 100));
    send(ctx.res, 201, {
      ...created,
      warning: "This is the only time the secret is shown. Store it now.",
    });
  });

  router.delete("/v1/keys/:id", (ctx) => {
    const { account } = authenticate(ctx);
    if (!store.revokeApiKey(account.id, ctx.params.id)) {
      throw notFound("No such key, or it is already revoked");
    }
    send(ctx.res, 200, { revoked: true, id: ctx.params.id });
  });

  return router;
}
