# Exact tested profile: ATB public snapshots / ATR1 reports

This is an application profile using standard cryptography, not a new cryptographic primitive. Implementation: `protocol.mjs`. Fixtures contain synthetic situations and disposable test keys only. Receipts, durable storage and LoRa framing are proposed in `architecture.md` and are not implemented here.

## Sealed report

HPKE RFC 9180 Base mode (`0`), DHKEM(X25519, HKDF-SHA256) (`0x0020`), HKDF-SHA256 (`0x0001`), AES-128-GCM (`0x0001`). Generate a fresh sender context for every report and seal exactly once. No password, shared citizen secret, deterministic seed or explicit nonce is used by application code.

| Offset | Length | Content |
|---|---:|---|
| 0 | 4 | ASCII `ATR1` — application, report class and version |
| 4 | 4 | Recipient public-key identifier, unsigned big endian |
| 8 | 2 | Padded plaintext length: `0x0100` = 256 |
| 10 | 32 | HPKE encapsulation `enc` |
| 42 | 272 | Ciphertext of 256 padded bytes plus 16-byte GCM tag |

Total **314 bytes**. HPKE `info` is UTF-8 `atbalsts/report/v1`, one zero byte, then the exact 10-byte header. AEAD `aad` is empty. Binding immutable metadata through `info` follows RFC 9180 §8.1's single-shot guidance and supports Python cryptography's public HPKE API. A changed recipient identifier fails decryption even if it aliases the same key. Gateways do not rewrite any envelope field.

Before encryption: a 2-byte big-endian CBOR length, followed by deterministic CBOR and zero padding to 256 bytes. CBOR value:

```
[1, observedAtUnixSeconds, category, latitudeE5, longitudeE5, text]
```

Category `0=access`, `1=hazard`, `2=shelter`, `3=other`; time is an untrusted reporter claim. Coordinates are signed integers. Text is at most 160 UTF-8 bytes, with no control characters; the whole encoded report must fit in 254 bytes. No extra fields. This schema is validated before sealing and after authenticated opening. Location selection must work from the saved registry/manual map; online geocoding is not required.

Use SHA-256 over all 314 bytes as the queue object ID. Relays only check outer format, known destination, size and queue limits; they cannot verify the encrypted report's content or AEAD tag. Any internet uploader, acoustic receiver or LoRa reassembler must feed the same object acceptance rules. The proof queue rejects unknown recipient IDs and holds at most 20 envelopes. It does not implement persistent storage, per-source scheduling or service-level guarantees.

## Public snapshot

Tagged COSE_Sign1 (CBOR tag 18) with protected map `{1: -8, 4: kidBytes}`. `-8` is COSE EdDSA; this profile permits only a preinstalled 32-byte Ed25519 public key. `kidBytes` is 4-byte big endian. Unprotected map must be empty. Payload and 64-byte signature are byte strings.

Signature input is deterministic CBOR:

```
["Signature1", protectedHeaderBytes, UTF8("atbalsts/public/v1"), payloadBytes]
```

Payload:

```
[1, centreId, areaId, registryVersion, authorityEpoch,
 sequence, issuedUnixSeconds, expiresUnixSeconds, shelters, situations]
```

All counters and times are unsigned 32-bit values. Authorities must rotate a provisioned epoch before counter exhaustion; an incoming object cannot authorize its own epoch or scope. Expiry must follow issue time by at most 24 hours in this pilot profile. Operational expiry can be shorter and is chosen by the centre.

- Shelter row: `[stableId, status, availablePlacesOrNull]`; status `0=unknown, 1=open, 2=limited, 3=full, 4=closed`. All area shelter IDs, preinstalled in the trust/registry configuration, must appear exactly once in increasing order. Unknown status is explicit.
- Situation row: `[stableId, severity1to3, latitudeE5, longitudeE5, title, instruction]`. IDs are unique/increasing; title ≤64 UTF-8 bytes, instruction ≤120. A complete newer snapshot replaces the area's situation list, so omission withdraws a previous situation.
- At most 32 shelters, 4 situations and **1,024 bytes including signature and COSE wrapper**. Reject excess, do not truncate. Large deployments need predefined small areas, not partial snapshots disguised as complete ones.

Verify the signature before decoding the public payload. Then validate schema, scoped key authority, epoch, registry and full shelter membership. Compare sequence with the persisted latest accepted version. Identical object = duplicate; lower sequence = stale; different content at the same sequence = conflict requiring attention. Preserve original signed bytes for re-transmission. Expired authenticated content can be stored as last-known information, but must be visibly outdated. Recompute freshness as time passes; the proof returns an ingest-time classification rather than a live UI clock.

The pilot trust table pins a centre key to one area and epoch. Root-signed provisioning, key revocation, transactional persistence and protected signing authorization remain integration work. The same-origin JavaScript proof is not a hardened centre sandbox.

## Audio and LoRa transport

The test reuses the deployed custom modem's waveform, 128-byte frames and 112-byte object chunks. Its legacy receiver/signature format is deliberately bypassed after frame decoding; the new profile verifies the reconstructed object. Existing radio-exercise clients do not understand ATR1 or this COSE profile without an update. CRC detects transport corruption, not authority. Outer transport IDs do not grant trust.

The exact waveform source hashes and pinned GitHub commit are in `sources.json`. Generated examples use two repetitions and PCM16 at 8 kHz. WAV duration describes generated audio, not a measured physical completion rate. LoRa requires its own fragmentation sized for the configured data rate; the 128-byte audio frames must not be assumed to fit.

## Evidence and references

`test.mjs` checks the selected official HPKE vector's 257 encryption/decryption pairs, six exporter results and encapsulation, plus RFC 8032 Ed25519 test 1. It exercises negative application cases and the existing streaming audio decoder. `interop.py` independently encrypts/decrypts using Python cryptography 50.0.1; it also verifies the Ed25519 signature input, but is not an independent COSE parser. `browser-test.mjs` runs the same protocol in a fresh headless Chrome with networking disabled after loading its local modules.

- [HPKE and single-shot binding](https://www.rfc-editor.org/rfc/rfc9180.html#section-8.1)
- [Pinned CFRG vectors](https://github.com/cfrg/draft-irtf-cfrg-hpke/blob/b1f7cb0cdeab6906c61b3d6574e8bdfdbe1cd3fb/test-vectors.json)
- [COSE Sign1 construction](https://www.rfc-editor.org/rfc/rfc9052.html#section-4.4)
- [Ed25519 known-answer tests](https://www.rfc-editor.org/rfc/rfc8032.html#section-7.1)
- [Python HPKE API](https://cryptography.io/en/latest/hazmat/primitives/hpke/)
- [hpke-js limitations: no formal audit](https://github.com/dajiaji/hpke-js#warnings-and-restrictions)
