"""Experiment B  -- ambient noise sweep (how loud a room is survivable)
   Experiment C  -- ablation: what each stage of the chain actually costs
   Experiment D  -- payload size vs robustness
   Experiment E  -- mid-burst interruption
"""
import json, sys, os, time
from dataclasses import replace
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study

GUARD = int(os.environ.get("GUARD", "64"))
N = 120
HERE = os.path.dirname(os.path.abspath(__file__))


def line(tag, c, n=N, guard=GUARD, payload=128, pool=None):
    k, nn = study.run(c, n=n, guard=guard, payload_len=payload, mode="time",
                      seed0=abs(hash((tag, guard, payload))) % 10**6, pool=pool)
    lo, hi = study.wilson(k, nn)
    print(f"{tag:<42} {k:3d}/{nn}  {k/nn:5.0%}  (95% CI {lo:.0%}-{hi:.0%})", flush=True)
    return dict(tag=tag, guard=guard, payload=payload, ok=k, n=nn,
                rate=k / nn, lo=lo, hi=hi)


if __name__ == "__main__":
    t0 = time.time(); out = {}
    with Pool(8) as pool:
        print(f"\n=== B. ambient noise sweep (guard {GUARD/8:.0f} ms) ===")
        out["B"] = []
        for drr in (12, 6):
            for snr in (30, 25, 20, 15, 12, 10, 8, 6):
                c = ch.Conditions(drr_db=drr, snr_db=snr, noise="babble")
                out["B"].append({**line(f"DRR {drr:+d} dB, babble SNR {snr:+d} dB", c, pool=pool),
                                 "drr_db": drr, "snr_db": snr})

        print(f"\n=== C. ablation at DRR +12 dB, SNR 20 dB, babble ===")
        base = ch.Conditions(drr_db=12, snr_db=20, noise="babble")
        out["C"] = []
        cases = [
            ("reference (full chain)", base),
            ("no broadcast processing", replace(base, broadcast=False)),
            ("no compressor (ratio 1)", replace(base, comp_ratio=1.0)),
            ("severe clipping (1 dB headroom)", replace(base, clip_headroom_db=1.0)),
            ("no clipping", replace(base, clip_headroom_db=None)),
            ("no loudspeaker model", replace(base, use_speaker=False)),
            ("anechoic (no room)", replace(base, rt60=0.0)),
            ("long reverb RT60 0.9 s", replace(base, rt60=0.9)),
            ("no mic AGC", replace(base, agc=False)),
            ("PHONE NOISE SUPPRESSION ON", replace(base, ns=True)),
            ("clock offset 0 ppm", replace(base, ppm=0.0)),
            ("clock offset 200 ppm", replace(base, ppm=200.0)),
            ("clock offset 1000 ppm", replace(base, ppm=1000.0)),
        ]
        for tag, c in cases:
            out["C"].append(line(tag, c, pool=pool))
        for g in (32, 64, 128):
            out["C"].append(line(f"guard {g/8:.0f} ms "
                                 f"(burst {study.burst_seconds(g,128):.2f} s)",
                                 base, guard=g, pool=pool))

        print(f"\n=== D. payload size (DRR +12 dB, SNR 20 dB) ===")
        out["D"] = []
        for pl in (85, 128, 170, 255):
            c = ch.Conditions(drr_db=12, snr_db=20, noise="babble")
            r = line(f"{pl}-byte modem payload", c, payload=pl, pool=pool)
            r["burst_s"] = round(study.burst_seconds(GUARD, pl), 3)
            out["D"].append(r)
            print(f"{'':<42}   burst {r['burst_s']:.2f} s", flush=True)

        print(f"\n=== E. mid-burst interruption (DRR +12 dB, SNR 20 dB) ===")
        out["E"] = []
        for d in (0.0, 0.05, 0.1, 0.25, 0.5):
            c = ch.Conditions(drr_db=12, snr_db=20, noise="babble",
                              dropout=(0.5, d) if d else ())
            out["E"].append(line(f"{int(d*1000):4d} ms dropout mid-burst", c, pool=pool))

    json.dump(out, open(os.path.join(HERE, "results_bcd.json"), "w"), indent=1)
    print("\nelapsed", round(time.time() - t0, 1), "s")
