"""Measure three encodings of the SAME bulletin, byte for byte.

  1. CBOR with integer keys      -- what the project uses today
  2. Protocol Buffers (proto3)   -- hand-encoded wire format, defaults omitted
  3. Bit-packed fixed layout     -- what ASN.1 Unaligned PER produces, and what
                                    the preinstalled registry actually permits

The comparison matters because the published protobuf-vs-CBOR benchmarks measure
protobuf against JSON-like CBOR with STRING keys. This fixture already uses
integer keys, which removes exactly that advantage.
"""
import json, os, sys

# ---------------------------------------------------------------- CBOR (current)
def head(major, n):
    if n < 24: return bytes([(major << 5) | n])
    for w, c in [(1, 24), (2, 25), (4, 26), (8, 27)]:
        if n < 1 << (8 * w): return bytes([(major << 5) | c]) + n.to_bytes(w, "big")
    raise ValueError


def cbor(v):
    if isinstance(v, bool): return b"\xf5" if v else b"\xf4"
    if isinstance(v, int): return head(0, v) if v >= 0 else head(1, -1 - v)
    if isinstance(v, str):
        d = v.encode(); return head(3, len(d)) + d
    if isinstance(v, bytes): return head(2, len(v)) + v
    if isinstance(v, list): return head(4, len(v)) + b"".join(map(cbor, v))
    if isinstance(v, dict):
        p = sorted((cbor(k), cbor(x)) for k, x in v.items())
        return head(5, len(p)) + b"".join(k + x for k, x in p)
    raise TypeError


# ------------------------------------------------------------------- protobuf
def varint(n):
    if n < 0: raise ValueError("use uint/zigzag")
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n: return bytes(out)


def zigzag(n): return (n << 1) ^ (n >> 63) if n >= 0 else ((-n) << 1) - 1


def tag(field, wire): return varint((field << 3) | wire)


def pb_uint(field, v):
    return b"" if v == 0 else tag(field, 0) + varint(v)          # proto3 omits defaults


def pb_sint(field, v):
    return b"" if v == 0 else tag(field, 0) + varint(zigzag(v))


def pb_bool(field, v):
    return b"" if not v else tag(field, 0) + varint(1)


def pb_str(field, s):
    d = s.encode()
    return b"" if not d else tag(field, 2) + varint(len(d)) + d


def pb_msg(field, body):
    return b"" if not body else tag(field, 2) + varint(len(body)) + body


def pb_decode(buf, i=0, end=None):
    """Round-trip check: walk the wire format and return (field, wiretype) pairs."""
    end = len(buf) if end is None else end
    out = []
    while i < end:
        t = 0; shift = 0
        while True:
            b = buf[i]; i += 1
            t |= (b & 0x7F) << shift; shift += 7
            if not b & 0x80: break
        f, w = t >> 3, t & 7
        if w == 0:
            while buf[i] & 0x80: i += 1
            i += 1
        elif w == 2:
            n = 0; shift = 0
            while True:
                b = buf[i]; i += 1
                n |= (b & 0x7F) << shift; shift += 7
                if not b & 0x80: break
            i += n
        else:
            raise ValueError(f"unexpected wire type {w}")
        out.append((f, w))
    return out


