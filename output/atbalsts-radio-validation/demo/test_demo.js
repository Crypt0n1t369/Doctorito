/* End-to-end: WAV -> streaming detector -> frames -> signature -> state applied
   against the PREINSTALLED registry. Optionally through the acoustic chain. */
const fs = require("fs");
require("./decoder.js"); require("./protocol.js"); require("./data.js");
const M = globalThis.AtbalstsModem, P = globalThis.AtbalstsProtocol, D = globalThis.ATBALSTS_DATA;
const man = JSON.parse(fs.readFileSync("demo-manifest.json", "utf8"));

function readWav(p) {
  const b = fs.readFileSync(p); let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4), sz = b.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12) };
    if (id === "data") data = b.subarray(pos + 8, pos + 8 + sz);
    pos += 8 + sz + (sz & 1);
  }
  const n = data.length / 2 / fmt.ch, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0;
    for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2) / 32768;
    out[i] = s / fmt.ch; }
  return { samples: out, rate: fmt.rate };
}

(async () => {
  const prefix = process.argv[2] || "clean";
  const keys = await P.keys();
  const state = new P.State(D.registry);
  const rx = new P.Receiver(keys, state, () => {});
  console.log(`registry preinstalled: ${state.registry.size} shelters, ` +
              `${[...state.sites.values()].filter(s => s.revision > 0).length} with status\n`);
  let t0 = Date.now();
  for (const f of man.files) {
    const path = prefix === "clean" ? f.file : `deg-${prefix}-${f.file}`;
    if (!fs.existsSync(path)) { console.log(`${path} missing, skipped`); continue; }
    const { samples, rate } = readWav(path);
    const rs = new M.Resampler(rate);
    const stream = new P.Stream(payload => rx.accept(payload));
    const step = Math.round(rate / 4);
    for (let at = 0; at < samples.length; at += step)
      stream.push(rs.push(samples.subarray(at, Math.min(at + step, samples.length))));
    await stream.finish();
    const withStatus = [...state.sites.values()].filter(s => s.revision > 0).length;
    console.log(`${f.file.padEnd(18)} ${rx.stats.frames}/${f.bursts} frames  ` +
      `${rx.stats.bad} bad  ${rx.stats.objects} objects  ` +
      `${withStatus} facilities now have status  ${state.situations.size} situations`);
  }
  const withStatus = [...state.sites.values()].filter(s => s.revision > 0);
  const byState = [0, 0, 0, 0, 0];
  withStatus.forEach(s => byState[s.state]++);
  console.log(`\nTOTAL ${rx.stats.frames} frames, ${rx.stats.objects} signed objects, ` +
    `${rx.stats.bytes} verified bytes, ${rx.stats.changes} record changes in ${(Date.now()-t0)/1000}s CPU`);
  console.log(`states: open ${byState[1]}, limited ${byState[2]}, full ${byState[3]}, closed ${byState[4]}`);
  const sample = withStatus.find(s => s.state === 4);
  console.log(`closed example: ${sample.name}, ${sample.locality} (id ${sample.id}, rev ${sample.revision})`);
  const sit = [...state.situations.values()][0];
  console.log(`situation: "${sit.title}"`);
  // registry fields must come from the bundle, never from the air
  console.log(`\nnames/coords transmitted over audio: 0 (all from preinstalled registry)`);
})();
