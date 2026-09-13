import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  FS, BAND, crc32c, modulate, demodulateAt, findPeaks, burstSamples, burstSeconds,
} from "../src/modem/core.js";
import {
  PROFILES, PROFILE_NAMES, fragment, parseFrame, Reassembler, frameCount,
  capacityPerFrame, buildSigned, openSigned, cardBody, readCardBody,
  CicadaFrameError, MULTI_HEADER, SOLO_HEADER,
} from "../src/modem/frame.js";
import {
  render, renderBody, encodeWav, decodeWav, decodeAudio, estimate, compareProfiles,
} from "../src/modem/audio.js";
import { applyChannel, CONDITION_NAMES } from "../src/modem/simulate.js";

const randomBytes = n => new Uint8Array(crypto.randomBytes(n));
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

describe("modem core", () => {
  test("occupies the declared 672-2313 Hz band", () => {
    assert.equal(Math.round(BAND.lowHz), 672);
    assert.equal(Math.round(BAND.highHz), 2313);
  });

  test("CRC32C matches the standard check value", () => {
    assert.equal(crc32c(new TextEncoder().encode("123456789")), 0xE3069283);
  });

  test("modulate/demodulate round-trips every frame size", () => {
    for (const name of PROFILE_NAMES) {
      const size = PROFILES[name].frameBytes;
      const payload = randomBytes(size);
      const burst = modulate(payload);
      assert.equal(burst.length, burstSamples(size));
      const x = new Float64Array(burst.length + 4000);
      x.set(burst, 2000);
      const peaks = findPeaks(x, 0, x.length, Math.floor(burstSamples(size) * 0.6));
      assert.ok(peaks.length >= 1, `${name}: no preamble found`);
      const got = demodulateAt(x, peaks[0], size);
      assert.ok(got, `${name}: did not decode`);
      assert.ok(same(got, payload), `${name}: payload mismatch`);
    }
  });

  test("forward error correction recovers a burst with symbols erased", () => {
    const payload = randomBytes(128);
    const burst = modulate(payload);
    const x = new Float64Array(burst.length + 4000);
    x.set(burst, 2000);
    // Silence three of the eleven data symbols. The interleaver spreads each
    // symbol's bits across the codeword, so the Viterbi decoder should close it.
    const dataStart = 2000 + 1024 + 160 + 64 + 576;
    for (let i = dataStart + 2 * 576; i < dataStart + 5 * 576; i++) x[i] = 0;
    const peaks = findPeaks(x, 0, x.length, 4000);
    const got = peaks.length ? demodulateAt(x, peaks[0], 128) : null;
    assert.ok(got && same(got, payload), "FEC should have recovered three erased symbols");
  });

  test("a burst buried in noise is rejected rather than mis-decoded", () => {
    let attempts = 0, accepted = 0;
    for (let trial = 0; trial < 12; trial++) {
      const payload = randomBytes(128);
      const burst = modulate(payload);
      const x = new Float64Array(burst.length + 4000);
      x.set(burst, 2000);
      // Overwrite most of the data region with noise at the signal's own level.
      let p = 0;
      for (const v of burst) p += v * v;
      const level = Math.sqrt(p / burst.length);
      const dataStart = 2000 + 1024 + 160 + 64 + 576;
      for (let i = dataStart; i < dataStart + 9 * 576; i++) {
        x[i] = (Math.random() * 2 - 1) * level * 6;
      }
      const peaks = findPeaks(x, 0, x.length, 4000);
      for (const pk of peaks) {
        attempts++;
        const got = demodulateAt(x, pk, 128);
        if (got) {
          accepted++;
          assert.ok(!same(got, payload), "noise cannot reconstruct the original payload");
        }
      }
    }
    // CRC32C must keep false accepts near zero across every attempt.
    assert.ok(attempts > 0, "no candidate bursts were examined");
    assert.equal(accepted, 0, `${accepted} of ${attempts} noise bursts passed CRC32C`);
  });
});

