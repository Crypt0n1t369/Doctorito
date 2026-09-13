"""Experiment J -- the car cabin, and cheap-radio hardware.

A car is not a small living room. Reverberation time is ~0.05 s instead of
~0.45 s, so the echo tail is short enough that the guard interval may finally
matter; and cabin noise is heavily low-frequency, so it costs far less in the
modem's band than its A-weighted level suggests.
"""
import json, sys, os, time
from dataclasses import replace
from multiprocessing import Pool
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study

N = 120
CAR = dict(rt60=0.05, speaker_kind="car", noise="road")
ROOM = dict(rt60=0.45, speaker_kind="radio", noise="babble")


def line(tag, c, guard=64, pool=None, n=N, payload=128):
    k, nn = study.run(c, n=n, guard=guard, payload_len=payload, mode="time",
                      seed0=abs(hash((tag, guard, payload))) % 10**6, pool=pool)
    lo, hi = study.wilson(k, nn)
    print(f"{tag:<50} {k:3d}/{nn} {k/nn:5.0%}  (95% CI {lo:.0%}-{hi:.0%})", flush=True)
    return dict(tag=tag, guard=guard, ok=k, n=nn, rate=k / nn, lo=lo, hi=hi)


if __name__ == "__main__":
    t0 = time.time(); out = {}
    with Pool(8) as pool:
        print("=== J1. car cabin: DRR sweep (road noise 15 dB, car audio) ===")
        out["J1"] = [line(f"DRR {d:+3d} dB  (~{study.drr_to_distance(d,3.0,0.05)*100:.0f} cm from a speaker)",
                          ch.Conditions(drr_db=d, snr_db=15, **CAR), pool=pool)
                     for d in (-12, -9, -6, -3, 0, 3, 6, 9, 12)]

        print("\n=== J2. does the guard interval matter in a car? (DRR 0 dB) ===")
        out["J2"] = [line(f"guard {g/8:.0f} ms, car cabin, DRR 0 dB",
                          ch.Conditions(drr_db=0, snr_db=15, **CAR), guard=g, pool=pool)
                     for g in (32, 64, 128, 256)]
        print("   (same sweep in a living room for contrast)")
        out["J2room"] = [line(f"guard {g/8:.0f} ms, living room, DRR +6 dB",
                              ch.Conditions(drr_db=6, snr_db=15, **ROOM), guard=g, pool=pool)
                         for g in (32, 64, 128, 256)]

        print("\n=== J3. realistic in-car placements vs road noise ===")
        out["J3"] = []
        for place, drr in [("phone touching the speaker grille (~3 cm)", 23),
                           ("phone held at the speaker (~10 cm)", 13),
                           ("phone in a dash cradle (~30 cm)", 3),
                           ("phone on the passenger seat (~50 cm)", -1)]:
            for snr, cond in [(25, "parked, engine off"), (15, "city, 50 km/h"),
                              (8, "highway, 100 km/h")]:
                out["J3"].append({**line(f"{place} · {cond}",
                                         ch.Conditions(drr_db=drr, snr_db=snr, **CAR), pool=pool),
                                  "drr": drr, "snr": snr, "place": place, "cond": cond})

        print("\n=== J4. cheap hardware in a living room (DRR +12 dB, SNR 15 dB) ===")
        out["J4"] = [line(f"{k} loudspeaker",
                          ch.Conditions(drr_db=12, snr_db=15, rt60=0.45,
                                        speaker_kind=k, noise="babble"), pool=pool)
                     for k in ("cheap", "radio", "car")]

    json.dump(out, open("results_car.json", "w"), indent=1)
    print("\nelapsed", round(time.time() - t0, 1), "s")
