/* Atbalsts receiver UI. DSP, framing and state are shared with the headless
   tests (test_demo.js), so what runs here is what is measured there. */
(function () {
"use strict";
const M = globalThis.AtbalstsModem, P = globalThis.AtbalstsProtocol,
      E = globalThis.AtbalstsEncoder, D = globalThis.ATBALSTS_DATA;
const $ = id => document.getElementById(id);
const STORE = "atbalsts-radio-demo-v3";
const NAMES = ["No data", "Open", "Limited", "Full", "Closed"];
const CATS = Object.fromEntries(D.categories.map(c => [c.code, c]));
const state = new P.State(D.registry);
const receiver = new P.Receiver(null, state, onEvent);

let keys = null, ctx = null, tracks = null, processor = null, source = null;
let stream = null, timer = null, running = false, epoch = 0;
let started = 0, frozen = 0, firstObject = null, mode = "idle";
let tx = null, wavURL = null, dirty = new Set();
let levels = [], logRows = [], micInfo = null, lastError = null;
const SESSION = Math.random().toString(36).slice(2, 10);

const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const elapsed = () => running ? (performance.now() - started) / 1000 : frozen;
const statusText = t => { $("statusText").textContent = t; };
function setLive(on) { $("status").className = "pill" + (on ? " live" : ""); }

function log(text, bad) {
  logRows.push({ t: +elapsed().toFixed(2), text, bad: !!bad });
  if (logRows.length > 400) logRows.shift();
  const li = document.createElement("li");
  li.textContent = elapsed().toFixed(1) + " s · " + text;
  if (bad) li.className = "bad";
  $("log").prepend(li);
  while ($("log").children.length > 60) $("log").lastChild.remove();
}

/* ------------------------------------------------------------------ map */
const STATE_VAR = ["--unknown", "--open", "--limited", "--full", "--closed"];
let mapReady = false, selected = null;
let vb = { x: 0, y: 0, w: 0, h: 0 };          // current viewBox
const HOME = { x: 0, y: 0, w: 0, h: 0 };

function project(lat, lon) {
  const b = D.bounds, W = D.viewBox[2], H = D.viewBox[3];
  return [(lon - b.lon[0]) / (b.lon[1] - b.lon[0]) * W,
          H - (lat - b.lat[0]) / (b.lat[1] - b.lat[0]) * H];
}
/* Marks must keep a constant SIZE ON SCREEN, so every radius and stroke is
   divided by the zoom factor. Without this the Rīga view drew 30-pixel blobs. */
function scale() { return vb.w / D.viewBox[2]; }
function applyView() {
  $("map").setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  const k = scale();
  // Radius is proportional to the viewBox width, with NO floor: a floor is in
  // user units, so zoomed in it renders as a huge blob. This keeps every mark
  // the same size on screen at any zoom.
  const r = 4.5 * k;
  const dots = $("dots");
  if (dots) for (const c of dots.children) {
    c.setAttribute("r", c.dataset.id === String(selected) ? r * 1.9 : r);
    c.setAttribute("stroke-width", 0.9 * k);
  }
  const land = $("land");
  if (land) {
    // The boundaries come from a 1:1.2 m outline; past about 6x they are coarser
    // than what they are drawn over, so they fade out rather than cut across the
    // city as wedges.
    land.setAttribute("opacity", k > 0.16 ? 1 : Math.max(0.18, k / 0.16));
    for (const pth of land.children) pth.setAttribute("stroke-width", 0.8 * k);
  }
  drawSituations();
  $("btnHome").hidden = Math.abs(vb.w - HOME.w) < 1;
}
function zoomTo(cx, cy, w) {
  const min = D.viewBox[2] / 60, max = D.viewBox[2];
  w = Math.max(min, Math.min(max, w));
  const h = w * D.viewBox[3] / D.viewBox[2];
  vb = { x: cx - w / 2, y: cy - h / 2, w, h };
  applyView();
}
function zoomBy(f) { zoomTo(vb.x + vb.w / 2, vb.y + vb.h / 2, vb.w * f); }

function buildMap() {
  const paths = D.municipalities.map(m =>
    `<path d="${m.d}" fill="var(--land)" stroke="var(--rule)" stroke-width="0.8"/>`).join("");
  const dots = [...state.registry.values()].map(s => {
    const [x, y] = project(s.lat, s.lon);
    return `<circle data-id="${s.id}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.8" `
         + `fill="var(--unknown)" stroke="var(--surface)" stroke-width="0.9" `
         + `style="cursor:pointer"></circle>`;
  }).join("");
  $("map").innerHTML = `<g id="land">${paths}</g><g id="sits"></g><g id="dots">${dots}</g>`;
  HOME.x = 0; HOME.y = 0; HOME.w = D.viewBox[2]; HOME.h = D.viewBox[3];
  vb = { ...HOME };
  mapReady = true;
  wireMapInput();
  applyView();
}
function drawSituations() {
  const g = $("sits"); if (!g) return;
  const k = scale();
  g.innerHTML = [...state.situations.values()].map(s => {
    const [x, y] = project(s.lat, s.lon);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(16 * k).toFixed(1)}" `
      + `fill="var(--closed)" opacity="0.13"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" `
      + `r="${(5 * k).toFixed(1)}" fill="none" stroke="var(--closed)" stroke-width="${(2 * k).toFixed(2)}"/>`;
  }).join("");
}
function paintMap(changed) {
  if (!mapReady) return;
  for (const id of changed) {
    const s = state.sites.get(id);
    const el = $("dots").querySelector(`[data-id="${id}"]`);
    if (!el || !s) continue;
    el.setAttribute("fill", `var(${STATE_VAR[s.state || 0]})`);
  }
  drawSituations();
}

/* pointer: drag to pan, wheel to zoom, tap a shelter to select it */
function wireMapInput() {
  const svg = $("map");
  let drag = null, moved = 0;
  const toUser = e => {
    const r = svg.getBoundingClientRect();
    return [vb.x + (e.clientX - r.left) / r.width * vb.w,
            vb.y + (e.clientY - r.top) / r.height * vb.h];
  };
  /* Hit-testing is geometric, not DOM-based. setPointerCapture retargets every
     later pointer event to the <svg>, so e.target is never the circle; and a
     3.5 px dot is far below a fingertip anyway. Nearest shelter within a
     finger-sized radius, converted from pixels to user units at this zoom. */
  const hitTest = e => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return null;
    const [ux, uy] = toUser(e);
    let best = null, bestD = (e.pointerType === "touch" ? 24 : 13) / r.width * vb.w;
    for (const site of state.registry.values()) {
      const [x, y] = project(site.lat, site.lon);
      const d = Math.hypot(x - ux, y - uy);
      if (d <= bestD) { bestD = d; best = site.id; }
    }
    return best;
  };
  svg.addEventListener("pointerdown", e => {
    drag = { p: toUser(e), x: vb.x, y: vb.y }; moved = 0;
    // Throws NotFoundError if the pointer has already been released; panning
    // still works without capture, so never let it abort the handler.
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  });
  svg.addEventListener("pointermove", e => {
    if (!drag) return;
    const r = svg.getBoundingClientRect();
    const dx = (e.clientX - (drag.sx ?? e.clientX));
    if (drag.sx === undefined) { drag.sx = e.clientX; drag.sy = e.clientY; }
    moved = Math.max(moved, Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy));
    const nx = drag.x - (e.clientX - drag.sx) / r.width * vb.w;
    const ny = drag.y - (e.clientY - drag.sy) / r.height * vb.h;
    vb.x = nx; vb.y = ny;
    svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  });
  svg.addEventListener("pointerup", e => {
    const wasDrag = moved > 6;
    drag = null;
    try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
    if (wasDrag) { applyView(); return; }
    if (picking === "situation") {
      const [ux, uy] = toUser(e), b = D.bounds;
      sitLoc = [b.lat[0] + (1 - uy / D.viewBox[3]) * (b.lat[1] - b.lat[0]),
                b.lon[0] + ux / D.viewBox[2] * (b.lon[1] - b.lon[0])];
      setPicking(null); refreshPick(); statusText("Situation placed");
      return;
    }
    const id = hitTest(e);
    if (id !== null) {
      selectSite(id, false);
      if (picking === "shelter") {
        $("recordId").value = String(id); setPicking(null); refreshPick();
        $("txPanel").scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else { selected = null; renderDetail(); applyView(); }
  });
  svg.addEventListener("pointercancel", () => { drag = null; });
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const [ux, uy] = toUser(e);
    const f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const w = Math.max(D.viewBox[2] / 60, Math.min(D.viewBox[2], vb.w * f));
    const h = w * D.viewBox[3] / D.viewBox[2];
    vb = { x: ux - (ux - vb.x) * (w / vb.w), y: uy - (uy - vb.y) * (h / vb.h), w, h };
    applyView();
  }, { passive: false });
}

