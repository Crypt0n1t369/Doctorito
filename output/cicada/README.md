# 🦗 Cicada

**Data over sound, as a service.** An OFDM audio modem, an HTTP API that renders and
decodes it, a browser SDK, and the three pages you need to operate it.

One speaker reaches every device in earshot. No pairing, no network, no camera.
Roughly 122 bytes a second in a band you can hear.

```bash
npm start
# → http://localhost:4137
```

The server prints an API key on its first start.

| | |
|---|---|
| **Studio** `/` | Type a payload, watch the spectrogram, press play, watch the same page hear it back |
| **Desk** `/announce` | Compose a PA announcement; see it in every language before it goes out |
| **Passenger** `/listen` | The announcement as large text, in the reader's language, offline |
| **Console** `/console` | Usage, channels, signing keys, cards, history, receipts |
| **Receiver** `/receive` | A deployable listener that pins keys and caches cards, then works offline |
| **Docs** `/docs` | API reference, wire format, and where this fails |

---

## Sixty seconds

```bash
# Render
curl -X POST localhost:4137/v1/transmissions \
  -H "Authorization: Bearer $CICADA_KEY" -H "Content-Type: application/json" \
  -d '{"text":"Gate 14 · boarding closes 18:40","profile":"robust"}'

# Play the audio_url through any speaker.
```

```js
// Receive — no key, no cost, entirely in the browser
import { listen } from "/cicada.js";
const rx = await listen({ onMessage: m => console.log(m.channel, m.text) });
```

No server needed at all:

```bash
node src/cli.js encode "hello" --out hello.wav
node src/cli.js decode hello.wav
```

---

## Measured performance

Reproduce with `npm run bench`.

| Profile | Frame | One frame holds | Throughput | Airtime for 11 B |
|---|---:|---:|---:|---:|
| `micro` | 16 B | 11 B | ~16 B/s | 0.55 s |
| `robust` | 64 B | 59 B | ~53 B/s | 0.84 s |
| **`standard`** | 128 B | 123 B | ~86 B/s | 1.20 s |
| `fast` | 512 B | 507 B | ~146 B/s | 3.29 s |

Raw burst throughput is 122 B/s at 128-byte frames and 163 B/s at 512-byte frames;
the table above includes the 0.30 s inter-burst gap and lead-in.

**Noise tolerance.** 128-byte frames decode 97 times in 100 at **−4 dB SNR** — with
the noise louder than the signal — then cliff sharply by −5.5 dB. 512-byte frames
hold to −3 dB and cliff harder. That is what rate-½ K=7 coding and coherent OFDM
gain buy you, and it is why an audible band works at a polite volume.

> Every figure here is from software. No physical speaker, room or microphone
> appears anywhere in the measurement. They bound what the modem can do, not what
> your deployment will do.

---

## Cards: the reason airtime stops mattering

Publish a payload once through the API; broadcast its four-byte code.

| Payload | Sent directly | As a card reference |
|---|---:|---:|
| 65 B of JSON | 1.20 s | **0.55 s** |
| 1 KB | 6.72 s | **0.55 s** |
| 10 KB | 68.6 s | **0.55 s** |
| 60 KB | 6.9 minutes | **0.55 s** |

Airtime per pass, unsigned. The saving on a small payload is modest; the point is
that **it never grows**. Receivers cache the bundle over their normal network
connection and resolve codes locally, so resolution works offline too.

Right when the set of things you might say is known in advance. Wrong when the
content is genuinely novel each time — the receiver has to have synced it first.

---

## Announcements: a PA system that reaches people who cannot hear it

A spoken platform announcement is useless to a deaf passenger, and to anyone who
does not speak the language it is read in. The usual remedy is an induction loop:
five figures per platform, reaches only hearing aids with a T-coil, and carries no
text at all.

Public-address announcements are not free text — they are a handful of sentence
templates with a few values filled in. So the **templates**, in every language the
venue serves, sync to phones over their ordinary network connection, and the air
carries only the template number and its values:

```bash
POST /v1/announcements
{ "channel": "ch_…", "template": 1,
  "values": { "service": 2041, "destination": 2, "platform": 11, "wasPlatform": 4 } }
```

| | |
|---|---|
| On the air | **11 bytes** — 0.55 s unsigned, 1.20 s signed |
| Languages carried | as many as you publish, at **no extra airtime** |
| Same announcement, spoken | 6–8 s of the PA's time, in one language |
| Infrastructure needed | the speakers already installed |

The passenger page (`/listen`) renders it as large text with a size control and a
high-contrast mode, puts it through an ARIA live region so screen readers speak it,
and vibrates for anything urgent — because the person this exists for did not hear
the PA. Switching language re-renders instantly with no new broadcast, since the
text was never on the air.

Seed a worked example — a Baltic station in Latvian, English, Russian and
Ukrainian:

```bash
CICADA_KEY=ck_live_… node examples/seed-station.mjs
```

---

## Signing

Mark a channel signed and Cicada mints an Ed25519 key pair, keeps the private half,
and signs every message. Receivers pin the public half from
`GET /v1/channels/{id}/trust`.

A signature covers `channel || keyId || payload`, so it establishes that the holder
of that channel's key produced these exact bytes *for that channel* — the same
message relayed onto another channel does not verify. The channel number is not
repeated in the body; it already travels in the frame header.

It does **not** establish that the content is true or current, and it does **not**
stop replay on its own channel — a recording of a valid broadcast stays valid. If
freshness matters, carry it in your payload.

