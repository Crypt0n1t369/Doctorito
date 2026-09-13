"""Representative coded-OFDM audio modem for the Atbalsts radio validation.

This is NOT a Rattlegram clone. It is a same-class modem -- differential QPSK on
OFDM subcarriers, ~1.6 kHz occupied bandwidth, cyclic-prefix guard interval,
rate-1/2 convolutional FEC with interleaving -- built so that channel results
transfer as class evidence rather than as a claim about Rattlegram's own
polar-coded implementation. Parameters are chosen to land within ~20% of
Rattlegram's published burst duration for the same payload size.

Design:
  fs           8000 Hz internal modem rate
  N_fft        256  -> 31.25 Hz subcarrier spacing
  guard        64 samples (8 ms cyclic prefix)
  symbol       320 samples = 40 ms
  carriers     53 active (52 differential pairs) spanning ~1.66 kHz
  centre       1500 Hz  -> occupied roughly 670..2330 Hz
  modulation   DQPSK differential ACROSS FREQUENCY (no channel estimation,
               first-order immune to carrier/sample-clock offset)
  FEC          K=7 rate-1/2 convolutional, G=(133,171) octal, soft Viterbi
  interleave   block interleaver over the whole packet
  sync         linear chirp preamble, matched-filter detected
  integrity    CRC-32C over the payload
"""

import numpy as np

FS = 8000
N_FFT = 256
GUARD = 64                   # cyclic prefix, samples (8 ms) -- see set_guard()
SYM = N_FFT + GUARD          # 320 samples = 40 ms
N_CARRIERS = 53              # 52 differential pairs: 2 pilots + 50 data
CENTRE_HZ = 1500.0
N_PILOT = 2                  # two pilot carriers/pairs carry a known zero step
MODE = "freq"                # "freq" = differential across subcarriers
                             # "time" = differential against the previous symbol
BITS_PER_SYMBOL = (N_CARRIERS - 1 - N_PILOT) * 2


def set_mode(mode: str):
    """Choose the differential reference axis.

    'freq' references the adjacent subcarrier. It needs no reference symbol, but
    it assumes the channel is flat between neighbouring carriers -- which a
    reverberant room is not: coherence bandwidth there is a few Hz against a
    31.25 Hz carrier spacing.

    'time' references the same subcarrier in the previous symbol. A room that
    nobody is moving in is essentially static, so the channel cancels exactly;
    a notch then costs amplitude but not phase. It costs one reference symbol.
    """
    global MODE, BITS_PER_SYMBOL
    MODE = mode
    BITS_PER_SYMBOL = ((N_CARRIERS - 1 - N_PILOT) if mode == "freq"
                       else (N_CARRIERS - N_PILOT)) * 2

def set_fft(n_fft: int, guard: int, bandwidth_hz: float = 1650.0):
    """Reshape the OFDM grid while holding occupied bandwidth roughly constant.

    Subcarrier spacing is the parameter that decides whether differential
    detection survives a reverberant room: the channel must stay flat across
    one spacing, and a room's coherence bandwidth is only a few Hz. Rattlegram
    uses 6.25 Hz spacing with 160 ms symbols; the default grid here is 31.25 Hz,
    which is deliberately coarser, so this lets the two be compared.
    """
    global N_FFT, GUARD, SYM, N_CARRIERS, BINS, OCCUPIED_HZ, BITS_PER_SYMBOL
    N_FFT = int(n_fft)
    GUARD = int(guard)
    SYM = N_FFT + GUARD
    N_CARRIERS = int(round(bandwidth_hz / (FS / N_FFT)))
    c0 = int(round(CENTRE_HZ / FS * N_FFT)) - N_CARRIERS // 2
    BINS = np.arange(c0, c0 + N_CARRIERS)
    OCCUPIED_HZ = (BINS[0] * FS / N_FFT, BINS[-1] * FS / N_FFT)
    set_mode(MODE)
    globals()["REF_PHASES"] = (np.random.default_rng(0xBEEF)
                               .integers(0, 4, N_CARRIERS) * (np.pi / 2))


def set_guard(samples: int):
    """Set the cyclic-prefix length. Longer guard absorbs more room echo at a
    proportional cost in airtime; this is the main robustness/throughput lever."""
    global GUARD, SYM
    GUARD = int(samples)
    SYM = N_FFT + GUARD