/* recentre is for picking from the LIST, where the shelter may be off screen.
   A tap on the map must not move the map: it jumps under the finger, and the
   next tap then lands on a different shelter. */
function selectSite(id, recentre) {
  selected = id;
  const s = state.sites.get(id);
  if (s && recentre) {
    const [x, y] = project(s.lat, s.lon);
    if (vb.w > D.viewBox[2] / 6) zoomTo(x, y, D.viewBox[2] / 8);
    else { vb.x = x - vb.w / 2; vb.y = y - vb.h / 2; }
  }
  renderDetail(); applyView(); renderList();
}
function renderDetail() {
  const s = selected != null ? state.sites.get(selected) : null;
  if (!s) { $("detail").innerHTML = ""; return; }
  const cat = (CATS[s.cat] || {}).lv || "Objekts";
  $("detail").innerHTML =
    `<div class="detail"><button class="x" id="detailClose" title="Close">×</button>`
    + `<strong>${esc(s.name)}</strong>`
    + `<div class="sub">${esc(s.locality)}${s.municipality ? " · " + esc(s.municipality) : ""}</div>`
    + `<div class="rowline"><span class="tag st-${s.state || 0}">${NAMES[s.state || 0]}</span>`
    + `<span class="kv">${esc(cat)}</span><span class="kv">ID ${s.id}</span>`
    + (s.revision ? `<span class="kv">revision ${s.revision}</span>` : `<span class="kv">no status received</span>`)
    + `</div>`
    + `<div class="sub">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`
    + (s.revision && s.state < 3 ? ` · ${s.places} free places` : "") + `</div>`
    + `<button id="detailEdit" class="primary" style="margin-top:8px">Change this shelter and transmit</button>`
    + `</div>`;
  $("detailClose").addEventListener("click", () => { selected = null; renderDetail(); applyView(); });
  $("detailEdit").addEventListener("click", () => {
    setTab("shelter");
    $("recordId").value = s.id;
    $("state").value = String(s.state === 1 ? 4 : 1);
    $("places").value = 0;
    refreshPick();
    $("txPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

/* ----------------------------------------------------------------- list */
/* Latvian names carry diacritics the tester will not type: "Riga" has to find
   "Rīga", "Kekava" has to find "Ķekava". Strip combining marks from both sides. */
const fold = t => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function renderList() {
  const q = fold($("search").value.trim());
  const want = $("filterState").value;
  let rows = [...state.sites.values()];
  const withStatus = rows.filter(s => s.revision > 0).length;
  $("sSites").textContent = `${state.registry.size} shelters known · ${withStatus} with status`
    + (state.situations.size ? ` · ${state.situations.size} situation${state.situations.size > 1 ? "s" : ""}` : "");
  /* Searching must reach the whole registry. Narrowing to "has a status" BEFORE
     applying the query meant that on a fresh page — nothing received yet — the
     search box filtered an already-empty list and appeared completely dead. */
  if (q) rows = rows.filter(s => fold(`${s.name} ${s.locality} ${s.municipality} ${s.id}`).includes(q));
  if (want === "all") { /* everything */ }
  else if (want !== "") rows = rows.filter(s => String(s.state || 0) === want && (want === "0" || s.revision > 0));
  else if (!q) rows = rows.filter(s => s.revision > 0);
  rows.sort((a, b) => (b.revision - a.revision) || a.id - b.id);
  const shown = rows.slice(0, 200);
  $("listWrap").innerHTML = shown.length
    ? `<div class="scroll"><table><thead><tr><th>Facility</th><th>Status</th>
       <th class="n">Places</th></tr></thead><tbody>` + shown.map(s =>
      `<tr data-row="${s.id}" style="cursor:pointer" class="${dirty.has(s.id) ? "flash" : ""}${selected === s.id ? " sel" : ""}"><td>${esc(s.name)}
        <small>${esc(s.locality)}${s.municipality ? " · " + esc(s.municipality) : ""} ·
        ${esc((CATS[s.cat] || {}).lv || "Objekts")} · ID ${s.id}${s.revision ? " · r" + s.revision : ""}</small></td>
       <td><span class="tag st-${s.state || 0}">${NAMES[s.state || 0]}</span></td>
       <td class="n">${s.revision && s.state < 3 ? s.places : "—"}</td></tr>`).join("")
      + `</tbody></table></div>` + (rows.length > 200
        ? `<p class="empty">Showing 200 of ${rows.length}. Use the filter to narrow.</p>` : "")
    : `<p class="empty">${q || want ? "Nothing matches that search."
        : "No status received yet. Search above to find any of the 803 shelters, or play a bulletin."}</p>`;
  $("listWrap").querySelectorAll("[data-row]").forEach(tr =>
    tr.addEventListener("click", () => selectSite(Number(tr.dataset.row), true)));
  $("sitWrap").innerHTML = [...state.situations.values()].map(s =>
    `<article class="situation"><strong>${esc(s.title)}</strong><p>${esc(s.text)}</p>
     <small>ID ${s.id} · revision ${s.revision} · signed</small></article>`).join("");
}
function render(changed) {
  dirty = new Set(changed || []);
  paintMap(changed && changed.length ? changed : [...state.sites.keys()]);
  renderList();
  setTimeout(() => { dirty.clear(); }, 1700);
}

/* ----------------------------------------------------------------- stats */
function tick() {
  const t = elapsed(), s = receiver.stats;
  if (running) {
    levels.push({ t: +t.toFixed(1), peak: +levelPeak.toFixed(4),
                  rms: levelN ? +Math.sqrt(levelSum / levelN).toFixed(4) : 0 });
    if (levels.length > 600) levels.shift();
    levelPeak = 0; levelSum = 0; levelN = 0;
  }
  $("sHeard").textContent = stream ? stream.detected : 0;
  $("sElapsed").textContent = t.toFixed(1) + " s";
  $("sFrames").textContent = s.bad ? `${s.frames} · ${s.bad} bad` : s.frames;
  $("sFail").textContent = s.bad;
  $("sObjects").textContent = s.objects; $("sChanges").textContent = s.changes;
  $("sBits").textContent = (t ? s.bytes * 8 / t : 0).toFixed(0) + " b/s";
  $("sFirst").textContent = firstObject === null ? "—" : firstObject.toFixed(1) + " s";
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state.snapshot())); } catch (_) {}
}
function onEvent(e) {
  if (e.kind === "frame") {
    const p = e.frame;
    $("rawFrame").textContent = `issuer ${p.issuer} · bulletin ${p.bulletin} · object ${p.object}\n`
      + `offset ${p.offset} of ${p.total} bytes\n${P.hex(p.chunk).replace(/(.{64})/g, "$1\n")}`;
  } else if (e.kind === "object") {
    if (firstObject === null) firstObject = elapsed();
    const kind = ["", "Registry", "Status", "Situation"][e.decoded.type];
    log(`${kind} object · ${e.body.length} signed bytes · ${e.changed.length} records applied`);
    $("rawImport").textContent = JSON.stringify(
      { object: e.frame.key, type: kind, signature: "verified",
        bytes: e.body.length, records: e.decoded.recs.slice(0, 6) }, null, 1);
    render(e.changed); save(); refreshPick();
  } else if (e.kind === "error") log(e.message, true);
  tick();
}

/* ----------------------------------------------------------------- audio */
function begin(m) {
  receiver.resetStats(); mode = m; frozen = 0; firstObject = null;
  levels = []; logRows = []; lastError = null;
  stream = new P.Stream(pl => receiver.accept(pl));
  started = performance.now(); running = true;
  $("btnStop").disabled = false; $("btnMic").disabled = true; $("btnFile").disabled = true;
  timer = setInterval(tick, 250); tick(); setLive(true);
}
let levelPeak = 0, levelSum = 0, levelN = 0;
function feed(samples, rs) {
  let pk = 0, sq = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]); if (a > pk) pk = a; sq += samples[i] * samples[i];
  }
  if (pk > levelPeak) levelPeak = pk;
  levelSum += sq; levelN += samples.length;
  $("lvl").style.width = Math.min(100, pk * 180) + "%";
  stream.push(rs.push(samples));
}
function stop() {
  frozen = elapsed(); running = false; epoch++;
  if (timer) { clearInterval(timer); timer = null; }
  if (source) { source.onended = null; try { source.stop(); } catch (_) {} source = null; }
  if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = null; }
  if (tracks) { tracks.getTracks().forEach(t => t.stop()); tracks = null; }
  if (ctx) { ctx.close().catch(() => {}); ctx = null; }
  $("btnStop").disabled = true; $("btnMic").disabled = !keys; $("btnFile").disabled = !keys;
  $("btnPlay").disabled = !tx; $("lvl").style.width = "0%"; setLive(false); tick();
}