describe("framing", () => {
  test("solo and multi-frame capacities are what the docs claim", () => {
    assert.equal(capacityPerFrame("micro", true), 16 - SOLO_HEADER);
    assert.equal(capacityPerFrame("standard", true), 128 - SOLO_HEADER);
    assert.equal(capacityPerFrame("standard", false), 128 - MULTI_HEADER);
    assert.equal(capacityPerFrame("fast", false), 512 - MULTI_HEADER);
  });

  test("a message that fits uses one solo frame", () => {
    const frames = fragment(randomBytes(100), { profile: "standard", channel: 7 });
    assert.equal(frames.length, 1);
    const p = parseFrame(frames[0]);
    assert.equal(p.solo, true);
    assert.equal(p.channel, 7);
    assert.equal(p.total, 100);
  });

  test("reassembly survives loss of the first frame, reordering and repeats", () => {
    const body = randomBytes(900);
    const frames = fragment(body, { profile: "standard", channel: 3, messageId: 42 });
    assert.equal(frames.length, frameCount("standard", 900));
    assert.ok(frames.length > 1);

    const r = new Reassembler();
    // First pass drops frame 0 and arrives backwards.
    const firstPass = frames.slice(1).reverse();
    for (const f of firstPass) assert.equal(r.accept(parseFrame(f)), null);
    // The repeat supplies the missing frame.
    const done = r.accept(parseFrame(frames[0]));
    assert.ok(done && !done.duplicate, "message did not complete on the repeat");
    assert.ok(same(done.body, body));
    // A whole further repeat is recognised as duplicate, not re-emitted.
    let dupSeen = 0;
    for (const f of frames) {
      const m = r.accept(parseFrame(f));
      if (m?.duplicate) dupSeen++;
    }
    assert.equal(dupSeen, 1);
    assert.equal(r.stats.messages, 1);
  });

  test("a frame from another protocol is not mistaken for Cicada", () => {
    assert.equal(parseFrame(new Uint8Array(128)), null);           // version 0
    const bad = new Uint8Array(128); bad[0] = 1; bad[1] = 0xf0;    // reserved bits set
    assert.equal(parseFrame(bad), null);
  });

  test("micro is solo-only and says so when a message will not fit", () => {
    assert.equal(capacityPerFrame("micro", false), 0);
    assert.equal(frameCount("micro", 11), 1);
    assert.throws(() => fragment(randomBytes(20), { profile: "micro" }),
      /holds at most 11 bytes/);
    assert.throws(() => fragment(new Uint8Array(0)), /empty/);
    assert.throws(() => fragment(randomBytes(4), { profile: "nope" }), /Unknown profile/);
  });

  test("card references are four bytes", () => {
    const b = cardBody(0xDEADBEEF);
    assert.equal(b.length, 4);
    assert.equal(readCardBody(b), 0xDEADBEEF);
  });
});

describe("signing", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const sign = bytes => new Uint8Array(crypto.sign(null, Buffer.from(bytes), privateKey));

  test("a signed message verifies and a tampered one does not", async () => {
    const payload = new TextEncoder().encode("gate 14 boarding now");
    const body = await buildSigned(payload, 0x01020304, sign, 9);
    const parts = openSigned(body, 9);
    assert.equal(parts.keyId, 0x01020304);
    assert.ok(same(parts.payload, payload));
    assert.ok(crypto.verify(null, Buffer.from(parts.covered), publicKey, Buffer.from(parts.signature)));

    for (const at of [0, 4, 10, body.length - 65]) {
      const bad = Uint8Array.from(body);
      bad[at] ^= 0x01;
      const bp = openSigned(bad, 9);
      assert.equal(
        crypto.verify(null, Buffer.from(bp.covered), publicKey, Buffer.from(bp.signature)),
        false, `flipping byte ${at} still verified`);
    }
  });

  test("a signature from a different key fails", async () => {
    const other = crypto.generateKeyPairSync("ed25519");
    const body = await buildSigned(randomBytes(30), 1, sign, 0);
    const parts = openSigned(body, 0);
    assert.equal(
      crypto.verify(null, Buffer.from(parts.covered), other.publicKey, Buffer.from(parts.signature)), false);
  });

  test("the same signed bytes do not verify on a different channel", async () => {
    const body = await buildSigned(new TextEncoder().encode("evacuate"), 1, sign, 4);
    const onFour = openSigned(body, 4);
    assert.ok(crypto.verify(null, Buffer.from(onFour.covered), publicKey, Buffer.from(onFour.signature)));
    // The body is byte-identical; only the channel it arrived on differs.
    for (const other of [0, 3, 5, 65535]) {
      const moved = openSigned(body, other);
      assert.equal(
        crypto.verify(null, Buffer.from(moved.covered), publicKey, Buffer.from(moved.signature)),
        false, `a channel-4 signature verified when replayed on channel ${other}`);
    }
  });
});

describe("airtime estimates", () => {
  test("match the rendered audio to within a sample", () => {
    for (const profile of PROFILE_NAMES) {
      const cap = capacityPerFrame(profile, true);
      const body = randomBytes(cap);
      const est = estimate(body.length, { profile, repeats: 2 });
      const samples = renderBody(body, { profile, repeats: 2 });
      const actual = samples.length / FS;
      assert.ok(Math.abs(actual - est.seconds) < 0.01,
        `${profile}: estimated ${est.seconds}s, rendered ${actual.toFixed(3)}s`);
    }
  });

  test("compareProfiles marks micro unusable for a long message", () => {
    const rows = compareProfiles(400);
    assert.equal(rows.find(r => r.profile === "micro").usable, false);
    assert.equal(rows.find(r => r.profile === "fast").usable, true);
  });
});

