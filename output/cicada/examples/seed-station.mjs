/* Set up a station channel: templates, destinations, and a signing key.
 *
 *   CICADA_KEY=ck_live_… node --disable-warning=ExperimentalWarning examples/seed-station.mjs
 *
 * The templates below are the announcements a real concourse makes, in the four
 * languages a Baltic station actually serves. Adding the fourth language costs
 * nothing on the air: the text is synced to phones over their own network, and
 * the broadcast carries only a template number and its values.
 */

const ORIGIN = process.env.CICADA_ORIGIN ?? "http://localhost:4137";
const KEY = process.env.CICADA_KEY;
if (!KEY) {
  console.error("Set CICADA_KEY. The server prints one on its first start.");
  process.exit(1);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json?.error?.message ?? "failed"}`);
  return json;
}

// ---------------------------------------------------------------- the station
const DESTINATIONS = [
  { lv: "Rīga",        en: "Riga",        ru: "Рига",        uk: "Рига" },
  { lv: "Jelgava",     en: "Jelgava",     ru: "Елгава",      uk: "Єлгава" },
  { lv: "Daugavpils",  en: "Daugavpils",  ru: "Даугавпилс",  uk: "Даугавпілс" },
  { lv: "Liepāja",     en: "Liepaja",     ru: "Лиепая",      uk: "Лієпая" },
  { lv: "Valmiera",    en: "Valmiera",    ru: "Валмиера",    uk: "Валмієра" },
  { lv: "Rēzekne",     en: "Rezekne",     ru: "Резекне",     uk: "Резекне" },
  { lv: "Tukums",      en: "Tukums",      ru: "Тукумс",      uk: "Тукумс" },
  { lv: "Sigulda",     en: "Sigulda",     ru: "Сигулда",     uk: "Сігулда" },
];

const REASONS = [
  { lv: "pārmiju atteices dēļ",       en: "due to a points failure",      ru: "из-за отказа стрелки",        uk: "через відмову стрілки" },
  { lv: "vilciena novēlotas pienākšanas dēļ", en: "due to a late arrival", ru: "из-за позднего прибытия",    uk: "через пізнє прибуття" },
  { lv: "tehnisku iemeslu dēļ",       en: "for technical reasons",        ru: "по техническим причинам",     uk: "з технічних причин" },
  { lv: "laika apstākļu dēļ",         en: "due to weather conditions",    ru: "из-за погодных условий",      uk: "через погодні умови" },
  { lv: "ceļa remontdarbu dēļ",       en: "due to track works",           ru: "из-за ремонта пути",          uk: "через ремонт колії" },
];

const TEMPLATES = [
  {
    id: 1, severity: "change", label: "Platform change",
    slots: [
      { name: "service", type: "u16" },
      { name: "destination", type: "item", list: "destinations" },
      { name: "platform", type: "u8" },
      { name: "wasPlatform", type: "u8" },
      { name: "reason", type: "item", list: "reasons" },
    ],
    text: {
      lv: "Vilciens {service} uz {destination} atiet no {platform}. perona, nevis no {wasPlatform}. perona {reason}.",
      en: "Train {service} to {destination} now departs from platform {platform}, not platform {wasPlatform}, {reason}.",
      ru: "Поезд {service} до {destination} отправляется с платформы {platform}, а не с платформы {wasPlatform}, {reason}.",
      uk: "Потяг {service} до {destination} відправляється з платформи {platform}, а не з платформи {wasPlatform}, {reason}.",
    },
  },
  {
    id: 2, severity: "disruption", label: "Delay",
    slots: [
      { name: "service", type: "u16" },
      { name: "destination", type: "item", list: "destinations" },
      { name: "delay", type: "minutes" },
      { name: "reason", type: "item", list: "reasons" },
    ],
    text: {
      lv: "Vilciens {service} uz {destination} kavējas par {delay} minūtēm {reason}.",
      en: "Train {service} to {destination} is delayed by {delay} minutes, {reason}.",
      ru: "Поезд {service} до {destination} задерживается на {delay} минут, {reason}.",
      uk: "Потяг {service} до {destination} затримується на {delay} хвилин, {reason}.",
    },
  },
  {
    id: 3, severity: "disruption", label: "Cancellation",
    slots: [
      { name: "service", type: "u16" },
      { name: "destination", type: "item", list: "destinations" },
      { name: "departure", type: "time" },
      { name: "reason", type: "item", list: "reasons" },
    ],
    text: {
      lv: "Vilciens {service} uz {destination} plkst. {departure} ir atcelts {reason}.",
      en: "The {departure} train {service} to {destination} is cancelled, {reason}.",
      ru: "Поезд {service} до {destination} в {departure} отменён, {reason}.",
      uk: "Потяг {service} до {destination} о {departure} скасовано, {reason}.",
    },
  },
  {
    id: 4, severity: "info", label: "Boarding",
    slots: [
      { name: "service", type: "u16" },
      { name: "destination", type: "item", list: "destinations" },
      { name: "platform", type: "u8" },
      { name: "departure", type: "time" },
    ],
    text: {
      lv: "Vilciens {service} uz {destination} plkst. {departure} gaida uz {platform}. perona. Lūdzu, kāpiet vagonos.",
      en: "Train {service} to {destination}, departing {departure}, is boarding at platform {platform}.",
      ru: "Поезд {service} до {destination}, отправление в {departure}, посадка на платформе {platform}.",
      uk: "Потяг {service} до {destination}, відправлення о {departure}, посадка на платформі {platform}.",
    },
  },
  {
    id: 5, severity: "info", label: "Lift or escalator out of service",
    slots: [
      { name: "platform", type: "u8" },
      { name: "backAt", type: "time" },
    ],
    text: {
      lv: "Lifts uz {platform}. peronu nedarbojas. Paredzams, ka tas darbosies no plkst. {backAt}. Palīdzību lūdziet stacijas personālam.",
      en: "The lift to platform {platform} is out of service, expected back at {backAt}. Station staff can assist.",
      ru: "Лифт на платформу {platform} не работает, ожидается в {backAt}. Персонал станции окажет помощь.",
      uk: "Ліфт на платформу {platform} не працює, очікується о {backAt}. Персонал станції допоможе.",
    },
  },
  {
    id: 6, severity: "disruption", label: "Replacement bus",
    slots: [
      { name: "destination", type: "item", list: "destinations" },
      { name: "stand", type: "u8" },
      { name: "reason", type: "item", list: "reasons" },
    ],
    text: {
      lv: "Uz {destination} kursē autobuss {reason}. Autobuss atiet no {stand}. platformas pie stacijas.",
      en: "Services to {destination} are replaced by bus, {reason}. Buses leave from stand {stand} outside the station.",
      ru: "До {destination} организован автобус, {reason}. Автобусы отправляются от платформы {stand} у вокзала.",
      uk: "До {destination} курсує автобус, {reason}. Автобуси відправляються з платформи {stand} біля вокзалу.",
    },
  },
  {
    id: 9, severity: "emergency", label: "Evacuation",
    slots: [{ name: "exit", type: "item", list: "exits" }],
    text: {
      lv: "UZMANĪBU. Lūdzu, nekavējoties atstājiet staciju. Izmantojiet {exit}. Neizmantojiet liftus.",
      en: "ATTENTION. Leave the station immediately. Use {exit}. Do not use the lifts.",
      ru: "ВНИМАНИЕ. Немедленно покиньте вокзал. Используйте {exit}. Не пользуйтесь лифтами.",
      uk: "УВАГА. Негайно залиште вокзал. Використовуйте {exit}. Не користуйтеся ліфтами.",
    },
  },
];

const EXITS = [
  { lv: "galveno izeju", en: "the main exit", ru: "главный выход", uk: "головний вихід" },
  { lv: "ziemeļu izeju", en: "the north exit", ru: "северный выход", uk: "північний вихід" },
  { lv: "dienvidu izeju", en: "the south exit", ru: "южный выход", uk: "південний вихід" },
];

// ------------------------------------------------------------------ seed it
const NAME = process.env.CICADA_STATION ?? "Rīga Central — concourse";

const existing = (await api("/v1/channels")).channels.find(c => c.name === NAME);
const channel = existing ?? await api("/v1/channels", {
  method: "POST", body: { name: NAME, signed: true },
});
console.log(`${existing ? "Reusing" : "Created"} channel ${channel.id} (number ${channel.number}), signed=${channel.signed}`);

for (const [name, entries] of [["destinations", DESTINATIONS], ["reasons", REASONS], ["exits", EXITS]]) {
  await api(`/v1/channels/${channel.id}/lists`, { method: "POST", body: { name, entries } });
  console.log(`  list ${name.padEnd(13)} ${entries.length} entries`);
}

console.log("");
for (const t of TEMPLATES) {
  const saved = await api(`/v1/channels/${channel.id}/templates`, { method: "POST", body: t });
  console.log(`  template ${String(saved.id).padStart(2)} ${saved.label.padEnd(30)}`
    + `${saved.languages.length} languages · ${saved.air_bytes} B on the air`);
}

// ------------------------------------------------- what it costs to broadcast
console.log("\nA platform change, priced:");
const preview = await api("/v1/announcements/preview", {
  method: "POST",
  body: {
    channel: channel.id, template: 1, repeats: 2,
    values: { service: 2041, destination: 2, platform: 11, wasPlatform: 4, reason: 0 },
  },
});
console.log(`  ${preview.air_bytes} bytes of announcement`
  + `${preview.signed ? `, ${preview.body_bytes} signed` : ""}`
  + `  ->  ${preview.estimate.profile} profile, ${preview.estimate.seconds}s for two passes\n`);
for (const [lang, text] of Object.entries(preview.rendered)) {
  console.log(`  ${lang}  ${text}`);
}

const spoken = Object.values(preview.rendered)[0].length / 14;   // ~14 chars per second of speech
console.log(`\n  Spoken aloud in one language that is roughly ${spoken.toFixed(0)} seconds.`);
console.log(`  As data in ${Object.keys(preview.rendered).length} languages it is ${preview.estimate.seconds} seconds,`);
console.log("  and it stays that length however many languages you add.");

console.log(`\nOperator desk   ${ORIGIN}/announce`);
console.log(`Passenger page  ${ORIGIN}/listen?channel=${channel.id}&token=${channel.receive_token}`);