/* Precise diagnosis: the usual cause of a dead microphone here is not the user
   denying it but the page running inside a frame that was never granted the
   permission, which no amount of re-allowing will fix. */
function micDiagnosis(err) {
  const framed = window.self !== window.top;
  if (!window.isSecureContext)
    return "This page is not in a secure context. Serve it over https, or over "
         + "http://localhost — see serve.py in the demo folder.";
  if (framed)
    return "The microphone is blocked because this page is running inside an embedded "
         + "frame that was not granted microphone permission. Re-allowing in the browser "
         + "cannot fix it. Run the page locally instead: python3 serve.py, then open "
         + "http://localhost:8000/receiver.html. File playback below works either way.";
  if (err && err.name === "NotAllowedError")
    return "Microphone permission was refused by the browser. Allow it for this site and retry.";
  if (err && err.name === "NotFoundError") return "No microphone was found on this device.";
  return err ? (err.name + ": " + err.message) : "Microphone unavailable.";
}
function showMicHelp(msg, warn) {
  $("micHelp").innerHTML = msg
    ? `<p class="note ${warn ? "warn" : ""}">${esc(msg)}</p>` : "";
}

async function listen() {
  stop(); const token = epoch;
  showMicHelp("");
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showMicHelp(micDiagnosis(null), true); statusText("Microphone unavailable"); return;
  }
  statusText("Opening microphone…"); $("btnMic").disabled = true;
  try {
    const c = ctx = new (window.AudioContext || window.webkitAudioContext)();
    await c.resume(); if (token !== epoch) return;
    const cap = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false,
               autoGainControl: false, channelCount: 1 } });
    if (token !== epoch) { cap.getTracks().forEach(t => t.stop()); return; }
    tracks = cap;
    const st = cap.getAudioTracks()[0].getSettings ? cap.getAudioTracks()[0].getSettings() : {};
    const on = ["echoCancellation", "noiseSuppression", "autoGainControl"].filter(k => st[k] === true);
    micInfo = { contextRate: c.sampleRate, trackSettings: st, processingOn: on };
    log(`Microphone open · ${c.sampleRate} Hz · ` +
        (on.length ? "WARNING processing still on: " + on.join(", ") : "unprocessed path granted"),
        on.length > 0);
    if (on.length) showMicHelp("The browser kept audio processing on (" + on.join(", ")
      + "). Decoding may fail; this is the condition the study identified as fatal.", true);
    const rs = new M.Resampler(c.sampleRate);
    const src = c.createMediaStreamSource(cap);
    processor = c.createScriptProcessor(4096, 1, 1);
    const mute = c.createGain(); mute.gain.value = 0;
    begin("microphone");
    processor.onaudioprocess = ev => {
      if (token === epoch && running) feed(ev.inputBuffer.getChannelData(0), rs);
    };
    src.connect(processor); processor.connect(mute); mute.connect(c.destination);
    statusText("Listening"); log("Listening. No network is used to receive or apply data.");
  } catch (err) {
    if (token !== epoch) return;
    stop(); statusText("Microphone unavailable");
    lastError = { name: err.name, message: err.message };
    showMicHelp(micDiagnosis(err), true); log(micDiagnosis(err), true);
  }
}

