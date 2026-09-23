/**
 * Every automated message says it is automated and gives one way to reach a
 * person. People forgive a machine that says so and do not forgive one that
 * pretended.
 *
 * Replies are templates in ordinary code, not generated text. The judgment
 * model does not generate, and we would not want it to: a reply that is wrong
 * about what someone committed to is worse than no reply.
 */
const T = {
  en: {
    auto: (contact) => `— sent automatically. A person reads ${contact} if you reply there.`,
    bound: (n, qty, unit, when, where, link) =>
      `Thank you — you are down for ${qty} ${unit} towards: ${n}.\n${when}${where}\nConfirm or withdraw in one tap: ${link}`,
    proposed: (n, qty, unit, when, where, link) =>
      `We can put you down for ${qty} ${unit} towards: ${n}.\n${when}${where}\nIt is not booked until you confirm: ${link}`,
    queued: () => `Thank you. A coordinator is looking at your message and will come back to you.`,
    ask_quantity: (n) => `Thank you. How much can you bring, and on which day? (Open right now: ${n})`,
    ask_which: (list) => `Thank you. Which of these fits best?\n${list}\nReply with the number.`,
    not_offer: () => `Thank you for writing. We could not find an offer or a question in this message.`,
    screened: () => `Thank you. This message has been set aside for a person to look at.`,
    answered: (fact) => fact,
    full: (alt) => `Thank you — that one is already covered. Still open and closest to what you offered: ${alt}`,
    no_match: (list) => `Thank you. Nothing open matches that exactly. Still open:\n${list}`,
    needs_credential: (n, code) =>
      `Thank you. "${n}" needs a verified ${code} before anyone can be booked onto it. A coordinator will contact you to check it.`,
    nothing_to_withdraw: () => `Noted — we had nothing down for you, so there was nothing to release. Thank you for telling us anyway.`,
    withdrawn: (n) => `Withdrawn. You are no longer down for: ${n}. Thank you for telling us in time.`,
    ask_outbound: (n, when, link) => `You told us before what you can do. Still open: ${n}. ${when}\nTake it in one tap: ${link}`,
  },
  lv: {
    auto: (contact) => `— nosūtīts automātiski. Uz ${contact} atbild cilvēks.`,
    bound: (n, qty, unit, when, where, link) =>
      `Paldies — esat pieteikts: ${qty} ${unit} uz ${n}.\n${when}${where}\nApstiprināt vai atsaukt ar vienu pieskārienu: ${link}`,
    proposed: (n, qty, unit, when, where, link) =>
      `Varam jūs pieteikt: ${qty} ${unit} uz ${n}.\n${when}${where}\nTas nav rezervēts, kamēr neapstiprināt: ${link}`,
    queued: () => `Paldies. Koordinators apskata jūsu ziņu un atbildēs.`,
    ask_quantity: (n) => `Paldies. Cik daudz varat un kurā dienā? (Šobrīd atvērts: ${n})`,
    ask_which: (list) => `Paldies. Kurš no šiem der vislabāk?\n${list}\nAtbildiet ar numuru.`,
    not_offer: () => `Paldies par ziņu. Tajā neatradām ne piedāvājumu, ne jautājumu.`,
    screened: () => `Paldies. Šī ziņa ir nodota cilvēkam izskatīšanai.`,
    answered: (fact) => fact,
    full: (alt) => `Paldies — tas jau ir nosegts. Vēl atvērts un tuvākais tam, ko piedāvājat: ${alt}`,
    no_match: (list) => `Paldies. Nekas atvērtais precīzi neatbilst. Vēl atvērts:\n${list}`,
    needs_credential: (n, code) =>
      `Paldies. "${n}" prasa apstiprinātu ${code}, pirms kādu var pieteikt. Koordinators sazināsies, lai to pārbaudītu.`,
    nothing_to_withdraw: () => `Pieņemts — jums nekas nebija pieteikts, tāpēc nekas nav jāatceļ. Paldies, ka pateicāt.`,
    withdrawn: (n) => `Atsaukts. Jūs vairs neesat pieteikts: ${n}. Paldies, ka pateicāt laikus.`,
    ask_outbound: (n, when, link) => `Jūs iepriekš norādījāt, ko varat. Vēl atvērts: ${n}. ${when}\nUzņemties ar vienu pieskārienu: ${link}`,
  },
  ru: {
    auto: (contact) => `— отправлено автоматически. На ${contact} отвечает человек.`,
    bound: (n, qty, unit, when, where, link) =>
      `Спасибо — вы записаны: ${qty} ${unit} на ${n}.\n${when}${where}\nПодтвердить или отменить в одно касание: ${link}`,
    proposed: (n, qty, unit, when, where, link) =>
      `Можем записать вас: ${qty} ${unit} на ${n}.\n${when}${where}\nЭто не бронь, пока вы не подтвердите: ${link}`,
    queued: () => `Спасибо. Координатор смотрит ваше сообщение и ответит.`,
    ask_quantity: (n) => `Спасибо. Сколько вы можете и в какой день? (Сейчас открыто: ${n})`,
    ask_which: (list) => `Спасибо. Что подходит лучше?\n${list}\nОтветьте номером.`,
    not_offer: () => `Спасибо за сообщение. Мы не нашли в нём ни предложения, ни вопроса.`,
    screened: () => `Спасибо. Это сообщение передано человеку на рассмотрение.`,
    answered: (fact) => fact,
    full: (alt) => `Спасибо — это уже закрыто. Ещё открыто и ближе всего к вашему предложению: ${alt}`,
    no_match: (list) => `Спасибо. Ничего открытого точно не подходит. Ещё открыто:\n${list}`,
    needs_credential: (n, code) =>
      `Спасибо. Для "${n}" нужен подтверждённый ${code}, прежде чем кого-то записывать. Координатор свяжется с вами.`,
    nothing_to_withdraw: () => `Принято — за вами ничего не было записано, отменять нечего. Спасибо, что сообщили.`,
    withdrawn: (n) => `Отменено. Вы больше не записаны: ${n}. Спасибо, что сообщили заранее.`,
    ask_outbound: (n, when, link) => `Вы раньше указали, что можете. Ещё открыто: ${n}. ${when}\nВзять в одно касание: ${link}`,
  },
};

export function t(language, key, ...args) {
  const pack = T[language] ?? T.en;
  const fn = pack[key] ?? T.en[key];
  return fn(...args);
}

/** Compose the body plus the disclosure line that must never be omitted. */
export function compose(language, key, cfg, ...args) {
  return `${t(language, key, ...args)}\n\n${t(language, 'auto', cfg.human_contact)}`;
}

export function whenLine(language, need) {
  if (!need.window_start) return '';
  const s = need.window_start.slice(0, 16).replace('T', ' ');
  const e = need.window_end ? need.window_end.slice(11, 16) : '';
  const label = { en: 'When', lv: 'Kad', ru: 'Когда' }[language] ?? 'When';
  return `${label}: ${s}${e ? '–' + e : ''}\n`;
}

export function whereLine(language, need) {
  if (!need.geo_place) return '';
  const label = { en: 'Where', lv: 'Kur', ru: 'Где' }[language] ?? 'Where';
  return `${label}: ${need.geo_place}\n`;
}
