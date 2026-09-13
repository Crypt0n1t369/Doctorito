"""End-to-end demonstration: the real signed fixture bulletin -> transport
frames -> OFDM audio -> the full impairment chain -> decode -> reassemble ->
Ed25519 signature verification -> applied application records.

Nothing is accepted on a CRC alone; an object counts only if its COSE_Sign1
signature verifies against the preinstalled public key.
"""
import hashlib, json, os, sys, time
import numpy as np
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.exceptions import InvalidSignature

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import modem, channel as ch, make_wav as mw, study

PUB = Ed25519PrivateKey.from_private_bytes(
    hashlib.sha256(b"atbalsts-radio-public-exercise-key-v1").digest()).public_key()


def head(major, n):
    if n < 24:
        return bytes([(major << 5) | n])
    for w, c in [(1, 24), (2, 25), (4, 26), (8, 27)]:
        if n < 1 << (8 * w):
            return bytes([(major << 5) | c]) + n.to_bytes(w, "big")
    raise ValueError


def cbor(v):
    if isinstance(v, bool): return b"\xf5" if v else b"\xf4"
    if isinstance(v, int): return head(0, v) if v >= 0 else head(1, -1 - v)
    if isinstance(v, bytes): return head(2, len(v)) + v
    if isinstance(v, str):
        d = v.encode(); return head(3, len(d)) + d
    if isinstance(v, list): return head(4, len(v)) + b"".join(map(cbor, v))
    raise TypeError


def dec(b, i=0):
    """Minimal CBOR reader, enough for the fixture's signed objects."""
    m, a = b[i] >> 5, b[i] & 31; i += 1
    if a == 24: n = b[i]; i += 1
    elif a == 25: n = int.from_bytes(b[i:i+2], "big"); i += 2
    elif a == 26: n = int.from_bytes(b[i:i+4], "big"); i += 4
    elif a == 27: n = int.from_bytes(b[i:i+8], "big"); i += 8
    else: n = a
    if m == 0: return n, i
    if m == 1: return -1 - n, i
    if m == 2: return b[i:i+n], i + n
    if m == 3: return b[i:i+n].decode("utf-8"), i + n
    if m in (4, 5):
        out = []
        for _ in range(n * (2 if m == 5 else 1)):
            v, i = dec(b, i); out.append(v)
        return (out if m == 4 else dict(zip(out[::2], out[1::2]))), i
    if m == 7:
        return {20: False, 21: True, 22: None}.get(a), i
    raise ValueError(m)


def verify(cose_bytes):
    """Return the application body only if the Ed25519 signature verifies."""
    if not cose_bytes or cose_bytes[0] != 0xD2:
        return None
    arr, _ = dec(cose_bytes, 1)
    protected, _unprot, payload, sig = arr
    try:
        PUB.verify(sig, cbor(["Signature1", protected, b"", payload]))
    except InvalidSignature:
        return None
    body, _ = dec(payload, 0)
    return body


def run(cond, payload_len=255, seed=0, wav=None):
    modem.set_mode("time"); modem.set_guard(64)
    a, fs = mw.read_wav(wav or os.path.join(ROOT, "bulletin.wav"))
    x = ch.resample(a, int(round(a.size * modem.FS / fs)))
    rng = np.random.default_rng(seed)
    y = ch.apply(x, cond, rng)

    burst_n = int(modem.burst_seconds(payload_len) * modem.FS)
    starts = mw.find_bursts(y, min_sep=int(burst_n * 0.6))
    objects, frames_ok, frames_bad = {}, 0, 0
    first_ok_s = None
    for st in starts:
        a0 = max(0, st - 400)
        seg = y[a0:a0 + burst_n + 1600]
        if seg.size < burst_n:
            continue
        got, good = modem.demodulate(seg, payload_len)
        p = mw.parse(got) if good else None
        if not p:
            frames_bad += 1
            continue
        frames_ok += 1
        o = objects.setdefault(p["object"], bytearray(p["total"]))
        o[p["offset"]:p["offset"] + len(p["data"])] = p["data"]
        if first_ok_s is None:
            first_ok_s = st / modem.FS

    applied, records = [], 0
    for oid in sorted(objects):
        body = verify(bytes(objects[oid]))
        if body is not None:
            applied.append(oid)
            records += len(body[9])
    return dict(preambles=len(starts), frames_ok=frames_ok, frames_bad=frames_bad,
                objects_verified=len(applied), objects_total=8,
                records_applied=records, first_frame_s=first_ok_s,
                duration_s=round(a.size / fs, 1))


CASES = [
    ("core envelope   (DRR +12 dB ~0.15 m, babble SNR 20 dB)", ch.Conditions(drr_db=12, snr_db=20, noise="babble")),
    ("noisy room      (DRR +12 dB ~0.15 m, babble SNR 10 dB)", ch.Conditions(drr_db=12, snr_db=10, noise="babble")),
    ("arm's length    (DRR  +6 dB ~0.30 m, babble SNR 15 dB)", ch.Conditions(drr_db=6, snr_db=15, noise="babble")),
    ("across the room (DRR  -5 dB ~1.0 m,  babble SNR 20 dB)", ch.Conditions(drr_db=-5, snr_db=20, noise="babble")),
    ("PROCESSED mic path (noise suppression on, DRR +12)", ch.Conditions(drr_db=12, snr_db=20, noise="babble", ns=True)),
]

if __name__ == "__main__":
    print(f"{'condition':<56} {'frames':>8} {'objects':>9} {'records':>8} {'1st frame':>10}")
    print("-" * 95)
    out = []
    for name, c in CASES:
        rs = [run(c, seed=1000 + i) for i in range(3)]
        f = np.mean([r["frames_ok"] for r in rs])
        o = np.mean([r["objects_verified"] for r in rs])
        rec = np.mean([r["records_applied"] for r in rs])
        ff = [r["first_frame_s"] for r in rs if r["first_frame_s"]]
        out.append(dict(name=name, frames_ok=f, objects=o, records=rec,
                        first_s=float(np.mean(ff)) if ff else None))
        print(f"{name:<56} {f:>5.1f}/16 {o:>6.1f}/8 {rec:>6.1f}/23 "
              f"{(f'{np.mean(ff):.1f} s' if ff else '--'):>10}")
    json.dump(out, open(os.path.join(HERE, "results_end2end.json"), "w"), indent=1)
    print("\n'records' counts application records whose signature verified "
          "(20 facility statuses + 3 situations).")
