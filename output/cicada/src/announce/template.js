/* Announcements: templated public-address messages, rendered on the listener's
 * own phone in the listener's own language.
 *
 * The observation this layer is built on is that public-address announcements
 * are not free text. They are a small set of sentence templates with a few
 * values filled in:
 *
 *   "Train {service} to {destination} departs from platform {platform}."
 *
 * So the template — in every language the venue serves — is synced to the phone
 * over its ordinary network connection, and the air carries only the template
 * number and the values. A platform change is around ten bytes: three of header
 * plus its slots. It stays that size whether the venue publishes in two
 * languages or twelve, because none of the text is ever on the air.
 *
 * That is what makes this affordable to broadcast. Read aloud in one language a
 * platform change takes six to eight seconds of the PA's time. As data, in four
 * languages, it is half a second unsigned or 1.2 seconds signed.
 */

import { BadInputError } from "../modem/frame.js";

export const ANNOUNCE_VERSION = 0x02;
export const HEADER_BYTES = 3;          // marker + templateId:u16

/** How urgent, and therefore how the phone should behave when it arrives. */
export const SEVERITIES = {
  info:       { id: 0, label: "Information", alert: false, vibrate: null },
  change:     { id: 1, label: "Change",      alert: true,  vibrate: [90, 60, 90] },
  disruption: { id: 2, label: "Disruption",  alert: true,  vibrate: [180, 80, 180] },
  emergency:  { id: 3, label: "Emergency",   alert: true,  vibrate: [400, 120, 400, 120, 400] },
};
export const SEVERITY_NAMES = Object.keys(SEVERITIES);
export const severityById = id => SEVERITY_NAMES.find(n => SEVERITIES[n].id === id) ?? "info";

/**
 * Slot types. Each is fixed-width and declared by the template, so no type tags
 * travel on the air — the receiver already knows the shape from the bundle.
 */
export const SLOT_TYPES = {
  u8:      { bytes: 1, max: 0xff,   label: "Whole number, 0–255" },
  u16:     { bytes: 2, max: 0xffff, label: "Whole number, 0–65535" },
  minutes: { bytes: 1, max: 0xff,   label: "Minutes, 0–255" },
  time:    { bytes: 2, max: 1439,   label: "Time of day" },
  item:    { bytes: 2, max: 0xffff, label: "An entry in a synced list" },
  text:    { bytes: -1,             label: "Free text — costs its own length on the air" },
};
export const SLOT_TYPE_NAMES = Object.keys(SLOT_TYPES);

export class AnnounceError extends BadInputError {
  constructor(message) { super(message, "AnnounceError"); }
}

const SLOT_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Check a template before it can be published. A template that renders wrongly
 * on a phone in a station is not something anyone can debug after the fact, so
 * everything that can be checked here is checked here.
 */
export function validateTemplate(t) {
  if (!Number.isInteger(t.id) || t.id < 0 || t.id > 0xffff) {
    throw new AnnounceError("Template id must be a whole number between 0 and 65535");
  }
  if (!SEVERITY_NAMES.includes(t.severity ?? "info")) {
    throw new AnnounceError(`severity must be one of: ${SEVERITY_NAMES.join(", ")}`);
  }
  const slots = t.slots ?? [];
  if (!Array.isArray(slots)) throw new AnnounceError("slots must be an array");
  if (slots.length > 8) throw new AnnounceError("A template takes at most 8 slots");

  const names = new Set();
  for (const s of slots) {
    if (!s.name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.name)) {
      throw new AnnounceError(`Slot name "${s.name}" must be a plain identifier`);
    }
    if (names.has(s.name)) throw new AnnounceError(`Slot "${s.name}" is declared twice`);
    names.add(s.name);
    if (!SLOT_TYPE_NAMES.includes(s.type)) {
      throw new AnnounceError(`Slot "${s.name}" has unknown type "${s.type}". Use one of: ${SLOT_TYPE_NAMES.join(", ")}`);
    }
    if (s.type === "item" && !s.list) {
      throw new AnnounceError(`Slot "${s.name}" is an item, so it must name the list it indexes`);
    }
  }

  const text = t.text ?? {};
  const languages = Object.keys(text);
  if (!languages.length) throw new AnnounceError("A template needs text in at least one language");

  // Every language must use exactly the declared slots. A missing slot in one
  // language means that language silently loses the platform number.
  for (const [lang, phrase] of Object.entries(text)) {
    if (typeof phrase !== "string" || !phrase.trim()) {
      throw new AnnounceError(`Text for "${lang}" is empty`);
    }
    const used = new Set([...phrase.matchAll(SLOT_RE)].map(m => m[1]));
    for (const u of used) {
      if (!names.has(u)) {
        throw new AnnounceError(`Text for "${lang}" uses {${u}}, which is not a declared slot`);
      }
    }
    for (const n of names) {
      if (!used.has(n)) {
        throw new AnnounceError(
          `Text for "${lang}" never uses {${n}}. Every language must carry every value, `
          + "or that language loses information the others have.");
      }
    }
  }
  return { id: t.id, severity: t.severity ?? "info", slots, text, languages };
}

