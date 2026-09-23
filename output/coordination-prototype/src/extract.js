/**
 * Deterministic extraction. Dates, quantities and places are parsed here, in
 * ordinary code, before anything reaches a model — because jev-1.13 reads dates
 * as text rather than as ordered quantities, does not count reliably, and is
 * weak on raw numbers. Anything the model would have to do arithmetic about is
 * resolved before it sees the state.
 */

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  janv: 1, febr: 2, mart: 3, apri: 4, maij: 5, juni: 6, juli: 7, augu: 8, sept: 9, okto: 10, nove: 11, dece: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};

const WEEKDAYS = {
  monday: 1, mon: 1, pirmdien: 1, понедельник: 1, пн: 1,
  tuesday: 2, tue: 2, otrdien: 2, вторник: 2, вт: 2,
  wednesday: 3, wed: 3, tresdien: 3, среда: 3, среду: 3, ср: 3,
  thursday: 4, thu: 4, ceturtdien: 4, четверг: 4, чт: 4,
  friday: 5, fri: 5, piektdien: 5, пятниц: 5, пт: 5,
  saturday: 6, sat: 6, sestdien: 6, суббот: 6, сб: 6,
  sunday: 0, sun: 0, svetdien: 0, воскресень: 0, вс: 0,
};

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
  viens: 1, divi: 2, tris: 3, cetri: 4, pieci: 5, sesi: 6, septini: 7, astoni: 8, devini: 9, desmit: 10,
  один: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
};

// Each alias is matched against the whole token after the number. Word
// boundaries are avoided on purpose: \b is ASCII-only in JavaScript, so it
// never fires next to Cyrillic, and "6 человек" would lose its unit.
const UNIT_ALIASES = [
  ['tonne', 't|tonn[\\p{L}\\p{N}]*|тонн[\\p{L}\\p{N}]*'],
  ['kg', 'kg|kilogram[\\p{L}\\p{N}]*|килограмм[\\p{L}\\p{N}]*'],
  ['km', 'km|kilomet[\\p{L}\\p{N}]*|километр[\\p{L}\\p{N}]*'],
  ['hour', 'h|hrs?|hours?|stund[\\p{L}\\p{N}]*|час[\\p{L}\\p{N}]*'],
  ['day', 'days?|dien[\\p{L}\\p{N}]*|dn[\\p{L}\\p{N}]*|дн[\\p{L}\\p{N}]*|сут[\\p{L}\\p{N}]*|дня|дней'],
  ['m3', 'm3|m\u00b3|cubic'],
  ['m2', 'm2|m\u00b2|kvadrat[\\p{L}\\p{N}]*'],
  ['EUR', 'eur|euros?|евро'],
  ['person', 'people|persons?|volunteers?|hands|cilvek[\\p{L}\\p{N}]*|brivpratig[\\p{L}\\p{N}]*|jauniesi[\\p{L}\\p{N}]*|человек[\\p{L}\\p{N}]*|людей|доброволь[\\p{L}\\p{N}]*'],
  ['place', 'places?|seats?|beds?|vietas?|мест[\\p{L}\\p{N}]*|коек'],
  ['unit', 'pcs?|pieces?|units?|gab[\\p{L}\\p{N}]*|шт[\\p{L}\\p{N}]*|штук[\\p{L}\\p{N}]*'],
];

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function iso(d) { return d.toISOString().slice(0, 10); }
function atTime(dateStr, h, m = 0) { return `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`; }