async function replay(file) {
  stop(); const token = epoch;
  try {
    const c = ctx = new (window.AudioContext || window.webkitAudioContext)();
    await c.resume(); if (token !== epoch) return;
    const audio = await c.decodeAudioData(await file.arrayBuffer());
    if (token !== epoch) return;
    if (audio.duration > 300) throw Error("Use a file shorter than five minutes");
    const mono = new Float32Array(audio.length);
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const d = audio.getChannelData(ch);
      for (let i = 0; i < mono.length; i++) mono[i] += d[i] / audio.numberOfChannels;
    }
    const rs = new M.Resampler(audio.sampleRate); let at = 0;
    begin("file"); statusText("Playing " + file.name);
    log(`Replaying ${file.name} · ${audio.duration.toFixed(1)} s. Software path — this does not test a speaker or microphone.`);
    // Audible playback is a courtesy; pacing runs off the wall clock so that a
    // browser blocking autoplay stalls the sound, never the decode.
    try {
      source = c.createBufferSource(); source.buffer = audio;
      source.connect(c.destination); source.start();
    } catch (_) { source = null; }
    const t0 = performance.now();
    clearInterval(timer);
    timer = setInterval(async () => {
      if (token !== epoch || !running) return;
      const end = Math.min(mono.length, Math.floor((performance.now() - t0) / 1000 * audio.sampleRate));
      const step = Math.round(audio.sampleRate / 4);
      while (at < end) { const nx = Math.min(at + step, end); feed(mono.subarray(at, nx), rs); at = nx; }
      tick();
      if (at >= mono.length) {
        clearInterval(timer); timer = null;
        await stream.finish();
        if (token === epoch) { stop(); statusText("Finished · data retained"); }
      }
    }, 250);
  } catch (err) {
    if (token === epoch) { stop(); log(err.message, true); statusText("Playback failed"); }
  }
}

