"""Several radios transmitting at once into one receiver.

Each sender occupies a different slice of the SAME radio channel's audio
passband (300-3400 Hz), including its own sync tone. The receiver gets the
sum of all of them and runs one decoder per slice.
"""
import sys, numpy as np
sys.path.insert(0, "/Users/kristaps/Documents/New project/output/atbalsts-radio-validation/sim")
import modem as M

FS = M.FS
BW = 450.0
SLICES = [800.0, 1500.0, 2200.0, 2900.0]   # centres, 700 Hz apart
PAYLOAD = 40

def tune(centre):
    """Point the whole modem -- data carriers AND sync tone -- at one slice."""
    M.CENTRE_HZ = centre
    M.CHIRP_F0, M.CHIRP_F1 = centre - 300.0, centre + 300.0
    M.CHIRP = M._chirp()
    M.set_fft(512, 64, BW)
    M.set_mode("time")

def passband(x, lo=300.0, hi=3400.0):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(x.size, 1/FS)
    X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, x.size)

rng = np.random.default_rng(4)
pays = [bytes(rng.integers(0, 256, PAYLOAD, dtype=np.uint8)) for _ in SLICES]
sigs = []
for c, p in zip(SLICES, pays):
    tune(c); sigs.append(M.modulate(p))
n = max(s.size for s in sigs)
print(f"{len(SLICES)} senders sharing one 300-3400 Hz radio channel")
print(f"slices at {', '.join(f'{c:.0f}' for c in SLICES)} Hz, {BW:.0f} Hz each, "
      f"250 Hz guard bands")
print(f"{PAYLOAD}-byte report, {n/FS:.2f} s on air\n")

def run(snr_db, seed):
    r = np.random.default_rng(seed)
    offs = r.integers(0, 3000, len(SLICES))        # senders NOT synchronised
    mix = np.zeros(n + 4000)
    for s, off in zip(sigs, offs):
        mix[off:off+s.size] += s
    mix = passband(mix)
    p = np.mean(mix**2)
    mix += r.normal(0, np.sqrt(p / 10**(snr_db/10)), mix.size)
    out = []
    for c, want in zip(SLICES, pays):
        tune(c)
        got, ok = M.demodulate(mix, PAYLOAD)
        out.append(ok and got == want)
    return out

print("=== ALL FOUR KEYING UP SIMULTANEOUSLY ===")
for snr in (30, 20, 15, 12, 10, 8, 6):
    per = np.zeros(len(SLICES), int); tot = 0
    for t in range(6):
        r = run(snr, 900 + t)
        per += np.array(r, int); tot += sum(r)
    bars = " ".join(f"{c:.0f}Hz:{k}/6" for c, k in zip(SLICES, per))
    print(f"  SNR {snr:2d} dB -> {tot:2d}/24 reports   {bars}")
