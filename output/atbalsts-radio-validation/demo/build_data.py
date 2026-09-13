"""Bundle the real Atbalsts reference layers into the demo page.

Source (unmodified, from the app repo):
  public/data/shelters_112_patvertnes.geojson        803 shelters, 112 registry
  public/data/latvia_municipalities_2026_1_2m.geojson 42 municipalities

This is the point of the exercise: the registry ships WITH the app. The radio
then carries five bytes per facility -- id, state, free places, revision -- and
never a name, an address or a coordinate. Building types collapse to a small
codebook so the phone can draw the right symbol from a code.
"""
import json, math, os, re, unicodedata

SRC = "/Users/kristaps/Documents/New project/palidzi-oauth-recovery/public/data"
HERE = os.path.dirname(os.path.abspath(__file__))

CATEGORIES = [
    (0, "Cits objekts", "Other"),
    (1, "Skola", "School"),
    (2, "Pirmsskola", "Preschool"),
    (3, "Kultūras nams", "Culture"),
    (4, "Administratīvā ēka", "Administrative"),
    (5, "Dzīvojamā māja", "Residential"),
    (6, "Veselības aprūpe", "Health"),
    (7, "Sociālā aprūpe", "Social care"),
    (8, "Sporta ēka", "Sport"),
    (9, "Saimniecības ēka", "Utility"),
]
RULES = [
    (2, r"pirms?s?kol|bērnudārz|pirmskol"),
    (1, r"skol|izglīt|mācīb|internāt|tehnikum|studij|darbnīc"),
    (6, r"ārstniec|slimnīc|poliklīnik|doktorāt|veselīb|medicīn|ambulan|ārsta|aptiek"),
    (7, r"sociāl|pansionāt|aprūp|bērnu nam|krīzes|dienas centr|ģimenes atbalst|sarkanais"),
    (8, r"sport|boks|šautuv|halle"),
    (3, r"kult|tautas nam|muzej|bibliot|teātr|koncert|saiet|pils|muiž|galerij|jauniešu|kapli|kulta|baznīc|plašizklaid|pašizklaid"),
    (4, r"administr|adminstr|aministr|biroj|biroja|pārvald|pašvald|pašcald|dome|pagast|dzimtsarakst|policij|migrācij|banka"),
    (5, r"dzīvojam|dzīvokļ|viesnīc|hostel|kopdzīvojam|dienesta viesnīc|māja"),
    (9, r"noliktav|pagrab|pagarab|šķūn|garāž|palīgbūv|saimniecīb|smēde|ēdnīc|katlu|ražošan|lauksaimniec|tualet"),
]


def categorise(text):
    t = unicodedata.normalize("NFC", (text or "")).lower()
    for code, pattern in RULES:
        if re.search(pattern, t):
            return code
    return 0


def clean(s):
    return re.sub(r"\s+", " ", (s or "").strip())


# ---------------------------------------------------------------- registry
src = json.load(open(os.path.join(SRC, "shelters_112_patvertnes.geojson")))
registry, cat_count = [], {}
for f in src["features"]:
    p = f["properties"]
    lat = p.get("patvertnesieejasdurvjukoordlat")
    lon = p.get("patvertnesieejasdurvjukoordlon")
    if lat is None or lon is None:
        lon, lat = f["geometry"]["coordinates"][:2]
    place = clean(p.get("pilsetasvaiapdzvietasnosaukums"))
    street = clean(p.get("ielasnosaukums"))
    num = clean(p.get("ekasnumurs"))
    addr = " ".join(x for x in [street, num] if x)
    cat = categorise(p.get("ekasgalvlietosanasveids"))
    cat_count[cat] = cat_count.get(cat, 0) + 1
    # locality is the first comma-separated part; the rest is the municipality
    parts = [x.strip() for x in place.split(",")]
    locality = parts[0] if parts else ""
    municipality = parts[-1] if len(parts) > 1 else ""
    registry.append([int(p["objectid"]), round(lat * 1e5), round(lon * 1e5), cat,
                     addr or locality, locality, municipality])

registry.sort(key=lambda r: r[0])
print(f"registry: {len(registry)} shelters, ids {registry[0][0]}..{registry[-1][0]}")
for code, lv, en in CATEGORIES:
    print(f"   {code} {en:<15} {cat_count.get(code,0):>4}")


# ------------------------------------------------------------- map outline
def perp(p, a, b):
    if a == b:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = perp(pts[i], pts[0], pts[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
    return [pts[0], pts[-1]]


muni = json.load(open(os.path.join(SRC, "latvia_municipalities_2026_1_2m.geojson")))
LAT = (55.62, 58.12)
LON = (20.90, 28.30)
K = math.cos(math.radians((LAT[0] + LAT[1]) / 2))
W = 1000.0
H = W * (LAT[1] - LAT[0]) / ((LON[1] - LON[0]) * K)


def project(lon, lat):
    x = (lon - LON[0]) / (LON[1] - LON[0]) * W
    y = H - (lat - LAT[0]) / (LAT[1] - LAT[0]) * H
    return x, y


TOL = 1.6           # projected units; ~1.8 km, right for a national overview
shapes, kept, total = [], 0, 0
for f in muni["features"]:
    g = f["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    d = []
    for poly in polys:
        for ring in poly:
            total += len(ring)
            pts = [project(x, y) for x, y in ring]
            s = simplify(pts, TOL)
            if len(s) < 4:
                continue
            # drop slivers the overview cannot show anyway
            area = abs(sum(s[i][0]*s[i-1][1] - s[i-1][0]*s[i][1] for i in range(len(s)))) / 2
            if area < 4:
                continue
            kept += len(s)
            d.append("M" + "L".join(f"{x:.0f} {y:.0f}" for x, y in s) + "Z")
    if d:
        shapes.append({"name": f["properties"]["name"], "d": "".join(d)})

print(f"map: {len(shapes)} municipalities, {total} -> {kept} points "
      f"({100*kept/total:.0f}% kept)")

out = {
    "viewBox": [0, 0, round(W, 1), round(H, 1)],
    "bounds": {"lat": LAT, "lon": LON, "k": round(K, 6)},
    "categories": [{"code": c, "lv": lv, "en": en} for c, lv, en in CATEGORIES],
    "municipalities": shapes,
    "registry": registry,
}
js = ("/* Generated by build_data.py from the Atbalsts reference layers. "
      "Real 112 shelter registry and 2026 municipality boundaries. */\n"
      "globalThis.ATBALSTS_DATA = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
open(os.path.join(HERE, "data.js"), "w").write(js)
print(f"data.js  {len(js)/1024:.0f} kB")