/* ------------------------------------------------------------ diagnostics */
function report() {
  const t = elapsed(), s = receiver.stats;
  const heard = stream ? stream.detected : 0;
  const peaks = levels.map(l => l.peak);
  const loud = peaks.filter(p => p > 0.01).length;
  return {
    exercise: true, session: SESSION, generated: new Date().toISOString(),
    page: {
      url: location.href, framed: window.self !== window.top,
      secureContext: window.isSecureContext, userAgent: navigator.userAgent,
      language: navigator.language, screen: `${screen.width}x${screen.height}`,
    },
    input: { mode, microphone: micInfo, lastError,
             activeSeconds: +t.toFixed(2),
             levelSamples: levels.length,
             levelPeakMax: peaks.length ? Math.max(...peaks) : 0,
             fractionAboveNoiseFloor: levels.length ? +(loud / levels.length).toFixed(3) : 0 },
    decode: {
      burstsHeard: heard, framesOk: s.frames, framesFailed: s.bad,
      objectsVerified: s.objects, recordsApplied: s.changes,
      verifiedBytes: s.bytes, firstObjectSeconds: firstObject,
      verifiedBitsPerSecond: t ? +(s.bytes * 8 / t).toFixed(1) : 0,
      decodeRate: heard ? +(s.frames / heard).toFixed(3) : null,
    },
    result: (() => {
      const heardAny = heard > 0, decoded = s.frames > 0;
      if (!levels.length) return "no audio captured — input never started";
      if (peaks.length && Math.max(...peaks) < 0.005) return "microphone silent — no signal reaching the page";
      if (!heardAny) return "audio present but no burst preamble detected — wrong file, too quiet, or too far";
      if (!decoded) return "bursts heard but none decoded — level, distance, or processed capture path";
      if (s.objects === 0) return "frames decoded but no complete signed object — partial reception";
      return "working";
    })(),
    state: { registry: state.registry.size,
             withStatus: [...state.sites.values()].filter(x => x.revision > 0).length,
             situations: state.situations.size },
    levels, log: logRows,
  };
}
async function exportLog() {
  const data = report();
  const text = JSON.stringify(data, null, 1);
  let posted = false;
  try {
    const r = await fetch("log", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
    posted = r.ok;
  } catch (_) { posted = false; }
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch (_) {}
  if (window.self === window.top) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.setAttribute("download", `atbalsts-log-${SESSION}.json`);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  $("logNote").textContent = "Result: " + data.result + ". "
    + (posted ? "Sent to the local server (logs/ folder). " : "")
    + (copied ? "Copied to the clipboard — paste it into the chat. " : "")
    + (window.self === window.top ? "Saved as a file." : "");
  log("Log exported · " + data.result);
}

/* -------------------------------------------------------------- transmit */
/* Compose -> encode -> transmit. The middle step is shown rather than hidden:
   the whole argument of the project is that a change is a handful of bytes, so
   the bytes are on screen next to the edit that produced them. */
let tab = "shelter", picking = null, sitLoc = [56.9496, 24.1052];

function setTab(t) {
  tab = t;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.tab === t));
  $("tabShelter").hidden = t !== "shelter";
  $("tabSituation").hidden = t !== "situation";
  $("encoded").innerHTML = ""; tx = null; $("btnPlay").disabled = true;
}
function setPicking(mode) {
  picking = mode;
  $("map").classList.toggle("picking", !!mode);
  $("pickMap").textContent = mode === "shelter" ? "Tap a shelter…" : "Choose on the map";
  $("pickSit").textContent = mode === "situation" ? "Tap the map…" : "Place on the map";
  if (mode) statusText(mode === "shelter" ? "Tap a shelter on the map" : "Tap the map to place the situation");
}
function refreshPick() {
  const s = state.sites.get(Number($("recordId").value));
  $("pickName").textContent = s ? `${s.name}, ${s.locality} · ${NAMES[s.state || 0]}` : "Unknown ID";
  $("sitWhere").textContent = sitLoc[0].toFixed(5) + ", " + sitLoc[1].toFixed(5);
  const sel = $("sitExisting"), cur = sel.value;
  sel.innerHTML = '<option value="">New situation</option>'
    + [...state.situations.values()].map(x =>
        `<option value="${x.id}">Edit ${esc(x.title.slice(0, 34))}</option>`).join("");
  sel.value = cur;
}

