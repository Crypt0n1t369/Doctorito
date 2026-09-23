/**
 * Language matters more than anyone budgets for. An initiative in Latvia
 * carries Latvian, Russian and English in one inbox and accuracy is not the
 * same across them, so every judgment is tagged with the language it ran on
 * and the harness reports per language.
 */

const CYRILLIC = /[Ѐ-ӿ]/;
const LV_DIACRITIC = /[āčēģīķļņšūž]/i;

const LV_WORDS = ['un', 'ar', 'var', 'varu', 'varam', 'ir', 'no', 'uz', 'līdz', 'piedāvāju', 'esmu', 'mums', 'jums', 'kas', 'tas', 'lai', 'bet', 'pie', 'par'];
const EN_WORDS = ['the', 'and', 'can', 'i', 'we', 'have', 'to', 'for', 'with', 'my', 'you', 'is', 'of', 'a'];

export function detectLanguage(text) {
  const t = (text || '').toLowerCase();
  if (CYRILLIC.test(t)) return 'ru';
  if (LV_DIACRITIC.test(t)) return 'lv';
  const words = t.split(/\W+/).filter(Boolean);
  const lv = words.filter((w) => LV_WORDS.includes(w)).length;
  const en = words.filter((w) => EN_WORDS.includes(w)).length;
  if (lv > en) return 'lv';
  return 'en';
}

export const STOPWORDS = new Set([
  ...EN_WORDS, 'in', 'on', 'at', 'it', 'be', 'are', 'am', 'this', 'that', 'will', 'would',
  'could', 'should', 'please', 'hi', 'hello', 'thanks', 'if', 'or', 'but', 'so', 'me', 'us',
  'our', 'your', 'from', 'by', 'as', 'an', 'any', 'all', 'some', 'not', 'no', 'do', 'does',
  ...LV_WORDS, 'labdien', 'sveiki', 'paldies', 'ja', 'arī', 'vai', 'man', 'mans', 'mūsu',
  'здравствуйте', 'привет', 'спасибо', 'и', 'в', 'на', 'с', 'до', 'от', 'я', 'мы', 'у',
  'для', 'что', 'это', 'но', 'или', 'могу', 'можем', 'есть',
]);

/** Crude but deterministic normalisation. No stemmer, no model, no network. */
export function tokens(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9Ѐ-ӿ]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Fold a token to a short stem so "trucks", "truck", "trucking" meet. */
export function stem(w) {
  return w
    .replace(/(iem|ām|ās|os|us|is|es|as|ai|ei)$/u, '')
    .replace(/(ами|ами|ов|ам|ах|ые|ый|ая|ое|ии|ия)$/u, '')
    .replace(/(ing|ers|er|ed|es|s)$/u, '')
    .slice(0, 8);
}

export function stems(text) {
  return tokens(text).map(stem);
}

/**
 * Cross-language concept lexicon. This is the one place where domain knowledge
 * lives in the fallback engine, and it is deliberately small and legible:
 * a concept is a bag of surface forms in the three languages we run.
 */
