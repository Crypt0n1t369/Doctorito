# Radio-audio link simulation

Phase-three validation for the Atbalsts radio update prototype: does data carried
as audible tones in an FM broadcast survive the path to an ordinary phone's
microphone, and how much of it?

Everything before this directory was a **byte-count budget on paper**. No
waveform had been generated or decoded. This adds a working modem, a modelled
impairment chain, and measured frame error rates.

## What this proves, and what it does not

**Proves.** A coded-OFDM modem of the Rattlegram class, carrying the project's
real signed CBOR/COSE fixture, recovers all eight objects byte-exact and
signature-verified through a modelled broadcast-processing, loudspeaker, room,
ambient-noise and phone-microphone chain — provided two conditions hold. It also
identifies which impairments matter and which do not, which is what a physical
trial needs to know before it books airtime.

**Does not prove.** No radio transmitted, no phone listened. Every impairment is
a documented model, not a measurement of a particular station, receiver or
handset. The modem here is a *representative* implementation, not Rattlegram:
same class (differential QPSK on OFDM, ~1.6 kHz occupied, cyclic prefix, soft-
decision FEC), but rate-1/2 convolutional coding in place of Rattlegram's polar
codes. Expect the real thing to be 1–2 dB better, not worse. Results transfer as
*class* evidence and as a *ranking of impairments*, not as Rattlegram numbers.

## The findings that decide the concept

1. **The room, not the radio, is the hard part — and a car is the easy case.**
   What governs decoding is the direct-to-reverberant ratio, and therefore the
   reverberation time of the space. A living room (RT60 ≈ 0.45 s) has a coherence
   bandwidth of ~9 Hz; a car cabin (RT60 ≈ 0.05 s) has ~82 Hz. In a car the modem
   decoded at **every distance tested, from 16 cm to 1.8 m**. In a living room it
   needs the phone close.

2. **How close depends on the modem's subcarrier spacing, not on physics alone.**
   At the 31.25 Hz spacing used by default here, a living room needs ~29 cm. At
   7.81 Hz — close to Rattlegram's actual 6.25 Hz — the same room works at
   40–57 cm. Any earlier "10–30 cm" figure was a property of the coarse grid.
   Fine subcarrier spacing is the single most important modem parameter for
   indoor use.

3. **The phone's audio capture path must be unprocessed.** A representative voice
   noise-suppressor drops frame success from 100% to 33%, and it fails
   *partially* — about a third of records arrive, so the app looks updated when it
   is not. One line of capture configuration.

4. **On a highway, noise rather than echo becomes the limit.** Road noise is
   heavily low-frequency: only −26 dB of its energy lands in the modem's band,
   against −3 dB for speech babble. Parked or at city speed the phone can sit
   anywhere in the cabin; at 100 km/h it needs to be near a speaker, or the volume
   turned up.

Everything else the chain does — broadcast compression, hard clipping even at
1 dB headroom, loudspeaker quality (cheap, ordinary and car speakers were
indistinguishable), microphone AGC, sample-clock offsets to 1000 ppm, dropouts up
to 100 ms — costs nothing measurable.

Guard interval is a partial exception to the earlier claim: it does not move the
cliff in a reverberant room, but in a car 4 ms fell to 89% where 8 ms held 100%,
and near the room cliff 32 ms beat 4 ms by four points. Keep a guard around
1/8 of the symbol; do not expect it to buy reverberation tolerance.

## Files

| File | Purpose |
|---|---|
| `modem.py` | The modem. OFDM/DQPSK, K=7 rate-1/2 convolutional FEC, chirp sync. `set_mode()` selects differential-across-frequency or across-time; `set_guard()` sets the cyclic prefix. |
| `channel.py` | Impairment chain: pre-emphasis, compression, clipping, 15 kHz limit, de-emphasis, loudspeaker, room impulse response, ambient noise, microphone AGC, noise suppression, clock offset. |
| `study.py` | Trial harness, Wilson confidence intervals, DRR↔distance conversion. |
| `capacity.py` | Frame error rate → maximum reliably deliverable bulletin. |
| `analyze.py` | Signing overhead, airtime throughput, capacity tables. |
| `goodput.py` | Frame-size choice from the measured rates. |
| `make_wav.py` | Builds `bulletin.wav` from the real fixture, and decodes one back. |
| `end2end.py` | Full chain including Ed25519 signature verification. |
| `encodings.py` | CBOR vs Protocol Buffers vs bit-packing, measured on the same bulletin. |
| `exp_*.py` | The experiments; each writes `results_*.json`. |

See `PROTOCOLS.md` for what to reuse instead of inventing, and the measured
encoding comparison.

## Reproducing

```
python3 exp_a.py       # guard interval vs reverberation
python3 exp_mode.py    # differential-in-frequency vs in-time
python3 exp_bcd.py     # noise sweep, impairment ablation, payload size, dropouts
python3 exp_f.py       # weak reception, programme-audio collision, late tune-in
python3 exp_g.py       # payload size at marginal operating points
python3 exp_h.py       # measured repetition gain
python3 exp_car.py     # car cabin, guard interval, cheap loudspeakers
python3 exp_grid.py    # subcarrier spacing vs reverberation
python3 exp_car_e2e.py # the car scenario end to end
python3 analyze.py goodput.py end2end.py encodings.py
```

Run them one at a time: each opens an 8-process pool, and two concurrently will
exhaust an 8 GB machine.

Needs `numpy` and `cryptography`. No scipy.

## Producing a broadcastable file

```
python3 make_wav.py                          # -> ../bulletin.wav + manifest
python3 make_wav.py --decode ../bulletin.wav # reference receiver
```

`bulletin.wav` is 48 kHz mono 16-bit, carrying the fixture's eight signed objects
twice, second pass in reversed order. `bulletin-manifest.json` records what was
transmitted in each slot, so a receiver log can be scored for frame erasure rate
against ground truth rather than against itself.

## Carrying this to the physical trial

The simulation has already answered the questions a bench test would have spent a
week on. The trial should therefore be pointed at what the model cannot settle:

- **Measure DRR directly**, not just tape-measure distance. Play a burst, record
  at the phone position, and compute the direct-to-reverberant ratio. The
  10–30 cm figure is derived from a Sabine diffuse-field model with an
  omnidirectional source; a real radio speaker is directional, so the usable
  distance on-axis is probably better than modelled. That correction is worth
  measuring before writing user instructions.
- **Confirm the unprocessed capture path** on each candidate handset, and log the
  audio route and sample rate actually granted, not the one requested.
- **Verify the real station's processing.** Clipping and compression cost nothing
  here, but a station's chain may include stereo encoding, loudness limiting or
  codec stages this model omits.
- **Keep programme audio out of the burst slots.** Speech or music less than
  15 dB below the burst breaks decoding; the model is unambiguous about that.
- **Do not chase marginal conditions.** The measured behaviour is close to
  binary: inside the envelope frames essentially always decode, outside it they
  essentially never do. Repetition rescues transient noise, not bad geometry.
- **Test the car first.** It is the most forgiving environment and the most
  likely real use, and it needs no instruction to the user beyond having the app
  open. Reverberant indoor spaces — tiled kitchens, hallways, empty flats — are
  the stress case, not the living room.
- **Measure the chosen modem's subcarrier spacing** before accepting any distance
  figure from this study. It is the parameter the indoor result hinges on.
