export function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined)) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Do two half-open intervals overlap? Nulls mean "unconstrained". */
export function windowsOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart && !aEnd) return true;
  if (!bStart && !bEnd) return true;
  const as = aStart ? Date.parse(aStart) : -Infinity;
  const ae = aEnd ? Date.parse(aEnd) : Infinity;
  const bs = bStart ? Date.parse(bStart) : -Infinity;
  const be = bEnd ? Date.parse(bEnd) : Infinity;
  return as <= be && bs <= ae;
}