export const CONCEPTS = {
  labour: ['volunteer', 'help', 'hands', 'people', 'person', 'work', 'shift', 'crew', 'staff',
    'brigad', 'brivpratig', 'palidz', 'cilvek', 'stradat', 'stunda', 'komanda',
    'доброволь', 'помощ', 'человек', 'работ', 'смен', 'бригад', 'рук',
    'hands', 'manpower', 'sort', 'bag', 'clear', 'clean', 'plant', 'paint', 'carry', 'supervis', 'steward', 'marshal', 'shift', 'overnight', 'talk', 'kart', 'tirit', 'vakt', 'dezur', 'sirot', 'убрать', 'убор', 'сортир', 'дежур', 'смен', 'разбор'
  ,
    // Turning up in person is an offer of labour, and it is how most people
    // phrase it: they do not say "volunteer", they say how many are coming.
    'come', 'coming', 'attend', 'join', 'turn up', 'show up', 'two of us', 'three of us',
    'four of us', 'few of us', 'busim', 'atnaksim', 'ieradisimies', 'nakam', 'cilvek*',
    'trose', 'dvoe', 'троe', 'трое', 'двое', 'четверо', 'пятеро', 'придем', 'придём',
    'приду', 'приедем', 'волонтер', 'помощник'
  ],
  transport: ['truck', 'van', 'lorry', 'trailer', 'flatbed', 'drive', 'driver', 'transport',
    'haul', 'tonne', 'ton', 'bus', 'kravas', 'auto', 'mikroautobus', 'piekab', 'vest', 'sofer',
    'грузов', 'машин', 'фургон', 'водител', 'перевоз', 'прицеп', 'тонн', 'автобус',
    '4x4', 'pickup', 'haul', 'tow', 'deliver', 'collect', 'load', 'trip', 'run', 'aizvest', 'atvest', 'parvadat', 'kravas', 'piegad', 'довез', 'отвез', 'подвез', 'доставк', 'рейс'
  ],
  equipment: ['equipment', 'tool', 'generator', 'pump', 'chainsaw', 'saw', 'ladder', 'gloves',
    'boots', 'bags', 'container', 'skip', 'drone', 'radio', 'iekart', 'instrument', 'generator',
    'sukn', 'motorzag', 'kapnes', 'cimd', 'maisi', 'konteiner',
    'оборудован', 'инструмент', 'генератор', 'насос', 'бензопил', 'лестниц', 'перчатк', 'мешк', 'контейнер',
    'chainsaw', 'saw', 'fell', 'felling', 'limb', 'strimmer', 'brushcutter', 'wheelbarrow', 'trailer', 'genset', 'terminal', 'starlink', 'heater', 'light', 'rake', 'spade', 'shovel', 'zagt', 'gaz*', 'ratin', 'lukturi', 'grabek', 'lapsta', 'apsild', 'пил', 'спил', 'валк', 'тачк', 'грабл', 'лопат', 'обогрев', 'фонар'
  ],
  materials: ['material', 'timber', 'sand', 'gravel', 'paint', 'cable', 'pipe', 'seedling',
    'plant', 'food', 'water', 'blanket', 'materiali', 'kokmateriali', 'smilt', 'krasa', 'kabel',
    'caurul', 'stadi', 'partika', 'udens', 'sega',
    'материал', 'древесин', 'песок', 'краск', 'кабел', 'труб', 'саженц', 'еда', 'вода', 'одеял',
    'bulbs', 'tree', 'trees', 'branch', 'waste', 'litter', 'rubbish', 'debris', 'soil', 'compost', 'fuel', 'diesel', 'petrol', 'meal', 'coffee', 'tea', 'bedding', 'koks', 'zar*', 'atkritum', 'gruz', 'auglig', 'degviel', 'dizel', 'edien', 'kafij', 'дерев', 'ветк', 'мусор', 'отход', 'топлив', 'дизел', 'бензин', 'питан', 'кофе'
  ],
  space: ['space', 'venue', 'hall', 'room', 'shelter', 'storage', 'yard', 'parking', 'site',
    'telp', 'zale', 'novietn', 'noliktav', 'pagalm', 'vieta', 'patversm',
    'помещен', 'зал', 'комнат', 'склад', 'двор', 'парковк', 'убежищ', 'мест',
    'bridge', 'footbridge', 'bank', 'riverbank', 'path', 'point', 'depot', 'gym', 'canteen', 'pilot site', 'premises', 'tilt', 'krast', 'taka', 'punkt', 'noliktav', 'zale', 'telp', 'мост', 'берег', 'тропин', 'пункт', 'площадк', 'помещ'
  ],
  expertise: ['expert', 'engineer', 'lawyer', 'accountant', 'translator', 'interpreter', 'nurse',
    'doctor', 'surveyor', 'architect', 'audit', 'advice', 'eksperts', 'inzenier', 'jurist',
    'gramatved', 'tulk', 'mediķ', 'arhitekt', 'konsult',
    'эксперт', 'инженер', 'юрист', 'бухгалтер', 'переводчик', 'медсестр', 'врач', 'архитектор', 'консультац',
    'assessment', 'dpo', 'gdpr', 'workpackage', 'work package', 'lead', 'coordinator', 'review', 'proofread', 'edit', 'statist', 'model', 'certif', 'qualified', 'licensed', 'novertej', 'vaditaj', 'recenz', 'kvalific', 'sertific', 'оценк', 'руководител', 'реценз', 'квалифиц', 'сертифиц'
  ],
  money: ['eur', 'euro', 'money', 'fund', 'sponsor', 'donate', 'donation', 'budget', 'cofund',
    'cofinanc', 'nauda', 'ziedo', 'finanse', 'budzet', 'sponsor',
    'евро', 'деньг', 'пожертв', 'финанс', 'бюджет', 'спонсор',
    'cofinanc', 'co-financ', 'match', 'contribut', 'underwrite', 'cover the cost', 'invoice', 'lidzfinanse', 'segt izmaksas', 'iemaksa', 'rekin', 'софинанс', 'покрыть расход', 'взнос', 'счет'
  ],
  permission: ['permit', 'permission', 'licence', 'license', 'approval', 'letter', 'support',
    'endorse', 'atlauj', 'licenc', 'saskanoj', 'vestul', 'atbalst',
    'разрешен', 'лиценз', 'согласован', 'письм', 'поддержк',
    'letter of support', 'endorsement', 'sign off', 'signoff', 'authoris', 'authoriz', 'consent', 'mou', 'declaration', 'atbalsta vestul', 'pilnvar', 'piekris', 'deklarac', 'письмо поддержк', 'полномоч', 'согласи', 'деклараци'
  ],
};

/**
 * Which concepts does this text touch?
 *
 * An entry of four characters or more, or one written with a trailing `*`, is a
 * stem and matches at a word start, so "cimd" finds "cimdi". A shorter entry
 * has to be the whole word, because otherwise "bus" finds the Latvian "būsim"
 * and "tow" finds "towards" — and two needs that share a phantom concept score
 * identically, which is a wrong bind waiting to happen.
 */
const CONCEPT_RES = Object.fromEntries(
  Object.entries(CONCEPTS).map(([concept, forms]) => [
    concept,
    forms.map((f) => {
      const star = f.endsWith('*');
      const stem = star ? f.slice(0, -1) : f;
      const body = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return star || stem.length >= 4
        ? new RegExp(`(?<![\\p{L}\\p{N}])${body}`, 'iu')
        : new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'iu');
    }),
  ]),
);

export function conceptsOf(text) {
  const t = (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const out = new Set();
  for (const [concept, res] of Object.entries(CONCEPT_RES)) {
    for (const re of res) {
      if (re.test(t)) { out.add(concept); break; }
    }
  }
  return out;
}
