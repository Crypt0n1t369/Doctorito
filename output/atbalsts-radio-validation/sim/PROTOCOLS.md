# What to reuse instead of inventing

Nothing in this system needs a new protocol. Every layer has a maintained
implementation or a published standard. This file records what exists, what it
costs, and what was measured here rather than assumed.

## The stack

| Layer | Take this | Why | Licence / status |
|---|---|---|---|
| Audio modem | **aicodix `modem` + `code` + `dsp`** (the engine inside Rattlegram) | Purpose-built for this exact job: 1600 Hz occupied, 85/128/170-byte packets in about a second, differential PSK, polar codes. Shipping apps already exist on **both Android and iOS**. | 0BSD — effectively unrestricted |
| Modem alternative | **Codec2 `freedv_data_raw_tx/rx`** — DATAC3 or DATAC1 | Built for genuinely bad HF channels. DATAC3: 128 payload bytes/frame, 282 bit/s, only 500 Hz wide, so it fits a poor audio path. DATAC1: 512 bytes/frame, 980 bit/s, 1700 Hz. Command-line tools already exist. | LGPL — review before shipping |
| Modem fallback | **MFSK32 via fldigi / TIVAR** | Slower, but the closest thing to a live precedent: Shortwave Radiogram broadcasts it weekly and listeners decode it on Android by putting the phone near the radio speaker. | Free / GPL |
| Alert semantics | **CAP 1.2** (OASIS) | The international standard for public warnings: update, cancellation, severity, area, multilingual. Do not re-derive these fields. | Open standard |
| Compact encoding | **ITU-T X.1303 / X.1303 bis compact binary** — CAP in ASN.1, **Unaligned PER** | This is the standardised version of the bit-packing that measured 26–70% smaller than CBOR here. It is normative, not a local invention. Tooling: `asn1tools` (Python), `asn1c`, ASN1SCC. | ITU-T recommendation |
| Signing | **COSE_Sign1 + Ed25519** (RFC 9052, RFC 8032) | Already the project's choice, and the right one: designed for constrained devices, 64-byte signatures. | IETF standards |
| Update pattern | **GTFS-Realtime's model** | Not the transport — the *shape*: a large static registry installed ahead of time, plus small differential updates keyed by entity ID against a registry version. That is precisely what Atbalsts does with shelters and aid points, and it is a well-worn pattern with known failure modes. | Open spec |
| Migration path | **DRM with EWF + Journaline** | The proper long-term answer: a broadcast standard that carries structured emergency text natively and can wake receivers. It needs DRM receivers, so it does not meet the no-extra-hardware constraint today. | ETSI standard |

## What was measured here, not assumed

Encoding the identical 20-facility, 3-situation bulletin four ways
(`encodings.py`), one signed object each:

| Encoding | Application bytes | Signed bytes | vs CBOR |
|---|---:|---:|---:|
| CBOR, integer keys — current | 511 | 594 | — |
| **Protocol Buffers (proto3)** | **540** | **623** | **+5.7%** |
| Bit-packed fixed layout (what UPER produces) | 377 | 460 | −26.2% |
| Bit-packed + signed phrase codebook | 154 | 237 | −69.9% |

**Protobuf is slightly larger than what the project already uses.** The published
benchmarks showing protobuf well ahead of CBOR compare it against *string-keyed*
CBOR. This fixture already uses integer keys, which removes exactly that
advantage. What remains is that every repeated protobuf message costs a field tag
plus a length prefix — two bytes per status record — which outweighs proto3's
habit of omitting zero-valued fields.

Protobuf remains a defensible choice for tooling, codegen and schema-evolution
reasons. It is simply not a way to save airtime here.

One caveat if it is chosen: protobuf serialisation is **not canonical**. Verify
the signature over the exact bytes received and never re-serialise before
checking, the same discipline JWS requires.

## Where the bytes actually are

Neither serialisation format is the lever. Two other things are:

- **Signature amortisation.** The COSE wrapper plus Ed25519 signature costs 83
  bytes per signed object. At the fixture's four records per object that is more
  than the content. Sixteen records per object cuts cost per status update from
  37.5 to 16.9 bytes.
- **The preinstalled registry.** A status update against a known registry is an
  index and a few enums — about 5.5 bytes bit-packed. Sending anything that
  resembles a name or an address costs ten times that. Keep free text in a signed,
  versioned phrase codebook and send phrase identifiers.

## Sources

- aicodix modem / polar decoder / DSP: <https://github.com/aicodix/modem>, <https://github.com/aicodix/code>, <https://github.com/aicodix/dsp>; Rattlegram: <https://www.aicodix.de/cofdmtv/rattlegram/>
- Codec2 data modes: <https://github.com/drowe67/codec2/blob/main/README_data.md>
- Shortwave Radiogram and TIVAR: <https://swradiogram.net/>, <https://wiki.radioreference.com/index.php/Decoding_the_SW_Radiogram_Broadcasts_with_TIVAR>
- CAP 1.2: <https://docs.oasis-open.org/emergency/cap/v1.2/CAP-v1.2-os.html>
- ITU-T X.1303 bis: <https://www.itu.int/en/ITU-D/Emergency-Telecommunications/Documents/2020/T-REC-X.1303bis-201403-.pdf>
- ASN.1 tooling: <https://github.com/eerimoq/asn1tools>
- COSE: <https://www.rfc-editor.org/rfc/rfc9052.html>; Ed25519: <https://www.rfc-editor.org/rfc/rfc8032.html>
- DRM EWF: <https://www.drm.org/about-drm/drm-benefits/>
