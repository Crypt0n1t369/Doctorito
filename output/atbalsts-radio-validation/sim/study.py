"""Trial harness: run modem bursts through the impairment chain and count
frame decode successes. Every trial draws a fresh payload, a fresh room
realisation and fresh noise, so a point estimate is not an artefact of one
waveform.
"""

import json, os, sys, time
from dataclasses import asdict, replace
from multiprocessing import Pool

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modem
import channel as ch


def _one(job):
    guard, cond, payload_len, seed, mode = job
    modem.set_mode(mode)
    modem.set_guard(guard)
    rng = np.random.default_rng(seed)
    payload = bytes(rng.integers(0, 256, payload_len, dtype=np.uint8))
    tx = modem.modulate(payload)
    rx = ch.apply(tx, cond, rng)
    got, ok = modem.demodulate(rx, payload_len)
    return bool(ok and got == payload)


def run(cond, n=120, guard=64, payload_len=128, seed0=0, pool=None, mode="time"):
    """Return (successes, n) for one condition."""
    jobs = [(guard, cond, payload_len, seed0 + i, mode) for i in range(n)]
    res = pool.map(_one, jobs) if pool else [_one(j) for j in jobs]
    return int(sum(res)), n


def wilson(k, n):
    """95% Wilson score interval -- honest small-sample bounds on a rate."""
    if n == 0:
        return (0.0, 1.0)
    z, p = 1.96, k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def burst_seconds(guard, payload_len, mode="time"):
    modem.set_mode(mode)
    modem.set_guard(guard)
    return modem.burst_seconds(payload_len)


# --- physical interpretation ------------------------------------------------
# Sabine critical distance: beyond it the reverberant field dominates.
#   d_c = 0.057 * sqrt(V / RT60)      (V in m^3, RT60 in s)
#   DRR(d) ~ 20*log10(d_c / d)
def critical_distance(volume_m3, rt60):
    return 0.057 * np.sqrt(volume_m3 / rt60)


def drr_to_distance(drr_db, volume_m3, rt60):
    return critical_distance(volume_m3, rt60) * 10 ** (-drr_db / 20)


def distance_to_drr(d_m, volume_m3, rt60):
    return 20 * np.log10(critical_distance(volume_m3, rt60) / d_m)