function bytesView(parts) {
  return parts.map(p =>
    `<span class="${p.cls}">${P.hex(p.bytes).replace(/(..)/g, "$1 ").trim()}</span>`).join(" ");
}

async function encode() {
  $("btnEncode").disabled = true;
  try {
    if (!keys) throw Error("This browser cannot sign exercise data (Ed25519 unsupported)");
    let body, summary, headerLen = 4;
    if (tab === "shelter") {
      const id = Number($("recordId").value);
      const site = state.sites.get(id);
      if (!site) throw Error("Shelter " + id + " is not in the preinstalled registry");
      const revision = (site.revision || 0) + 1;
      if (revision > 255) throw Error("Revision limit reached; erase received data to restart");
      const rec = { id, state: Number($("state").value),
                    places: Number($("places").value), revision };
      body = P.encodeBody(2, [rec]);
      summary = `${site.name}, ${site.locality} → <b>${NAMES[rec.state]}</b>`
        + (rec.state < 3 ? `, ${rec.places} free places` : "") + ` (revision ${revision})`;
    } else {
      const id = Number($("sitId").value);
      const old = state.situations.get(id);
      const revision = (old ? old.revision : 0) + 1;
      if (revision > 255) throw Error("Revision limit reached for this situation");
      const rec = { id, severity: Number($("severity").value),
                    lat: sitLoc[0], lon: sitLoc[1],
                    title: $("title").value.trim(), text: $("message").value.trim() };
      if (!rec.title || !rec.text) throw Error("A situation needs a title and a message");
      body = P.encodeBody(3, [rec], revision);
      summary = `Situation ${id} → <b>${esc(rec.title)}</b> (revision ${revision})`;
    }
    const signed = await P.signBody(body, keys);
    const bulletin = crypto.getRandomValues(new Uint32Array(1))[0];
    const frames = P.fragment(signed, bulletin, 1);
    const passes = Number($("repeats").value);
    const samples = E.transmission(frames, passes);
    tx = { samples, body };
    const secs = samples.length / M.FS;

    const perRecord = body.length - headerLen;
    $("encoded").innerHTML =
      `<div class="wire"><p class="lead">${summary}</p>`
      + `<p class="lead"><b>${body.length} bytes</b> of application data `
      + `(${headerLen} header + ${perRecord} record) `
      + `+ <b>64</b> signature = <b>${signed.length}</b> signed bytes → `
      + `${frames.length} fragment${frames.length > 1 ? "s" : ""} × ${passes} passes = `
      + `<b>${frames.length * passes} bursts</b>, <b>${secs.toFixed(1)} s</b> of audio</p>`
      + `<div class="bytes">` + bytesView([
          { cls: "hdr", bytes: body.subarray(0, headerLen) },
          { cls: "rec", bytes: body.subarray(headerLen) },
          { cls: "sig", bytes: signed.subarray(signed.length - 64, signed.length - 56) },
        ]) + ` <span class="sig">… +56 more</span></div>`
      + `<div class="keyrow"><span><i style="background:var(--s1)"></i>object header</span>`
      + `<span><i style="background:var(--ink)"></i>the change itself</span>`
      + `<span><i style="background:var(--s2)"></i>Ed25519 signature</span></div></div>`;

    if (window.self === window.top) {
      if (wavURL) URL.revokeObjectURL(wavURL);
      wavURL = URL.createObjectURL(new Blob([E.wav(samples)], { type: "audio/wav" }));
      const slot = $("dlSlot"); slot.textContent = "";
      const a = document.createElement("a");
      a.href = wavURL; a.setAttribute("download", `atbalsts-${Date.now()}.wav`);
      a.textContent = "Save WAV"; slot.appendChild(a);
    }
    $("btnPlay").disabled = false;
    statusText("Encoded · ready to transmit");
    log(`Encoded ${signed.length} signed bytes into ${frames.length * passes} bursts. `
      + `Not applied here — it only counts once received.`);
  } catch (e) { statusText("Could not encode"); log(e.message, true); }
  finally { $("btnEncode").disabled = !keys; }
}

async function play() {
  if (!tx) return; stop(); const token = epoch;
  try {
    const c = ctx = new (window.AudioContext || window.webkitAudioContext)();
    await c.resume(); if (token !== epoch) return;
    const b = c.createBuffer(1, tx.samples.length, M.FS);
    b.copyToChannel(tx.samples, 0);
    source = c.createBufferSource(); source.buffer = b; source.connect(c.destination);
    $("btnPlay").disabled = true; $("btnStop").disabled = false;
    source.onended = () => { if (token === epoch) { stop(); statusText("Transmission complete"); } };
    source.start();
    statusText(`Transmitting ${b.duration.toFixed(1)} s — the other device should be listening`);
  } catch (e) { if (token === epoch) { stop(); log(e.message, true); } }
}