CHIRP_LEN = 1024             # 128 ms
CHIRP_F0, CHIRP_F1 = 700.0, 2300.0

K = 7
POLY = (0o133, 0o171)
N_STATES = 1 << (K - 1)


# ---------------------------------------------------------------- CRC-32C

def crc32c(data: bytes) -> int:
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82F63B78 if crc & 1 else 0)
    return crc ^ 0xFFFFFFFF


assert crc32c(b"123456789") == 0xE3069283


# ------------------------------------------------- convolutional code tables

def _parity(x):
    x ^= x >> 8
    x ^= x >> 4
    x ^= x >> 2
    x ^= x >> 1
    return x & 1


_NEXT = np.zeros((N_STATES, 2), dtype=np.int32)
_OUT = np.zeros((N_STATES, 2, 2), dtype=np.int8)
for _s in range(N_STATES):
    for _b in (0, 1):
        reg = (_b << (K - 1)) | _s
        _NEXT[_s, _b] = reg >> 1
        for _j, _p in enumerate(POLY):
            _OUT[_s, _b, _j] = _parity(reg & _p)

# For the decoder: for each state, the two predecessor states and the input bit
# that caused the transition.
_PREV = np.zeros((N_STATES, 2), dtype=np.int32)
_PREV_BIT = np.zeros((N_STATES, 2), dtype=np.int8)
_PREV_OUT = np.zeros((N_STATES, 2, 2), dtype=np.int8)
_fill = np.zeros(N_STATES, dtype=np.int32)
for _s in range(N_STATES):
    for _b in (0, 1):
        _ns = _NEXT[_s, _b]
        _i = _fill[_ns]
        _PREV[_ns, _i] = _s
        _PREV_BIT[_ns, _i] = _b
        _PREV_OUT[_ns, _i] = _OUT[_s, _b]
        _fill[_ns] += 1
assert (_fill == 2).all()


def conv_encode(bits: np.ndarray) -> np.ndarray:
    """bits -> 2x coded bits, zero-terminated (K-1 tail bits appended by caller)."""
    state = 0
    out = np.empty(bits.size * 2, dtype=np.int8)
    for i, b in enumerate(bits):
        out[2 * i:2 * i + 2] = _OUT[state, b]
        state = _NEXT[state, b]
    return out


def viterbi(soft: np.ndarray, n_info: int) -> np.ndarray:
    """Soft-decision Viterbi. `soft` holds +/- LLR-ish values, 2 per info bit.

    Convention: soft > 0 means the coded bit is more likely 0.
    Returns n_info decoded bits (tail included by caller).
    """
    pairs = soft.reshape(-1, 2)
    n_steps = pairs.shape[0]
    # Branch metric for a hypothesised output pair (c0,c1): higher is better.
    # metric = sum over j of soft_j * (1 - 2*c_j)
    sign = 1 - 2 * _PREV_OUT.astype(np.float64)      # (states, 2, 2)
    metric = np.full(N_STATES, -1e9)
    metric[0] = 0.0
    back = np.zeros((n_steps, N_STATES), dtype=np.int8)

    for t in range(n_steps):
        s0, s1 = pairs[t]
        # contribution of each candidate predecessor branch
        bm = sign[:, :, 0] * s0 + sign[:, :, 1] * s1      # (states, 2)
        cand = metric[_PREV] + bm                          # (states, 2)
        choice = np.argmax(cand, axis=1)
        back[t] = choice
        metric = cand[np.arange(N_STATES), choice]
        metric -= metric.max()

    state = 0            # zero-terminated trellis
    bits = np.zeros(n_steps, dtype=np.int8)
    for t in range(n_steps - 1, -1, -1):
        i = back[t, state]
        bits[t] = _PREV_BIT[state, i]
        state = _PREV[state, i]
    return bits[:n_info]


# ------------------------------------------------------------- interleaving

def _perm(n: int) -> np.ndarray:
    """Deterministic pseudo-random interleave -- spreads frequency-selective
    notches and burst errors across the trellis."""
    rng = np.random.default_rng(0xA7BA1)
    return rng.permutation(n)