describe("WAV container", () => {
  test("round-trips 16-bit mono", () => {
    const samples = renderBody(randomBytes(60), { profile: "robust", repeats: 1 });
    const wav = encodeWav(samples);
    const back = decodeWav(wav);
    assert.equal(back.sampleRate, FS);
    assert.equal(back.channels, 1);
    assert.equal(back.samples.length, samples.length);
    for (let i = 0; i < samples.length; i += 97) {
      assert.ok(Math.abs(back.samples[i] - samples[i]) < 1e-4);
    }
  });

  test("rejects non-WAV input clearly", () => {
    assert.throws(() => decodeWav(new Uint8Array(64)), /RIFF/);
  });
});

describe("end to end", () => {
  test("body survives render -> WAV -> decode on every profile", async () => {
    for (const profile of PROFILE_NAMES) {
      const cap = capacityPerFrame(profile, true);
      const body = randomBytes(Math.min(cap, 90));
      const wav = encodeWav(renderBody(body, { profile, repeats: 1 }));
      const { samples, sampleRate } = decodeWav(wav);
      const { messages } = await decodeAudio(samples, sampleRate);
      assert.equal(messages.length, 1, `${profile}: expected 1 message, got ${messages.length}`);
      assert.ok(same(messages[0].body, body), `${profile}: body mismatch`);
    }
  });

  test("a multi-frame message reassembles from audio", async () => {
    const body = randomBytes(1200);
    const samples = renderBody(body, { profile: "standard", channel: 9, repeats: 1 });
    const { messages, stats } = await decodeAudio(samples, FS);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].channel, 9);
    assert.ok(same(messages[0].body, body));
    assert.equal(stats.frames, frameCount("standard", 1200));
  });

  test("a 44.1 kHz recording decodes through the resampler", async () => {
    const body = new TextEncoder().encode("resampled from 44100");
    const at8k = renderBody(body, { profile: "robust", repeats: 1 });
    // Naive upsample to 44.1 kHz, as a capture device would deliver.
    const ratio = 44100 / FS;
    const up = new Float32Array(Math.floor(at8k.length * ratio));
    for (let i = 0; i < up.length; i++) {
      const s = i / ratio, k = Math.floor(s), f = s - k;
      up[i] = (1 - f) * at8k[k] + f * (at8k[Math.min(k + 1, at8k.length - 1)] || 0);
    }
    const { messages } = await decodeAudio(up, 44100);
    assert.equal(messages.length, 1);
    assert.ok(same(messages[0].body, body));
  });

  test("signed messages are delivered only when the signature checks", async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const sign = b => new Uint8Array(crypto.sign(null, Buffer.from(b), privateKey));
    const payload = new TextEncoder().encode("authenticated broadcast");
    const body = await buildSigned(payload, 77, sign, 5);
    const samples = renderBody(body, { profile: "standard", channel: 5, signed: true, repeats: 1 });

    const good = await decodeAudio(samples, FS, {
      verify: ({ covered, signature }) =>
        crypto.verify(null, Buffer.from(covered), publicKey, Buffer.from(signature)),
    });
    assert.equal(good.messages.length, 1);
    assert.equal(good.messages[0].verified, true);
    assert.equal(good.messages[0].keyId, 77);
    assert.ok(same(good.messages[0].body, payload));

    const rejected = await decodeAudio(samples, FS, { verify: () => false });
    assert.equal(rejected.messages.length, 0, "a bad signature must not deliver a message");

    // The verifier is handed the channel the frame arrived on, so it can bind to it.
    const bound = await decodeAudio(samples, FS, {
      verify: ({ channel, covered, signature }) =>
        channel === 5 && crypto.verify(null, Buffer.from(covered), publicKey, Buffer.from(signature)),
    });
    assert.equal(bound.messages.length, 1);
  });

  test("mixed profiles in one recording all decode", async () => {
    const a = new TextEncoder().encode("micro");
    const b = randomBytes(100);
    const first = renderBody(a, { profile: "micro", channel: 1, repeats: 1 });
    const second = renderBody(b, { profile: "standard", channel: 2, repeats: 1 });
    const joined = new Float32Array(first.length + second.length);
    joined.set(first); joined.set(second, first.length);
    const { messages } = await decodeAudio(joined, FS);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map(m => m.channel).sort(), [1, 2]);
  });
});

describe("simulated channels", () => {
  test("every named condition is defined and runs", () => {
    const samples = renderBody(randomBytes(40), { profile: "robust", repeats: 1 });
    for (const name of CONDITION_NAMES) {
      const out = applyChannel(samples, name, { seed: 5 });
      assert.ok(out.length > samples.length * 0.9, `${name} produced no audio`);
      assert.ok(out.every(Number.isFinite), `${name} produced non-finite samples`);
    }
  });

  test("a robust-profile message survives office and car conditions", async () => {
    const body = new TextEncoder().encode("shelter 14 open, 40 places");
    for (const condition of ["office", "car"]) {
      const samples = renderBody(body, { profile: "robust", repeats: 2 });
      const heard = applyChannel(samples, condition, { seed: 11 });
      const { messages } = await decodeAudio(heard, FS);
      assert.equal(messages.length, 1, `${condition}: expected the message to arrive`);
      assert.ok(same(messages[0].body, body), `${condition}: body corrupted`);
    }
  });
});
