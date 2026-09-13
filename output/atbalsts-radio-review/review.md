# Atbalsts offline audio test: findings and product implications

Reviewed 9 September 2026. Session `3ikpsj6w`, exported 14:11:04 UTC. The user confirms that a phone played the audio, a MacBook received it, and connectivity was disabled. Distance and ambient conditions were not recorded.

**The core objective worked in this setup: audible sound carried an update into an offline app.** The next work should establish reliable phone reception and offline reopening, then connect verified updates to the main Atbalsts state. Changing the modem is not the immediate priority.

## Measured results

| Measure | Result | Meaning |
|---|---:|---|
| Listening session | 30.68 seconds | Denominator includes waiting and repeats |
| First complete accepted object | 19.06 seconds | Time to the first usable update, measured from listening start |
| Applied status records | 180 | All arrived in one complete, signature-checked object |
| Unique accepted data | 904 bytes | Four body-header bytes plus 180 five-byte records |
| Useful data rate | 235.7 bits/s; 29.5 bytes/s | Body bytes only, divided by the whole session |
| Detected candidates decoded | 17 / 24 = 70.8% | Seven candidates failed; this is not a bit-error rate or population reliability estimate |
| Preloaded shelter registry | 803 locations | Names, coordinates and map were already on the device |
| Locations with received status | 180 / 803 = 22.4% | Registry coverage, not transmission completion |
| Situations present | 0 | This session does not establish situation-message reception |

The signed object is **968 bytes**, including the 64-byte signature; it needs nine distinct fragments at 112 object bytes per frame. Repetition and reassembly can make the object succeed despite individual failed or missed attempts. The log alone does not show which fragments came from which repetition.

**Do not interpret the seven failures as seven lost transmitted packets.** The receiver counts detected chirp candidates, including possible false detections, and the export omits the sender's manifest. The deployed built-in 180-record national sweep sends nine fragments twice: 18 bursts. If that was the selected transmission, 24 detected candidates cannot be treated as 24 intended transmitted packets. Confirm the sender mode before computing packet loss.

Holding this session-average rate constant would yield about **5.3 KB in three minutes**. That is a linear planning projection, not measured sustained capacity. It supports the direction of compact statuses and brief instructions; it does not establish a service guarantee.

## What the evidence establishes

The supplied log and the user's confirmation establish the phone-speaker → MacBook-microphone → data → app-change loop with internet disabled. The receiver reports 48 kHz mono capture; echo cancellation, noise suppression and automatic gain control were reported off.

It does not establish reception on Android or iPhone, reception through an FM station and radio speaker, blackout recovery after closing the app, multi-hop forwarding, population reliability or battery consumption. A preloaded 803-location registry is also not proof that 803 locations were sent over audio.

Five sampled level windows around 6–7 seconds had peaks above 1, reaching 3.19. Check gain, volume and capture normalization. These floating-point observations do not establish where clipping occurred or whether it caused the failed candidates. The log's 88.5% “above noise floor” metric uses a fixed peak threshold and windows emitted by both timers and decode events; it is neither SNR nor a time-weighted availability measure.

## Concrete findings in Atbalsts