# ---------------------------------------------------------------- preamble

def _chirp() -> np.ndarray:
    t = np.arange(CHIRP_LEN) / FS
    dur = CHIRP_LEN / FS
    phase = 2 * np.pi * (CHIRP_F0 * t + (CHIRP_F1 - CHIRP_F0) / (2 * dur) * t ** 2)
    w = np.hanning(CHIRP_LEN)
    return (np.cos(phase) * w).astype(np.float64)


CHIRP = _chirp()

# subcarrier bin indices, centred on CENTRE_HZ
_c0 = int(round(CENTRE_HZ / FS * N_FFT)) - N_CARRIERS // 2
BINS = np.arange(_c0, _c0 + N_CARRIERS)
OCCUPIED_HZ = (BINS[0] * FS / N_FFT, BINS[-1] * FS / N_FFT)


def _payload_bits(payload: bytes) -> np.ndarray:
    crc = crc32c(payload)
    raw = payload + crc.to_bytes(4, "big")
    bits = np.unpackbits(np.frombuffer(raw, dtype=np.uint8)).astype(np.int8)
    return np.concatenate([bits, np.zeros(K - 1, dtype=np.int8)])   # tail


def n_symbols_for(payload_len: int) -> int:
    """Number of DATA symbols (the 'time' mode adds one reference symbol)."""
    n_info = payload_len * 8 + 32 + (K - 1)
    return int(np.ceil(n_info * 2 / BITS_PER_SYMBOL))


def n_symbols_on_air(payload_len: int) -> int:
    return n_symbols_for(payload_len) + (1 if MODE == "time" else 0)


# Known QPSK reference symbol used by the 'time' mode as the first differential
# anchor. Pseudo-random rather than constant, to keep the peak-to-average ratio
# of that symbol in line with the data symbols.
REF_PHASES = np.random.default_rng(0xBEEF).integers(0, 4, N_CARRIERS) * (np.pi / 2)


def modulate(payload: bytes, amplitude: float = 0.25) -> np.ndarray:
    """Encode a payload into a real audio burst at FS."""
    info = _payload_bits(payload)
    coded = conv_encode(info)
    n_sym = n_symbols_for(len(payload))
    need = n_sym * BITS_PER_SYMBOL
    coded = np.concatenate([coded, np.zeros(need - coded.size, dtype=np.int8)])
    coded = coded[_perm(need)]

    # DQPSK across frequency: carrier k phase = carrier k-1 phase + delta
    dibits = coded.reshape(-1, 2)
    gray = np.array([0, 1, 3, 2])                        # Gray-coded quadrant
    idx = gray[dibits[:, 0] * 2 + dibits[:, 1]]
    if MODE == "freq":
        delta = np.zeros((n_sym, N_CARRIERS - 1))
        delta[:, 1:-1] = idx.reshape(n_sym, N_CARRIERS - 1 - N_PILOT) * (np.pi / 2)
        all_phases = [np.concatenate([[0.0], np.cumsum(d)]) for d in delta]
    else:
        delta = np.zeros((n_sym, N_CARRIERS))
        delta[:, 1:-1] = idx.reshape(n_sym, N_CARRIERS - N_PILOT) * (np.pi / 2)
        all_phases = [REF_PHASES.copy()]
        for d in delta:
            all_phases.append(all_phases[-1] + d)

    out = [np.zeros(GUARD)]
    for phases in all_phases:
        spec = np.zeros(N_FFT, dtype=complex)
        spec[BINS] = np.exp(1j * phases)
        # real passband signal: conjugate-symmetric spectrum
        spec[N_FFT - BINS] = np.conj(spec[BINS])
        sym = np.fft.ifft(spec).real
        sym /= np.sqrt(np.mean(sym ** 2))
        out.append(np.concatenate([sym[-GUARD:], sym]))   # cyclic prefix

    body = np.concatenate(out)
    body *= amplitude / np.sqrt(np.mean(body ** 2)) * 0.35
    pre = CHIRP * (amplitude / np.abs(CHIRP).max()) * 1.0
    return np.concatenate([np.zeros(int(0.02 * FS)), pre,
                           np.zeros(GUARD), body, np.zeros(int(0.02 * FS))])