function nextWeekday(now, dow) {
  const d = new Date(now);
  const delta = (dow - d.getUTCDay() + 7) % 7;   // today counts: "Thursday and Friday" said on a Thursday means today
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

// --- quantities --------------------------------------------------------------

export function extractQuantities(text) {
  const t = norm(text);
  const out = [];
  // The unit is the word that follows the number, and it may end in a digit
  // ("m2", "m3"). Only that word is considered: scanning further ahead makes
  // "12 m2 of storage, 3 tonnes" read as twelve tonnes.
  const re = /(\d+(?:[.,]\d+)?)\s*([a-z\u0400-\u04FF]{1,12}[\u00b2\u00b30-9]?)?/gu;
  let m;
  while ((m = re.exec(t))) {
    const value = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(value)) continue;
    out.push({ value, unit: unitOf(m[2] ?? ''), raw: m[0].trim() });
  }
  // number words
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    const wre = new RegExp(`(?<![\\p{L}\\p{N}])${word}(?![\\p{L}\\p{N}])\\s*([a-z\\u0400-\\u04FF]{0,14})`, 'u');
    const wm = wre.exec(t);
    if (wm) out.push({ value, unit: unitOf(wm[1]), raw: wm[0].trim() });
  }
  // "€500" / "500€"
  const cur = /[\u20ac]\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*[\u20ac]/u.exec(t);
  if (cur) out.push({ value: parseFloat((cur[1] ?? cur[2]).replace(',', '.')), unit: 'EUR', raw: cur[0] });
  return dedupeQuantities(out);
}

const UNIT_RES = UNIT_ALIASES.map(([unit, pattern]) => [unit, new RegExp(`^(?:${pattern})$`, 'iu')]);

function unitOf(s) {
  const token = norm(s).trim().replace(/[.,;:)]+$/, '');
  if (!token) return null;
  for (const [unit, re] of UNIT_RES) if (re.test(token)) return unit;
  return null;
}

/** Which of the need's own units did this message actually name? */
export function statesUnit(quantities, unit) {
  return (quantities ?? []).some((q) => q.unit === unit);
}