/* ------------------------------------------------------- offline / network */
const CACHE_NAME = "atbalsts-radio-exercise-v1";
let netCount = 0;
function paintNet() {
  const off = !navigator.onLine;
  $("netPill").className = "pill " + (off ? "off" : "on");
  $("netText").textContent = off ? "Device reports: offline" : "Device reports: online";
  $("netNote").textContent = off
    ? "Good — this is the state to demonstrate in."
    : "Turn on airplane mode on both devices before step 3.";
  $("netCount").textContent = netCount + " network request"
    + (netCount === 1 ? "" : "s") + " since the page finished loading";
}
function watchNetwork() {
  addEventListener("online", paintNet); addEventListener("offline", paintNet);
  try {
    new PerformanceObserver(list => { netCount += list.getEntries().length; paintNet(); })
      .observe({ type: "resource", buffered: false });
  } catch (_) {}
  paintNet();
}
/* Whether a reload survives airplane mode is a fact, not a hope, so it is
   checked by reading the page back out of the cache rather than by assuming the
   write worked. The live page is served no-cache, so the service worker is the
   only thing that can carry it. */
async function offlineReady() {
  try {
    if (typeof caches === "undefined") return false;
    const c = await caches.open(CACHE_NAME);
    const hit = await c.match(location.pathname + location.search, { ignoreSearch: true });
    return !!hit;
  } catch (_) { return false; }
}
async function paintOffline() {
  const ready = await offlineReady();
  const sw = ("serviceWorker" in navigator) && !!navigator.serviceWorker.controller;
  $("cacheNote").innerHTML = ready && sw
    ? '<b style="color:var(--open)">Offline copy saved.</b> A reload with the network off will work.'
    : ready
      ? '<b style="color:var(--limited)">Cached, but no active worker yet.</b> Reload once while still online.'
      : '<b style="color:var(--limited)">Not saved yet.</b> Until it is, keep this tab open — '
        + 'a reload with the network off will fail.';
  return ready && sw;
}
async function cacheOffline() {
  const btn = $("btnCache"); btn.disabled = true;
  try {
    if (window.self !== window.top)
      throw Error("This page is in an embedded frame, which cannot register a service worker. "
        + "Open it directly to save it offline, or simply keep this tab open.");
    if (!("serviceWorker" in navigator) || !window.isSecureContext)
      throw Error("Needs https or http://localhost");
    const reg = await navigator.serviceWorker.register("sw.js");
    await navigator.serviceWorker.ready;
    const c = await caches.open(CACHE_NAME);
    await c.add(new Request(location.pathname + location.search, { cache: "reload" }));
    if (!await offlineReady()) throw Error("The page did not end up in the cache");
    await paintOffline();
    log("Offline copy saved (" + reg.scope + ").");
  } catch (e) {
    $("cacheNote").innerHTML = '<b style="color:var(--closed)">Could not save offline.</b> '
      + esc(e.message) + ' Keep this tab open instead — everything still works with the '
      + 'network off, but do not reload.';
    log("Offline save failed: " + e.message, true);
  } finally { btn.disabled = false; }
}

/* ---------------------------------------------------- demo bulletin maker */
/* The same three bulletins as the bundled WAVs, built in the page so the hosted
   copy needs no audio files. States are deterministic, so a repeat run gives the
   same picture. */
// XOR yields a SIGNED int32 in JavaScript, so the final >>> 0 matters:
// without it the hash can go negative and index the state table out of range.
function mix(n) { n = (n * 2654435761) >>> 0; n ^= n >>> 15; n = (n * 2246822519) >>> 0; return (n ^ (n >>> 13)) >>> 0; }
function demoState(id, salt) {
  const h = mix(id + salt * 7919);
  const st = [1, 1, 1, 2, 1, 2, 1, 3][h % 8];
  return { state: st, places: st >= 3 ? 0 : 15 + ((h >>> 8) % 140) };
}
function rigaIds() {
  return [...state.registry.values()]
    .filter(s => /Rīga/.test((s.municipality || "") + " " + (s.locality || "")))
    .map(s => s.id).sort((a, b) => a - b);
}
function nationalIds() {
  const riga = new Set(rigaIds());
  const rest = [...state.registry.values()].filter(s => !riga.has(s.id)).map(s => s.id).sort((a, b) => a - b);
  const step = Math.max(1, Math.floor(rest.length / 180));
  return rest.filter((_, i) => i % step === 0).slice(0, 180);
}
function nearest(centre, n) {
  return [...state.registry.values()]
    .filter(s => /Rīga/.test((s.municipality || "") + " " + (s.locality || "")))
    .map(s => [s.id, Math.hypot((s.lat - centre[0]) * 111, (s.lon - centre[1]) * 111 * 0.55)])
    .sort((a, b) => a[1] - b[1]).slice(0, n).map(x => x[0]);
}
async function playDemo(kind) {
  const btns = ["btnDemoRiga", "btnDemoSit", "btnDemoLv"];
  btns.forEach(b => { $(b).disabled = true; });
  try {
    if (!keys) throw Error("This browser cannot sign exercise data");
    let bodies, label;
    if (kind === "riga") {
      const rows = rigaIds().map(id => ({ id, ...demoState(id, 1), revision: 1 }));
      bodies = [P.encodeBody(2, rows, 1)]; label = `Rīga sweep · ${rows.length} shelters`;
    } else if (kind === "lv") {
      const rows = nationalIds().map(id => ({ id, ...demoState(id, 2), revision: 1 }));
      bodies = [P.encodeBody(2, rows, 1)]; label = `National sweep · ${rows.length} shelters`;
    } else {
      const sit = [{ id: 9001, severity: 3, lat: 56.9496, lon: 24.1052,
        title: "Mācības: plūdu apdraudējums Rīgas centrā",
        text: "Mācību scenārijs. Centra patvertnes slēgtas. Izmanto Purvciema un Imantas patvertnes. Seko oficiālajiem paziņojumiem radio." }];
      const closed = nearest([56.9496, 24.1052], 12).map(id => ({ id, state: 4, places: 0, revision: 2 }));
      bodies = [P.encodeBody(3, sit, 1), P.encodeBody(2, closed, 2)];
      label = `Situation + ${closed.length} closures`;
    }
    const bulletin = crypto.getRandomValues(new Uint32Array(1))[0];
    const frames = [];
    for (let i = 0; i < bodies.length; i++)
      frames.push(...P.fragment(await P.signBody(bodies[i], keys), bulletin, i + 1));
    const passes = kind === "sit" ? 3 : 2;
    tx = { samples: E.transmission(frames, passes),
           bytes: bodies.reduce((n, b) => n + b.length, 0) };
    const dur = tx.samples.length / M.FS;
    $("demoSummary").textContent = `${label} · ${dur.toFixed(1)} s · `
      + `${frames.length * passes} bursts · ${tx.bytes} data bytes`;
    await play();
  } catch (e) { log(e.message, true); statusText("Could not build bulletin"); }
  finally { btns.forEach(b => { $(b).disabled = false; }); }
}

