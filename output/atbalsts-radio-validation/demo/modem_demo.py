"""Self-contained, JS-portable modem for the live demonstration.

Deliberately separate from ../sim/modem.py: every pseudo-random choice here is
replaced by a closed-form one so that a JavaScript decoder can reproduce it
exactly. No numpy RNG, no library-specific behaviour.

  fs 8000, FFT 512, guard 64 -> 72 ms symbol, 15.625 Hz subcarrier spacing
  106 carriers spanning 672-2313 Hz (2 pilots + 104 data)
  differential QPSK against the previous symbol
  K=7 rate-1/2 convolutional code, soft Viterbi, prime-stride interleaver
  1024-sample chirp preamble, matched-filter detected
  CRC-32C over the payload

15.625 Hz spacing is chosen over the research default 31.25 Hz because the reverberation
study showed spacing is what decides indoor range.
"""
import math
import numpy as np

FS = 8000
N_FFT = 512
GUARD = 64
SYM = N_FFT + GUARD
CENTRE_HZ = 1500.0
N_CARRIERS = 106
N_PILOT = 2
BITS_PER_SYMBOL = (N_CARRIERS - N_PILOT) * 2     # 208
K = 7
POLY = (0o133, 0o171)
N_STATES = 1 << (K - 1)
CHIRP_LEN = 1024
CHIRP_F0, CHIRP_F1 = 700.0, 2300.0
LEAD = 160          # samples of silence before the chirp
TAIL = 160

_c0 = int(round(CENTRE_HZ / FS * N_FFT)) - N_CARRIERS // 2
BINS = np.arange(_c0, _c0 + N_CARRIERS)
OCCUPIED = (BINS[0] * FS / N_FFT, BINS[-1] * FS / N_FFT)


def crc32c(data):
    crc = 0xFFFFFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82F63B78 if crc & 1 else 0)
    return crc ^ 0xFFFFFFFF


assert crc32c(b"123456789") == 0xE3069283