function dedupeQuantities(list) {
  const seen = new Set();
  const out = [];
  for (const q of list) {
    const k = `${q.value}|${q.unit}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(q);
  }
  return out;
}

/** The best guess at "how much is being offered", given a unit the need wants. */
export function quantityFor(quantities, unit) {
  const exact = quantities.find((q) => q.unit === unit);
  if (exact) return exact.value;
  if (unit === 'person') {
    const p = quantities.find((q) => q.unit === null && q.value <= 50 && Number.isInteger(q.value));
    if (p) return p.value;
  }
  return null;
}

// --- dates and windows -------------------------------------------------------

/**
 * Returns { start, end, kind } where kind is one of:
 *   explicit  a date was stated
 *   relative  a weekday or "tomorrow" was stated and resolved against `now`
 *   none      the offer says nothing about when, which is itself information
 */
export function extractWindow(text, now = new Date()) {
  const t = norm(text);

  // 3.-5. oktobris | 3-5 October | October 3-5
  let m = /(\d{1,2})\s*[.\-–]+\s*(\d{1,2})\.?\s*([a-zЀ-ӿ]{3,10})/u.exec(t);
  if (m) {
    const mon = monthOf(m[3]);
    if (mon) return span(now, +m[1], mon, +m[2], mon, 'explicit');
  }
  m = /([a-zЀ-ӿ]{3,10})\s+(\d{1,2})\s*[-–]\s*(\d{1,2})/u.exec(t);
  if (m) {
    const mon = monthOf(m[1]);
    if (mon) return span(now, +m[2], mon, +m[3], mon, 'explicit');
  }
  // 12 October | October 12 | 12.10 | 12.10.2026
  m = /(?<![\p{L}\p{N}])(\d{1,2})[.\s]+([a-zЀ-ӿ]{3,10})(?![\p{L}\p{N}])/u.exec(t);
  if (m) {
    const mon = monthOf(m[2]);
    if (mon) return span(now, +m[1], mon, +m[1], mon, 'explicit');
  }
  m = /(?<![\p{L}\p{N}])([a-zЀ-ӿ]{3,10})\s+(\d{1,2})(?![\p{L}\p{N}])/u.exec(t);
  if (m) {
    const mon = monthOf(m[1]);
    if (mon) return span(now, +m[2], mon, +m[2], mon, 'explicit');
  }
  // 17.10. | 17.10.2026 | 17/10 — never a decimal quantity such as "7.5 t"
  m = /(?<![\p{L}\p{N}])(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)|(?<![\p{L}\p{N}])(\d{1,2})\/(\d{1,2})(?!\d)/u.exec(t);
  if (m) {
    const d = +(m[1] ?? m[4]), mon = +(m[2] ?? m[5]);
    if (mon >= 1 && mon <= 12 && d <= 31) return span(now, d, mon, d, mon, 'explicit', m[3] ? +m[3] : null);
  }

  // weekend
  if (/(?<![\p{L}\p{N}])(weekend|nedelas nogal|выходн)/u.test(t)) {
    const sat = nextWeekday(now, 6);
    const sun = new Date(sat); sun.setUTCDate(sun.getUTCDate() + 1);
    return { start: atTime(iso(sat), 8), end: atTime(iso(sun), 20), kind: 'relative', dows: [6, 0] };
  }
  // tomorrow / today
  if (/(?<![\p{L}\p{N}])(tomorrow|rit(?![\p{L}\p{N}])|ritdien|завтра)/u.test(t)) {
    const d = new Date(now); d.setUTCDate(d.getUTCDate() + 1);
    return { start: atTime(iso(d), 8), end: atTime(iso(d), 20), kind: 'relative' };
  }
  if (/(?<![\p{L}\p{N}])(today|sodien|сегодня)/u.test(t)) {
    return { start: atTime(iso(now), 8), end: atTime(iso(now), 20), kind: 'relative' };
  }
  // weekday, possibly two ("Thursday and Friday")
  const days = new Set();
  for (const [word, dow] of Object.entries(WEEKDAYS)) {
    // Unicode-safe word start: \b is ASCII-only, so it never fires before
    // "субботу" and every Russian weekday quietly went unrecognised.
    if (new RegExp(`(?<![\\p{L}\\p{N}])${word}`, 'u').test(t)) days.add(dow);
  }
  if (days.size) {
    const dows = [...days].sort((a, b) => a - b);
    const dates = dows.map((d) => nextWeekday(now, d)).sort((a, b) => a - b);
    return {
      start: atTime(iso(dates[0]), hourOf(t, 8)),
      end: atTime(iso(dates[dates.length - 1]), hourOf(t, 20, true)),
      kind: 'relative',
      dows,
    };
  }
  return { start: null, end: null, kind: 'none' };
}

function hourOf(t, fallback, end = false) {
  const m = end
    ? /(?<![\p{L}\p{N}])(?:until|till|to|lidz|до)\s*(\d{1,2})(?::(\d{2}))?/u.exec(t)
    : /(?<![\p{L}\p{N}])(?:from|no|с|at)\s*(\d{1,2})(?::(\d{2}))?/u.exec(t);
  if (m) {
    const h = +m[1];
    if (h >= 0 && h <= 23) return h;
  }
  return fallback;
}

function monthOf(word) {
  const w = norm(word).slice(0, 4);
  for (const [k, v] of Object.entries(MONTHS)) {
    if (w.startsWith(k.slice(0, 3))) return v;
  }
  return null;
}

function span(now, d1, m1, d2, m2, kind, year = null) {
  const y = year ?? now.getUTCFullYear();
  const start = new Date(Date.UTC(y, m1 - 1, d1, 8));
  let end = new Date(Date.UTC(y, m2 - 1, d2, 20));
  // a date already past by more than a month is next year's
  if (!year && start.getTime() < now.getTime() - 31 * 864e5) {
    start.setUTCFullYear(y + 1); end.setUTCFullYear(y + 1);
  }
  if (end < start) end = new Date(start.getTime() + 12 * 3600e3);
  return { start: start.toISOString(), end: end.toISOString(), kind };
}

// --- places ------------------------------------------------------------------

/**
 * No geocoding service. The scenario supplies a gazetteer, which is what a real
 * deployment has anyway: a municipality knows its own place names.
 */
export function extractPlaces(text, gazetteer = []) {
  const t = norm(text);
  const hits = [];
  for (const g of gazetteer) {
    for (const name of [g.name, ...(g.aliases ?? [])]) {
      if (t.includes(norm(name))) { hits.push(g); break; }
    }
  }
  return hits;
}

export function extractRadius(text) {
  const m = /(\d{1,3})\s*km/u.exec(norm(text));
  return m ? +m[1] : null;
}

// --- one call ----------------------------------------------------------------

export function extract(text, { now = new Date(), gazetteer = [] } = {}) {
  const quantities = extractQuantities(text);
  const window = extractWindow(text, now);
  const places = extractPlaces(text, gazetteer);
  return {
    quantities,
    window,
    places: places.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon })),
    radius_km: extractRadius(text),
    has_question_mark: /\?/.test(text),
    length: text.length,
  };
}

/**
 * Reconcile a relative window against the initiative it was written to.
 *
 * "Saturday" written three weeks before the event means the event's Saturday,
 * not the one coming up. The parser cannot know that; the initiative's window
 * can. So a weekday that resolves outside the initiative window is re-resolved
 * to the first matching weekday inside it, and a relative window that still
 * lands outside is demoted to "no time stated" rather than being used to throw
 * away every candidate need.
 *
 * Explicit dates are never touched. If somebody writes 12 October, they mean it.
 */
export function reconcileWindow(window, initiative, now = new Date()) {
  if (!window || window.kind !== 'relative') return window;
  const iStart = initiative?.window_start ? Date.parse(initiative.window_start) : null;
  const iEnd = initiative?.window_end ? Date.parse(initiative.window_end) : null;
  if (iStart === null && iEnd === null) return window;

  const overlaps = (s, e) =>
    (iEnd === null || Date.parse(s) <= iEnd) && (iStart === null || Date.parse(e) >= iStart);

  if (overlaps(window.start, window.end)) return window;

  // A weekday is a recurring answer, not a date. Somebody writing "Saturday"
  // three weeks before a month-long initiative means one of its Saturdays, and
  // which one is a question for the reply, not for the filter. So the span runs
  // from the first matching weekday to the last, and `dows` is carried so the
  // filter can drop needs that fall on no matching day at all.
  if (window.dows?.length && iStart !== null) {
    const from = new Date(Math.max(iStart, now.getTime()));
    const until = new Date(iEnd ?? (from.getTime() + 60 * 864e5));
    const first = window.dows.map((d) => firstWeekdayOnOrAfter(from, d)).sort((a, b) => a - b)[0];
    const last = window.dows.map((d) => lastWeekdayOnOrBefore(until, d)).sort((a, b) => b - a)[0];
    if (first && last && first <= last) {
      return { ...window, start: atTime(iso(first), 0), end: atTime(iso(last), 23, 59), kind: 'relative-recurring' };
    }
  }
  return { start: null, end: null, kind: 'none', demoted_from: window.kind };
}

function lastWeekdayOnOrBefore(from, dow) {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - dow + 7) % 7));
  return d;
}

/**
 * Does this need's window contain any day the offer actually named? Ranges
 * overlap far too easily once a weekday has been spread across a month, and
 * this is arithmetic, so it belongs in code rather than anywhere near a model.
 */
export function windowHasWeekday(startIso, endIso, dows) {
  if (!dows?.length) return true;
  if (!startIso) return true;
  const start = new Date(startIso);
  const end = new Date(endIso ?? startIso);
  start.setUTCHours(0, 0, 0, 0);
  const want = new Set(dows);
  for (let d = new Date(start), i = 0; d <= end && i < 400; d.setUTCDate(d.getUTCDate() + 1), i++) {
    if (want.has(d.getUTCDay())) return true;
  }
  return false;
}

function firstWeekdayOnOrAfter(from, dow) {
  const d = new Date(from);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((dow - d.getUTCDay() + 7) % 7));
  return d;
}
