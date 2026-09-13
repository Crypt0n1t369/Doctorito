/* Plans and metering.
 *
 * The unit of value is a transmission: one message turned into audio that
 * devices can hear. Receiving is deliberately never metered — decoding happens
 * on the listener's own device, it costs us nothing, and a free receiver is
 * what makes anyone want a transmitter.
 */

export const METRICS = ["render", "decode", "simulate", "card_sync"];

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    priceMonthly: 0,
    limits: { render: 1000, decode: 500, simulate: 2000, card_sync: 5000 },
    channels: 1,
    cards: 100,
    signing: false,
    receiptRetentionDays: 1,
    audioRetentionHours: 24,
    overage: null,
    blurb: "Everything you need to build and demo. Unsigned channels only.",
  },
  pro: {
    id: "pro",
    label: "Pro",
    priceMonthly: 49,
    limits: { render: 50000, decode: 25000, simulate: 100000, card_sync: 250000 },
    channels: 10,
    cards: 10000,
    signing: true,
    receiptRetentionDays: 30,
    audioRetentionHours: 24 * 30,
    overage: { render: 2.0, decode: 4.0 },      // USD per 1,000 over the limit
    blurb: "Signed channels, managed keys, receipts. For one product in production.",
  },
  scale: {
    id: "scale",
    label: "Scale",
    priceMonthly: 299,
    limits: { render: 1000000, decode: 500000, simulate: 2000000, card_sync: 10000000 },
    channels: Infinity,
    cards: Infinity,
    signing: true,
    receiptRetentionDays: 365,
    audioRetentionHours: 24 * 90,
    overage: { render: 1.0, decode: 2.0 },
    blurb: "Unlimited channels, a year of receipts, priority rendering.",
  },
  selfhosted: {
    id: "selfhosted",
    label: "Self-hosted",
    priceMonthly: null,
    limits: { render: Infinity, decode: Infinity, simulate: Infinity, card_sync: Infinity },
    channels: Infinity,
    cards: Infinity,
    signing: true,
    receiptRetentionDays: Infinity,
    audioRetentionHours: Infinity,
    overage: null,
    blurb: "Your hardware, your keys, no egress. Annual licence from $25,000.",
  },
};

export const PLAN_IDS = Object.keys(PLANS);

export function planOf(id) {
  return PLANS[id] || PLANS.free;
}

/** Current billing period, as YYYY-MM in UTC. */
export function currentPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Decide whether a metered call may proceed.
 * Plans with an overage rate never hard-stop; they bill the excess.
 */
export function checkQuota(plan, metric, used, cost = 1) {
  const limit = plan.limits[metric];
  if (limit === undefined) return { allowed: true, limit: Infinity, used, remaining: Infinity };
  if (used + cost <= limit) {
    return { allowed: true, limit, used, remaining: limit - used - cost, overage: 0 };
  }
  const over = used + cost - limit;
  if (plan.overage && plan.overage[metric] != null) {
    return { allowed: true, limit, used, remaining: 0, overage: over,
             overageCost: (over / 1000) * plan.overage[metric] };
  }
  return {
    allowed: false, limit, used, remaining: 0, overage: over,
    reason: `${metric} quota of ${limit} for the ${plan.label} plan is used up for this period`,
  };
}

export function publicPlans() {
  return PLAN_IDS.map(id => {
    const p = PLANS[id];
    return {
      id: p.id, label: p.label, priceMonthly: p.priceMonthly, blurb: p.blurb,
      signing: p.signing,
      channels: p.channels === Infinity ? "unlimited" : p.channels,
      cards: p.cards === Infinity ? "unlimited" : p.cards,
      limits: Object.fromEntries(Object.entries(p.limits).map(([k, v]) => [k, v === Infinity ? "unlimited" : v])),
      receiptRetentionDays: p.receiptRetentionDays === Infinity ? "unlimited" : p.receiptRetentionDays,
      overage: p.overage,
    };
  });
}
