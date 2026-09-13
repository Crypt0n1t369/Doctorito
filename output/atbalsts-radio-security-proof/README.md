# Atbalsts: reproducible encryption and audio proof

The protocol tests pass. **This is not deployed in Atbalsts and does not certify production security or RF reliability.**

Start with [architecture.md](architecture.md) for the small centre-led design and [protocol-spec.md](protocol-spec.md) for exact wire formats. Results are machine-readable in `results.json` and `browser-results.json`.

## Results

- 19 grouped Node checks passed, including 257 official HPKE encryption/decryption cases and RFC 8032 Ed25519 test 1.
- Exact application envelope interoperated both ways with Python cryptography 50.0.1. No custom cryptographic primitive or home-made key derivation was used.
- A one-bit alteration at each of **692 byte positions** across the two test objects was rejected. Wrong-key and same-key/different-destination tests also failed closed. These are finite negative tests, not a mathematical proof.
- A deliberately false, correctly encrypted report entered the unverified inbox and did not change public state. Valid encryption does not establish truth or sender identity.
- Fresh headless Chrome **152.0.7977.83**, offline after local module load: encryption/decryption, wrong-key rejection and signed public-state import passed. Zero external requests. No screenshots, browser views or user profile access.

| Synthetic example | Wire object | Audio, two passes | Clean PCM decoding |
|---|---:|---:|---:|
| One short sealed report | 314 B | 8.588 s | 6/6 frames |
| 32 shelter statuses + one situation | 378 B | 11.284 s | 8/8 frames |

The report's CBOR content is 72 B; fixed padding, header and encryption increase it to 314 B. The public CBOR payload is 296 B; the signature/COSE wrapper add 82 B. Data is synthetic and the WAV checks are entirely in software. Physical phone, FM, LoRa, storage-recovery and attack-load trials remain necessary.

## Run again

Requires Node with WebCrypto/Ed25519, Python `cryptography==50.0.1` for the independent interop check, and optional Playwright plus Chrome for the headless check.

```sh
npm ci --ignore-scripts
npm test
node browser-test.mjs
```

This machine's `npm` symlink was broken, so the tests installed pinned packages using an integrity-checked npm 10.9.3 copy in `/tmp`. That temporary tool is not needed on a normal installation. The lockfile pins `@hpke/core` 1.9.0, `@hpke/dhkem-x25519` 1.8.0, `@hpke/common` 1.10.1 and `cborg` 6.1.2.

Set `ATBALSTS_PYTHON` to another suitable Python executable. The optional browser script also accepts `ATBALSTS_PLAYWRIGHT` (absolute module path) and `ATBALSTS_CHROME` (executable path). All dependencies must be available locally before an offline run. The proof contains no CDN dependency.

The test generates disposable centre keys in memory. Python receives test key material through a subprocess pipe, not a saved key file. The WAV examples contain synthetic data, but their random encryption/signing keys are deliberately not retained. Therefore the saved WAVs are size/waveform examples; rerun the test to reproduce a full decode with matching keys. Do not upload them into the current exercise expecting its different demo-key format to accept them.

`modem/legacy-framing.js` is copied exercise source for framing/stream detection only; its public exercise key is not trusted or used by the new profile. `sources.json` records source hashes. The production repository remains unchanged. A cryptographic library passing vectors is not an audit: hpke-js explicitly reports that it has not been formally audited.
