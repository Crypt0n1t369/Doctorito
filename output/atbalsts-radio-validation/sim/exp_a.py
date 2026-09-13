"""Experiment A -- guard interval vs reverberation (the dominant impairment)."""
import json, sys, os, time
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study

GUARDS = [32, 64, 128, 256]          # 4, 8, 16, 32 ms
DRRS = [-6, -3, 0, 3, 6, 9, 12, 15, 20]
N = 120

if __name__ == "__main__":
    t0 = time.time()
    out = []
    with Pool(8) as pool:
        for g in GUARDS:
            for drr in DRRS:
                c = ch.Conditions(name=f"g{g}_drr{drr}", drr_db=drr, snr_db=25.0)
                k, n = study.run(c, n=N, guard=g, seed0=hash((g, drr)) % 10**6, pool=pool)
                lo, hi = study.wilson(k, n)
                sec = study.burst_seconds(g, 128)
                out.append(dict(guard=g, guard_ms=g / 8.0, drr_db=drr, ok=k, n=n,
                                rate=k / n, lo=lo, hi=hi, burst_s=round(sec, 3)))
                print(f"guard {g/8:>4.0f} ms  DRR {drr:+3d} dB  ->  {k:3d}/{n}  "
                      f"({k/n:.0%}, 95% CI {lo:.0%}-{hi:.0%})  burst {sec:.2f}s", flush=True)
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results_a.json"), "w"), indent=1)
    print("elapsed", round(time.time() - t0, 1), "s")