/* ------------------------------------------------------------------ wire */
$("btnCache").addEventListener("click", cacheOffline);
$("btnDemoRiga").addEventListener("click", () => playDemo("riga"));
$("btnDemoSit").addEventListener("click", () => playDemo("sit"));
$("btnDemoLv").addEventListener("click", () => playDemo("lv"));
$("btnMic").addEventListener("click", listen);
$("btnStop").addEventListener("click", stop);
$("btnFile").addEventListener("click", () => $("fileIn").click());
$("fileIn").addEventListener("change", e => {
  if (e.target.files[0]) replay(e.target.files[0]); e.target.value = "";
});
$("btnLog").addEventListener("click", exportLog);
$("btnClear").addEventListener("click", () => {
  stop(); receiver.clear(); firstObject = null; frozen = 0; tx = null;
  $("btnPlay").disabled = true; $("dlSlot").textContent = ""; $("encoded").innerHTML = "";
  $("rawFrame").textContent = "No frame received."; $("rawImport").textContent = "No object accepted.";
  $("log").innerHTML = "";
  try { localStorage.removeItem(STORE); } catch (_) {}
  render([]); tick(); statusText("Erased · ready");
  log("Received data and counters erased. The preinstalled registry is intact.");
});
$("search").addEventListener("input", renderList);
$("filterState").addEventListener("change", renderList);
$("btnPlay").addEventListener("click", play);
$("btnEncode").addEventListener("click", encode);
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("pickMap").addEventListener("click", () => setPicking(picking === "shelter" ? null : "shelter"));
$("pickSit").addEventListener("click", () => setPicking(picking === "situation" ? null : "situation"));
$("recordId").addEventListener("input", refreshPick);
$("sitExisting").addEventListener("change", e => {
  const x = state.situations.get(Number(e.target.value));
  if (!x) return;
  $("sitId").value = x.id; $("title").value = x.title; $("message").value = x.text;
  $("severity").value = String(x.severity || 3); sitLoc = [x.lat, x.lon]; refreshPick();
});

(async function init() {
  // zoom control, added here so the markup stays declarative
  buildMap();
  watchNetwork();
  paintOffline();
  $("zoomIn").addEventListener("click", () => zoomBy(1 / 1.6));
  $("zoomOut").addEventListener("click", () => zoomBy(1.6));
  $("btnHome").addEventListener("click", () => { selected = null; renderDetail(); vb = { ...HOME }; applyView(); });
  $("btnRiga").addEventListener("click", () => {
    const r = [...state.registry.values()].filter(x => /Rīga/.test((x.municipality || "") + " " + (x.locality || "")));
    if (!r.length) return;
    const pts = r.map(x => project(x.lat, x.lon));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    zoomTo(cx, cy, (Math.max(...xs) - Math.min(...xs)) * 1.6);
  });
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) { state.restore(JSON.parse(saved)); log("Restored previously received data from this device."); }
  } catch (_) { log("Could not restore saved data.", true); }
  render([]); tick(); setTab("shelter"); refreshPick();
  try {
    keys = await P.keys(); receiver.keys = keys;
    $("btnMic").disabled = false; $("btnFile").disabled = false; $("btnEncode").disabled = false;
    statusText("Ready");
    if (window.self !== window.top)
      showMicHelp("Running inside an embedded frame. Microphone access is usually blocked here — "
        + "use “Play a bulletin file”, or run the page locally with serve.py for a real "
        + "speaker-to-microphone test.", false);
  } catch (err) {
    statusText("Browser cannot verify signatures");
    log(err.message + " Signed objects will be rejected.", true);
  }
})();
})();
