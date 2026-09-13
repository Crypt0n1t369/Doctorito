import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../src/server/server.js";
import { decodeWav, decodeAudio } from "../src/modem/audio.js";
import { verifyRaw } from "../src/server/signing.js";
import { openSigned } from "../src/modem/frame.js";

let server, origin, dir, store, key, account;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "cicada-test-"));
  server = createServer({ dbFile: join(dir, "t.db"), audioDir: join(dir, "audio") });
  process.env.CICADA_LOG = "off";
  await new Promise(r => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
  store = server.store;
  account = store.createAccount({ email: "t@example.com", name: "Test", plan: "scale" });
  key = store.createApiKey(account.id, "test").secret;
});

after(async () => {
  await new Promise(r => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const api = (path, opts = {}) => fetch(`${origin}${path}`, {
  ...opts,
  headers: {
    ...(opts.body && !opts.raw ? { "content-type": "application/json" } : {}),
    ...(opts.noAuth ? {} : { authorization: `Bearer ${opts.token ?? key}` }),
    ...opts.headers,
  },
  body: opts.raw ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined),
});
const json = async (...a) => {
  const r = await api(...a);
  return { status: r.status, body: await r.json(), headers: r.headers };
};

describe("public endpoints", () => {
  test("health needs no key", async () => {
    const r = await fetch(`${origin}/v1/health`);
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.status, "ok");
    assert.equal(b.sample_rate, 8000);
    assert.deepEqual(b.band_hz, [672, 2313]);
  });

  test("profiles report their real throughput", async () => {
    const { body } = await json("/v1/profiles", { noAuth: true });
    assert.equal(body.default, "standard");
    const std = body.profiles.find(p => p.name === "standard");
    assert.equal(std.frame_bytes, 128);
    assert.equal(std.max_single_frame_bytes, 123);
    assert.ok(std.throughput_bytes_per_second > 80 && std.throughput_bytes_per_second < 100);
    assert.equal(body.profiles.find(p => p.name === "micro").solo_only, true);
  });

  test("capacity is an unmetered calculator with a recommendation", async () => {
    const { status, body } = await json("/v1/capacity?bytes=40&repeats=2", { noAuth: true });
    assert.equal(status, 200);
    assert.equal(body.payload_bytes, 40);
    assert.equal(body.body_bytes, 40);
    assert.ok(body.profiles.some(p => p.profile === "micro" && p.usable === false));
    assert.equal(body.recommendation.most_robust_that_fits, "robust");
  });

  test("capacity accounts for the signature overhead", async () => {
    const { body } = await json("/v1/capacity?bytes=40&signed=true", { noAuth: true });
    assert.equal(body.signature_overhead_bytes, 68);
    assert.equal(body.body_bytes, 108);
  });

  test("plans are listed with limits", async () => {
    const { body } = await json("/v1/plans", { noAuth: true });
    assert.equal(body.plans.length, 4);
    assert.equal(body.plans.find(p => p.id === "free").signing, false);
    assert.equal(body.plans.find(p => p.id === "pro").priceMonthly, 49);
  });
});

describe("authentication", () => {
  test("a missing key is rejected with guidance", async () => {
    const { status, body } = await json("/v1/usage", { noAuth: true });
    assert.equal(status, 401);
    assert.match(body.error.message, /Authorization: Bearer/);
  });

  test("a bogus key is rejected", async () => {
    const { status } = await json("/v1/usage", { token: "ck_live_nope" });
    assert.equal(status, 401);
  });

  test("a revoked key stops working", async () => {
    const temp = store.createApiKey(account.id, "temp");
    assert.equal((await json("/v1/usage", { token: temp.secret })).status, 200);
    assert.equal((await json(`/v1/keys/${temp.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await json("/v1/usage", { token: temp.secret })).status, 401);
  });

  test("a receive token cannot reach a secret endpoint", async () => {
    const ch = (await json("/v1/channels", { method: "POST", body: { name: "scoped" } })).body;
    const { status, body } = await json("/v1/transmissions", { token: ch.receive_token });
    assert.equal(status, 403);
    assert.match(body.error.message, /receive token/);
  });
});

describe("transmissions", () => {
  test("text renders to decodable audio", async () => {
    const { status, body } = await json("/v1/transmissions", {
      method: "POST",
      body: { text: "gate 14 boarding", profile: "robust", repeats: 1, label: "test" },
    });
    assert.equal(status, 201);
    assert.equal(body.payload_bytes, 16);
    assert.equal(body.frames, 1);
    assert.equal(body.profile, "robust");
    assert.ok(Math.abs(body.seconds - body.estimate.seconds) < 0.01);

    const audio = await api(`/v1/transmissions/${body.id}/audio.wav`);
    assert.equal(audio.status, 200);
    assert.equal(audio.headers.get("content-type"), "audio/wav");
    const wav = decodeWav(new Uint8Array(await audio.arrayBuffer()));
    const { messages } = await decodeAudio(wav.samples, wav.sampleRate);
    assert.equal(messages.length, 1);
    assert.equal(Buffer.from(messages[0].body).toString("utf8"), "gate 14 boarding");
  });

  test("json payloads survive the round trip", async () => {
    const payload = { gate: 14, status: "boarding", until: "2026-09-13T18:40:00Z" };
    const { body } = await json("/v1/transmissions", {
      method: "POST", body: { json: payload, profile: "standard", repeats: 1 },
    });
    const audio = await api(`/v1/transmissions/${body.id}/audio.wav`);
    const wav = decodeWav(new Uint8Array(await audio.arrayBuffer()));
    const { messages } = await decodeAudio(wav.samples, wav.sampleRate);
    assert.deepEqual(JSON.parse(Buffer.from(messages[0].body).toString("utf8")), payload);
  });

  test("a payload too large for the profile explains the alternatives", async () => {
    const { status, body } = await json("/v1/transmissions", {
      method: "POST", body: { text: "x".repeat(40), profile: "micro" },
    });
    assert.equal(status, 400);
    assert.match(body.error.message, /holds at most 11 bytes/);
    assert.ok(body.error.alternatives.some(a => a.profile === "standard" && a.usable));
  });

  test("invalid base64 is refused rather than silently truncated", async () => {
    const { status, body } = await json("/v1/transmissions", {
      method: "POST", body: { data: "this is not base64!!" },
    });
    assert.equal(status, 400);
    assert.match(body.error.message, /base64/);
  });

  test("frames are exposed for transmitters with their own modulator", async () => {
    const { body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { text: "frame export", profile: "robust", repeats: 3 },
    });
    const { body } = await json(`/v1/transmissions/${tx.id}/frames`);
    assert.equal(body.frame_bytes, 64);
    assert.equal(body.frames.length, 1, "three passes of one frame is still one unique frame");
    assert.equal(Buffer.from(body.frames[0], "base64").length, 64);
  });

  test("delete removes the transmission and its audio", async () => {
    const { body } = await json("/v1/transmissions", { method: "POST", body: { text: "bye", profile: "robust" } });
    assert.equal((await json(`/v1/transmissions/${body.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await json(`/v1/transmissions/${body.id}`)).status, 404);
    assert.equal((await api(`/v1/transmissions/${body.id}/audio.wav`)).status, 404);
  });

  test("one account cannot read another's transmission", async () => {
    const other = store.createAccount({ email: "other@example.com", plan: "pro" });
    const otherKey = store.createApiKey(other.id, "k").secret;
    const { body } = await json("/v1/transmissions", { method: "POST", body: { text: "private", profile: "robust" } });
    assert.equal((await json(`/v1/transmissions/${body.id}`, { token: otherKey })).status, 404);
  });
});

describe("decode", () => {
  test("round-trips a rendered WAV posted as raw bytes", async () => {
    const { body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { text: "decode me", profile: "robust", repeats: 1 },
    });
    const wav = Buffer.from(await (await api(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer());
    const r = await api("/v1/decode", {
      method: "POST", raw: true, body: wav, headers: { "content-type": "audio/wav" },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].text, "decode me");
    assert.equal(body.messages[0].bytes, 9);
    assert.equal(body.stats.messages, 1);
  });

  test("accepts base64 JSON and multipart form uploads", async () => {
    const { body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { text: "multi", profile: "robust", repeats: 1 },
    });
    const wav = Buffer.from(await (await api(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer());

    const b64 = await json("/v1/decode", { method: "POST", body: { audio_base64: wav.toString("base64") } });
    assert.equal(b64.body.messages[0].text, "multi");

    const form = new FormData();
    form.set("file", new Blob([wav], { type: "audio/wav" }), "r.wav");
    const r = await fetch(`${origin}/v1/decode`, {
      method: "POST", headers: { authorization: `Bearer ${key}` }, body: form,
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).messages[0].text, "multi");
  });

  test("rejects something that is not a WAV", async () => {
    const r = await api("/v1/decode", {
      method: "POST", raw: true, body: Buffer.from("hello"), headers: { "content-type": "audio/wav" },
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error.message, /RIFF/);
  });

  test("silence decodes to no messages rather than an error", async () => {
    const { encodeWav } = await import("../src/modem/audio.js");
    const silence = Buffer.from(encodeWav(new Float32Array(8000)));
    const r = await api("/v1/decode", {
      method: "POST", raw: true, body: silence, headers: { "content-type": "audio/wav" },
    });
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).messages, []);
  });
});

describe("signed channels", () => {
  let channel;

  test("creating a signed channel mints a key", async () => {
    const { status, body } = await json("/v1/channels", {
      method: "POST", body: { name: "Departures", signed: true },
    });
    assert.equal(status, 201);
    assert.equal(body.signed, true);
    assert.equal(body.keys.length, 1);
    assert.equal(body.keys[0].key_id, 1);
    assert.equal(body.keys[0].public_key.length, 64);
    assert.ok(body.receive_token.startsWith("rk_"));
    channel = body;
  });

  test("a transmission on it is signed and verifies against the published key", async () => {
    const { body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { channel: channel.id, text: "authenticated", profile: "standard", repeats: 1 },
    });
    assert.equal(tx.signed, true);
    assert.equal(tx.channel, channel.number);

    const wav = decodeWav(new Uint8Array(await (await api(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer()));
    // Decode without a verifier to inspect the raw signed body.
    const { messages } = await decodeAudio(wav.samples, wav.sampleRate, { verify: () => true });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].signed, true);
    assert.equal(messages[0].keyId, 1);

    // Now verify exactly as a receiver would, using only the published key.
    const trust = await json(`/v1/channels/${channel.id}/trust`, { token: channel.receive_token });
    const pub = trust.body.keys[0].public_key;
    const raw = await decodeAudio(wav.samples, wav.sampleRate, {
      verify: ({ covered, signature }) => verifyRaw(pub, covered, signature),
    });
    assert.equal(raw.messages.length, 1);
    assert.equal(raw.messages[0].verified, true);
    assert.equal(Buffer.from(raw.messages[0].body).toString("utf8"), "authenticated");
  });

  test("the server decode endpoint verifies against the account's own keys", async () => {
    const { body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { channel: channel.id, text: "server verified", profile: "standard", repeats: 1 },
    });
    const wav = Buffer.from(await (await api(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer());
    const r = await api("/v1/decode", {
      method: "POST", raw: true, body: wav, headers: { "content-type": "audio/wav" },
    });
    const body = await r.json();
    assert.equal(body.messages[0].verified, true);
    assert.equal(body.messages[0].key_id, 1);
    assert.equal(body.messages[0].text, "server verified");
  });

  test("a tampered signed message is not delivered", async () => {
    const { body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { channel: channel.id, text: "do not tamper", profile: "standard", repeats: 1 },
    });
    const wav = decodeWav(new Uint8Array(await (await api(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer()));
    const trust = await json(`/v1/channels/${channel.id}/trust`, { token: channel.receive_token });
    const pub = trust.body.keys[0].public_key;
    const flipped = await decodeAudio(wav.samples, wav.sampleRate, {
      verify: ({ covered, signature }) => {
        const bad = Uint8Array.from(covered);
        bad[bad.length - 1] ^= 1;
        return verifyRaw(pub, bad, signature);
      },
    });
    assert.equal(flipped.messages.length, 0);
  });

  test("rotation issues a new key id and keeps the old one published", async () => {
    const { status, body } = await json(`/v1/channels/${channel.id}/rotate`, { method: "POST" });
    assert.equal(status, 200);
    assert.equal(body.keys.length, 2);
    const active = body.keys.filter(k => !k.retired_at);
    assert.equal(active.length, 1);
    assert.equal(active[0].key_id, 2);

    const trust = await json(`/v1/channels/${channel.id}/trust`, { token: channel.receive_token });
    assert.equal(trust.body.keys.length, 2, "receivers must still trust the retired key");
    assert.equal(trust.body.keys.filter(k => k.retired).length, 1);

    // New transmissions use key 2.
    const { body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { channel: channel.id, text: "rotated", profile: "standard", repeats: 1 },
    });
    const wav = decodeWav(new Uint8Array(await (await api(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer()));
    const { messages } = await decodeAudio(wav.samples, wav.sampleRate, { verify: () => true });
    assert.equal(messages[0].keyId, 2);
  });

  test("the free plan cannot create a signed channel", async () => {
    const freeAcct = store.createAccount({ email: "free@example.com", plan: "free" });
    const freeKey = store.createApiKey(freeAcct.id, "k").secret;
    const { status, body } = await json("/v1/channels", {
      method: "POST", token: freeKey, body: { name: "nope", signed: true },
    });
    assert.equal(status, 403);
    assert.match(body.error.message, /Pro plan/);
  });
});

describe("cards", () => {
  let channel;

  test("a card gets a code and a bundle", async () => {
    channel = (await json("/v1/channels", { method: "POST", body: { name: "Museum" } })).body;
    const { status, body } = await json(`/v1/channels/${channel.id}/cards`, {
      method: "POST",
      body: { label: "Room 3 audio guide", json: { room: 3, title: "The North Gallery", minutes: 4 } },
    });
    assert.equal(status, 201);
    assert.equal(body.code, 1);
    assert.equal(body.version, 1);
    assert.ok(body.bytes > 40);

    const bundle = await json(`/v1/channels/${channel.id}/cards/bundle`, { token: channel.receive_token });
    assert.equal(bundle.body.cards.length, 1);
    assert.ok(bundle.body.etag);
  });

  test("the bundle supports conditional requests", async () => {
    const first = await api(`/v1/channels/${channel.id}/cards/bundle`, { token: channel.receive_token });
    const etag = first.headers.get("etag");
    const second = await api(`/v1/channels/${channel.id}/cards/bundle`, {
      token: channel.receive_token, headers: { "if-none-match": etag },
    });
    assert.equal(second.status, 304);
  });

  test("broadcasting a card reference costs one micro frame and resolves on decode", async () => {
    const { status, body: tx } = await json("/v1/transmissions", {
      method: "POST", body: { channel: channel.id, card: 1, profile: "micro", repeats: 1 },
    });
    assert.equal(status, 201);
    assert.equal(tx.body_bytes, 4, "a card reference is four bytes on the air");
    assert.equal(tx.frames, 1);
    assert.ok(tx.seconds < 1.0, `a card reference should be under a second, was ${tx.seconds}`);

    const wav = Buffer.from(await (await api(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer());
    const r = await api("/v1/decode", {
      method: "POST", raw: true, body: wav, headers: { "content-type": "audio/wav" },
    });
    const body = await r.json();
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].card.code, 1);
    assert.equal(JSON.parse(body.messages[0].card.resolved.text).title, "The North Gallery");
  });

  test("a card reference is far shorter than sending the payload", async () => {
    const payload = { room: 3, title: "The North Gallery", minutes: 4 };
    const direct = (await json("/v1/transmissions", {
      method: "POST", body: { json: payload, profile: "standard", repeats: 1 },
    })).body;
    const viaCard = (await json("/v1/transmissions", {
      method: "POST", body: { channel: channel.id, card: 1, profile: "micro", repeats: 1 },
    })).body;
    assert.ok(viaCard.seconds < direct.seconds / 2,
      `card ${viaCard.seconds}s should be well under half of direct ${direct.seconds}s`);
  });

  test("updating a card bumps its version without changing the code", async () => {
    const { body } = await json(`/v1/channels/${channel.id}/cards`, {
      method: "POST", body: { code: 1, label: "Room 3", json: { room: 3, title: "Updated", minutes: 5 } },
    });
    assert.equal(body.code, 1);
    assert.equal(body.version, 2);
  });

  test("broadcasting an unknown card is refused with a pointer to the fix", async () => {
    const { status, body } = await json("/v1/transmissions", {
      method: "POST", body: { channel: channel.id, card: 999, profile: "micro" },
    });
    assert.equal(status, 404);
    assert.match(body.error.message, /no card 999/i);
  });
});

describe("simulation", () => {
  test("compares profiles through a modelled channel", async () => {
    const { status, body } = await json("/v1/simulate", {
      method: "POST",
      body: { text: "platform 4", condition: "cafe", profiles: ["robust", "standard"], trials: 3, repeats: 1 },
    });
    assert.equal(status, 200);
    assert.equal(body.condition, "cafe");
    assert.equal(body.results.length, 2);
    for (const r of body.results) {
      assert.ok(r.delivery_rate >= 0 && r.delivery_rate <= 1);
      assert.equal(r.trials, 3);
    }
    assert.match(body.caveat, /not a measurement/);
  });

  test("an unknown condition lists the valid ones", async () => {
    const { status, body } = await json("/v1/simulate", {
      method: "POST", body: { text: "x", condition: "volcano" },
    });
    assert.equal(status, 400);
    assert.match(body.error.message, /office/);
  });

  test("a profile the message does not fit is reported, not thrown", async () => {
    const { body } = await json("/v1/simulate", {
      method: "POST", body: { text: "x".repeat(30), profiles: ["micro", "robust"], trials: 1, repeats: 1 },
    });
    assert.equal(body.results.find(r => r.profile === "micro").usable, false);
    assert.equal(body.results.find(r => r.profile === "robust").usable, true);
  });
});

describe("receipts", () => {
  test("a receiver reports with only its receive token", async () => {
    const ch = (await json("/v1/channels", { method: "POST", body: { name: "Receipts" } })).body;
    const { status, body } = await json("/v1/receipts", {
      method: "POST", token: ch.receive_token,
      body: { device: "pixel-8", outcome: "decoded", latency_ms: 1840, detail: { rssi: -42 } },
    });
    assert.equal(status, 201);
    assert.ok(body.id);

    const list = await json(`/v1/receipts?channel_id=${ch.id}`);
    assert.equal(list.body.receipts.length, 1);
    assert.equal(list.body.receipts[0].device, "pixel-8");
    assert.equal(list.body.receipts[0].latency_ms, 1840);
    assert.deepEqual(list.body.receipts[0].detail, { rssi: -42 });
  });
});

describe("metering", () => {
  test("usage counts renders and decodes", async () => {
    const acct = store.createAccount({ email: "meter@example.com", plan: "pro" });
    const k = store.createApiKey(acct.id, "k").secret;
    const before = (await json("/v1/usage", { token: k })).body;
    assert.equal(before.metrics.render.used, 0);

    await json("/v1/transmissions", { method: "POST", token: k, body: { text: "one", profile: "robust" } });
    await json("/v1/transmissions", { method: "POST", token: k, body: { text: "two", profile: "robust" } });

    const after = (await json("/v1/usage", { token: k })).body;
    assert.equal(after.metrics.render.used, 2);
    assert.equal(after.metrics.render.limit, 50000);
    assert.equal(after.account.plan, "pro");
    assert.equal(after.estimated_charges_usd, 49);
  });

  test("a free account is stopped at its render limit", async () => {
    const acct = store.createAccount({ email: "capped@example.com", plan: "free" });
    const k = store.createApiKey(acct.id, "k").secret;
    // Jump straight to the limit rather than issuing a thousand requests.
    store.bumpUsage(acct.id, "render", 1000, (await json("/v1/usage", { token: k })).body.period);
    const { status, body } = await json("/v1/transmissions", {
      method: "POST", token: k, body: { text: "over", profile: "robust" },
    });
    assert.equal(status, 429);
    assert.match(body.error.message, /quota of 1000/);
    assert.equal(body.error.plan, "free");
  });

  test("a paid plan bills overage instead of blocking", async () => {
    const acct = store.createAccount({ email: "over@example.com", plan: "pro" });
    const k = store.createApiKey(acct.id, "k").secret;
    const period = (await json("/v1/usage", { token: k })).body.period;
    store.bumpUsage(acct.id, "render", 51000, period);
    const { status } = await json("/v1/transmissions", {
      method: "POST", token: k, body: { text: "billed", profile: "robust" },
    });
    assert.equal(status, 201, "overage should not block a paid plan");
    const usage = (await json("/v1/usage", { token: k })).body;
    assert.equal(usage.metrics.render.over, 1001);
    assert.ok(usage.estimated_charges_usd > 49);
  });
});

describe("errors", () => {
  test("unknown routes give a 404 with a request id", async () => {
    const r = await api("/v1/nope");
    assert.equal(r.status, 404);
    const b = await r.json();
    assert.equal(b.error.request_id, r.headers.get("x-request-id"));
  });

  test("the wrong method gives 405", async () => {
    assert.equal((await api("/v1/health", { method: "DELETE" })).status, 405);
  });

  test("malformed JSON is reported clearly", async () => {
    const r = await api("/v1/transmissions", {
      method: "POST", raw: true, body: "{oops", headers: { "content-type": "application/json" },
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error.message, /not valid JSON/);
  });

  test("CORS preflight is answered", async () => {
    const r = await fetch(`${origin}/v1/transmissions`, { method: "OPTIONS" });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
  });
});

describe("static pages", () => {
  test("serves the studio, console and receiver", async () => {
    for (const path of ["/", "/console", "/receive", "/docs"]) {
      const r = await fetch(`${origin}${path}`);
      assert.equal(r.status, 200, `${path} returned ${r.status}`);
      assert.match(r.headers.get("content-type"), /text\/html/);
    }
  });

  test("refuses to serve outside the public directory", async () => {
    const r = await fetch(`${origin}/../package.json`, { redirect: "manual" });
    assert.ok(r.status === 404 || r.status === 301, `path traversal returned ${r.status}`);
  });
});

describe("delivery paths", () => {
  test("lists every path with the bands that reach it", async () => {
    const { status, body } = await json("/v1/paths", { noAuth: true });
    assert.equal(status, 200);
    assert.ok(body.paths.length >= 7);
    const fm = body.paths.find(p => p.path === "fmBroadcast");
    assert.equal(fm.cutoff_hz, 15000);
    assert.equal(fm.recommended_band, "audible");
    assert.equal(fm.bands.find(b => b.band === "nearUltrasonic").survives, false);
    assert.match(fm.bands.find(b => b.band === "nearUltrasonic").reason, /19 kHz|19820 Hz/);
  });

  test("near-ultrasonic reaches direct playback and nothing else", async () => {
    const { body } = await json("/v1/paths", { noAuth: true });
    const reach = body.paths.filter(p => p.bands.find(b => b.band === "nearUltrasonic").survives);
    assert.deepEqual(reach.map(p => p.path), ["directSpeaker"]);
  });

  test("audible reaches everything except narrowband telephony's headroom", async () => {
    const { body } = await json("/v1/paths", { noAuth: true });
    for (const p of body.paths) {
      assert.equal(p.bands.find(b => b.band === "audible").survives, true,
        `audible should reach ${p.path}`);
    }
  });

  test("capacity warns when the band cannot reach the declared path", async () => {
    const bad = await json("/v1/capacity?bytes=40&path=fmBroadcast&band=nearUltrasonic", { noAuth: true });
    assert.equal(bad.status, 200);
    assert.equal(bad.body.delivery.survives, false);
    assert.match(bad.body.delivery.warning, /nothing will be received/);
    assert.equal(bad.body.delivery.use_band, "audible");

    const ok = await json("/v1/capacity?bytes=40&path=fmBroadcast&band=audible", { noAuth: true });
    assert.equal(ok.body.delivery.survives, true);
    assert.equal(ok.body.delivery.warning, undefined);
  });

  test("an unknown path lists the valid ones", async () => {
    const { status, body } = await json("/v1/paths?path=carrier-pigeon", { noAuth: true });
    assert.equal(status, 400);
    assert.match(body.error.message, /fmBroadcast/);
  });
});
