import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../src/server/server.js";
import { decodeWav, decodeAudio } from "../src/modem/audio.js";
import {
  validateTemplate, encodeAnnouncement, decodeAnnouncement, renderAnnouncement, renderAll,
  announcementBytes, isAnnouncement, AnnounceError, SEVERITIES,
} from "../src/announce/template.js";

const PLATFORM = {
  id: 1, severity: "change",
  slots: [
    { name: "service", type: "u16" },
    { name: "destination", type: "item", list: "destinations" },
    { name: "platform", type: "u8" },
  ],
  text: {
    lv: "Vilciens {service} uz {destination} atiet no {platform}. perona.",
    en: "Train {service} to {destination} departs from platform {platform}.",
    ru: "Поезд {service} до {destination} отправляется с платформы {platform}.",
  },
};
const LISTS = {
  destinations: [
    { lv: "Rīga", en: "Riga", ru: "Рига" },
    { lv: "Daugavpils", en: "Daugavpils", ru: "Даугавпилс" },
  ],
};

describe("template validation", () => {
  test("accepts a well-formed template", () => {
    const t = validateTemplate(PLATFORM);
    assert.equal(t.id, 1);
    assert.deepEqual(t.languages, ["lv", "en", "ru"]);
  });

  test("refuses a language that drops a value the others carry", () => {
    assert.throws(() => validateTemplate({
      ...PLATFORM,
      text: { ...PLATFORM.text, ru: "Поезд {service} отправляется." },
    }), /never uses \{destination\}/);
  });

  test("refuses text referring to a slot that does not exist", () => {
    assert.throws(() => validateTemplate({
      ...PLATFORM,
      text: { en: "Train {service} to {destination} from {platform} at {clock}." },
    }), /\{clock\}, which is not a declared slot/);
  });

  test("refuses duplicate slots, unknown types, and item slots with no list", () => {
    assert.throws(() => validateTemplate({ ...PLATFORM,
      slots: [...PLATFORM.slots, { name: "service", type: "u8" }] }), /declared twice/);
    assert.throws(() => validateTemplate({ ...PLATFORM,
      slots: [{ name: "x", type: "float" }], text: { en: "{x}" } }), /unknown type/);
    assert.throws(() => validateTemplate({ ...PLATFORM,
      slots: [{ name: "x", type: "item" }], text: { en: "{x}" } }), /must name the list/);
  });

  test("refuses a template with no text at all", () => {
    assert.throws(() => validateTemplate({ ...PLATFORM, text: {} }), /at least one language/);
  });
});

