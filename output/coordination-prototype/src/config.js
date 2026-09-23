/**
 * Thresholds are configuration, per risk class, per initiative. They are not
 * constants in the code, because the only way to find the right ones is to
 * measure calibration on your own data and move them.
 */
export const DEFAULT_CONFIG = {
  // 'typesafe' | 'rules'. The fallback is the default on purpose: the prototype
  // has to run, and be measurable, with no key and no network. A scenario's own
  // config overrides this, and JUDGMENT_ENGINE overrides the default for a run.
  engine: process.env.JUDGMENT_ENGINE ?? 'rules',
  model: process.env.TYPESAFE_MODEL ?? 'jev-latest',

  // Processing with a hosted provider is its own permission, separate from
  // reading (docs/OUTCOMES.md, C1 and D4). Off unless the initiative's owner
  // turns it on; with it off, a hosted engine does not run and the rules engine
  // answers as a degraded fallback that can triage but never bind. The
  // operator's JUDGMENT_ENGINE switch chooses an engine; it cannot grant this.
  hosted_processing: false,

  // Risk class -> auto-bind threshold. Class 3 is absent on purpose: there is
  // no number you can put here that would let a class 3 need bind itself.
  thresholds: {
    1: 0.90,
    2: 0.97,
  },
  escalate_floor: 0.50,             // below this: ask one clarifying question
  gate_is_offer: 0.50,              // below this it is not an offer at all
  gate_adversarial: 0.50,           // at or above this the text is treated as an attack
  gate_withdrawal: 0.60,            // at or above this the message is taking something back
  fits_floor: 0.30,                 // a shortlist candidate below this is not a candidate
  vague_below: 1.00,                // specificity under this means the offer is vague, not unwanted

  shortlist_size: 3,
  short_desc_chars: 60,

  lease_minutes: 120,               // unconfirmed leases expire and the quantity returns
  confirm_required_from_class: 2,   // class 1 auto-binds stand; class 2 needs a tap

  ask_after_hours: 24,              // a need this old with no commitments goes outbound
  ask_batch: 12,                    // best dozen actors
  ask_cooldown_hours: 72,           // never pester the same actor faster than this
  ask_fit_floor: 0.60,              // below this an outbound ask is noise, not an ask

  // A flood degrades to queueing, not to spending.
  rate_per_minute: 120,
  daily_cost_cap_usd: 5.00,

  languages: ['en', 'lv', 'ru'],
  human_contact: 'koordinators@example.org',
  retention_days: 730,
};

export function configFor(initiative) {
  const raw = initiative?.config ? JSON.parse(initiative.config) : {};
  const merged = {
    ...DEFAULT_CONFIG, ...raw,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...(raw.thresholds ?? {}) },
  };
  // An initiative's stored config normally wins — it is the customer's setting.
  // JUDGMENT_ENGINE is the one exception: it is the operator's switch, used to
  // run the same catalogue through a different engine without editing anyone's
  // data, which is the only way to compare two engines on identical inputs.
  if (process.env.JUDGMENT_ENGINE) merged.engine = process.env.JUDGMENT_ENGINE;
  return merged;
}

/**
 * Risk classes. What is in them decides whether a machine may ever act alone.
 *   1  reversible, no credential, no money
 *   2  money, a public commitment, hard to undo
 *   3  safety, certification, hazardous work, minors
 */
export const RISK = {
  1: 'reversible, no credential, no money',
  2: 'money, a public commitment, hard to undo',
  3: 'safety, certification, hazardous work, minors',
};

/**
 * Invariant 4, as code rather than as a condition. This function does not take
 * a confidence argument, so no threshold anywhere can make a class 3 need
 * bind itself. Callers that want an auto-bind must pass this first.
 */
export function mayAutoBind(riskClass) {
  return riskClass === 1 || riskClass === 2;
}

export function thresholdFor(cfg, riskClass) {
  if (!mayAutoBind(riskClass)) return Infinity;
  return cfg.thresholds[riskClass] ?? cfg.thresholds[String(riskClass)] ?? 1.0;
}
