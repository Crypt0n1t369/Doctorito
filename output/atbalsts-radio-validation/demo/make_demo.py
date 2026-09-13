"""Build the demonstration audio.

The registry is PREINSTALLED (data.js, from the real 112 shelter list), so the
audio carries only what changes: five bytes per facility — id, state, free
places, revision. Nothing here transmits a name, an address or a coordinate for
a facility the app already knows about.

  01-riga.wav       status for every shelter in Rīga
  02-situation.wav  one situation, plus the closures around it
  03-latvija.wav    a national sweep across the other municipalities

All content is fictional exercise material; the signing key is the project's
public test key and must never be trusted by a production receiver.
"""
import hashlib, json, math, os, struct, sys, wave
import numpy as np
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import modem_demo as M

PAYLOAD, DATA = 128, 112
ISSUER = 1
GAP_S, LEAD_S = 0.30, 0.5
LAT0, LON0 = 5550000, 2050000

PRIV = Ed25519PrivateKey.from_private_bytes(
    hashlib.sha256(b"atbalsts-radio-public-exercise-key-v1").digest())
PUB = PRIV.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)

DATA_JS = json.loads(open(os.path.join(HERE, "data.js")).read().split("= ", 1)[1].rstrip(";\n"))
REGISTRY = DATA_JS["registry"]
BY_MUNI = {}
for r in REGISTRY:
    BY_MUNI.setdefault(r[6] or r[5], []).append(r)


def u24(v):
    return struct.pack(">I", v)[1:]


def enc_status(rows, seq):
    b = bytearray([1, 2, seq, len(rows)])
    for fid, state, places, rev in rows:
        b += struct.pack(">HBBB", fid, state, min(places, 255), rev)
    return bytes(b)


def enc_situation(rows, seq):
    b = bytearray([1, 3, seq, len(rows)])
    for sid, sev, lat, lon, title, text in rows:
        t, x = title.encode(), text.encode()
        b += struct.pack(">HB", sid, sev) + u24(round(lat * 1e5) - LAT0) \
             + u24(round(lon * 1e5) - LON0) + bytes([len(t)]) + t + bytes([len(x)]) + x
    return bytes(b)


def sign(body):
    return body + PRIV.sign(body)


def frames(bulletin, object_id, obj):
    out = []
    for off in range(0, len(obj), DATA):
        chunk = obj[off:off + DATA]
        h = struct.pack(">HIHHH", ISSUER, bulletin, object_id, off, len(obj))
        out.append(h + struct.pack(">I", M.crc32c(h + chunk)) + chunk + bytes(DATA - len(chunk)))
    return out


def build(frame_list, passes):
    gap = np.zeros(int(GAP_S * M.FS))
    parts, t, slots = [np.zeros(int(LEAD_S * M.FS))], LEAD_S, []
    for p in range(passes):
        for j, f in enumerate(frame_list):
            burst = M.modulate(f)
            slots.append(dict(pass_=p, frame=j, start_s=round(t, 3)))
            parts += [burst, gap]
            t += (burst.size + gap.size) / M.FS
    return np.concatenate(parts), slots


def write_wav(path, audio, fs_out=48000):
    n = int(round(audio.size * fs_out / M.FS))
    X = np.fft.rfft(audio)
    Y = np.zeros(n // 2 + 1, dtype=complex)
    k = min(X.size, Y.size); Y[:k] = X[:k]
    y = np.fft.irfft(Y, n) * (n / audio.size)
    y = y / (np.abs(y).max() + 1e-9) * 0.72
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(fs_out)
        w.writeframes((y * 32767).astype("<i2").tobytes())
    return n / fs_out


def deterministic_state(fid, salt):
    """Stable pseudo-random but plausible state, so runs are reproducible."""
    h = int(hashlib.sha256(f"{salt}:{fid}".encode()).hexdigest()[:8], 16)
    state = [1, 1, 1, 2, 1, 2, 1, 3][h % 8]          # mostly open, some limited/full
    places = 0 if state >= 3 else 15 + (h >> 8) % 140
    return state, places


# ---------------------------------------------------------------- bulletins
riga = [r for r in REGISTRY if "Rīga" in (r[6] or "") or (r[5] or "") == "Rīga"]
riga_rows = [(r[0],) + deterministic_state(r[0], "riga") + (1,) for r in riga]

# a situation in central Rīga, and the shelters closed around it
CENTRE = (56.9496, 24.1052)


def near(rows, centre, n):
    def d(r):
        return math.hypot((r[1] / 1e5 - centre[0]) * 111,
                          (r[2] / 1e5 - centre[1]) * 111 * 0.55)
    return sorted(rows, key=d)[:n]


close_rows = [(r[0], 4, 0, 2) for r in near(riga, CENTRE, 12)]
situation_rows = [(9001, 3, CENTRE[0], CENTRE[1],
                   "Mācības: plūdu apdraudējums Rīgas centrā",
                   "Mācību scenārijs. Centra patvertnes slēgtas. Izmanto Purvciema un "
                   "Imantas patvertnes. Seko oficiālajiem paziņojumiem radio.")]

rest = [r for r in REGISTRY if r not in riga]
rest_sorted = sorted(rest, key=lambda r: r[0])
national = rest_sorted[::max(1, len(rest_sorted) // 180)][:180]
national_rows = [(r[0],) + deterministic_state(r[0], "lv") + (1,) for r in national]

FILES = [
    ("01-riga.wav", "Rīga status sweep", 2,
     [(2, enc_status(riga_rows, 1))]),
    ("02-situation.wav", "Situation and closures", 3,
     [(3, enc_situation(situation_rows, 1)), (4, enc_status(close_rows, 2))]),
    ("03-latvija.wav", "National sweep", 2,
     [(5, enc_status(national_rows, 1))]),
]

if __name__ == "__main__":
    manifest = {"public_key_hex": PUB.hex(), "payload_len": PAYLOAD, "issuer": ISSUER,
                "registry_size": len(REGISTRY), "files": []}
    print(f"registry preinstalled: {len(REGISTRY)} shelters "
          f"({len(riga)} in Rīga)\n")
    for name, label, passes, objs in FILES:
        bulletin = 2600 + FILES.index((name, label, passes, objs))
        fl = [f for oid, o in objs for f in frames(bulletin, oid, sign(o))]
        audio, slots = build(fl, passes)
        dur = write_wav(os.path.join(HERE, name), audio)
        app = sum(len(o) for _, o in objs)
        signed = app + 64 * len(objs)
        recs = sum(o[3] for _, o in objs)
        manifest["files"].append(dict(file=name, label=label, bulletin=bulletin,
            objects=[oid for oid, _ in objs], unique_frames=len(fl), passes=passes,
            bursts=len(slots), duration_s=round(dur, 2), application_bytes=app,
            signed_bytes=signed, records=recs))
        print(f"{name:<18} {label:<24} {recs:>3} records  {app:>4} B app / {signed:>4} B signed"
              f"  {len(fl)} frames x{passes} = {len(slots):2d} bursts  {dur:5.1f} s")
    json.dump(manifest, open(os.path.join(HERE, "demo-manifest.json"), "w"),
              indent=1, ensure_ascii=False)
    tot = sum(f["records"] for f in manifest["files"])
    sec = sum(f["duration_s"] for f in manifest["files"])
    print(f"\n{tot} facility/situation records in {sec:.1f} s of audio")
