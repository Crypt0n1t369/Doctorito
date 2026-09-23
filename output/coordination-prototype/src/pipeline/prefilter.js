import { all } from '../db.js';
import { windowHasWeekday } from '../extract.js';

/**
 * Filtering before the model is what keeps this honest.
 *
 * Window overlap, travel radius, missing certifications and already-full needs
 * are eliminated here, in one SQL query, so the model never sees a candidate it
 * would have to reason about dates or arithmetic to reject — which is exactly
 * what jev-1.13 is documented to be bad at. A catalogue of 200 needs typically
 * reduces to 20–40 before ranking, which makes the wide pass cheaper and more
 * accurate at the same time.
 */
const SQL = `
select * from (
  select n.*,
    (n.qty_required - n.qty_committed - coalesce((
        select sum(c.qty) from commitments c
         where c.need_id = n.need_id
           and c.state = 'proposed'
           and (c.lease_expires_at is null or c.lease_expires_at > :now)), 0)) as remaining,
    (select count(*) from json_each(n.qualifications)) as n_quals,
    (select count(*) from json_each(n.qualifications) q
      where exists (
        select 1 from credentials cr
         where cr.actor_id = :actor and cr.code = q.value
           and (cr.expires_at is null or cr.expires_at > :now))) as n_held
  from needs n
  where n.initiative_id = :init
    and n.status = 'open'
)
where remaining > 0
  and (:ws is null or window_end   is null or window_end   >= :ws)
  and (:we is null or window_start is null or window_start <= :we)
  and (:lat is null or geo_lat is null or (
        abs(geo_lat - :lat) <= ((coalesce(geo_radius_km, 25) + :radius) / 111.0)
    and abs(geo_lon - :lon) <= ((coalesce(geo_radius_km, 25) + :radius) / (111.0 * max(0.2, cos(:lat * 3.14159265 / 180))))
  ))
order by (qty_required - qty_committed) desc, published_at asc
`;

export function prefilter(db, { initiative, actorId = null, extracted = {}, now = new Date() }) {
  const nowIso = now.toISOString();
  const place = extracted.places?.[0] ?? null;
  const params = {
    init: initiative.initiative_id,
    actor: actorId,
    now: nowIso,
    ws: extracted.window?.start ?? null,
    we: extracted.window?.end ?? null,
    lat: place?.lat ?? null,
    lon: place?.lon ?? null,
    radius: extracted.radius_km ?? 25,
  };

  const total = all(db, 'select count(*) c from needs where initiative_id=? and status=?',
    initiative.initiative_id, 'open')[0].c;
  const rows = all(db, SQL, params);

  // The SQL overlap is a range test, and a weekday spread across a month
  // overlaps almost everything. If the message named days, drop the needs that
  // fall on none of them — still deterministic, still before the model.
  const dows = extracted.window?.dows;
  const onDay = dows?.length
    ? rows.filter((r) => windowHasWeekday(r.window_start, r.window_end, dows))
    : rows;

  const eligible = onDay.filter((r) => r.n_held >= r.n_quals);
  const blocked = onDay.filter((r) => r.n_held < r.n_quals);

  return {
    candidates: eligible,
    blockedByCredentials: blocked,
    counts: {
      open_needs: total,
      survived_hard_constraints: onDay.length,
      eligible: eligible.length,
      blocked_by_credentials: blocked.length,
      eliminated: total - onDay.length,
    },
  };
}

/** The 60-character form the wide ranking pass sees. Nothing longer goes in. */
export function shortForm(need, chars = 60) {
  const s = need.description_short || need.description || '';
  return s.length <= chars ? s : s.slice(0, chars - 1).trimEnd() + '…';
}
