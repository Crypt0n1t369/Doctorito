"""Turn measured frame-error rates into the numbers the project actually needs:
airtime throughput, maximum reliable bulletin size, and how many shelter /
aid-point status updates that buys.

Object sizes are measured by re-encoding the real fixture schema, not assumed.
"""
import hashlib, json, math, os, sys

import numpy as np
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import capacity

# ---- reuse the fixture's exact CBOR encoder -------------------------------
def head(major, n):
    if n < 24:
        return bytes([(major << 5) | n])
    for width, code in [(1, 24), (2, 25), (4, 26), (8, 27)]:
        if n < 1 << (8 * width):
            return bytes([(major << 5) | code]) + n.to_bytes(width, "big")
    raise ValueError


def cbor(v):
    if v is False: return b"\xf4"
    if v is True: return b"\xf5"
    if v is None: return b"\xf6"
    if isinstance(v, int): return head(0, v) if v >= 0 else head(1, -1 - v)
    if isinstance(v, bytes): return head(2, len(v)) + v
    if isinstance(v, str):
        d = v.encode(); return head(3, len(d)) + d
    if isinstance(v, list): return head(4, len(v)) + b"".join(map(cbor, v))
    if isinstance(v, dict):
        p = sorted((cbor(k), cbor(x)) for k, x in v.items())
        return head(5, len(p)) + b"".join(k + x for k, x in p)
    raise TypeError


PRIV = Ed25519PrivateKey.from_private_bytes(
    hashlib.sha256(b"atbalsts-radio-public-exercise-key-v1").digest())
PROTECTED = cbor({1: -8, 4: b"test01"})


def signed_size(n_records, issued=1788951600):
    recs = [[0, 0, 100 + i, 1, 1 + (i % 4), 20 + i, 0] for i in range(n_records)]
    body = {0: 1, 1: 1, 2: 1, 3: 1, 4: 1001, 5: 1, 6: issued,
            7: issued + 3600, 8: True, 9: recs}
    payload = cbor(body)
    sig = PRIV.sign(cbor(["Signature1", PROTECTED, b"", payload]))
    cose = b"\xd2" + cbor([PROTECTED, {}, payload, sig])
    return len(payload), len(cose)


# ---- modem throughput ------------------------------------------------------
def throughput(modem_payload, burst_s, gap_s, base64_text):
    data = capacity.frame_data_bytes(modem_payload, base64_text)
    return data, data / (burst_s + gap_s)


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    import modem as M
    M.set_mode("time"); M.set_guard(64)
    GAP = 0.25          # inter-burst scheduling gap

    print("=" * 78)
    print("1. SIGNING OVERHEAD -- measured by re-encoding the fixture schema")
    print("=" * 78)
    print(f"{'records/object':>15} {'app B':>7} {'signed B':>9} {'signed B/record':>16}")
    batch = {}
    for m in (1, 2, 4, 8, 16, 32, 48):
        a, c = signed_size(m)
        batch[m] = (a, c)
        print(f"{m:>15} {a:>7} {c:>9} {c/m:>16.1f}")
    print("\nBatching more status records into one signed object amortises the")
    print("83-byte COSE+Ed25519 wrapper. The fixture uses 4 records/object.")

    print()
    print("=" * 78)
    print("2. AIRTIME THROUGHPUT (signed-object bytes carried per second)")
    print("=" * 78)
    print(f"{'modem payload':>14} {'burst s':>8} {'+gap':>6} {'data B/frame':>13} "
          f"{'B/s binary':>11} {'B/s base64':>11}")
    rows = []
    for pl in (85, 128, 170, 255):
        b = M.burst_seconds(pl)
        db, tb = throughput(pl, b, GAP, False)
        d6, t6 = throughput(pl, b, GAP, True)
        rows.append(dict(payload=pl, burst_s=round(b, 3), data_bin=db, bps_bin=round(tb, 1),
                         data_b64=d6, bps_b64=round(t6, 1)))
        print(f"{pl:>14} {b:>8.2f} {b+GAP:>6.2f} {db:>13} {tb:>11.1f} {t6:>11.1f}")
    print("\nBase64 is only needed to ride a stock text-input modem; a binary")
    print("adapter recovers about a quarter of the channel.")

    print()
    print("=" * 78)
    print("3. MAXIMUM RELIABLE BULLETIN in a 180 s slot (95% complete delivery)")
    print("=" * 78)
    PL, D = 255, capacity.frame_data_bytes(255, False)
    SLOT = M.burst_seconds(255) + GAP
    print(f"frame = {PL}-byte modem payload -> {D} signed bytes, slot {SLOT:.2f} s "
          f"({int(180//SLOT)} slots in 180 s)\n")
    print(f"{'FER':>6} {'independent repeats':>34} {'correlated repeats':>34}")
    print(f"{'':>6} {'bytes':>9} {'frames':>7} {'passes':>7} {'updates':>8}"
          f" {'bytes':>9} {'frames':>7} {'passes':>7} {'updates':>8}")
    cap_rows = []
    per_upd = batch[16][1] / 16          # signed bytes per facility at 16/object
    for fer in (0.0, 0.01, 0.02, 0.05, 0.10, 0.20, 0.35):
        r = capacity.report(fer, SLOT, 180.0, frame_bytes=D)
        ind_u = int(r["independent_bytes"] / per_upd)
        cor_u = int(r["correlated_bytes"] / per_upd)
        cap_rows.append({**r, "updates_independent": ind_u, "updates_correlated": cor_u})
        print(f"{fer:>6.0%} {r['independent_bytes']:>9} {r['independent_N']:>7} "
              f"{r['independent_R']:>7} {ind_u:>8} {r['correlated_bytes']:>9} "
              f"{r['correlated_N']:>7} {r['correlated_R']:>7} {cor_u:>8}")
    print(f"\n'updates' = shelter/aid-point status records at "
          f"{per_upd:.1f} signed bytes each (16 records per signed object).")

    print()
    print("=" * 78)
    print("4. THE EXISTING FIXTURE BULLETIN (1,392 signed bytes) THROUGH THIS PATH")
    print("=" * 78)
    for pl in (128, 255):
        for b64 in (True, False):
            d = capacity.frame_data_bytes(pl, b64)
            slot = M.burst_seconds(pl) + GAP
            n = math.ceil(1392 / d)
            print(f"  {pl:>3}-byte payload, {'base64':>6} {'text' if b64 else 'bin ':>4}: "
                  f"{n:>2} frames, one pass {n*slot:>5.1f} s, two passes {2*n*slot:>5.1f} s")

    json.dump(dict(batching={str(k): v for k, v in batch.items()},
                   throughput=rows, capacity=cap_rows,
                   slot_s=SLOT, frame_bytes=D, gap_s=GAP),
              open(os.path.join(HERE, "results_capacity.json"), "w"), indent=1)
