"""Reproducible payload/airtime budget, not an audio modem or RF test.

Run with Python 3 and cryptography. The small CBOR encoder covers only this
fixture; production should use a maintained CBOR/COSE implementation.
The deterministic signing key is PUBLIC TEST MATERIAL and must never be trusted
by a production receiver. All data describes a fictional exercise.
"""

import argparse
import base64
import hashlib
import json
import math
import struct
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


OUT = Path(__file__).resolve().parent
FIXTURES = OUT / "fixtures"


def head(major, n):
    if n < 24:
        return bytes([(major << 5) | n])
    for width, code in [(1, 24), (2, 25), (4, 26), (8, 27)]:
        if n < 1 << (8 * width):
            return bytes([(major << 5) | code]) + n.to_bytes(width, "big")
    raise ValueError("integer too large")


def cbor(value):
    if value is False:
        return b"\xf4"
    if value is True:
        return b"\xf5"
    if value is None:
        return b"\xf6"
    if isinstance(value, int):
        return head(0, value) if value >= 0 else head(1, -1 - value)
    if isinstance(value, bytes):
        return head(2, len(value)) + value
    if isinstance(value, str):
        data = value.encode("utf-8")
        return head(3, len(data)) + data
    if isinstance(value, list):
        return head(4, len(value)) + b"".join(map(cbor, value))
    if isinstance(value, dict):
        pairs = sorted((cbor(k), cbor(v)) for k, v in value.items())
        return head(5, len(pairs)) + b"".join(k + v for k, v in pairs)
    raise TypeError(type(value))


def crc32c(data):
    crc = 0xFFFFFFFF
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0x82F63B78 if crc & 1 else 0)
    return crc ^ 0xFFFFFFFF


assert cbor({1: "a"}).hex() == "a1016161"
assert crc32c(b"123456789") == 0xE3069283

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--issued-at", type=int, default=1788951600,
                    help="Unix issue time; use the agreed live-test time before broadcasting")
issued = parser.parse_args().issued_at
facilities = []
for i in range(20):
    # [operation, kind, registry ID, revision, state, available places,
    #  service bitmask]. Kinds: 0 shelter, 1 aid point.
    # States: 0 unknown, 1 open, 2 limited, 3 full, 4 closed.
    kind = 0 if i < 12 else 1
    facilities.append([0, kind, 100 + i, 1, [1, 2, 3, 4][i % 4],
                       20 + i if kind == 0 and i % 4 < 2 else 0,
                       0 if kind == 0 else [1, 3, 5, 7][i % 4]])

situations = [
    [1, 3001, 1, 1, 2, 5695000, 2410000,
     "Mācības: iela slēgta", "Mācību zonā izmanto norādīto apbraucamo ceļu.", 1],
    [1, 3002, 1, 2, 1, 5696000, 2412000,
     "Mācības: ūdens piegāde", "Ūdens saņemams mācību palīdzības punktā A112.", 1],
    [1, 3003, 1, 3, 1, 5694000, 2409000,
     "Mācības: atvērta patvertne", "Mācību dalībniekiem pieejama patvertne S100.", 1],
]

private = Ed25519PrivateKey.from_private_bytes(
    hashlib.sha256(b"atbalsts-radio-public-exercise-key-v1").digest())
public = private.public_key()
protected = cbor({1: -8, 4: b"test01"})
groups = [facilities[i:i + 4] for i in range(0, 20, 4)]
groups.extend([[s] for s in situations])
objects = []

FIXTURES.mkdir(parents=True, exist_ok=True)
for number, records in enumerate(groups, start=1):
    body = {0: 1, 1: 1, 2: 1, 3: 1, 4: 1001, 5: number,
            6: issued, 7: issued + 3600, 8: True, 9: records}
    payload = cbor(body)
    signed_bytes = cbor(["Signature1", protected, b"", payload])
    signature = private.sign(signed_bytes)
    public.verify(signature, signed_bytes)
    cose = b"\xd2" + cbor([protected, {}, payload, signature])
    (FIXTURES / f"object-{number:02d}.cose").write_bytes(cose)
    objects.append({"id": number, "body": body, "payload": payload, "cose": cose})


def packetize(obj, text_cap):
    binary_cap = ((text_cap - 4) // 4) * 3
    chunk_cap = binary_cap - 16
    data = obj["cose"]
    count = math.ceil(len(data) / chunk_cap)
    packets = []
    for index in range(count):
        chunk = data[index * chunk_cap:(index + 1) * chunk_cap]
        header = struct.pack(">HIHHH", 1, 1001, obj["id"], index * chunk_cap, len(data))
        frame = header + struct.pack(">I", crc32c(header + chunk)) + chunk
        text = "at1:" + base64.b64encode(frame).decode("ascii")
        assert len(text) <= text_cap
        assert base64.b64decode(text[4:]) == frame
        packets.append(text)
    return packets


results = []
for name, cap in [("Rattlegram 170-byte", 170),
                  ("Rattlegram 128-byte", 128),
                  ("Rattlegram 85-byte", 85)]:
    packets = [p for o in objects for p in packetize(o, cap)]
    # Budgeted slot: source-derived 1.26 s waveform + 0.24 s additional gap.
    # Last fragments may automatically use a stronger stock Rattlegram mode.
    one_pass = len(packets) * 1.5
    app_bytes = sum(len(o["payload"]) for o in objects)
    result = {"profile": name, "text_cap": cap,
              "fragment_data_bytes_max": ((cap - 4) // 4) * 3 - 16,
              "frames_per_pass": len(packets), "one_pass_seconds": one_pass,
              "two_pass_seconds": one_pass * 2,
              "two_pass_plus_25_percent_contingency_seconds": one_pass * 2 * 1.25,
              "budgeted_unique_application_bps": round(app_bytes * 8 / (one_pass * 2 * 1.25), 2)}
    results.append(result)
    (FIXTURES / f"packets-{cap}.txt").write_text("\n".join(packets) + "\n")

summary = {
    "evidence": "Encoded fixture byte counts; airtime is a budget, not measured radio throughput.",
    "fixture": "20 facility status updates and 3 new fictional situations; 8 independently signed objects",
    "application_cbor_bytes": sum(len(o["payload"]) for o in objects),
    "cose_bytes": sum(len(o["cose"]) for o in objects),
    "object_sizes": [{"object_id": o["id"], "application_bytes": len(o["payload"]),
                      "signed_bytes": len(o["cose"]), "records": len(o["body"][9])} for o in objects],
    "public_test_key_hex": public.public_bytes(Encoding.Raw, PublicFormat.Raw).hex(),
    "profiles": results,
}
(OUT / "sizing-results.json").write_text(json.dumps(summary, indent=2) + "\n")
(FIXTURES / "bulletin-readable.json").write_text(json.dumps(
    [o["body"] for o in objects], ensure_ascii=False, indent=2) + "\n")
print(json.dumps(summary, indent=2))
