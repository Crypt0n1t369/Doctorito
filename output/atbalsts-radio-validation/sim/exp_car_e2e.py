"""The car scenario, end to end: real signed fixture -> audio -> car cabin ->
phone -> Ed25519 verification -> applied records. No extra hardware beyond the
car's own radio."""
import json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, end2end, modem

CAR = dict(rt60=0.05, speaker_kind="car", noise="road")
CASES = [
    ("Parked, engine off · phone on the passenger seat (~50 cm)",  -1, 25),
    ("City 50 km/h · phone in a dash cradle (~30 cm)",              3, 15),
    ("Highway 100 km/h · phone in a dash cradle (~30 cm)",          3,  8),
    ("Highway 100 km/h · phone on the passenger seat (~50 cm)",    -1,  8),
    ("Highway 100 km/h · phone held at the speaker (~10 cm)",      13,  8),
]

if __name__ == "__main__":
    modem.set_fft(256, 64); modem.set_mode("time")
    print(f"{'condition':<58} {'frames':>8} {'objects':>9} {'records':>9} {'1st':>7}")
    print("-" * 95)
    out = []
    for name, drr, snr in CASES:
        c = ch.Conditions(drr_db=drr, snr_db=snr, **CAR)
        rs = [end2end.run(c, seed=2000 + i) for i in range(3)]
        f = np.mean([r["frames_ok"] for r in rs])
        o = np.mean([r["objects_verified"] for r in rs])
        rec = np.mean([r["records_applied"] for r in rs])
        ff = [r["first_frame_s"] for r in rs if r["first_frame_s"]]
        out.append(dict(name=name, drr=drr, snr=snr, frames=f, objects=o, records=rec,
                        first_s=float(np.mean(ff)) if ff else None))
        print(f"{name:<58} {f:>5.1f}/16 {o:>6.1f}/8 {rec:>6.1f}/23 "
              f"{(f'{np.mean(ff):.1f}s' if ff else '--'):>7}", flush=True)
    json.dump(out, open("results_car_e2e.json", "w"), indent=1)
