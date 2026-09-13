"""Narrowband FM: what really happens when two radios key up on one channel.

NBFM as used by ham 2 m/70 cm and PMR446: 12.5 kHz channel, +-2.5 kHz
deviation, 300-3000 Hz audio, 750 us pre/de-emphasis.
"""
import sys, numpy as np
sys.path.insert(0, "/Users/kristaps/Documents/New project/output/atbalsts-radio-validation/sim")
import modem as M

FS_A = 8000          # audio rate
UP   = 12            # -> 96 kHz IF rate, enough for a 12.5 kHz channel
FS_I = FS_A * UP
DEV  = 2500.0        # +-2.5 kHz peak deviation
TAU  = 750e-6        # NBFM emphasis time constant

def resample(x, up):
    X = np.fft.rfft(x); Y = np.zeros(x.size*up//2 + 1, complex)
    Y[:X.size] = X * up
    return np.fft.irfft(Y, x.size*up)

def decimate(x, dn):
    X = np.fft.rfft(x); keep = x.size//dn//2 + 1
    return np.fft.irfft(X[:keep] / dn, x.size//dn)

def emphasis(x, fs, tau, pre=True):
    """One-pole 6 dB/octave pre- or de-emphasis."""
    a = np.exp(-1.0/(fs*tau))
    y = np.empty_like(x)
    if pre:                       # differentiator-ish: boost highs
        prev_x = prev_y = 0.0
        for i, s in enumerate(x):
            prev_y = s - a*prev_x + a*prev_y
            prev_x = s; y[i] = prev_y
        return y / np.max(np.abs(y) + 1e-12) * np.max(np.abs(x))
    prev_y = 0.0                  # integrator: restore
    for i, s in enumerate(x):
        prev_y = (1-a)*s + a*prev_y
        y[i] = prev_y
    return y

def tx(audio, f_off=0.0, gain=1.0):
    """Audio -> NBFM complex baseband at FS_I."""
    a = emphasis(audio, FS_A, TAU, pre=True)
    a = a / (np.max(np.abs(a)) + 1e-12)
    a = resample(a, UP)
    ph = 2*np.pi*np.cumsum(DEV*a + f_off)/FS_I
    return gain * np.exp(1j*ph)

def _iffilt(y):
    Y = np.fft.fft(y); f = np.fft.fftfreq(y.size, 1/FS_I)
    Y[np.abs(f) > 6250] = 0
    return np.fft.ifft(Y)

def rx(iq, cnr_db, seed=7):
    """CNR is defined IN THE CHANNEL BANDWIDTH, after the IF filter."""
    r = np.random.default_rng(seed)
    n = r.normal(0,1,iq.size) + 1j*r.normal(0,1,iq.size)
    p_sig = np.mean(np.abs(_iffilt(iq))**2)
    p_n   = np.mean(np.abs(_iffilt(n))**2)          # noise power that survives
    n *= np.sqrt(p_sig/(10**(cnr_db/10)) / p_n)
    y = _iffilt(iq + n)
    d = np.angle(y[1:] * np.conj(y[:-1])) * FS_I/(2*np.pi)   # discriminator
    d = np.concatenate([[0], d]) / DEV
    d = decimate(d, UP)
    return emphasis(d, FS_A, TAU, pre=False)

# ---- one 40-byte report through the modem, centred normally
M.CENTRE_HZ = 1500.0
M.CHIRP_F0, M.CHIRP_F1 = 700.0, 2300.0
M.CHIRP = M._chirp()
M.set_fft(512, 64, 1650.0); M.set_mode("time")
rng = np.random.default_rng(11)
pa = bytes(rng.integers(0,256,40,dtype=np.uint8))
pb = bytes(rng.integers(0,256,40,dtype=np.uint8))
sa = M.modulate(pa); sb = M.modulate(pb)
n = max(sa.size, sb.size) + 2000
A = np.zeros(n); A[:sa.size] = sa
B = np.zeros(n); B[400:400+sb.size] = sb

print("NBFM, 12.5 kHz channel, +-2.5 kHz deviation, 40-byte report\n")
print("=== ONE STATION ALONE (baseline) ===")
for cnr in (20, 16, 14, 12, 10, 8, 6, 4, 2, 0):
    hits = sum(1 for t in range(5)
               if (lambda r: r[1] and r[0]==pa)(M.demodulate(rx(tx(A), cnr, 40+t), 40)))
    print(f"  CNR {cnr:2d} dB -> {hits}/5 decoded")

print("\n=== TWO STATIONS KEY UP ON THE SAME CHANNEL AT ONCE ===")
print("  (capture effect: the RF signals fight, they do not add up as audio)")
for dgain_db in (20, 10, 6, 3, 1, 0):
    g = 10**(dgain_db/20)
    iq = tx(A, gain=g) + tx(B, f_off=300.0, gain=1.0)
    out = rx(iq, 20)
    ga, oka = M.demodulate(out, 40)
    gb, okb = M.demodulate(out, 40)
    a_ok = oka and ga == pa
    # try to find B too by searching later in the stream
    b_ok = False
    for start in range(0, out.size-1000, 800):
        gg, o = M.demodulate(out[start:], 40)
        if o and gg == pb: b_ok = True; break
        if o and gg == pa: a_ok = True
    print(f"  stronger station +{dgain_db:2d} dB -> "
          f"strong:{'OK ' if a_ok else 'lost'}  weak:{'OK ' if b_ok else 'lost'}")