# --------------------------------------------------------------- bit packing
class Bits:
    """Unaligned bit writer -- the same technique ASN.1 Unaligned PER uses."""
    def __init__(self): self.acc, self.n = 0, 0
    def put(self, value, width):
        assert 0 <= value < (1 << width), (value, width)
        self.acc = (self.acc << width) | value; self.n += width
    def bytes(self):
        pad = (-self.n) % 8
        return (self.acc << pad).to_bytes((self.n + pad) // 8, "big")


# ------------------------------------------------------------------- fixture
ISSUED = 1788951600
FACILITIES = []
for i in range(20):
    kind = 0 if i < 12 else 1
    FACILITIES.append(dict(op=0, kind=kind, entity=100 + i, revision=1,
                           state=[1, 2, 3, 4][i % 4],
                           places=20 + i if kind == 0 and i % 4 < 2 else 0,
                           services=0 if kind == 0 else [1, 3, 5, 7][i % 4]))
SITUATIONS = [
    dict(op=1, entity=3001, revision=1, category=1, severity=2,
         lat=5695000, lon=2410000, title="Mācības: iela slēgta",
         instruction="Mācību zonā izmanto norādīto apbraucamo ceļu.", active=1),
    dict(op=1, entity=3002, revision=1, category=2, severity=1,
         lat=5696000, lon=2412000, title="Mācības: ūdens piegāde",
         instruction="Ūdens saņemams mācību palīdzības punktā A112.", active=1),
    dict(op=1, entity=3003, revision=1, category=3, severity=1,
         lat=5694000, lon=2409000, title="Mācības: atvērta patvertne",
         instruction="Mācību dalībniekiem pieejama patvertne S100.", active=1),
]


def enc_cbor(facs, sits):
    recs = [[f["op"], f["kind"], f["entity"], f["revision"], f["state"],
             f["places"], f["services"]] for f in facs]
    recs += [[s["op"], s["entity"], s["revision"], s["category"], s["severity"],
              s["lat"], s["lon"], s["title"], s["instruction"], s["active"]]
             for s in sits]
    body = {0: 1, 1: 1, 2: 1, 3: 1, 4: 1001, 5: 1, 6: ISSUED,
            7: ISSUED + 3600, 8: True, 9: recs}
    return cbor(body)


def enc_protobuf(facs, sits):
    body = (pb_uint(1, 1) + pb_uint(2, 1) + pb_uint(3, 1) + pb_uint(4, 1)
            + pb_uint(5, 1001) + pb_uint(6, 1) + pb_uint(7, ISSUED)
            + pb_uint(8, ISSUED + 3600) + pb_bool(9, True))
    for f in facs:
        r = (pb_uint(1, f["entity"]) + pb_uint(2, f["revision"]) + pb_uint(3, f["kind"])
             + pb_uint(4, f["state"]) + pb_uint(5, f["places"]) + pb_uint(6, f["services"]))
        body += pb_msg(10, r)
    for s in sits:
        r = (pb_uint(1, s["entity"]) + pb_uint(2, s["revision"]) + pb_uint(3, s["category"])
             + pb_uint(4, s["severity"]) + pb_sint(5, s["lat"]) + pb_sint(6, s["lon"])
             + pb_str(7, s["title"]) + pb_str(8, s["instruction"]) + pb_uint(9, s["active"]))
        body += pb_msg(11, r)
    pb_decode(body)                      # round-trip: the wire format is walkable
    return body


def enc_packed(facs, sits):
    """Fixed-width bit fields. Legal because the registry is preinstalled: an
    entity is an index into it, not a name."""
    b = Bits()
    b.put(1, 4)                          # schema version
    b.put(1, 10)                         # issuer key id
    b.put(1, 8)                          # region
    b.put(1, 12)                         # registry version
    b.put(1001, 20)                      # bulletin id
    b.put(1, 8)                          # object id
    b.put(ISSUED // 60, 26)              # issue time, minute resolution
    b.put(60, 12)                        # validity in minutes
    b.put(1, 1)                          # exercise flag
    b.put(len(facs), 8)
    for f in facs:
        b.put(f["entity"], 14)           # registry index, up to 16384 facilities
        b.put(f["revision"], 6)
        b.put(f["kind"], 2)
        b.put(f["state"], 3)
        b.put(min(f["places"], 511), 9)
        b.put(f["services"], 6)
    b.put(len(sits), 6)
    for s in sits:
        b.put(s["entity"], 20)
        b.put(s["revision"], 6)
        b.put(s["category"], 6)
        b.put(s["severity"], 3)
        b.put(s["lat"] - 5550000, 20)    # Latvia-relative, 1e-5 deg
        b.put(s["lon"] - 2050000, 20)
        b.put(s["active"], 1)
        t = s["title"].encode(); ins = s["instruction"].encode()
        b.put(len(t), 8)
        for ch in t: b.put(ch, 8)
        b.put(len(ins), 8)
        for ch in ins: b.put(ch, 8)
    return b.bytes()


def enc_packed_codebook(facs, sits):
    """As above, but situations reference a signed, preinstalled phrase codebook
    instead of carrying free text."""
    b = Bits()
    b.put(1, 4); b.put(1, 10); b.put(1, 8); b.put(1, 12); b.put(1001, 20)
    b.put(1, 8); b.put(ISSUED // 60, 26); b.put(60, 12); b.put(1, 1)
    b.put(len(facs), 8)
    for f in facs:
        b.put(f["entity"], 14); b.put(f["revision"], 6); b.put(f["kind"], 2)
        b.put(f["state"], 3); b.put(min(f["places"], 511), 9); b.put(f["services"], 6)
    b.put(len(sits), 6)
    for s in sits:
        b.put(s["entity"], 20); b.put(s["revision"], 6); b.put(s["category"], 6)
        b.put(s["severity"], 3)
        b.put(s["lat"] - 5550000, 20); b.put(s["lon"] - 2050000, 20)
        b.put(s["active"], 1)
        b.put(7, 12)                     # title phrase id
        b.put(41, 12)                    # instruction phrase id
        b.put(0, 4)                       # substitution slot count
    return b.bytes()


if __name__ == "__main__":
    SIG = 83          # measured COSE_Sign1 + Ed25519 wrapper, from analyze.py
    print("=" * 84)
    print("WHOLE BULLETIN — 20 facility statuses + 3 situations, one signed object")
    print("=" * 84)
    rows = []
    for name, fn in [("CBOR, integer keys (today)", enc_cbor),
                     ("Protocol Buffers (proto3)", enc_protobuf),
                     ("Bit-packed, free text", enc_packed),
                     ("Bit-packed + phrase codebook", enc_packed_codebook)]:
        n = len(fn(FACILITIES, SITUATIONS))
        rows.append((name, n, n + SIG))
        print(f"  {name:<32} {n:>5} B application   {n+SIG:>5} B signed")

    base = rows[0][1]
    print()
    print("  relative to CBOR:")
    for name, n, s in rows[1:]:
        print(f"    {name:<32} {100*(n-base)/base:+6.1f}% application, "
              f"{100*(s-rows[0][2])/rows[0][2]:+6.1f}% signed")

    print()
    print("=" * 84)
    print("STATUS UPDATES ONLY — the case the app actually needs most")
    print("=" * 84)
    print(f"  {'encoding':<32} {'20 facilities':>14} {'per facility':>13} {'signed/facility':>16}")
    for name, fn in [("CBOR, integer keys (today)", enc_cbor),
                     ("Protocol Buffers (proto3)", enc_protobuf),
                     ("Bit-packed fixed layout", enc_packed)]:
        n = len(fn(FACILITIES, []))
        print(f"  {name:<32} {n:>12} B {n/20:>12.1f} {(n+SIG)/20:>15.1f}")

    print()
    print("  Scaling to 200 facilities in one signed object:")
    for name, fn in [("CBOR, integer keys", enc_cbor),
                     ("Protocol Buffers", enc_protobuf),
                     ("Bit-packed fixed layout", enc_packed)]:
        big = [dict(FACILITIES[i % 20], entity=100 + i) for i in range(200)]
        n = len(fn(big, []))
        print(f"    {name:<30} {n:>6} B  ({(n+SIG)/200:>4.1f} B per update, "
              f"{(n+SIG)*8/113.1:>5.1f} s of airtime)")