Signing costs 68 bytes on the air, so signed messages need `robust` or larger.

---

## API

Full reference at `/docs`. Authenticate with `Authorization: Bearer ck_live_…`.

```
POST   /v1/transmissions               Render a message to audio
GET    /v1/transmissions/{id}/audio.wav
GET    /v1/transmissions/{id}/frames   Raw frames, for your own modulator
POST   /v1/decode                      Recording in, messages out
POST   /v1/simulate                    Delivery rate through a modelled channel
POST   /v1/channels                    Create, optionally signed
POST   /v1/channels/{id}/rotate        New signing key, old one retired
GET    /v1/channels/{id}/trust         Public keys for receivers       · rk_ ok
POST   /v1/channels/{id}/cards         Publish a card
GET    /v1/channels/{id}/cards/bundle  Offline bundle, ETag'd          · rk_ ok
POST   /v1/receipts                    A receiver reports what it heard · rk_ ok
GET    /v1/capacity?bytes=N            Airtime calculator · free, unmetered
GET    /v1/usage                       This period's metered usage
```

**Receive tokens** (`rk_…`) are designed to ship inside clients: they read the trust
and card bundles and post receipts, and can do nothing else. Your secret key never
leaves your server.

---

## Why the band is audible, not ultrasonic

`experiments/ultrasonic.mjs` runs the unmodified modem upconverted to centre
frequencies from 1.5 to 21 kHz, through modelled transducer response, atmospheric
absorption, reverberation and seven pipeline cutoffs.

| | Audible, 672–2313 Hz | Near-ultrasonic, 18.2–19.8 kHz |
|---|---|---|
| Throughput | 86 B/s | 86 B/s — bandwidth sets it, not carrier height |
| Speaker + mic penalty | 0 dB | **−31.5 dB** |
| Works at 2 m | ✓ | ✗ — dies between 1 m and 2 m |
| FM broadcast (15 kHz) | ✓ | ✗ |
| Venue PA (18 kHz) | ✓ | ✗ |
| Video, voice call, telephony | ✓ | ✗ |
| Direct playback only | ✓ | ✓ |
| Reverberation tolerated | baseline | ~2× better — its one real win |
| Audible to under-25s, dogs, cats | n/a | yes |

Near-ultrasonic is an arm's-length, direct-playback channel — a different product,
not an upgrade. It ships as a selectable band, gated to paths that can carry it.

**Declare your delivery path and the service will tell you what survives it:**

```bash
curl "localhost:4137/v1/capacity?bytes=40&path=fmBroadcast&band=nearUltrasonic"
```

The most expensive mistake in data-over-sound is choosing a band the path silently
removes: the audio plays, nothing is received, and it looks like a decoder bug.

---

## Where this fails

- **Long reverberation.** The cyclic prefix is 8 ms. Rooms whose echoes run much
  longer smear symbols into each other and volume does not help. Atriums and
  stairwells are the hard case — not distance.
- **Aggressive loudness processing.** OFDM has a high peak-to-average ratio, so a
  broadcast limiter pushed hard flattens exactly the peaks carrying the information.
- **Voice-tuned audio processing.** Noise suppression and AGC are built to remove
  things that are not speech; a modem in the speech band looks like something to
  remove. The SDK disables them on capture — you cannot disable them in somebody
  else's conference system.
- **No acknowledgements.** There is no return channel. Receipts are only as complete
  as the devices that chose to send them.
- **It is audible.** By design — an inaudible carrier is a covert side channel — but
  it means bursts, not continuous transmission.

---

## Layout

```
src/modem/     core.js      DSP: FFT, Viterbi, chirp sync, resampler
               frame.js     Profiles, framing, reassembly, signing envelope
               audio.js     Rendering, WAV, streaming receiver
               simulate.js  Modelled acoustic channels
src/announce/  template.js  Templated multilingual announcements
src/server/    server.js api.js db.js http.js plans.js signing.js
public/        cicada.js    Browser SDK · studio/desk/listen/console/receive/docs
test/          modem.test.js api.test.js security.test.js announce.test.js bench.js
experiments/   ultrasonic.mjs  Is there a case for the near-ultrasonic band?
BUSINESS.md    Market, pricing, and what would have to be true
```

```bash
npm test          # 124 tests
npm run bench     # profile × condition delivery matrix
```

No runtime dependencies. Node ≥ 22.5 for `node:sqlite` and WebCrypto Ed25519.

---

## Provenance

The DSP core is derived from the Atbalsts radio-validation modem, where it was
verified bit-exact against an independent Python implementation and shown to decode
through simulated room, car and cheap-speaker degradations. Constants are unchanged,
so existing fixtures still decode.

Four things were found and fixed while building this:

1. The burst detector required `burstSamples` after a detected chirp, but that count
   includes 160 samples of lead *preceding* the chirp — so a burst at the end of a
   recording never decoded. A trailing silence gap had been masking it.
2. The resampler emitted its output shifted late by its filter's group delay,
   moving reported arrival times and pushing trailing bursts off the buffer. It is
   now sample-exact at 8, 16, 22.05, 44.1 and 48 kHz.
3. A fixed 0.5 s lead-in plus a trailing gap meant a four-byte card reference cost
   1.2 s, 58% of it silence. Now 0.55 s.
4. Signatures covered only `keyId || payload`, leaving them valid on any channel.
   A relay was stopped only by the trust table holding a different key elsewhere —
   a policy where a construction belonged. The channel number is now inside the
   signed bytes, at no cost on the air.