/** Bytes an announcement from this template will occupy, before any signature. */
export function announcementBytes(template, values = {}) {
  let n = HEADER_BYTES;
  for (const s of template.slots) {
    if (s.type === "text") {
      const v = String(values[s.name] ?? "");
      n += 1 + new TextEncoder().encode(v).length;
    } else {
      n += SLOT_TYPES[s.type].bytes;
    }
  }
  return n;
}

// ------------------------------------------------------------------ encoding
/** Pack an announcement: marker, template id, then the declared slot values. */
export function encodeAnnouncement(template, values = {}) {
  const t = template.slots ? template : validateTemplate(template);
  const out = [ANNOUNCE_VERSION, (t.id >> 8) & 0xff, t.id & 0xff];

  for (const s of t.slots) {
    const raw = values[s.name];
    if (raw === undefined || raw === null) {
      throw new AnnounceError(`Announcement is missing a value for {${s.name}}`);
    }
    if (s.type === "text") {
      const bytes = new TextEncoder().encode(String(raw));
      if (bytes.length > 120) throw new AnnounceError(`Text slot "${s.name}" is limited to 120 bytes`);
      out.push(bytes.length, ...bytes);
      continue;
    }
    const spec = SLOT_TYPES[s.type];
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > spec.max) {
      throw new AnnounceError(
        `Value for {${s.name}} must be a whole number between 0 and ${spec.max} (${spec.label}); got ${raw}`);
    }
    if (spec.bytes === 2) out.push((n >> 8) & 0xff, n & 0xff);
    else out.push(n & 0xff);
  }
  return Uint8Array.from(out);
}

/** Is this message body an announcement? */
export const isAnnouncement = body => body?.length >= HEADER_BYTES && body[0] === ANNOUNCE_VERSION;

/**
 * Unpack an announcement against the templates the receiver has cached.
 * A template it has never seen is reported as such rather than guessed at.
 */
export function decodeAnnouncement(body, templates) {
  if (!isAnnouncement(body)) throw new AnnounceError("Not an announcement");
  const id = (body[1] << 8) | body[2];
  const template = templates instanceof Map ? templates.get(id) : templates?.[id];
  if (!template) {
    return { templateId: id, known: false, values: null,
             reason: `Template ${id} is not in this device's cached bundle` };
  }

  const values = {};
  let at = HEADER_BYTES;
  const need = n => {
    if (at + n > body.length) throw new AnnounceError(`Announcement is truncated inside {${lastName}}`);
  };
  let lastName = "";
  for (const s of template.slots) {
    lastName = s.name;
    if (s.type === "text") {
      need(1);
      const len = body[at++];
      need(len);
      values[s.name] = new TextDecoder("utf-8", { fatal: false }).decode(body.subarray(at, at + len));
      at += len;
      continue;
    }
    const spec = SLOT_TYPES[s.type];
    need(spec.bytes);
    values[s.name] = spec.bytes === 2 ? (body[at] << 8) | body[at + 1] : body[at];
    at += spec.bytes;
  }
  if (at !== body.length) throw new AnnounceError("Announcement has trailing bytes the template does not account for");
  return { templateId: id, known: true, template, values };
}

// ----------------------------------------------------------------- rendering
const pad2 = n => String(n).padStart(2, "0");

/** How a value reads in a sentence. Lists resolve locally; times format locally. */
export function formatValue(slot, value, { lists = {}, language = "en" } = {}) {
  if (slot.type === "item") {
    const list = lists[slot.list];
    const entry = Array.isArray(list) ? list[value] : list?.[value];
    if (entry === undefined || entry === null) return `#${value}`;
    if (typeof entry === "string") return entry;
    // A list entry may itself be translated.
    return entry[language] ?? entry.en ?? Object.values(entry)[0] ?? `#${value}`;
  }
  if (slot.type === "time") return `${pad2(Math.floor(value / 60))}:${pad2(value % 60)}`;
  return String(value);
}

/**
 * Render an announcement into one language. Falls back through the languages
 * the template does have rather than showing nothing.
 */
export function renderAnnouncement(decoded, { language = "en", lists = {}, fallback = ["en"] } = {}) {
  if (!decoded.known) return null;
  const { template, values } = decoded;
  const order = [language, ...fallback, ...Object.keys(template.text)];
  const lang = order.find(l => template.text[l]);
  if (!lang) return null;

  const bySlot = new Map(template.slots.map(s => [s.name, s]));
  const text = template.text[lang].replace(SLOT_RE, (whole, name) => {
    const slot = bySlot.get(name);
    if (!slot) return whole;
    return formatValue(slot, values[name], { lists, language: lang });
  });
  return {
    language: lang,
    requestedLanguage: language,
    text,
    severity: template.severity ?? "info",
    templateId: template.id,
    values,
  };
}

/** Render into every language the template carries — what an operator checks. */
export function renderAll(decoded, { lists = {} } = {}) {
  if (!decoded.known) return {};
  const out = {};
  for (const lang of Object.keys(decoded.template.text)) {
    out[lang] = renderAnnouncement(decoded, { language: lang, lists, fallback: [] })?.text ?? null;
  }
  return out;
}
