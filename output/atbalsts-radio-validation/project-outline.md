# Atbalsts radio update prototype

Prepared 9 September 2026. Scope: a nearby radio plays an audible data broadcast; a normal phone receives it through its microphone and updates an offline app. The app adds situations and changes shelter and humanitarian aid-point status. This is a validation project, not an operational warning service.

**Recommendation.** Build an Android prototype around Rattlegram's coded OFDM audio modem, starting with its 128-byte profile. Compare its 170-byte and 85-byte profiles through the same signal path. Keep Codec2 DATAC1/DATAC3 as the alternative if Rattlegram fails the radio-and-room tests. Use MFSK32 as a reference and possible fallback. Select the deployed profile from measured complete-update reliability, not nominal speed.

The concept is realistic for compact updates in a few minutes. Its remaining uncertainty is the complete path through broadcast processing, radio loudspeaker, room acoustics and phone microphone. No physical radio or phone reception has been measured in this work.

**What Atbalsts contributes.** The corrected reference is [atbalsts.sortium.co](https://atbalsts.sortium.co/). Its readable page identifies a crisis information platform where the centre publishes checked situations and keeps reference layers distinct. That distinction should survive the radio import: a shelter's presence in a registry does not establish that it is open now. The prototype uses the three record types requested by the user and a simple diagnostic interface; it does not need to reproduce the site's design.

**Signal path and scope.**

`Centre-approved records → compact signed objects → audio modem → mono WAV → station audio input → radio transmission → ordinary radio loudspeaker → phone microphone → modem decoder → verification → local database → live app`

The broadcast contains audible modem bursts in dedicated time slots. Start around 1.5 kHz centre frequency. Rattlegram's approximately 1.6 kHz occupied bandwidth then sits roughly between 700 and 2,300 Hz. Check actual occupied spectrum and all preamble components against the selected station's audio path. Do not use ultrasonic profiles, a 57 kHz RDS subcarrier, or stereo channels to carry independent data. Keep speech and music outside the data bursts in the first prototype.

Generate a 48 kHz, mono, 16-bit PCM WAV master. “16-bit audio” describes samples, not the data rate. 32-bit processing can be useful internally but does not increase the radio channel's capacity. Use the modem's supported sample rate internally and an explicit resampler at the phone input. No internet, FM tuner API, cloud decoder or return channel is required on the receiving phone.

**Modern candidates.** These figures describe different modem layers and are not interchangeable measurements of useful app throughput.

| Candidate | Published characteristics | Prototype role |
|---|---|---|
| Rattlegram / COFDMTV | 85, 128 or 170-byte text packets, about one second with optional noise/header disabled; 1.6 kHz bandwidth; differential QPSK and polar error correction | Primary: existing Android receiver and short independent packets |
| Codec2 DATAC1 | 510 payload bytes/frame, about 980 bit/s nominal; 1.7 kHz bandwidth | Alternative for larger objects; test burst overhead and phone port |
| Codec2 DATAC3 | 126 payload bytes/frame, about 321 bit/s nominal; 500 Hz bandwidth | Alternative for weaker or narrower audio paths |
| aicodix/modem, separate newer implementation | 2.4 kHz bandwidth; short half-rate QPSK about 1.1 kbit/s, 16-QAM about 2.1 kbit/s | Later throughput experiment; not automatically compatible with Rattlegram |
| ggwave audible | Typically 8–16 bytes/s, using a wider audio band | Easy comparison, but no clear speed advantage for this project |
| MFSK32 | 31.25 symbols/s, 16 tones, convolutional FEC and variable-length character coding | Reference/fallback; its 120 wpm text figure is not 120 bytes/s |

Primary specifications: [Rattlegram author description](https://github.com/aicodix/rattlegram/blob/56bba44527f37963deefc675cc909a97dbb6b149/fastlane/metadata/android/en-US/full_description.txt), [Codec2 data modes](https://github.com/drowe67/codec2/blob/310777b1c6f1af0bc7c72f5b32f80f6fd9136962/README_data.md), [aicodix/modem](https://github.com/aicodix/modem/tree/a4a8b57769679cf0fd3f5b4941f246b5e3718ee9), [ggwave](https://github.com/ggerganov/ggwave), and [MFSK specification](https://www.w1hkj.org/modes/mfsk.htm).

Codec2 includes radio-channel tests, but those are not phone microphone results. OFDM's guard interval and coding make it a credible candidate; station clipping, noise suppression, long room echoes and poor audio routing can still defeat it. Quiet/amodem are additional research options, but their high cable-link rates are not evidence for this broadcast path. Acknowledgment-dependent file transfer also does not fit one-way broadcasting.

**A concrete payload budget.** A reproducible fictional bulletin is included alongside this plan. It contains 12 shelter status updates, 8 aid-point status updates and 3 new situations, including Latvian text. Facility names and coordinates come from a preinstalled versioned registry; each new situation carries its own coordinates, title and instruction.

- Actual encoded application data: **728 bytes** in deterministic CBOR.
- Actual signed data: **1,392 bytes** across eight independently signed objects.
- Five objects contain four facility updates each; three objects contain one situation each.
- No compression is required for these sizes. Longer descriptions, new facility definitions, polygons and additional languages must be budgeted separately.

| Maximum Rattlegram text packet | Object bytes per full transport fragment | Packets per pass | Two passes | Two passes + 25% contingency |
|---|---:|---:|---:|---:|
| 170 bytes | 107 | 17 | 51 s | 63.75 s |
| **128 bytes** | **77** | **19** | **57 s** | **71.25 s** |
| 85 bytes | 44 | 35 | 105 s | 131.25 s |

Each slot is budgeted at 1.5 seconds. Reading the pinned [Rattlegram encoder](https://github.com/aicodix/rattlegram/blob/56bba44527f37963deefc675cc909a97dbb6b149/app/src/main/cpp/encoder.hh) gives seven 180 ms blocks when optional leading noise and the visual header are disabled, including a trailing block: 1.26 seconds. The extra 240 ms is an initial scheduling allowance. Measure the actual generated WAV and mobile playback queue before freezing this number. Short final fragments can automatically use stronger profiles.

For this heavily signed, repeated small-record workload, the 128-byte budget corresponds to **81.7 useful application bit/s** over its allocated 71.25 seconds. Over a full 180-second session containing only this one unique bulletin, it is **32.4 useful bit/s**. That difference is why the demo must show both elapsed session time and transferred unique bytes. Repetitions improve reception opportunities without increasing unique content. The 25% allowance is not a probability of successful reception.

**Protocol v0.1.** Keep the modem and application protocol separate so the latter survives changing modems.

| Layer | Initial choice |
|---|---|
| Application | Three operations: situation upsert, shelter status upsert, aid-point status upsert |
| Serialization | Deterministic CBOR with integer field identifiers, enumerations and UTF-8 text |
| Authentication | One COSE_Sign1/Ed25519 signature per small object; trusted public keys installed with app |
| Transport | Bounded fragments, offsets, full-object length, CRC32C, duplicate suppression |
| Audio | Rattlegram 128-byte profile first; repeated objects; no acknowledgment dependency |

CBOR and COSE are defined by [RFC 8949](https://www.rfc-editor.org/rfc/rfc8949.html) and [RFC 9052](https://www.rfc-editor.org/rfc/rfc9052.html). Ed25519 signatures are 64 bytes, as specified in [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html). CRC detects transport errors; the signature authenticates the publisher. A decoded callsign or CRC alone cannot establish authority.

The fixture's signed body carries: schema version, issuer, region, registry version, bulletin ID, object ID, issue time, expiry time, exercise flag and records. Each record has an entity ID and revision. Coordinates use signed integers scaled by 100,000. Facility states are unknown/open/limited/full/closed. Available-place counts and service flags are explicit values, not inferred from map presence. Situation records carry category, severity, point location, title, instruction and active/resolved state.

The transport frame is 16 header bytes plus object data. Multi-byte fields use network byte order:

`issuer:u16 | bulletin:u32 | object:u16 | byte_offset:u16 | total_length:u16 | crc32c:u32 | fragment`

CRC32C covers the first 12 header bytes and the fragment. Offsets allow merging the same object received using different packet sizes. Overlaps must agree byte for byte. The verified body must match the transport issuer/bulletin/object identity. Bound objects to 1,024 bytes, bound concurrent incomplete objects, and reject invalid lengths before allocating memory.

For stock text compatibility, send `at1:` followed by Base64 of the binary frame. A 128-character packet leaves 77 bytes for object data; this overhead is included above. Stock Rattlegram chooses its mode from text length. A later binary adapter can remove Base64 overhead, but requires explicit length handling because the stock encoder examines zero-terminated text.

Verify and commit each complete object immediately. A missing situation must not prevent a shelter bundle from updating. Apply only newer entity revisions; repeat reception must not duplicate records or roll back state. Retain incomplete fragments across repeats. Send full state for each updated entity so a phone does not need every earlier bulletin. Carry resolved/closed states explicitly. Expired availability becomes stale/unknown; missing reception never means that a facility is closed. Unknown registry versions must not resolve IDs against the wrong map. Keep any unresolved record visible as such. Track freshness separately from signature validity if the phone clock is untrusted.

**The demo interface.** One screen should have three views, with no online basemap dependency:

1. **Receive:** microphone level, selected/detected mode, elapsed time, valid and failed frames, decoded transport bit/s, unique verified application bit/s, and object completion. Show decoder SNR/frequency offset only if actually available.
2. **Raw import:** received `at1:` text, binary hex, offset and length, CRC result, decoded object fields and signature result. Distinguish incomplete, rejected, duplicate and applied objects. Provide offline WAV import as a repeatable diagnostic input to the same decoder.
3. **Atbalsts data:** situations, shelters and aid points. Flash changed rows briefly and show revision, issue time and freshness. Update from real decoder events, without a timer fabricating reception.

Use an Android app with native microphone capture, the existing C++ modem core, a Kotlin UI and SQLite/Room storage. Keep DSP off the UI thread. Bundle schemas, registry, public keys and fonts. The receive-only demo build should omit the INTERNET permission. Microphone use is explicit and foreground. Prefer unprocessed capture when supported and log the actual input route/rate; Android provides a capability check for [unprocessed audio](https://developer.android.com/reference/android/media/AudioManager#PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED). Test built-in microphones before Bluetooth. An iPhone port is a separate milestone using the same core and [measurement audio mode](https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/measurement); do not imply the existing Android app establishes iOS support.

**Step-by-step work plan.** Estimated 3–4 weeks with a mobile engineer and a DSP engineer, plus a station engineer for the radio tests. This is an effort estimate, dependent on device availability and station access.

| Step | Work and output | Acceptance checkpoint |
|---|---|---|
| 1. Freeze the experiment, days 1–2 | Pin source versions; select three Android phones and two radios; define broadcast audio path, fixtures and log format | Everyone tests the same WAVs, records and conditions |
| 2. Establish modem reference, days 2–4 | Generate all three Rattlegram profiles; check spectrum and exact duration; independently decode reference files; compare Codec2/MFSK32 where practical | Byte-exact decoding; no assumptions about nominal rate left hidden |
| 3. Build importer, days 3–6 | CBOR/COSE, fragments, local registry, entity revisions, expiry and signed object commits | Reorder, loss, duplicates, invalid signatures and stale versions handled correctly |
| 4. Build the live phone screen, days 5–10 | Microphone decoder plus raw-packet view, speed counters and three entity lists; offline WAV replay uses the same pipeline | New data appears only from verified decoder output; restart works offline |
| 5. Test acoustics, days 8–12 | Speaker-to-phone tests at multiple distances, volumes and noise levels; select viable profiles | Find the repeatable operating envelope and first useful-update latency |
| 6. Test the radio chain, days 11–15 | Audio-only control versus actual FM receiver output and speaker; retain the station's intended processing | Determine how much loss comes from radio processing versus the room |
| 7. Run a live broadcast exercise, days 15–18 | Three-minute signed exercise bulletin, independent receivers at multiple locations, local logs | Complete update and latency results by phone, receiver and location |
| 8. Decide and document, days 18–20 | Compare profiles, failures and usable throughput; publish supported envelope and reproducible recordings | Choose the fastest profile that passes; otherwise reduce scope or change modem |

For step 2, include reference-decoder cross checks so testing does not only compare an implementation with itself. Start with the Rattlegram commit linked above. Its published source is 0BSD; retain applicable notices when integrating. Codec2 requires a separate review of its library distribution obligations before a product release. The protocol fixture is not a production crypto implementation.

**Measurement design.** Count all sessions, including failed acquisitions. Use these definitions in logs and on screen:

- Decoded transport rate: CRC-valid binary frame bytes × 8 / elapsed time. Include headers and repeated frames, exclude Base64 text expansion from this particular counter.
- Useful application goodput: bytes of unique verified CBOR object bodies first accepted in this session × 8 / elapsed time. Exclude signatures, transport headers, Base64 and repeats. For the main throughput comparison start each receiver from the same baseline; separately count entities actually changed.
- Session goodput: the same useful byte count divided by the entire prescribed listening window, including silence, acquisition and failures. Show a 10-second rolling rate separately from the cumulative rate.
- Frame erasure rate: missing or invalid expected frames / transmitted frames, matched against the transmitter's run manifest. Corrupt headers may prevent counting failed frames accurately from receiver logs alone.
- Completion and latency: time to first applied object, time to all expected entity revisions, and completion within 180 seconds. Report failed sessions separately rather than computing percentiles only over successes without disclosure.
- Raw BER: measure only with known test bits and decoder instrumentation. CRC failures alone do not reveal the number of bit errors.

Record run ID, source/build hashes, modem profile, audio sample rate, WAV hash/duration, phone/OS, radio model, station chain, output level, distance/orientation, noise condition, arrival time, transport IDs, CRC/signature result, committed revisions and interruptions. Keep raw recordings for designated test runs. Log radio-to-phone distance separately from transmitter-to-radio location. For simulated SNR, state the measurement bandwidth; do not compare different modem SNR figures as if they were equivalent.

First screen profiles with short packet runs. For the selected profile, conduct at least 120 phone-sessions: three phones × two radios × two declared conditions × ten runs. Phones can listen concurrently, but observations from the same broadcast are correlated; preserve run IDs and do not present them as fully independent reliability evidence. Test nearby quiet reception at 0.3 m and 1 m as the core envelope. Treat 3 m, conversation noise, reverberant rooms, receiver edge coverage, heavy compression, clipping, changed phone orientation and late starts as stress cases. Add sample-rate drift, truncated bursts, 1–5 second interruptions, duplicate/out-of-order packets and malformed inputs in offline replay.

Proposed prototype pass criteria: at least 95% complete bulletins within 180 seconds inside the declared core envelope; first useful object within 10 seconds in at least 95% of full-start core runs; no wrong or unauthenticated state commits in the corruption/replay tests; and successful cold restart with networking disabled. These are pilot gates, not a claim of emergency-service reliability. If the faster profile fails, select 128 or 85 bytes; if those fail, compare Codec2 DATAC3 and MFSK32 using the identical application objects. Upgrade speed only when completion reliability holds.

**Three-minute live exercise.**

| Time | Transmission | Visible result |
|---|---|---|
| 0–10 s | Spoken exercise identification and listening instructions | App is already open and listening |
| 10–40 s | First 128-byte pass, priority objects first | Raw packets arrive; small signed groups populate progressively |
| 40–70 s | Second pass in changed object order | Missing fragments complete; duplicates do not add content |
| 70–110 s | New higher revisions: one shelter becomes full, an aid point changes services, one situation resolves | Existing rows visibly change without duplication |
| 110–170 s | Repeat critical and previously sent objects; optionally use a tested stronger profile | Interrupted/late receivers recover what fits in the remaining slot |
| 170–180 s | Exercise closing and end margin | App retains its data; counters preserve the complete session denominator |

Generate and time the actual sequence before broadcast; those windows are a schedule budget. Pause/mute one receiver for five seconds, resume it, and show recovery from repeats. A receiver starting very late cannot be promised the entire bulletin. For a measured late-join test, prescribe a start offset and an explicit remaining listening duration.

Before the exercise, install the app and static registry. Regenerate the fixture with `payload-budget.py --issued-at <unix-test-time>` so its one-hour validity covers the exercise; fixed timestamps are replay test vectors, not current alerts. Then enable airplane mode and explicitly switch Wi-Fi and Bluetooth off. Relaunch the app offline with no imported situation data. The only source of the new updates must be the radio's sound. Following reception, stop the sound, restart the app and demonstrate retained data and correct expiry. Offline WAV replay is useful evidence of the decoder/importer, but must be reported separately from microphone and RF tests.

Use a cooperating licensed station for the live RF stage. Earlier tests can use audio playback and a properly controlled RF bench. If testing in Latvia, [Elektroniskie sakari's current guidance](https://www.esakari.lv/lv/radioatlaujas) includes low-power FM event permits and assigns their frequencies; low power is not itself permission to broadcast. Confirm the appropriate route with the station or regulator before radiating. No frequency, power, range or permit is assumed by this outline.

**Outputs to hand over.** Android receiver build; transmitter WAV generator; versioned protocol schema; reference corpus and audio recordings; locally exportable reception logs; modem comparison by condition; a video of genuine offline reception; and a go/no-go decision tied to the measured operating envelope. Initial equipment needs are a laptop/audio interface, two FM radios with speakers, three existing Android phones, and access to an RF bench or broadcaster. Obtain hardware and airtime quotes after inventory; no purchase is needed to validate file encoding.

**What is already supplied.** `payload-budget.py` generates `fixtures/bulletin-readable.json`, signed object files and stock-text-compatible packet lists for all three profiles. `sizing-results.json` records exact byte counts and assumed airtime. Signature verification, CRC32C's standard check value, Base64 round trips and packet limits were checked locally. All eight objects were reassembled from each profile after a missing first packet, reversed arrival order and repetition; a corrupted fragment failed CRC. These files do not yet constitute a microphone decoder, mobile app, generated modem WAV or completed radio trial. The included deterministic signing key is public exercise material and must never be trusted in production.
