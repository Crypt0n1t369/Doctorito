/* Adversarial tests. These are the things that would be embarrassing. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

import { createServer } from "../src/server/server.js";
import { parseMultipart } from "../src/server/http.js";
import { decodeWav, encodeWav, renderBody, decodeAudio } from "../src/modem/audio.js";
import { parseFrame, fragment, openSigned, Reassembler } from "../src/modem/frame.js";
import { verifyRaw } from "../src/server/signing.js";

let server, origin, dir, store, keyA, keyB, acctA, acctB;

before(async () => {
  process.env.CICADA_LOG = "off";
  dir = mkdtempSync(join(tmpdir(), "cicada-sec-"));
  server = createServer({ dbFile: join(dir, "t.db"), audioDir: join(dir, "audio") });
  await new Promise(r => server.listen(0, r));
  origin = `http://127.0.0.1:${server.address().port}`;
  store = server.store;
  acctA = store.createAccount({ email: "a@example.com", plan: "scale" });
  acctB = store.createAccount({ email: "b@example.com", plan: "scale" });
  keyA = store.createApiKey(acctA.id, "a").secret;
  keyB = store.createApiKey(acctB.id, "b").secret;
});

after(async () => {
  await new Promise(r => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const call = (path, opts = {}) => fetch(`${origin}${path}`, {
  ...opts,
  headers: {
    ...(opts.body && !opts.raw ? { "content-type": "application/json" } : {}),
    ...(opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? keyA}` }),
    ...opts.headers,
  },
  body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined),
});
const j = async (...a) => { const r = await call(...a); return { status: r.status, body: await r.json() }; };

describe("tenant isolation", () => {
  test("account B cannot see, play, or delete account A's things", async () => {
    const ch = (await j("/v1/channels", { method: "POST", body: { name: "A private", signed: true } })).body;
    await j(`/v1/channels/${ch.id}/cards`, { method: "POST", body: { text: "secret card" } });
    const tx = (await j("/v1/transmissions", {
      method: "POST", body: { channel: ch.id, text: "for A only", profile: "robust" },
    })).body;

    for (const [path, method] of [
      [`/v1/channels/${ch.id}`, "GET"],
      [`/v1/channels/${ch.id}/cards`, "GET"],
      [`/v1/channels/${ch.id}`, "DELETE"],
      [`/v1/channels/${ch.id}/rotate`, "POST"],
      [`/v1/transmissions/${tx.id}`, "GET"],
      [`/v1/transmissions/${tx.id}/audio.wav`, "GET"],
      [`/v1/transmissions/${tx.id}`, "DELETE"],
    ]) {
      const r = await call(path, { method, token: keyB });
      assert.equal(r.status, 404, `${method} ${path} leaked to another account (${r.status})`);
    }
  });

  test("B's receipts do not include A's", async () => {
    const { body } = await j("/v1/receipts", { token: keyB });
    assert.equal(body.receipts.length, 0);
  });

  test("A's decode does not verify against B's signing keys", async () => {
    const chB = (await j("/v1/channels", { method: "POST", token: keyB, body: { name: "B", signed: true } })).body;
    const txB = (await j("/v1/transmissions", {
      method: "POST", token: keyB, body: { channel: chB.id, text: "B's message", profile: "standard" },
    })).body;
    const wav = Buffer.from(await (await call(`/v1/transmissions/${txB.id}/audio.wav`, { token: keyB })).arrayBuffer());

    // A decodes B's audio: the bytes are public, but A must not be told it verified.
    const asA = await (await call("/v1/decode", {
      method: "POST", raw: wav, token: keyA, headers: { "content-type": "audio/wav" },
    })).json();
    assert.equal(asA.messages.length, 0, "a signed message from another account's key must not be delivered");
  });
});

describe("receive tokens stay in their lane", () => {
  let chA, chB;
  before(async () => {
    chA = (await j("/v1/channels", { method: "POST", body: { name: "scope A", signed: true } })).body;
    chB = (await j("/v1/channels", { method: "POST", token: keyB, body: { name: "scope B", signed: true } })).body;
  });

  test("cannot render, decode, simulate, or read usage and keys", async () => {
    for (const [path, method, body] of [
      ["/v1/transmissions", "POST", { text: "x" }],
      ["/v1/decode", "POST", { audio_base64: "" }],
      ["/v1/simulate", "POST", { text: "x" }],
      ["/v1/usage", "GET", null],
      ["/v1/keys", "GET", null],
      ["/v1/keys", "POST", { label: "mine now" }],
      ["/v1/channels", "GET", null],
      ["/v1/receipts", "GET", null],
      ["/v1/transmissions", "GET", null],
    ]) {
      const r = await call(path, { method, token: chA.receive_token, ...(body ? { body: JSON.stringify(body), raw: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
      assert.equal(r.status, 403, `${method} ${path} accepted a receive token (${r.status})`);
    }
  });

  test("one channel's token cannot read another channel's trust or cards", async () => {
    assert.equal((await call(`/v1/channels/${chB.id}/trust`, { token: chA.receive_token })).status, 404);
    assert.equal((await call(`/v1/channels/${chB.id}/cards/bundle`, { token: chA.receive_token })).status, 404);
    assert.equal((await call(`/v1/channels/${chA.id}/trust`, { token: chA.receive_token })).status, 200);
  });

  test("the trust bundle publishes public keys and never private ones", async () => {
    const { body } = await j(`/v1/channels/${chA.id}/trust`, { token: chA.receive_token });
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /PRIVATE KEY/);
    assert.doesNotMatch(text, /private/i);
    for (const k of body.keys) assert.equal(k.public_key.length, 64, "expected a raw 32-byte hex key");
  });

  test("a private key never appears in any channel response", async () => {
    const all = JSON.stringify((await j("/v1/channels")).body);
    assert.doesNotMatch(all, /PRIVATE KEY/);
    assert.doesNotMatch(all, /private_pem/);
  });
});

describe("static file serving", () => {
  test("refuses to escape the public directory", async () => {
    writeFileSync(join(dir, "secret.txt"), "do not serve me");
    for (const path of [
      "/../package.json",
      "/..%2fpackage.json",
      "/%2e%2e%2fpackage.json",
      "/....//package.json",
      "/sdk/../../package.json",
      "/sdk/..%2f..%2fpackage.json",
      "/../../../../etc/passwd",
    ]) {
      const r = await fetch(`${origin}${path}`, { redirect: "manual" });
      const text = r.ok ? await r.text() : "";
      assert.ok(!text.includes("\"name\": \"cicada\""), `${path} served package.json`);
      assert.ok(!text.includes("root:"), `${path} served /etc/passwd`);
    }
  });

  test("serves the SDK modules the browser needs", async () => {
    for (const f of ["core.js", "frame.js", "audio.js"]) {
      const r = await fetch(`${origin}/sdk/${f}`);
      assert.equal(r.status, 200, `/sdk/${f} is not served`);
      assert.match(r.headers.get("content-type"), /javascript/);
    }
  });

  test("does not serve the server source through the SDK path", async () => {
    const r = await fetch(`${origin}/sdk/../server/db.js`, { redirect: "manual" });
    const text = r.ok ? await r.text() : "";
    assert.ok(!text.includes("DatabaseSync"), "server source leaked through /sdk/");
  });
});

describe("hostile input", () => {
  test("multipart parsing terminates on malformed bodies", () => {
    const cases = [
      Buffer.from("--abc"),
      Buffer.from("--abc\r\n"),
      Buffer.from("--abc\r\nContent-Disposition: form-data; name=\"x\"\r\n\r\n"),
      Buffer.from("--abc\r\n\r\n\r\n--abc--"),
      Buffer.alloc(1024),
      Buffer.from("--abc\r\n".repeat(200)),
    ];
    for (const body of cases) {
      // Must return or throw quickly; never hang or read out of bounds.
      try { parseMultipart(body, "multipart/form-data; boundary=abc"); }
      catch (e) { assert.ok(e.status === 400, `unexpected error type: ${e.message}`); }
    }
  });

  test("a truncated or lying WAV header is rejected, not trusted", async () => {
    const good = Buffer.from(encodeWav(new Float32Array(800)));
    const cases = [
      good.subarray(0, 20),                                  // truncated
      (() => { const b = Buffer.from(good); b.writeUInt32LE(0xFFFFFFFF, 40); return b; })(),  // data size lies
      (() => { const b = Buffer.from(good); b.writeUInt16LE(99, 34); return b; })(),          // bit depth 99
      (() => { const b = Buffer.from(good); b.writeUInt16LE(7, 20); return b; })(),           // format 7 (mu-law)
      Buffer.from("RIFF" + "x".repeat(60)),
    ];
    for (const body of cases) {
      const r = await call("/v1/decode", {
        method: "POST", raw: body, headers: { "content-type": "audio/wav" },
      });
      assert.ok(r.status === 400 || r.status === 200,
        `malformed WAV produced ${r.status}, which should have been a 400 or a clean 200`);
      if (r.status === 200) {
        const b = await r.json();
        assert.ok(Array.isArray(b.messages), "a clean 200 must still be well formed");
      }
    }
  });

  test("random audio does not produce phantom messages", async () => {
    const noise = new Float32Array(8000 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    const r = await call("/v1/decode", {
      method: "POST", raw: Buffer.from(encodeWav(noise)), headers: { "content-type": "audio/wav" },
    });
    const body = await r.json();
    assert.equal(body.messages.length, 0, "four seconds of noise produced a message");
  });

  test("frames with a hostile header are refused by the parser", () => {
    const base = fragment(new Uint8Array(200), { profile: "standard", channel: 1, messageId: 1 })[0];
    const mutate = (fn) => { const f = Uint8Array.from(base); fn(new DataView(f.buffer), f); return f; };
    // offset beyond total
    assert.equal(parseFrame(mutate(d => d.setUint16(8, 60000))), null);
    // total length zero
    assert.equal(parseFrame(mutate(d => d.setUint16(10, 0))), null);
    // offset not a multiple of the frame's capacity
    assert.equal(parseFrame(mutate(d => d.setUint16(8, 3))), null);
    // solo frame claiming more bytes than the frame holds
    const solo = fragment(new Uint8Array(10), { profile: "standard" })[0];
    assert.equal(parseFrame(mutate2(solo, f => { f[4] = 250; })), null);
    function mutate2(src, fn) { const f = Uint8Array.from(src); fn(f); return f; }
  });

  test("reassembly cannot be made to allocate unboundedly", () => {
    const r = new Reassembler({ maxPending: 8 });
    // 200 distinct incomplete messages, each claiming the maximum length.
    for (let i = 0; i < 200; i++) {
      const frames = fragment(new Uint8Array(60000), { profile: "fast", messageId: i, channel: 1 });
      r.accept(parseFrame(frames[0]));
    }
    assert.ok(r.pending.size <= 8, `pending grew to ${r.pending.size}`);
  });

  test("a signed body too short to hold a signature is rejected", () => {
    assert.throws(() => openSigned(new Uint8Array(10)), /too short/);
    assert.throws(() => openSigned(new Uint8Array(68)), /too short/);
  });

  test("oversized request bodies are refused", async () => {
    const huge = Buffer.alloc(33 * 1024 * 1024);
    huge.write("RIFF");
    const r = await call("/v1/decode", {
      method: "POST", raw: huge, headers: { "content-type": "audio/wav" },
    }).catch(e => ({ status: 413, err: e }));
    assert.ok(r.status === 413 || r.status === 400, `33 MB body produced ${r.status}`);
  });
});

describe("signature forgery", () => {
  test("a message re-signed by a different key does not verify against the pinned one", async () => {
    const ch = (await j("/v1/channels", { method: "POST", body: { name: "forge", signed: true } })).body;
    const pinned = ch.keys[0].public_key;
    const forger = crypto.generateKeyPairSync("ed25519");

    const payload = new TextEncoder().encode("evacuate the building");
    const head = Buffer.alloc(6);
    head.writeUInt16BE(ch.number, 0);                    // the channel it will ride on
    head.writeUInt32BE(1, 2);                            // claim key id 1
    const covered = Buffer.concat([head, Buffer.from(payload)]);
    const sig = crypto.sign(null, covered, forger.privateKey);
    const body = new Uint8Array(Buffer.concat([covered.subarray(2), sig]));

    const samples = renderBody(body, { profile: "standard", channel: ch.number, signed: true, repeats: 1 });
    const wav = Buffer.from(encodeWav(samples));

    // Through the server, which trusts this account's own keys.
    const viaApi = await (await call("/v1/decode", {
      method: "POST", raw: wav, headers: { "content-type": "audio/wav" },
    })).json();
    assert.equal(viaApi.messages.length, 0, "a forged signature was delivered by the API");

    // And through a receiver pinning the published key.
    const { samples: s2, sampleRate } = decodeWav(new Uint8Array(wav));
    const viaReceiver = await decodeAudio(s2, sampleRate, {
      verify: ({ covered: c, signature }) => {
        try { return verifyRaw(pinned, c, signature); } catch { return false; }
      },
    });
    assert.equal(viaReceiver.messages.length, 0, "a forged signature was accepted by a receiver");
  });

  /*
   * Two independent defences stop a relay, and this test exercises the outer one:
   * the trust table is keyed by channel/keyId, so a message arriving on a channel
   * with no key registered at that id is refused before any crypto runs.
   *
   * The inner defence — the channel number being inside the signed bytes — is
   * covered by "the same signed bytes do not verify on a different channel" in
   * modem.test.js. Removing the binding makes that test fail and leaves this one
   * passing, which is what defence in depth is supposed to look like.
   */
  test("a real signature relayed onto another channel is refused by the trust table", async () => {
    const ch = (await j("/v1/channels", { method: "POST", body: { name: "relay", signed: true } })).body;
    const tx = (await j("/v1/transmissions", {
      method: "POST", body: { channel: ch.id, text: "on channel A", profile: "standard", repeats: 1 },
    })).body;
    const wav = Buffer.from(await (await call(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer());
    const { samples, sampleRate } = decodeWav(new Uint8Array(wav));

    // Capture the genuine signed body, signature and all, exactly as broadcast.
    let signedBody = null;
    await decodeAudio(samples, sampleRate, {
      verify: ({ keyId, payload, signature }) => {
        signedBody = Buffer.concat([
          (() => { const h = Buffer.alloc(4); h.writeUInt32BE(keyId); return h; })(),
          Buffer.from(payload), Buffer.from(signature),
        ]);
        return true;
      },
    });
    assert.ok(signedBody, "did not capture the signed body");

    // Re-broadcast those exact bytes on a different channel number.
    const moved = renderBody(new Uint8Array(signedBody), {
      profile: "standard", channel: ch.number + 100, signed: true, repeats: 1,
    });
    const r = await (await call("/v1/decode", {
      method: "POST", raw: Buffer.from(encodeWav(moved)), headers: { "content-type": "audio/wav" },
    })).json();
    assert.equal(r.messages.length, 0,
      "a genuine signature was accepted after being relayed onto another channel");

    // Sanity: the same bytes on their own channel still verify.
    const home = renderBody(new Uint8Array(signedBody), {
      profile: "standard", channel: ch.number, signed: true, repeats: 1,
    });
    const ok = await (await call("/v1/decode", {
      method: "POST", raw: Buffer.from(encodeWav(home)), headers: { "content-type": "audio/wav" },
    })).json();
    assert.equal(ok.messages.length, 1);
    assert.equal(ok.messages[0].verified, true);
  });
});

describe("key lifecycle", () => {
  test("a revoked key cannot be revived by re-presenting it", async () => {
    const k = store.createApiKey(acctA.id, "temp");
    assert.equal((await call("/v1/usage", { token: k.secret })).status, 200);
    store.revokeApiKey(acctA.id, k.id);
    for (let i = 0; i < 3; i++) {
      assert.equal((await call("/v1/usage", { token: k.secret })).status, 401);
    }
  });

  test("account B cannot revoke account A's key", async () => {
    const k = store.createApiKey(acctA.id, "target");
    assert.equal((await call(`/v1/keys/${k.id}`, { method: "DELETE", token: keyB })).status, 404);
    assert.equal((await call("/v1/usage", { token: k.secret })).status, 200, "A's key was revoked by B");
  });

  test("the stored key material is a hash, not the secret", () => {
    const k = store.createApiKey(acctA.id, "hashcheck");
    const row = store.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(k.id);
    assert.ok(!JSON.stringify(row).includes(k.secret.slice(16)),
      "the secret's random half is recoverable from the database row");
    assert.equal(row.hash, crypto.createHash("sha256").update(k.secret).digest("hex"));
  });
});
