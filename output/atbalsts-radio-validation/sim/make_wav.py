"""Generate a broadcastable bulletin WAV plus its run manifest, and decode one
back. This is the reference transmitter/receiver pair for the physical trial:
the manifest lets a receiver log be scored for frame erasure rate against what
was actually transmitted.

  python3 make_wav.py                       # build bulletin.wav + manifest
  python3 make_wav.py --decode bulletin.wav # decode it back and report
"""
import argparse, json, math, os, struct, sys, wave
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import modem

FIXTURES = os.path.join(ROOT, "fixtures")
ISSUER, BULLETIN = 1, 1001
HDR = 16


def crc32c(b):
    return modem.crc32c(b)


def frames(objects, data_bytes):
    """Fragment signed objects into transport frames (outline protocol v0.1)."""
    out = []
    for oid, cose in objects:
        n = math.ceil(len(cose) / data_bytes)
        for i in range(n):
            chunk = cose[i * data_bytes:(i + 1) * data_bytes]
            h = struct.pack(">HIHHH", ISSUER, BULLETIN, oid, i * data_bytes, len(cose))
            out.append((oid, i, h + struct.pack(">I", crc32c(h + chunk)) + chunk))
    return out


def parse(frame):
    """Frames are zero-padded to the modem payload size, so the true fragment
    length comes from the header's offset/total fields, not from len(frame)."""
    if len(frame) <= HDR:
        return None
    h, crc = frame[:12], struct.unpack(">I", frame[12:16])[0]
    issuer, bulletin, oid, off, total = struct.unpack(">HIHHH", h)
    if total == 0 or off >= total or total > 1024:      # bound before allocating
        return None
    chunk = frame[HDR:HDR + min(len(frame) - HDR, total - off)]
    if crc32c(h + chunk) != crc:
        return None
    return dict(issuer=issuer, bulletin=bulletin, object=oid, offset=off,
                total=total, data=chunk)


def load_objects():
    objs = []
    for f in sorted(os.listdir(FIXTURES)):
        if f.startswith("object-") and f.endswith(".cose"):
            objs.append((int(f[7:9]), open(os.path.join(FIXTURES, f), "rb").read()))
    return objs


def build(payload_len=255, passes=2, gap_s=0.25, lead_s=1.0, fs_out=48000):
    modem.set_mode("time"); modem.set_guard(64)
    objs = load_objects()
    data_bytes = payload_len - HDR
    fr = frames(objs, data_bytes)
    gap = np.zeros(int(gap_s * modem.FS))
    parts, manifest, t = [np.zeros(int(lead_s * modem.FS))], [], lead_s

    order = list(range(len(fr)))
    for p in range(passes):
        seq = order if p == 0 else order[::-1]      # second pass, changed order
        for i in seq:
            oid, idx, f = fr[i]
            pad = f + bytes(payload_len - len(f))
            burst = modem.modulate(pad)
            manifest.append(dict(pass_=p, object=oid, fragment=idx,
                                 start_s=round(t, 3),
                                 duration_s=round(burst.size / modem.FS, 3),
                                 frame_len=len(f)))
            parts += [burst, gap]
            t += (burst.size + gap.size) / modem.FS

    audio = np.concatenate(parts)
    n_out = int(round(audio.size * fs_out / modem.FS))
    import channel as ch
    audio = ch.resample(audio, n_out)
    audio = audio / (np.abs(audio).max() + 1e-9) * 0.7
    return audio, manifest, fr, fs_out, payload_len


def write_wav(path, audio, fs):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(fs)
        w.writeframes((audio * 32767).astype("<i2").tobytes())


def read_wav(path):
    with wave.open(path, "rb") as w:
        fs, n = w.getframerate(), w.getnframes()
        a = np.frombuffer(w.readframes(n), dtype="<i2").astype(np.float64) / 32768
        if w.getnchannels() == 2:
            a = a.reshape(-1, 2).mean(axis=1)
    return a, fs


def find_bursts(x, min_sep, thresh=0.35):
    """Continuous preamble detection: correlate the chirp against the whole
    recording and pick peaks, the way a live receiver would. Returns chirp
    start indices."""
    n = 1 << int(np.ceil(np.log2(x.size + modem.CHIRP.size)))
    corr = np.abs(np.fft.irfft(np.fft.rfft(x, n) * np.conj(np.fft.rfft(modem.CHIRP, n)), n))
    corr = corr[:x.size]
    peaks, work, limit = [], corr.copy(), thresh * corr.max()
    while True:
        i = int(np.argmax(work))
        if work[i] < limit:
            break
        peaks.append(i)
        work[max(0, i - min_sep):i + min_sep] = 0
    return sorted(peaks)


def decode_file(path, payload_len=255):
    """Detect every preamble, decode each burst, reassemble objects."""
    import channel as ch
    modem.set_mode("time"); modem.set_guard(64)
    a, fs = read_wav(path)
    x = ch.resample(a, int(round(a.size * modem.FS / fs)))
    burst_n = int(modem.burst_seconds(payload_len) * modem.FS)
    objects, ok, bad = {}, 0, 0
    starts = find_bursts(x, min_sep=int(burst_n * 0.6))
    for st in starts:
        a0 = max(0, st - 400)
        seg = x[a0:a0 + burst_n + 1600]
        if seg.size < burst_n:
            continue
        got, good = modem.demodulate(seg, payload_len)
        p = parse(got) if good else None
        if p:
            ok += 1
            o = objects.setdefault(p["object"], bytearray(p["total"]))
            o[p["offset"]:p["offset"] + len(p["data"])] = p["data"]
        else:
            bad += 1
    return objects, ok, bad, len(starts)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--decode")
    ap.add_argument("--payload", type=int, default=255)
    ap.add_argument("--passes", type=int, default=2)
    a = ap.parse_args()

    if a.decode:
        objs, ok, bad, found = decode_file(a.decode, a.payload)
        truth = {i: c for i, c in load_objects()}
        print(f"{found} preambles detected -> {ok} valid frames, {bad} failed")
        for oid in sorted(objs):
            got = bytes(objs[oid])
            print(f"  object {oid:02d}: {len(got):>4} bytes  "
                  f"{'EXACT MATCH' if got == truth.get(oid) else 'MISMATCH/INCOMPLETE'}")
        print(f"{sum(1 for o in objs if bytes(objs[o])==truth.get(o))}/{len(truth)} "
              f"objects recovered byte-exact")
    else:
        audio, man, fr, fs, pl = build(payload_len=a.payload, passes=a.passes)
        out = os.path.join(ROOT, "bulletin.wav")
        write_wav(out, audio, fs)
        json.dump(dict(payload_len=pl, passes=a.passes, frames=len(fr),
                       slots=len(man), duration_s=round(audio.size / fs, 2),
                       sample_rate=fs, manifest=man),
                  open(os.path.join(ROOT, "bulletin-manifest.json"), "w"), indent=1)
        print(f"{out}\n  {len(fr)} unique frames x {a.passes} passes = {len(man)} bursts")
        print(f"  {audio.size/fs:.1f} s, {fs} Hz mono 16-bit, "
              f"{os.path.getsize(out)/1024:.0f} kB")
