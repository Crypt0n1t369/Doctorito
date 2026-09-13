"""Experiment H -- MEASURED repetition gain.

Repeating a bulletin only helps if failures decorrelate between passes. Here the
room geometry is held fixed within a session (the phone does not move) while
ambient noise and payload content vary between repeats, which is exactly the
real situation. The empirical P(at least one of R succeeds) is compared with the
independence prediction 1 - p^R.
"""
import json, sys, os, time
from dataclasses import replace
from multiprocessing import Pool
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study, modem

SESSIONS, REPEATS = 220, 4


def _session(job):
    drr, snr, room_seed = job
    modem.set_mode("time"); modem.set_guard(64)
    rr = np.random.default_rng(room_seed)
    base = ch.Conditions(drr_db=drr, snr_db=snr, noise="babble")
    rir = ch.room_ir(base.rt60, drr, ch.FS_AIR, rr)      # fixed geometry
    c = replace(base, rir=rir)
    out = []
    for r in range(REPEATS):
        rng = np.random.default_rng(room_seed * 31 + r + 1)
        pay = bytes(rng.integers(0, 256, 128, dtype=np.uint8))
        got, ok = modem.demodulate(ch.apply(modem.modulate(pay), c, rng), 128)
        out.append(bool(ok and got == pay))
    return out


if __name__ == "__main__":
    t0 = time.time(); res = {}
    with Pool(8) as pool:
        for drr, snr in [(6, 12), (6, 10), (9, 8), (12, 6)]:
            pat = pool.map(_session, [(drr, snr, 1000 + i) for i in range(SESSIONS)])
            a = np.array(pat)
            p = 1 - a.mean()
            print(f"\nDRR {drr:+d} dB, babble SNR {snr:+d} dB   marginal FER = {p:.3f}")
            print(f"{'R':>3} {'measured P(complete)':>21} {'independence model':>19} {'gap':>7}")
            row = []
            for R in range(1, REPEATS + 1):
                meas = a[:, :R].any(axis=1).mean()
                ind = 1 - p ** R
                lo, hi = study.wilson(int(meas * SESSIONS), SESSIONS)
                print(f"{R:>3} {meas:>17.1%} {'':>3} {ind:>17.1%} {meas-ind:>+7.1%}"
                      f"   (95% CI {lo:.0%}-{hi:.0%})")
                row.append(dict(R=R, measured=meas, independent=ind, lo=lo, hi=hi))
            # per-session success counts show how bimodal the outcome is
            counts = a.sum(axis=1)
            hist = [int((counts == k).sum()) for k in range(REPEATS + 1)]
            print(f"    sessions by successes out of {REPEATS}: {hist}"
                  f"   (all-or-nothing sessions: "
                  f"{(hist[0]+hist[-1])/SESSIONS:.0%})")
            res[f"drr{drr}_snr{snr}"] = dict(fer=p, rows=row, hist=hist,
                                             sessions=SESSIONS, repeats=REPEATS)
    json.dump(res, open("results_h.json", "w"), indent=1)
    print("\nelapsed", round(time.time() - t0, 1), "s")
