"""Experiment F -- transmission-side disruptions.

   F1  weak FM reception: hiss injected BEFORE the loudspeaker (so it is shaped
       by the speaker and the room, unlike ambient room noise)
   F2  programme audio (speech/music) overlapping the data burst
   F3  late tune-in: the burst is already running when the receiver starts
"""
import json, sys, os, time
from dataclasses import replace
from multiprocessing import Pool
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import channel as ch, study, modem

N = 120
BASE = ch.Conditions(drr_db=12, snr_db=25, noise="babble")


def programme(n, fs, rng):
    """Speech/music-like interferer: harmonic stack + formant-ish shaping and
    syllabic modulation, occupying the same band as the modem."""
    t = np.arange(n) / fs
    y = np.zeros(n)
    for k, f0 in enumerate([180.0, 240.0, 330.0]):
        for h in range(1, 9):
            y += (np.sin(2 * np.pi * f0 * h * t + rng.uniform(0, 6))
                  / (h + 1) * rng.uniform(0.5, 1.0))
    y = ch.bandpass(y, 200.0, 4000.0, fs)
    mod = 0.4 + 0.6 * np.abs(np.sin(2 * np.pi * 2.7 * t + rng.uniform(0, 6)))
    return y * mod


def _one(job):
    kind, cond, arg, seed = job
    modem.set_mode("time"); modem.set_guard(64)
    rng = np.random.default_rng(seed)
    pay = bytes(rng.integers(0, 256, 128, dtype=np.uint8))
    tx = modem.modulate(pay)

    if kind == "hiss":
        # noise added at the FM receiver output, before the loudspeaker
        n_air = int(round(tx.size * ch.FS_AIR / ch.FS_MODEM))
        x = ch.resample(tx, n_air)
        nz = rng.normal(0, 1, x.size)
        ps, pn = ch.band_power(x, ch.FS_AIR), ch.band_power(nz, ch.FS_AIR)
        x = x + nz * np.sqrt(ps / pn / 10 ** (arg / 10))
        tx = ch.resample(x, tx.size)
    elif kind == "programme":
        n_air = int(round(tx.size * ch.FS_AIR / ch.FS_MODEM))
        x = ch.resample(tx, n_air)
        pr = programme(x.size, ch.FS_AIR, rng)
        ps, pp = ch.band_power(x, ch.FS_AIR), ch.band_power(pr, ch.FS_AIR)
        x = x + pr * np.sqrt(ps / pp / 10 ** (arg / 10))
        tx = ch.resample(x, tx.size)

    rx = ch.apply(tx, cond, rng)
    if kind == "late":
        rx = rx[int(arg * modem.FS):]           # receiver starts mid-burst
    got, ok = modem.demodulate(rx, 128)
    return bool(ok and got == pay)


def line(tag, jobs, pool):
    k = sum(pool.map(_one, jobs)); lo, hi = study.wilson(k, N)
    print(f"{tag:<44} {k:3d}/{N}  {k/N:5.0%}  (95% CI {lo:.0%}-{hi:.0%})", flush=True)
    return dict(tag=tag, ok=k, n=N, rate=k / N, lo=lo, hi=hi)


if __name__ == "__main__":
    t0 = time.time(); out = {}
    with Pool(8) as pool:
        print("=== F1. weak FM reception (hiss before the loudspeaker) ===")
        out["F1"] = [line(f"receiver SNR {s:+d} dB",
                          [("hiss", BASE, s, abs(hash(("h", s, i))) % 10**7) for i in range(N)], pool)
                     for s in (30, 25, 20, 15, 12, 10, 8, 6)]
        print("\n=== F2. programme audio overlapping the burst ===")
        out["F2"] = [line(f"burst {s:+d} dB above programme audio",
                          [("programme", BASE, s, abs(hash(("p", s, i))) % 10**7) for i in range(N)], pool)
                     for s in (20, 15, 10, 6, 3, 0, -3)]
        print("\n=== F3. late tune-in (receiver starts mid-burst) ===")
        out["F3"] = [line(f"missed first {int(s*1000)} ms of the burst",
                          [("late", BASE, s, abs(hash(("l", s, i))) % 10**7) for i in range(N)], pool)
                     for s in (0.0, 0.05, 0.1, 0.2, 0.4)]
    json.dump(out, open("results_f.json", "w"), indent=1)
    print("\nelapsed", round(time.time() - t0, 1), "s")

# appended: payload size at a MARGINAL operating point, where frame length
# actually trades against reliability