1. **Offline cache conflict.** The deployed main worker deletes every cache except its own during activation. This includes the radio exercise cache. An isolated test of that exact worker, using in-memory caches, reproduced the deletion without changing any browser. Restrict cleanup to that worker's own older cache names, or manage both packages under one explicit offline lifecycle. Test main-app installation and upgrades alongside radio preparation. [Main worker, lines 94–102](https://github.com/goofis11/palidzi/blob/5d6da0aa7053ebe492b477bc28e64d7e109e787c/public/sw.js#L94-L102)
2. **The exercise has its own state.** It stores statuses under `atbalsts-radio-demo-v3`. This successful import is not evidence that the main situation workflow reads those records. Add one validated local store for public state, shared by online and audio inputs. The radio's numeric shelter IDs currently correspond to the main registry's `official-112-N` suffixes, with matching coordinates for all 803 entries in the inspected checkout. Formalize and version that mapping instead of relying on array order.
3. **The exercise key is public test material.** A valid demo signature proves byte integrity against that test key. Production approval must use a different trust root, and public recipient code must never carry centre publishing or report-decryption secrets. [Deployed source](https://github.com/goofis11/palidzi/blob/5d6da0aa7053ebe492b477bc28e64d7e109e787c/public/radio-exercise/index.html)
4. **Freshness needs a protocol, not a badge.** The demo's revisions are one byte and the signed body lacks issue time, expiry and registry identity. Add authenticated freshness and authority metadata before applying this to live status. Distinguish unknown, outdated, closed and withdrawn records.
5. **Cached software needs safe updates.** The radio worker prefers cached responses. An online upgrade should install a verified complete new package without deleting the last working offline copy. Cache presence alone cannot guarantee survival of browser storage eviction or device loss.

The downloaded radio page matched GitHub commit `5d6da0aa7053ebe492b477bc28e64d7e109e787c` exactly. GitHub main at inspection was merge `6636f6fae01bba5a4a9697c196638b7f0ee84ea9`. The main worker also matched its GitHub source exactly. No production files were changed during this review.

## Blackout user experience

Before a disruption, offer **Save for offline use**, a selected home area and a short practice reception. Essential reading and listening should not depend on login. Preload maps, registries, languages, instructions and public keys. Validate readiness by reopening the app with connectivity disabled, including after an app upgrade. People without the saved app cannot obtain it from a status-only broadcast during a blackout.

During disruption, the main view should contain **Nearby help**, **Listen for updates**, and a clear last-known timestamp. Show saved information immediately. Keep the agreed radio station, frequency and bulletin schedule in the offline pack. Do not require internet geocoding; support a manually selected area.

The listening sequence should say:

- “Waiting for the broadcast.”
- “Receiving — keep the phone near the speaker.”
- “Receiving your area: 6 of 9 parts.”
- “Update received: two nearby shelters changed status.”

Those are proposed UX messages, not current measured behavior. Progress must reflect actual authenticated bundle membership. If a bulletin is incomplete, preserve progress and say so. Put bitrate, frame counters, the editor and raw imports in exercise/operator tools.

On completion, stop microphone capture when the relevant bundle is complete and give an accessible visual/haptic cue. Display publisher, issue time, receipt time and expiry. A free-place count is the last report, not a reservation. Keep unverified reports off the public map; their handling is specified in the accompanying relay design.

Use agreed scheduled listening windows to conserve power, rather than depending on continuous background microphone access. Pair data tones with spoken guidance and a non-phone fallback. [VUGD guidance](https://www.vugd.gov.lv/lv/ieteikumi-civilas-aizsardzibas-joma) already identifies radio as an emergency-information channel and includes a portable radio with batteries in preparedness advice.

## Next validation

First repeat the known transmission into Android and iPhone receivers with connectivity off, including closing and reopening the app. Then insert an actual radio receiver. Test late starts, short interruptions and quiet/noisy rooms at recorded distances and volumes. Send situations and aid-point changes as well as shelter statuses.

Measure complete useful regional updates within the promised listening window, first useful update time, full completion time and battery use. Record the app version, exact sender manifest, per-frame times and validity outcomes, full-object IDs, connectivity state and offline-reopen result. A single “working” field should not be the acceptance test.

## Reproducibility

The original supplied log remains in the user's Downloads folder. `analyze_log.py`, `log-summary.json` and `log-analysis.ipynb` reproduce the numerical checks without copying microphone device identifiers into the summary. Notebook code was executed in a fresh Python namespace and structurally checked; the bundled runtime did not provide `nbformat`.

The analytics report renderer ceased to be available during this task, before rendering succeeded. This source-backed Markdown review and the relay design are the delivered files; no rendered analytics widget is claimed.