describe("encoding", () => {
  test("a three-language platform change is eight bytes on the air", () => {
    const body = encodeAnnouncement(PLATFORM, { service: 2041, destination: 1, platform: 11 });
    // marker + templateId:u16 = 3, then service:u16 + destination:item(u16) + platform:u8 = 5.
    assert.equal(body.length, 8);
    assert.equal(body.length, announcementBytes(validateTemplate(PLATFORM), {}));
    assert.ok(isAnnouncement(body));
  });

  test("every domain error is a client error, not a server error", () => {
    try { encodeAnnouncement(PLATFORM, {}); assert.fail("should have thrown"); }
    catch (e) { assert.equal(e.status, 400, "AnnounceError must declare its own status"); }
  });

  test("adding languages does not change a single byte on the air", () => {
    const values = { service: 2041, destination: 1, platform: 11 };
    const three = encodeAnnouncement(PLATFORM, values);
    const twelve = encodeAnnouncement({
      ...PLATFORM,
      text: Object.fromEntries(
        ["lv", "en", "ru", "uk", "de", "fr", "pl", "fi", "et", "lt", "sv", "no"]
          .map(l => [l, `${l} {service} {destination} {platform}`])),
    }, values);
    assert.deepEqual([...three], [...twelve]);
  });

  test("refuses a missing or out-of-range value with a useful message", () => {
    assert.throws(() => encodeAnnouncement(PLATFORM, { service: 1, destination: 0 }),
      /missing a value for \{platform\}/);
    assert.throws(() => encodeAnnouncement(PLATFORM, { service: 1, destination: 0, platform: 900 }),
      /between 0 and 255/);
    assert.throws(() => encodeAnnouncement(PLATFORM, { service: 1, destination: 0, platform: 1.5 }),
      /whole number/);
  });

  test("round-trips every value exactly", () => {
    const values = { service: 65535, destination: 1, platform: 255 };
    const decoded = decodeAnnouncement(encodeAnnouncement(PLATFORM, values), { 1: validateTemplate(PLATFORM) });
    assert.equal(decoded.known, true);
    assert.deepEqual(decoded.values, values);
  });

  test("a template the receiver has never seen is reported, not guessed", () => {
    const body = encodeAnnouncement(PLATFORM, { service: 1, destination: 0, platform: 2 });
    const decoded = decodeAnnouncement(body, {});
    assert.equal(decoded.known, false);
    assert.match(decoded.reason, /not in this device's cached bundle/);
    assert.equal(renderAnnouncement(decoded, { language: "en" }), null);
  });

  test("a truncated announcement names the slot it died in", () => {
    const body = encodeAnnouncement(PLATFORM, { service: 1, destination: 0, platform: 2 });
    assert.throws(() => decodeAnnouncement(body.subarray(0, 5), { 1: validateTemplate(PLATFORM) }),
      AnnounceError);
  });
});

describe("rendering", () => {
  const decoded = () => decodeAnnouncement(
    encodeAnnouncement(PLATFORM, { service: 2041, destination: 1, platform: 11 }),
    { 1: validateTemplate(PLATFORM) });

  test("renders into each language with the list resolved locally", () => {
    const all = renderAll(decoded(), { lists: LISTS });
    assert.equal(all.en, "Train 2041 to Daugavpils departs from platform 11.");
    assert.equal(all.lv, "Vilciens 2041 uz Daugavpils atiet no 11. perona.");
    assert.equal(all.ru, "Поезд 2041 до Даугавпилс отправляется с платформы 11.");
  });

  test("a list entry uses the reader's own language", () => {
    const ru = renderAnnouncement(decoded(), { language: "ru", lists: LISTS });
    assert.match(ru.text, /Даугавпилс/);
    const lv = renderAnnouncement(decoded(), { language: "lv", lists: LISTS });
    assert.match(lv.text, /Daugavpils/);
  });

  test("falls back rather than showing nothing", () => {
    const r = renderAnnouncement(decoded(), { language: "de", lists: LISTS, fallback: ["en"] });
    assert.equal(r.language, "en");
    assert.equal(r.requestedLanguage, "de");
  });

  test("a missing list entry degrades to its index, not to a crash", () => {
    const r = renderAnnouncement(decoded(), { language: "en", lists: {} });
    assert.match(r.text, /#1/);
  });

  test("times format as a clock, not as a number of minutes", () => {
    const t = validateTemplate({
      id: 5, slots: [{ name: "at", type: "time" }], text: { en: "Back at {at}." },
    });
    const d = decodeAnnouncement(encodeAnnouncement(t, { at: 17 * 60 + 5 }), { 5: t });
    assert.equal(renderAnnouncement(d, { language: "en" }).text, "Back at 17:05.");
  });

  test("severity travels with the template, not with the message", () => {
    const d = decoded();
    assert.equal(renderAnnouncement(d, { language: "en", lists: LISTS }).severity, "change");
    assert.ok(SEVERITIES.emergency.vibrate, "an emergency must have a haptic pattern for deaf readers");
    assert.equal(SEVERITIES.info.alert, false);
  });
});

// ------------------------------------------------------------------- the API
describe("announcements over the API", () => {
  let server, origin, dir, store, key, channel;

  before(async () => {
    process.env.CICADA_LOG = "off";
    dir = mkdtempSync(join(tmpdir(), "cicada-ann-"));
    server = createServer({ dbFile: join(dir, "t.db"), audioDir: join(dir, "audio") });
    await new Promise(r => server.listen(0, r));
    origin = `http://127.0.0.1:${server.address().port}`;
    store = server.store;
    const account = store.createAccount({ email: "station@example.com", plan: "scale" });
    key = store.createApiKey(account.id, "k").secret;
    channel = await post("/v1/channels", { name: "Concourse", signed: true });
    await post(`/v1/channels/${channel.id}/lists`, { name: "destinations", entries: LISTS.destinations });
    await post(`/v1/channels/${channel.id}/templates`, PLATFORM);
  });

  after(async () => {
    await new Promise(r => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  const call = (path, opts = {}) => fetch(`${origin}${path}`, {
    ...opts,
    headers: {
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...(opts.token === null ? {} : { authorization: `Bearer ${opts.token ?? key}` }),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const post = async (p, body) => {
    const r = await call(p, { method: "POST", body });
    const j = await r.json();
    if (!r.ok) throw new Error(`${p}: ${j?.error?.message}`);
    return j;
  };

  test("preview renders every language without spending a render", async () => {
    const before = (await (await call("/v1/usage")).json()).metrics.render.used;
    const p = await post("/v1/announcements/preview", {
      channel: channel.id, template: 1, values: { service: 2041, destination: 1, platform: 11 },
    });
    assert.equal(p.air_bytes, 8);
    assert.equal(p.signed, true);
    assert.equal(p.body_bytes, 8 + 68);
    assert.equal(p.rendered.en, "Train 2041 to Daugavpils departs from platform 11.");
    assert.equal(Object.keys(p.rendered).length, 3);
    const after = (await (await call("/v1/usage")).json()).metrics.render.used;
    assert.equal(after, before, "preview must not be billed as a render");
  });

  test("a broadcast announcement decodes back into every language", async () => {
    const tx = await post("/v1/announcements", {
      channel: channel.id, template: 1, repeats: 1,
      values: { service: 2041, destination: 1, platform: 11 },
    });
    assert.equal(tx.air_bytes, 8);
    assert.equal(tx.signed, true);
    assert.equal(tx.severity, "change");

    const wav = Buffer.from(await (await call(`/v1/transmissions/${tx.id}/audio.wav`)).arrayBuffer());
    const { samples, sampleRate } = decodeWav(new Uint8Array(wav));
    const { messages } = await decodeAudio(samples, sampleRate, { verify: () => true });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].announce, true, "the frame must be flagged as an announcement");

    const bundle = await (await call(`/v1/channels/${channel.id}/announce/bundle`, { token: channel.receive_token })).json();
    const templates = Object.fromEntries(bundle.templates.map(t => [t.id, t]));
    const decoded = decodeAnnouncement(messages[0].body, templates);
    assert.equal(decoded.known, true);
    assert.equal(renderAll(decoded, { lists: bundle.lists }).ru,
      "Поезд 2041 до Даугавпилс отправляется с платформы 11.");
  });

  test("the whole announcement fits one micro frame when the channel is unsigned", async () => {
    const plain = await post("/v1/channels", { name: "Unsigned concourse" });
    await post(`/v1/channels/${plain.id}/lists`, { name: "destinations", entries: LISTS.destinations });
    await post(`/v1/channels/${plain.id}/templates`, PLATFORM);
    const tx = await post("/v1/announcements", {
      channel: plain.id, template: 1, repeats: 1,
      values: { service: 2041, destination: 1, platform: 11 },
    });
    assert.equal(tx.profile, "micro");
    assert.equal(tx.frames, 1);
    assert.ok(tx.seconds < 0.6, `expected under 0.6s, got ${tx.seconds}`);
  });

  test("the bundle is readable with a receive token and carries no private key", async () => {
    const r = await call(`/v1/channels/${channel.id}/announce/bundle`, { token: channel.receive_token });
    assert.equal(r.status, 200);
    const b = await r.json();
    assert.equal(b.templates.length, 1);
    assert.deepEqual(b.languages, ["en", "lv", "ru"]);
    assert.ok(b.lists.destinations);
    assert.doesNotMatch(JSON.stringify(b), /PRIVATE KEY|private_pem/);
  });

  test("the bundle supports conditional requests", async () => {
    const first = await call(`/v1/channels/${channel.id}/announce/bundle`, { token: channel.receive_token });
    const etag = first.headers.get("etag");
    const again = await fetch(`${origin}/v1/channels/${channel.id}/announce/bundle`, {
      headers: { authorization: `Bearer ${channel.receive_token}`, "if-none-match": etag },
    });
    assert.equal(again.status, 304);
  });

  test("a value outside the template's range is refused before it is broadcast", async () => {
    const r = await call("/v1/announcements", {
      method: "POST",
      body: { channel: channel.id, template: 1, values: { service: 2041, destination: 1, platform: 999 } },
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error.message, /between 0 and 255/);
  });

  test("an unknown template is refused with the channel named", async () => {
    const r = await call("/v1/announcements", {
      method: "POST", body: { channel: channel.id, template: 404, values: {} },
    });
    assert.equal(r.status, 404);
    assert.match((await r.json()).error.message, /no template 404/);
  });

  test("another account cannot read this venue's templates", async () => {
    const other = store.createAccount({ email: "other@example.com", plan: "pro" });
    const otherKey = store.createApiKey(other.id, "k").secret;
    const r = await call(`/v1/channels/${channel.id}/templates`, { token: otherKey });
    assert.equal(r.status, 404);
  });

  test("updating a template bumps its version and keeps its number", async () => {
    const updated = await post(`/v1/channels/${channel.id}/templates`, {
      ...PLATFORM,
      text: { ...PLATFORM.text, en: "Train {service} for {destination} leaves from platform {platform}." },
    });
    assert.equal(updated.id, 1);
    assert.equal(updated.version, 2);
    assert.match(updated.text.en, /leaves from/);
  });
});