# --- deterministic reference symbol: quadratic (good peak-to-average, no RNG) --
def ref_phase(k):
    return (math.pi / 2) * ((k * (k + 1) // 2) % 4)


REF_PHASES = np.array([ref_phase(k) for k in range(N_CARRIERS)])


# --- deterministic interleaver: prime stride, computable in any language ------
def _gcd(a, b):
    while b:
        a, b = b, a % b
    return a


def stride_for(n):
    s = int(math.isqrt(n)) | 1
    while _gcd(s, n) != 1:
        s += 2
    return s


def perm_for(n):
    s = stride_for(n)
    return (np.arange(n) * s) % n


# --- convolutional code -------------------------------------------------------
def _par(x):
    x ^= x >> 8; x ^= x >> 4; x ^= x >> 2; x ^= x >> 1
    return x & 1


_NEXT = np.zeros((N_STATES, 2), dtype=np.int32)
_OUT = np.zeros((N_STATES, 2, 2), dtype=np.int8)
for _s in range(N_STATES):
    for _b in (0, 1):
        reg = (_b << (K - 1)) | _s
        _NEXT[_s, _b] = reg >> 1
        for _j, _p in enumerate(POLY):
            _OUT[_s, _b, _j] = _par(reg & _p)

_PREV = np.zeros((N_STATES, 2), dtype=np.int32)
_PREV_BIT = np.zeros((N_STATES, 2), dtype=np.int8)
_PREV_OUT = np.zeros((N_STATES, 2, 2), dtype=np.int8)
_fill = np.zeros(N_STATES, dtype=np.int32)
for _s in range(N_STATES):
    for _b in (0, 1):
        _ns = _NEXT[_s, _b]; _i = _fill[_ns]
        _PREV[_ns, _i] = _s; _PREV_BIT[_ns, _i] = _b; _PREV_OUT[_ns, _i] = _OUT[_s, _b]
        _fill[_ns] += 1


def conv_encode(bits):
    state = 0
    out = np.empty(bits.size * 2, dtype=np.int8)
    for i, b in enumerate(bits):
        out[2 * i:2 * i + 2] = _OUT[state, b]
        state = _NEXT[state, b]
    return out


def viterbi(soft, n_info):
    pairs = soft.reshape(-1, 2)
    sign = 1 - 2 * _PREV_OUT.astype(np.float64)
    metric = np.full(N_STATES, -1e9); metric[0] = 0.0
    back = np.zeros((pairs.shape[0], N_STATES), dtype=np.int8)
    for t in range(pairs.shape[0]):
        bm = sign[:, :, 0] * pairs[t, 0] + sign[:, :, 1] * pairs[t, 1]
        cand = metric[_PREV] + bm
        ch = np.argmax(cand, axis=1)
        back[t] = ch
        metric = cand[np.arange(N_STATES), ch]
        metric -= metric.max()
    state = 0
    bits = np.zeros(pairs.shape[0], dtype=np.int8)
    for t in range(pairs.shape[0] - 1, -1, -1):
        i = back[t, state]
        bits[t] = _PREV_BIT[state, i]
        state = _PREV[state, i]
    return bits[:n_info]


# --- preamble -----------------------------------------------------------------
def _chirp():
    t = np.arange(CHIRP_LEN) / FS
    dur = CHIRP_LEN / FS
    ph = 2 * np.pi * (CHIRP_F0 * t + (CHIRP_F1 - CHIRP_F0) / (2 * dur) * t ** 2)
    return np.cos(ph) * np.hanning(CHIRP_LEN)


CHIRP = _chirp()


def n_data_symbols(payload_len):
    n_info = payload_len * 8 + 32 + (K - 1)
    return int(math.ceil(n_info * 2 / BITS_PER_SYMBOL))


def burst_samples(payload_len):
    return LEAD + CHIRP_LEN + GUARD + GUARD + (n_data_symbols(payload_len) + 1) * SYM + TAIL


def burst_seconds(payload_len):
    return burst_samples(payload_len) / FS


GRAY = [0, 1, 3, 2]

# A peak-to-average limiter was tried here and removed. Clipping the OFDM body
# from its natural ~16 dB peak-to-average down to 8 dB does raise the delivered
# average level by about 5 dB at a fixed speaker peak, but measured decoding got
# WORSE, not better: 95/100 -> 74/100 at DRR +9 dB, SNR +8 dB. The clip-and-
# refilter step has to run per symbol and rebuild the cyclic prefix; filtering
# the concatenated body with one FFT smears energy across symbol boundaries and
# introduced -15.4 dB EVM. Doing it correctly is a real range improvement and is
# left as known work rather than shipped broken.

def modulate(payload, amplitude=0.32):
    crc = crc32c(payload)
    raw = bytes(payload) + crc.to_bytes(4, "big")
    bits = np.unpackbits(np.frombuffer(raw, dtype=np.uint8)).astype(np.int8)
    info = np.concatenate([bits, np.zeros(K - 1, dtype=np.int8)])
    coded = conv_encode(info)
    n_sym = n_data_symbols(len(payload))
    need = n_sym * BITS_PER_SYMBOL
    coded = np.concatenate([coded, np.zeros(need - coded.size, dtype=np.int8)])
    coded = coded[perm_for(need)]

    di = coded.reshape(-1, 2)
    idx = np.array([GRAY[a * 2 + b] for a, b in di])
    delta = np.zeros((n_sym, N_CARRIERS))
    delta[:, 1:-1] = idx.reshape(n_sym, N_CARRIERS - N_PILOT) * (np.pi / 2)

    phases = [REF_PHASES.copy()]
    for d in delta:
        phases.append(phases[-1] + d)

    out = [np.zeros(GUARD)]
    for ph in phases:
        spec = np.zeros(N_FFT, dtype=complex)
        spec[BINS] = np.exp(1j * ph)
        spec[N_FFT - BINS] = np.conj(spec[BINS])
        sym = np.fft.ifft(spec).real
        sym /= np.sqrt(np.mean(sym ** 2))
        out.append(np.concatenate([sym[-GUARD:], sym]))
    body = np.concatenate(out)
    body *= amplitude / np.sqrt(np.mean(body ** 2)) * 0.38
    pre = CHIRP * (amplitude / np.abs(CHIRP).max())
    return np.concatenate([np.zeros(LEAD), pre, np.zeros(GUARD), body, np.zeros(TAIL)])


def find_preamble(rx):
    n = 1 << int(math.ceil(math.log2(rx.size + CHIRP.size)))
    corr = np.fft.irfft(np.fft.rfft(rx, n) * np.conj(np.fft.rfft(CHIRP, n)), n)
    return int(np.argmax(np.abs(corr[:rx.size])))


def demodulate_at(rx, chirp_start, payload_len):
    """chirp_start = index of the chirp's first sample."""
    n_sym = n_data_symbols(payload_len) + 1
    base = chirp_start + CHIRP_LEN + GUARD + GUARD
    best = None
    for off in (-16, -8, 0, 8, 16):
        s = base + off
        if s < 0 or s + n_sym * SYM > rx.size:
            continue
        blocks = rx[s:s + n_sym * SYM].reshape(n_sym, SYM)[:, GUARD:]
        spec = np.fft.fft(blocks, axis=1)[:, BINS]
        diff = spec[1:, :] * np.conj(spec[:-1, :])
        m = np.abs(diff).sum()
        if best is None or m > best[0]:
            best = (m, diff)
    if best is None:
        return None, False
    diff = best[1]

    unit = diff / (np.abs(diff) + 1e-12)
    rot = np.angle((unit ** 4).mean()) / 4.0
    pil = diff[:, [0, -1]].reshape(-1)
    cand = rot + np.arange(4) * (np.pi / 2)
    score = np.abs(np.angle(pil[:, None] * np.exp(-1j * cand[None, :]))).sum(axis=0)
    rot = cand[int(np.argmin(score))]
    diff = diff[:, 1:-1] * np.exp(-1j * rot)

    ang = np.angle(diff)
    amp = np.abs(diff); amp = amp / (amp.mean() + 1e-12)
    soft = np.empty(diff.shape + (2,))
    soft[..., 0] = (np.cos(ang) + np.sin(ang)) / np.sqrt(2) * amp
    soft[..., 1] = (np.cos(ang) - np.sin(ang)) / np.sqrt(2) * amp
    soft = soft.reshape(-1)

    de = np.empty_like(soft)
    de[perm_for(soft.size)] = soft
    n_info = payload_len * 8 + 32 + (K - 1)
    bits = viterbi(de, n_info)
    data = np.packbits(bits[:payload_len * 8 + 32].astype(np.uint8))
    payload = bytes(data[:payload_len])
    crc_rx = int.from_bytes(bytes(data[payload_len:payload_len + 4]), "big")
    return payload, crc32c(payload) == crc_rx


def demodulate(rx, payload_len):
    return demodulate_at(rx, find_preamble(rx), payload_len)
