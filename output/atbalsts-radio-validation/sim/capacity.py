"""Turn a measured frame error rate into 'maximum bytes deliverable reliably'.

A bulletin is N fragments, each broadcast R times inside a session of T seconds.
With per-frame error probability p:

  independent repeats  P(all N arrive) = (1 - p^R)^N
  correlated repeats   P(all N arrive) = (1 - p)^N        (repeats do not help)

The truth sits between: a phone lying still near a radio sees a nearly fixed
channel, so repeats are strongly correlated; ambient noise and small movements
decorrelate them. Both bounds are reported rather than one flattering number.
"""

import json, math, os, sys

HDR = 16                       # transport header bytes per fragment
SIG_OBJECT_OVERHEAD = 83       # COSE_Sign1 wrapper + Ed25519 signature, measured
APP_PER_FACILITY = 17          # measured from the fixture
COSE_PER_FACILITY_5OBJ = 37.7  # measured, 20 facilities across 5 signed objects


def frame_data_bytes(modem_payload: int, base64_text: bool) -> int:
    """Useful (signed-object) bytes carried by one modem burst."""
    binary = ((modem_payload - 4) // 4) * 3 if base64_text else modem_payload
    return binary - HDR


def max_bytes(p, t_slot, T, target=0.95, frame_bytes=112, correlated=False):
    """Largest bulletin (bytes of signed object) deliverable with probability
    >= target inside T seconds. Returns (bytes, N, R)."""
    best = (0, 0, 0)
    slots = int(T // t_slot)
    for R in range(1, slots + 1):
        N = slots // R
        if N < 1:
            break
        per = (1 - p) if correlated else (1 - p ** R)
        if per <= 0:
            continue
        # largest N' <= N with per**N' >= target
        if per >= 1.0:
            n_ok = N
        else:
            n_ok = min(N, int(math.floor(math.log(target) / math.log(per))))
        if n_ok < 1:
            continue
        if n_ok * frame_bytes > best[0]:
            best = (n_ok * frame_bytes, n_ok, R)
    return best


def report(p, t_slot, T=180.0, frame_bytes=112, label=""):
    ind = max_bytes(p, t_slot, T, frame_bytes=frame_bytes, correlated=False)
    cor = max_bytes(p, t_slot, T, frame_bytes=frame_bytes, correlated=True)
    return dict(label=label, fer=p, slot_s=round(t_slot, 3), window_s=T,
                frame_bytes=frame_bytes,
                independent_bytes=ind[0], independent_N=ind[1], independent_R=ind[2],
                correlated_bytes=cor[0], correlated_N=cor[1], correlated_R=cor[2])


def facilities_from_bytes(cose_bytes, per_facility=COSE_PER_FACILITY_5OBJ):
    return int(cose_bytes // per_facility)


if __name__ == "__main__":
    # measured fixture constants, recomputed from sizing-results.json
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    s = json.load(open(os.path.join(root, "sizing-results.json")))
    fac = [o for o in s["object_sizes"] if o["records"] == 4]
    app = sum(o["application_bytes"] for o in fac)
    cose = sum(o["signed_bytes"] for o in fac)
    n_fac = sum(o["records"] for o in fac)
    print(f"fixture: {n_fac} facility records -> {app} app bytes ({app/n_fac:.1f}/facility), "
          f"{cose} signed bytes ({cose/n_fac:.1f}/facility)")
    print(f"signature+wrapper overhead per signed object: "
          f"{(cose-app)/len(fac):.0f} bytes  ({len(fac)} objects -> {cose-app} bytes total)")
    print(f"whole bulletin: {s['application_cbor_bytes']} app -> {s['cose_bytes']} signed "
          f"({s['cose_bytes']/s['application_cbor_bytes']:.2f}x)")
