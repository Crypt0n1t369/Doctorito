import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {encode} from 'cborg';
import * as P from './protocol.mjs';
import './modem/decoder.js';
import './modem/legacy-framing.js';
import './modem/encoder.js';

const results = {generated: new Date().toISOString(), node: process.version, checks: [], measurements: {}};
const test = async (name, fn) => { await fn(); results.checks.push({name, passed: true}); console.log('PASS', name); };
const v = JSON.parse(fs.readFileSync(new URL('./vectors/hpke-base-x25519.json', import.meta.url)));
await test('RFC 9180 base/X25519/AES128: deterministic encapsulation, 257 encryptions and 257 decryptions, 3 exports in both contexts', async () => {
  const s = P.suite(), pub = await s.kem.deserializePublicKey(P.fromHex(v.pkRm)), priv = await s.kem.deserializePrivateKey(P.fromHex(v.skRm));
  // Deterministic ekm is ONLY for the official known-answer test.
  const tx = await s.createSenderContext({recipientPublicKey: pub, info: P.fromHex(v.info), ekm: P.fromHex(v.ikmE)});
  const rx = await s.createRecipientContext({recipientKey: priv, enc: P.fromHex(v.enc), info: P.fromHex(v.info)});
  assert.equal(P.hex(tx.enc), v.enc);
  for (const x of v.encryptions) {
    assert.equal(P.hex(await tx.seal(P.fromHex(x.pt), P.fromHex(x.aad))), x.ct);
    assert.equal(P.hex(await rx.open(P.fromHex(x.ct), P.fromHex(x.aad))), x.pt);
  }
  for (const x of v.exports) for (const ctx of [tx, rx]) assert.equal(P.hex(await ctx.export(P.fromHex(x.exporter_context), x.L)), x.exported_value);
  results.officialVectors = {suite: 'mode=0, kem=0x0020, kdf=0x0001, aead=0x0001', encryptions:257, decryptions:257, exporterChecks:6, encapsulationChecks:1};
});
await test('RFC 8032 Ed25519 test 1: expected public key and signature, verify and tamper rejection', async () => {
  const seed = P.fromHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
  const pk = P.fromHex('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a');
  const expected = 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
  const priv = await crypto.subtle.importKey('pkcs8', P.concat(P.fromHex('302e020100300506032b657004220420'), seed), 'Ed25519', true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', priv); assert.equal(Buffer.from(jwk.x, 'base64url').toString('hex'), P.hex(pk));
  const pub = await crypto.subtle.importKey('raw', pk, 'Ed25519', false, ['verify']);
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', priv, new Uint8Array())); assert.equal(P.hex(sig), expected);
  assert.equal(await crypto.subtle.verify('Ed25519', pub, sig, new Uint8Array()), true);
  sig[0] ^= 1; assert.equal(await crypto.subtle.verify('Ed25519', pub, sig, new Uint8Array()), false);
});

// Keys are freshly generated for this run, never loaded from or saved into app code.
const centre = await P.suite().kem.generateKeyPair(), stranger = await P.suite().kem.generateKeyPair();
const signing = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const rogueSign = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
const KID=17, SIGN_KID=23, TIME=1788976800;
const report = [1,TIME,2,5694960,2410520,'Exercise: entrance blocked at the community shelter.'];
const sealed = await P.sealReport(report, KID, centre.publicKey);
const snapshot = [1,1,101,1,1,42,TIME,TIME+7200,
  Array.from({length:32}, (_,i)=>[100+i,i===0?4:1,i===0?0:20+i]),
  [[1,2,5694960,2410520,'Shelter entrance closed','Use the east entrance. Centre checked at 14:00.']]];
const trust = new Map([[P.hex(P.kidBytes(SIGN_KID)), {publicKey:signing.publicKey, centre:1, area:101, registry:1, epoch:1, shelterIds:snapshot[8].map(x=>x[0])}]]);
const signed = await P.signSnapshot(snapshot, SIGN_KID, signing.privateKey);
await test('Exact sealed report is 314 bytes; intended centre recovers all fields', async()=>{
  assert.equal(sealed.length,314); assert.deepEqual(await P.openReport(sealed,KID,centre.privateKey),report);
});
await test('Relay public key and unrelated private key cannot decrypt',async()=>{
  await assert.rejects(P.openReport(sealed,KID,centre.publicKey));
  await assert.rejects(P.openReport(sealed,KID,stranger.privateKey));
});
await test('Fresh encryption of identical report gives different encapsulation and ciphertext',async()=>{
  const again=await P.sealReport(report,KID,centre.publicKey); assert.notDeepEqual(sealed,again);
  assert.notDeepEqual(sealed.slice(10,42),again.slice(10,42)); assert.notDeepEqual(sealed.slice(42),again.slice(42));
});
await test('One-bit mutation at EACH of 314 envelope byte positions rejected',async()=>{
  for(let i=0;i<sealed.length;i++){const b=sealed.slice();b[i]^=1;await assert.rejects(P.openReport(b,KID,centre.privateKey));}
});
await test('Relabel destination to an alias for same key still fails cryptographic binding',async()=>{
  const b=sealed.slice();new DataView(b.buffer).setUint32(4,KID+1);await assert.rejects(P.openReport(b,KID+1,centre.privateKey));
});
await test('Replay decrypts at crypto layer but queue and centre deduplicate by full object hash',async()=>{
  const q=new P.SealedQueue([KID]);assert.equal((await q.accept(sealed)).status,'queued');assert.equal((await q.accept(sealed)).status,'duplicate');
  const inbox=new P.CentreInbox(KID,centre.privateKey);await inbox.receive(sealed);await inbox.receive(sealed);assert.equal(inbox.items.size,1);
  assert.equal((await P.openReport(sealed,KID,centre.privateKey))[5],report[5]);
});
await test('Opaque gateway export contains ciphertext only, keeps exact bytes, enforces quota',async()=>{
  const q=new P.SealedQueue([KID],1);await q.accept(sealed);assert.deepEqual([...q.items.values()][0],sealed);
  const dump=JSON.stringify([...q.items].map(([id,b])=>({id,ciphertext:P.hex(b)})));assert.ok(!dump.includes(report[5]));
  await assert.rejects(q.accept(await P.sealReport(report,KID,centre.publicKey)),/queue full/);
  await assert.rejects(new P.SealedQueue([]).accept(sealed),/unknown destination/);
});
await test('Malformed size, extra fields, oversized UTF-8 text and invalid coordinates rejected',async()=>{
  await assert.rejects(P.openReport(sealed.slice(0,-1),KID,centre.privateKey));
  await assert.rejects(P.openReport(P.concat(sealed,new Uint8Array([0])),KID,centre.privateKey));
  await assert.rejects(P.sealReport([...report,true],KID,centre.publicKey));
  await assert.rejects(P.sealReport([...report.slice(0,5),'ā'.repeat(81)],KID,centre.publicKey));
  const bad=structuredClone(report);bad[3]=9000001;await assert.rejects(P.sealReport(bad,KID,centre.publicKey));
});
await test('Deliberately false but well-formed report stays unverified and has no public-state effects',async()=>{
  const state=new P.PublicState(trust);await state.accept(signed,TIME+1);
  const before=P.hex(state.snapshots.get('1/101').bytes),inbox=new P.CentreInbox(KID,centre.privateKey);
  const falseReport=[...report.slice(0,5),'Unconfirmed claim: all shelters are closed.'];
  const item=await inbox.receive(await P.sealReport(falseReport,KID,centre.publicKey));
  assert.equal(item.status,'unverified');assert.equal(P.hex(state.snapshots.get('1/101').bytes),before);
});
await test('COSE_Sign1 exact profile accepts authorized complete snapshot and rejects private objects',async()=>{
  assert.deepEqual(await P.verifySnapshot(signed,trust),snapshot);await assert.rejects(P.verifySnapshot(sealed,trust));
  await assert.rejects(P.openReport(signed,KID,centre.privateKey));
});
await test('One-bit mutation at EACH public object byte position rejected',async()=>{
  for(let i=0;i<signed.length;i++){const b=signed.slice();b[i]^=1;await assert.rejects(P.verifySnapshot(b,trust));}
});
await test('Wrong signer, unknown key ID, wrong area, wrong epoch and incomplete snapshot rejected',async()=>{
  await assert.rejects(P.verifySnapshot(await P.signSnapshot(snapshot,SIGN_KID,rogueSign.privateKey),trust));
  await assert.rejects(P.verifySnapshot(await P.signSnapshot(snapshot,SIGN_KID+1,signing.privateKey),trust));
  for (const field of [2,3,4]) {const x=structuredClone(snapshot);x[field]++;await assert.rejects(P.verifySnapshot(await P.signSnapshot(x,SIGN_KID,signing.privateKey),trust));}
  const missing=structuredClone(snapshot);missing[8].pop();await assert.rejects(P.verifySnapshot(await P.signSnapshot(missing,SIGN_KID,signing.privateKey),trust));
});
await test('Newer complete snapshot withdraws situation; replay cannot resurrect it; duplicate is harmless',async()=>{
  const state=new P.PublicState(trust);await state.accept(signed,TIME+1);
  const next=structuredClone(snapshot);next[5]++;next[9]=[];const newer=await P.signSnapshot(next,SIGN_KID,signing.privateKey);
  assert.equal((await state.accept(newer,TIME+2)).status,'applied');assert.equal(state.snapshots.get('1/101').data[9].length,0);
  assert.equal((await state.accept(signed,TIME+2)).status,'stale');assert.equal((await state.accept(newer,TIME+2)).status,'duplicate');
  next[8][0][1]=1;await assert.rejects(state.accept(await P.signSnapshot(next,SIGN_KID,signing.privateKey),TIME+3),/conflicting/);
});
await test('Expired signed data and unknown clock are explicitly distinguished from current data',async()=>{
  assert.equal((await new P.PublicState(trust).accept(signed,TIME+8000)).freshness,'expired');
  assert.equal((await new P.PublicState(trust).accept(signed)).freshness,'time-uncertain');
});
await test('Independent Python cryptography: JS→Python decrypt, Python→JS decrypt, Ed25519 verify',async()=>{
  const body=encode(report),padded=new Uint8Array(256);new DataView(padded.buffer).setUint16(0,body.length);padded.set(body,2);
  const cose=P.unpack(signed.slice(1));
  const input={privateKey:P.hex(await P.suite().kem.serializePrivateKey(centre.privateKey)),envelope:P.hex(sealed),paddedPlaintext:P.hex(padded),
    signPublicKey:P.hex(await crypto.subtle.exportKey('raw',signing.publicKey)),signature:P.hex(cose[3]),sigStructure:P.hex(encode(['Signature1',cose[0],P.PUBLIC_AAD,cose[2]]))};
  const python=process.env.ATBALSTS_PYTHON || '/Users/kristaps/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
  const run=spawnSync(python,[fileURLToPath(new URL('./interop.py',import.meta.url))],{input:JSON.stringify(input),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);const out=JSON.parse(run.stdout);assert.equal(out.hpke_js_to_python,true);
  assert.deepEqual(await P.openReport(P.fromHex(out.pythonEnvelope),KID,centre.privateKey),report);
  results.independentImplementation={cryptography:out.cryptography,jsToPython:true,pythonToJs:true,ed25519Verification:true};
});

const M=globalThis.AtbalstsModem,F=globalThis.AtbalstsProtocol,E=globalThis.AtbalstsEncoder;
async function audioRoundtrip(bytes, name, number) {
  const frames=F.fragment(bytes,number,1),wave=E.wav(E.transmission(frames,2));
  const pcm=new Float32Array((wave.length-44)/2),d=new DataView(wave.buffer,wave.byteOffset);
  for(let i=0;i<pcm.length;i++)pcm[i]=d.getInt16(44+2*i,true)/32768;
  const assembled=new Uint8Array(bytes.length),seen=new Set();let good=0,bad=0;
  const stream=new F.Stream(frame=>{const p=F.parseFrame(frame);if(!p){bad++;return;}good++;assert.equal(p.total,bytes.length);assembled.set(p.chunk,p.offset);seen.add(p.offset);});
  const resampler=new M.Resampler(M.FS);
  for(let i=0;i<pcm.length;i+=2000){stream.push(resampler.push(pcm.subarray(i,i+2000)));await stream.finish();}
  await stream.finish();assert.equal(seen.size,frames.length);assert.deepEqual(assembled,bytes);assert.equal(bad,0);
  fs.writeFileSync(new URL(`./${name}.wav`,import.meta.url),wave);
  results.measurements[name]={objectBytes:bytes.length,framesPerPass:frames.length,repeats:2,decodedFrames:good,failedCandidates:bad,wavSeconds:pcm.length/M.FS};
  return assembled;
}
await test('Sealed report → existing modem → 16-bit PCM WAV → streaming decoder → opaque relay → centre plaintext',async()=>{
  const recovered=await audioRoundtrip(sealed,'sealed-report',9001),q=new P.SealedQueue([KID]);await q.accept(recovered);
  assert.deepEqual(await P.openReport([...q.items.values()][0],KID,centre.privateKey),report);
});
await test('Signed area snapshot → PCM WAV → streaming decoder → verified local app state',async()=>{
  const recovered=await audioRoundtrip(signed,'public-snapshot',9002),state=new P.PublicState(trust);await state.accept(recovered,TIME+1);
  assert.deepEqual(state.snapshots.get('1/101').data,snapshot);
});
results.measurements.reportCborBytes=encode(report).length;
results.measurements.publicPayloadBytes=encode(snapshot).length;
results.measurements.privateMutationCases=sealed.length;
results.measurements.publicMutationCases=signed.length;
results.totalChecks=results.checks.length;
results.limitations=['Software audio loop only: no new speaker/microphone, FM or LoRa field test.', 'No production integration, key provisioning, hardware key custody or persistent transactional storage.', 'Negative tests are evidence, not a cryptographic proof or independent security audit.', 'Python independently verifies Ed25519 input; full COSE parsing is tested in JS only.'];
fs.writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({checks:results.totalChecks,measurements:results.measurements},null,2));
