"""Experiment K -- is the living-room limit physics, or my modem's grid?

Rattlegram uses 6.25 Hz subcarrier spacing and 160 ms symbols. The default grid
here is 31.25 Hz / 32 ms, five times coarser. In a reverberant room the coherence
bandwidth is only a few Hz, so spacing is exactly the parameter that should
decide how much reverberation survives. If the cliff moves, the earlier
"10-30 cm" figure is an artefact of my grid, not a property of the concept.
"""
import json, sys, os, time
from multiprocessing import Pool
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study, modem

N = 120
GRIDS = [(256, 64, "31.25 Hz / 32+8 ms  (default)"),
         (512, 64, "15.63 Hz / 64+8 ms"),
         (1024, 128, "7.81 Hz / 128+16 ms  (near Rattlegram)")]
DRRS = [-9, -6, -3, 0, 3, 6, 9]


def _one(job):
    nfft, guard, cond, seed = job
    modem.set_fft(nfft, guard); modem.set_mode("time")
    rng = np.random.default_rng(seed)
    pay = bytes(rng.integers(0, 256, 128, dtype=np.uint8))
    got, ok = modem.demodulate(ch.apply(modem.modulate(pay), cond, rng), 128)
    return bool(ok and got == pay)


if __name__ == "__main__":
    t0 = time.time(); out = []
    with Pool(8) as pool:
        for nfft, guard, label in GRIDS:
            modem.set_fft(nfft, guard); modem.set_mode("time")
            burst = modem.burst_seconds(128)
            print(f"\n--- {label}   burst {burst:.2f} s ---")
            for drr in DRRS:
                c = ch.Conditions(drr_db=drr, snr_db=20, rt60=0.45,
                                  speaker_kind="radio", noise="babble")
                k = sum(pool.map(_one, [(nfft, guard, c, abs(hash((nfft, drr, i))) % 10**7)
                                        for i in range(N)]))
                lo, hi = study.wilson(k, N)
                d = study.drr_to_distance(drr, 45, 0.45)
                out.append(dict(nfft=nfft, guard=guard, label=label, drr_db=drr,
                                ok=k, n=N, rate=k / N, lo=lo, hi=hi,
                                burst_s=round(burst, 3)))
                print(f"  DRR {drr:+3d} dB (~{d*100:3.0f} cm)  {k:3d}/{N} {k/N:5.0%}"
                      f"  (95% CI {lo:.0%}-{hi:.0%})", flush=True)
    json.dump(out, open("results_grid.json", "w"), indent=1)
    print("\nelapsed", round(time.time() - t0, 1), "s")
