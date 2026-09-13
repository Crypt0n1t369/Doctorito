"""Impairment chain: broadcast processing -> FM link -> loudspeaker -> room ->
ambient noise -> phone microphone -> clock offset.

Every stage is a documented model, not a measurement of any particular station,
radio or handset. The purpose is to find which stage dominates and where the
cliff edge sits, so that a physical trial knows what to measure.

Signal-to-noise ratio is defined throughout as the ratio of modem-burst power to
ambient-noise power, both measured in the modem's occupied band (688-2313 Hz),
at the microphone. That is the quantity a field test can actually measure.
"""

from dataclasses import dataclass, field
import numpy as np

FS_AIR = 48000          # acoustic / broadcast simulation rate
FS_MODEM = 8000


# ------------------------------------------------------------- resampling

def resample(x: np.ndarray, num: int) -> np.ndarray:
    """Band-limited resample to `num` samples via the frequency domain."""
    n = x.size
    X = np.fft.rfft(x)
    keep = min(X.size, num // 2 + 1)
    Y = np.zeros(num // 2 + 1, dtype=complex)
    Y[:keep] = X[:keep]
    return np.fft.irfft(Y, num) * (num / n)


def clock_offset(x: np.ndarray, ppm: float) -> np.ndarray:
    """Receiver sample-clock error: resample by (1 + ppm*1e-6)."""
    if ppm == 0:
        return x
    idx = np.arange(0, x.size - 2, 1.0 / (1 + ppm * 1e-6))
    i0 = idx.astype(int)
    f = idx - i0
    return x[i0] * (1 - f) + x[i0 + 1] * f


# ----------------------------------------------------------------- filters

def _fir_lowpass(cutoff, fs, taps=257):
    n = np.arange(taps) - (taps - 1) / 2
    h = np.sinc(2 * cutoff / fs * n) * np.hamming(taps)
    return h / h.sum()


def _fir_highpass(cutoff, fs, taps=257):
    h = _fir_lowpass(cutoff, fs, taps)
    d = np.zeros(taps); d[(taps - 1) // 2] = 1.0
    return d - h


def fftconv(x, h):
    """Full linear convolution via FFT -- the room impulse response is tens of
    thousands of taps, so direct convolution dominates runtime."""
    n = x.size + h.size - 1
    nfft = 1 << int(np.ceil(np.log2(n)))
    return np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(h, nfft), nfft)[:n]


def _apply(x, h):
    y = fftconv(x, h)
    off = (h.size - 1) // 2
    return y[off:off + x.size]


def bandpass(x, lo, hi, fs):
    y = _apply(x, _fir_lowpass(hi, fs)) if hi < fs / 2 else x
    return _apply(y, _fir_highpass(lo, fs)) if lo > 0 else y


_DEC = 12                    # envelope followers run at fs/12; gain control is
                             # slow by design, so this is faithful and ~12x faster


def _envelope(env, fs, attack_ms, release_ms):
    """Asymmetric attack/release envelope follower, evaluated at a decimated
    rate and interpolated back. Peak-pooling keeps transient attacks honest."""
    n = env.size
    pad = (-n) % _DEC
    blocks = np.concatenate([env, np.zeros(pad)]).reshape(-1, _DEC).max(axis=1)
    fsd = fs / _DEC
    aa = np.exp(-1.0 / (fsd * attack_ms / 1000))
    ar = np.exp(-1.0 / (fsd * release_ms / 1000))
    out = np.empty_like(blocks); acc = 1e-6
    for i in range(blocks.size):
        k = aa if blocks[i] > acc else ar
        acc = k * acc + (1 - k) * blocks[i]
        out[i] = acc
    xp = np.arange(blocks.size) * _DEC + _DEC / 2
    return np.interp(np.arange(n), xp, out)


# --------------------------------------------------- FM broadcast processing

def preemphasis(x, fs, tau=50e-6):
    """European 50 us pre-emphasis (a first-order high-boost)."""
    a = np.exp(-1.0 / (fs * tau))
    y = np.empty_like(x)
    y[0] = x[0]
    y[1:] = x[1:] - a * x[:-1]
    return y / (1 + a)


def deemphasis(x, fs, tau=50e-6):
    """One-pole de-emphasis, applied as a truncated FIR (the pole decays fast
    enough that 60 taps is exact to well below the noise floor)."""
    a = np.exp(-1.0 / (fs * tau))
    h = a ** np.arange(60)
    return fftconv(x, h)[:x.size] * (1 - a)


def compressor(x, fs, ratio=4.0, attack_ms=1.0, release_ms=80.0, thresh=0.1):
    """Feed-forward broadcast-style compressor with a fast attack.

    Broadcast processors ride the gain hard; a data burst that starts quietly
    gets pumped up, and the gain moves during the burst.
    """
    if ratio <= 1.0:
        return x
    e = _envelope(np.abs(x), fs, attack_ms, release_ms)
    gain = np.ones_like(e)
    over = e > thresh
    gain[over] = (thresh / e[over]) ** (1 - 1 / ratio)
    return x * gain


def clip(x, headroom_db):
    """Hard clipping / limiting. Generates harmonics and intermodulation that
    land back inside the occupied band."""
    if headroom_db is None:
        return x
    peak = np.abs(x).max() + 1e-12
    thr = peak * 10 ** (-headroom_db / 20)
    return np.clip(x, -thr, thr)


# ------------------------------------------------------- speaker and room

SPEAKERS = {
    # (low cut Hz, high cut Hz, nonlinearity drive)
    "cheap":  (330.0, 4500.0, 2.6),   # pocket/kitchen radio, single small driver
    "radio":  (260.0, 7000.0, 1.6),   # ordinary mains/battery radio
    "car":    (110.0, 12000.0, 1.15), # car audio, multiple drivers, more headroom
}


def speaker(x, fs, kind="radio"):
    """Loudspeaker colouration: bass roll-off, limited top, and cone
    nonlinearity at listening level."""
    lo, hi, drive = SPEAKERS[kind]
    y = bandpass(x, lo, hi, fs)
    return np.tanh(y * drive) / drive


def room_ir(rt60, drr_db, fs, rng):
    """Synthetic room impulse response: a direct path plus exponentially
    decaying diffuse noise, scaled to the requested direct-to-reverberant ratio.
    """
    if rt60 <= 0:
        return np.array([1.0])
    n = int(rt60 * fs)
    t = np.arange(n) / fs
    tail = rng.normal(0, 1, n) * np.exp(-6.9078 * t / rt60)
    pre = int(0.004 * fs)                       # 4 ms before diffuse onset
    tail[:pre] = 0.0
    tail /= np.sqrt(np.sum(tail ** 2)) + 1e-12
    direct = 10 ** (drr_db / 20)
    h = np.zeros(n); h[0] = direct
    return h + tail


def ambient(n, kind, fs, rng):
    if kind == "pink":
        w = rng.normal(0, 1, n)
        X = np.fft.rfft(w)
        f = np.arange(X.size); f[0] = 1
        return np.fft.irfft(X / np.sqrt(f), n)
    if kind == "road":
        # Car cabin noise: tyre and engine energy is heavily low-frequency
        # weighted, falling roughly 9 dB/octave above ~250 Hz. That matters here
        # because the modem sits at 688-2313 Hz, well above the worst of it.
        w = rng.normal(0, 1, n)
        X = np.fft.rfft(w)
        f = np.fft.rfftfreq(n, 1 / fs); f[0] = f[1]
        shape = 1.0 / (1.0 + (f / 250.0) ** 1.5)
        return np.fft.irfft(X * shape / np.sqrt(f / f[0]), n)
    if kind == "babble":
        # speech-shaped: pink noise with a 300-3000 Hz emphasis and 4 Hz
        # syllabic amplitude modulation
        base = ambient(n, "pink", fs, rng)
        base = bandpass(base, 150.0, 4000.0, fs)
        t = np.arange(n) / fs
        mod = 0.6 + 0.4 * np.abs(np.sin(2 * np.pi * 3.5 * t + rng.uniform(0, 6)))
        return base * mod
    return rng.normal(0, 1, n)


# ---------------------------------------------------------- phone microphone

def mic_agc(x, fs, target=0.15, attack_ms=8.0, release_ms=250.0):
    e = _envelope(np.abs(x), fs, attack_ms, release_ms)
    return x * (target / (e + 1e-4))


def noise_suppressor(x, fs, aggressiveness=1.6, n_fft=512):
    """Representative phone voice-preprocessing noise suppressor.

    Spectral-subtraction gate with a slowly-adapting noise floor. A steady modem
    tone set looks stationary to this estimator, so the floor creeps up towards
    the signal and the gate attenuates exactly what we want to keep. This models
    the documented hazard of using a processed (VOICE_COMMUNICATION) capture
    path instead of an unprocessed one.
    """
    hop = n_fft // 4
    win = np.hanning(n_fft)
    pad = np.concatenate([x, np.zeros(n_fft)])
    out = np.zeros_like(pad); wsum = np.zeros_like(pad)
    floor = None
    for i in range(0, pad.size - n_fft, hop):
        seg = pad[i:i + n_fft] * win
        X = np.fft.rfft(seg)
        mag = np.abs(X)
        floor = mag.copy() if floor is None else 0.92 * floor + 0.08 * mag
        gain = np.maximum(0.05, 1.0 - aggressiveness * floor / (mag + 1e-12))
        y = np.fft.irfft(X * gain, n_fft) * win
        out[i:i + n_fft] += y
        wsum[i:i + n_fft] += win ** 2
    return (out / np.maximum(wsum, 1e-6))[:x.size]


# -------------------------------------------------------------- conditions

@dataclass
class Conditions:
    name: str = "clean"
    broadcast: bool = True       # pre-emphasis, compression, clipping, 15 kHz
    comp_ratio: float = 4.0
    clip_headroom_db: float = 6.0
    use_speaker: bool = True
    speaker_kind: str = "radio"  # "cheap" | "radio" | "car"
    rt60: float = 0.45
    drr_db: float = 6.0          # ~0.3 m from the speaker in a 45 m3 room
                                 # (see study.drr_to_distance)
    snr_db: float = 20.0
    noise: str = "pink"
    agc: bool = True
    ns: bool = False             # phone noise suppression (processed capture)
    ppm: float = 30.0
    dropout: tuple = ()          # (start_seconds, duration_seconds)
    rir: object = None           # fixed room impulse response; when set, the
                                 # geometry is held constant across repeats so
                                 # that repetition gain can be measured rather
                                 # than assumed


BAND = (687.5, 2312.5)


def band_power(x, fs):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(x.size, 1 / fs)
    m = (f >= BAND[0]) & (f <= BAND[1])
    return np.sum(np.abs(X[m]) ** 2) / x.size ** 2


def apply(x8k: np.ndarray, c: Conditions, rng) -> np.ndarray:
    """Run a modem burst at 8 kHz through the chain; return 8 kHz at the mic."""
    n_air = int(round(x8k.size * FS_AIR / FS_MODEM))
    x = resample(x8k, n_air)
    fs = FS_AIR

    if c.broadcast:
        x = preemphasis(x, fs)
        x = compressor(x, fs, ratio=c.comp_ratio)
        x = clip(x, c.clip_headroom_db)
        x = _apply(x, _fir_lowpass(15000.0, fs))     # FM baseband limit
        x = deemphasis(x, fs)

    if c.use_speaker:
        x = speaker(x, fs, c.speaker_kind)

    if c.rir is not None:
        x = fftconv(x, c.rir)[:x.size]
    elif c.rt60 > 0:
        h = room_ir(c.rt60, c.drr_db, fs, rng)
        x = fftconv(x, h)[:x.size]

    # inject ambient noise at the requested in-band SNR, measured at the mic
    if np.isfinite(c.snr_db):
        nz = ambient(x.size, c.noise, fs, rng)
        ps, pn = band_power(x, fs), band_power(nz, fs)
        if pn > 0:
            nz *= np.sqrt(ps / pn / 10 ** (c.snr_db / 10))
        x = x + nz

    if c.dropout:
        s, d = c.dropout
        a, b = int(s * fs), int((s + d) * fs)
        x[a:min(b, x.size)] = 0.0

    x = bandpass(x, 120.0, 7500.0, fs)               # microphone response
    if c.ns:
        x = noise_suppressor(x, fs)
    if c.agc:
        x = mic_agc(x, fs)
    x = clock_offset(x, c.ppm)

    return resample(x, int(round(x.size * FS_MODEM / FS_AIR)))
