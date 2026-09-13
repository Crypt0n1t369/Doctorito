/* No browser automation. Test the same modem, receiver and state code as the page. */
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
require("./decoder.js"); require("./protocol.js"); require("./encoder.js"); require("./data.js");
const M = globalThis.AtbalstsModem, P = globalThis.AtbalstsProtocol,
      E = globalThis.AtbalstsEncoder, D = globalThis.ATBALSTS_DATA;
function readWav(bytes) {
  const b = Buffer.from(bytes); let rate, channels, data;
  for (let p = 12; p + 8 <= b.length;) {
    const id = b.toString("ascii", p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === "fmt ") { assert.equal(b.readUInt16LE(p + 8), 1); assert.equal(b.readUInt16LE(p + 22), 16); channels = b.readUInt16LE(p + 10); rate = b.readUInt32LE(p + 12); }
    if (id === "data") data = b.subarray(p + 8, p + 8 + size);
    p += size + 8 + (size & 1);
  }
  assert.ok(data && rate && channels);
  const samples = new Float32Array(data.length / 2 / channels);
  for (let i = 0; i < samples.length; i++) for (let c = 0; c < channels; c++) samples[i] += data.readInt16LE((i * channels + c) * 2) / 32768 / channels;
  return { samples, rate };
}
async function streamAudio(receiver, samples, rate) {
  const stream = new P.Stream(f => receiver.accept(f)), rs = new M.Resampler(rate), step = Math.round(rate / 4);
  for (let p = 0; p < samples.length; p += step) { stream.push(rs.push(samples.subarray(p, p + step))); await stream.finish(); }
  await stream.finish();
}
async function main() {
  const keys = await P.keys(), manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "demo-manifest.json")));
  assert.equal(P.PUB, manifest.public_key_hex);
  for (const prefix of ["clean", "room", "car", "cheap"]) {
    const r = new P.Receiver(keys, new P.State(D.registry));
    for (const f of manifest.files) {
      const wav = readWav(fs.readFileSync(path.join(__dirname, prefix === "clean" ? f.file : `deg-${prefix}-${f.file}`)));
      await streamAudio(r, wav.samples, wav.rate);
    }
    const withStatus = [...r.state.sites.values()].filter(s => s.revision > 0).length;
    assert.equal(r.stats.frames, 45); assert.equal(r.stats.objects, 4); assert.equal(r.stats.bad, 0);
    assert.equal(r.state.sites.size, 803); assert.equal(r.state.situations.size, 1);
    assert.equal(withStatus, 292); assert.equal(r.stats.changes, 305);
    // id 500 is closed at revision 2 by the situation bulletin
    assert.equal(r.state.sites.get(500).state, 4); assert.equal(r.state.sites.get(500).revision, 2);
    // its name and coordinates came from the bundled registry, never from the air
    assert.equal(r.state.sites.get(500).name, D.registry.find(x => x[0] === 500)[4]);
    console.log(`PASS ${prefix} bulletins: 45 frames, 4 verified objects, ${withStatus} facilities with status + 1 situation`);
  }
  const site = { id: 900, kind: 0, lat: 56.9496, lon: 24.1052, name: "Mācības · Rīga", state: 1, places: 40, revision: 1 };
  const bodies = [P.encodeBody(1, [site], 1), P.encodeBody(2, [site])];
  const signed = await Promise.all(bodies.map(b => P.signBody(b, keys)));
  const frames = signed.flatMap((b, i) => P.fragment(b, 12345, i + 1));
  const signal = E.transmission(frames, 3), r = new P.Receiver(keys, new P.State(D.registry));
  const wave = E.wav(signal), decodedWav = readWav(wave);
  await streamAudio(r, decodedWav.samples, decodedWav.rate);
  assert.equal(r.stats.frames, frames.length * 3); assert.equal(r.stats.objects, 2);
  assert.equal(r.state.sites.get(900).name, site.name); assert.equal(r.state.sites.get(900).places, 40);
  assert.equal(r.stats.bytes, bodies.reduce((n, b) => n + b.length, 0));
  console.log(`PASS JS edit → signed bytes → PCM WAV → streaming decoder → app state (${(signal.length / M.FS).toFixed(3)} s)`);
  const update = await P.signBody(P.encodeBody(2, [{ ...site, state: 4, places: 0, revision: 2 }]), keys);
  // Object ID reused by a later bulletin must be accepted; revisions survive session switches.
  r.resetStats();
  for (const f of P.fragment(update, 12346, 1)) await r.accept(f);
  assert.equal(r.state.sites.get(900).state, 4); assert.equal(r.stats.changes, 1);
  for (const f of frames) await r.accept(f);
  assert.equal(r.state.sites.get(900).state, 4); assert.equal(r.stats.changes, 1);
  const restored = new P.State(); restored.restore(JSON.parse(JSON.stringify(r.state.snapshot())));
  assert.deepEqual(restored.snapshot(), r.state.snapshot());
  console.log("PASS later bulletin, duplicate suppression, stale status rejection and saved state restore");
  const invalid = signed[0].slice(); invalid[invalid.length - 1] ^= 1;
  const fail = new P.Receiver(keys);
  for (const f of P.fragment(invalid, 700, 1)) await fail.accept(f);
  assert.equal(fail.stats.objects, 0); assert.equal(fail.state.sites.size, 0);
  for (const f of P.fragment(signed[0], 700, 1)) await fail.accept(f);
  assert.equal(fail.stats.objects, 1); // Correct repetition recovers after rejection.
  const unsupported = new P.Receiver(null);
  for (const f of frames) await unsupported.accept(f);
  assert.equal(unsupported.stats.bytes, 0); assert.equal(unsupported.state.sites.size, 0);
  await assert.rejects(P.keys({}), /WebCrypto/);
  const crcBad = frames[0].slice(); crcBad[25] ^= 1; assert.equal(P.parseFrame(crcBad), null);
  for (const body of bodies) {
    assert.throws(() => P.decodeBody(body.subarray(0, -1)), /Truncated/);
    assert.throws(() => P.decodeBody(Uint8Array.from([...body, 0])), /Trailing/);
  }
  assert.throws(() => P.decodeBody(Uint8Array.from([1, 9, 0, 1])), /Unknown/);
  assert.throws(() => P.encodeBody(2, [{ ...site, state: 5 }]), /range/);
  const longBody = P.encodeBody(3, [{ id: 901, severity: 2, lat: site.lat, lon: site.lon, title: "Exercise", text: "Ā".repeat(120) }], 1);
  const longSigned = await P.signBody(longBody, keys), parts = P.fragment(longSigned, 88, 2), partial = new P.Receiver(keys);
  await partial.accept(parts[0]); await partial.accept(parts[0]); await partial.accept(parts.at(-1));
  assert.equal(partial.state.situations.size, 0);
  for (const f of parts.slice().reverse()) await partial.accept(f);
  assert.equal(partial.state.situations.size, 1);
  // Same object number from different issuers cannot mix into a complete object.
  const mixed = new P.Receiver(keys), other = P.fragment(longSigned, 88, 2, 2);
  await mixed.accept(parts[0]); for (const f of other.slice(1)) await mixed.accept(f);
  assert.equal(mixed.stats.objects, 0);
  console.log("PASS corrupt/unsupported rejection, recovery, strict parsing, missing fragments and issuer isolation");
  if (process.argv.includes("--python")) {
    const os = require("node:os"), cp = require("node:child_process");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atbalsts-encoder-")), file = path.join(dir, "reference.json");
    const payload = Uint8Array.from({ length: 128 }, (_, i) => (i * 17 + 3) & 255);
    fs.writeFileSync(file, JSON.stringify({ payload: P.hex(payload), samples: Array.from(E.modulate(payload)) }));
    try {
      const executable = process.argv[process.argv.indexOf("--python") + 1] || "python3";
      const result = cp.spawnSync(executable, [path.join(__dirname, "verify_encoder.py"), file], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || result.stdout); process.stdout.write(result.stdout);
    } finally { fs.rmSync(dir, { recursive: true }); }
  }
}
module.exports = { readWav, streamAudio };
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