def burst_seconds(payload_len: int) -> float:
    return (0.02 + CHIRP_LEN / FS + GUARD / FS
            + (GUARD + n_symbols_on_air(payload_len) * SYM) / FS + 0.02)


# ----------------------------------------------------------------- receiver

def _find_preamble(rx: np.ndarray) -> int:
    """Matched-filter the chirp; return sample index just after it."""
    n = rx.size + CHIRP.size
    n = 1 << int(np.ceil(np.log2(n)))
    corr = np.fft.irfft(np.fft.rfft(rx, n) * np.conj(np.fft.rfft(CHIRP, n)), n)
    peak = int(np.argmax(np.abs(corr[:rx.size])))
    return peak + CHIRP.size


def demodulate(rx: np.ndarray, payload_len: int, noise_var: float = 1.0):
    """Return (payload_bytes, crc_ok). rx is real audio at FS."""
    n_sym = n_symbols_on_air(payload_len)
    start = _find_preamble(rx)
    need = GUARD + n_sym * SYM
    if start < 0 or start + need > rx.size:
        return None, False

    best = None
    # small search over residual timing error; OFDM tolerates CP-length offsets
    for off in (-24, -12, 0, 12, 24):
        s = start + 2 * GUARD + off
        if s < 0 or s + n_sym * SYM > rx.size:
            continue
        blocks = rx[s:s + n_sym * SYM].reshape(n_sym, SYM)[:, GUARD:]
        spec = np.fft.fft(blocks, axis=1)[:, BINS]
        if MODE == "freq":
            diff = spec[:, 1:] * np.conj(spec[:, :-1])
        else:
            diff = spec[1:, :] * np.conj(spec[:-1, :])
        mag = np.abs(diff).sum()
        if best is None or mag > best[0]:
            best = (mag, diff)
    if best is None:
        return None, False
    diff = best[1]

    # A residual timing offset appears as one common phase rotation on every
    # differential pair. Estimate it blind from the 4th power (QPSK is 4-fold
    # symmetric), then resolve the remaining 90-degree ambiguity with the two
    # known pilot pairs.
    # The offset is fixed within one burst (clock drift over ~1 s is well under
    # a sample), so pool the estimate over the whole burst rather than per
    # symbol -- that is what keeps it usable at low SNR.
    unit = diff / (np.abs(diff) + 1e-12)
    rot = np.angle((unit ** 4).mean()) / 4.0
    pilots = diff[:, [0, -1]].reshape(-1)
    cand = rot + np.arange(4) * (np.pi / 2)
    score = np.abs(np.angle(pilots[:, None] * np.exp(-1j * cand[None, :]))).sum(axis=0)
    rot = cand[int(np.argmin(score))]
    diff = diff[:, 1:-1] * np.exp(-1j * rot)

    # soft bits from the DQPSK quadrant, scaled by per-pair amplitude
    ang = np.angle(diff)
    amp = np.abs(diff)
    amp = amp / (amp.mean() + 1e-12)
    # Gray mapping (b0,b1) -> phase: (0,0)->0, (0,1)->90, (1,1)->180, (1,0)->270.
    # b0 is 0 in quadrants {0,90}   -> discriminant (cos+sin)
    # b1 is 0 in quadrants {0,270}  -> discriminant (cos-sin)
    # Convention: soft > 0 means the coded bit is 0.
    s_b0 = (np.cos(ang) + np.sin(ang)) / np.sqrt(2)
    s_b1 = (np.cos(ang) - np.sin(ang)) / np.sqrt(2)
    soft = np.empty(diff.shape + (2,))
    soft[..., 0] = s_b0 * amp
    soft[..., 1] = s_b1 * amp
    soft = soft.reshape(-1)

    de = np.empty_like(soft)
    de[_perm(soft.size)] = soft
    n_info = payload_len * 8 + 32 + (K - 1)
    bits = viterbi(de, n_info)

    data = np.packbits(bits[:payload_len * 8 + 32].astype(np.uint8))
    payload, crc_rx = bytes(data[:payload_len]), int.from_bytes(bytes(data[payload_len:payload_len + 4]), "big")
    return payload, crc32c(payload) == crc_rx
