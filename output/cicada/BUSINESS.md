# Cicada — the business case

*Written 13 September 2026, alongside the working implementation in this repository.*

---

## 1. What is actually being sold

A data channel made of sound. Bytes go into a speaker; any device with a microphone
in earshot gets them back. No pairing, no network, no camera, no account on the
receiving side.

The measured envelope, from `npm run bench` in this repo:

| | |
|---|---|
| Throughput | 122 B/s at 128-byte frames, 163 B/s at 512-byte frames |
| Robustness | 128-byte frames decode 97 times in 100 at **−4 dB SNR** — noise louder than signal |
| Band | 671.9 – 2312.5 Hz, audible, 8 kHz sample rate |
| Latency | 0.55 s for a card reference, 2.5 s for a signed one |
| Receiver cost | Zero. It is client-side JavaScript. |

For comparison, `ggwave` — the best-known open-source equivalent — runs at
8–16 B/s. This is roughly ten times faster and survives negative SNR.

Those numbers come from software simulation of the acoustic channel. They bound
what the modem can do. They are not a claim about any particular room.

---

## 2. Why anyone pays for this

Three properties fall out of the physics, and each one is awkward to buy elsewhere.

**No pairing.** Bluetooth needs discovery and a session. NFC needs a tap. QR needs
a camera, a steady hand, and a person who knows to point it. Sound needs a device
that is already listening. For a headless sensor being commissioned on a factory
floor, or a phone in a pocket, that difference is the entire product.

**One-to-many at zero marginal cost.** One speaker reaches every device in earshot
simultaneously. The hundredth listener costs exactly what the first did. A push
notification to 500 phones is 500 messages; a Cicada broadcast to 500 phones is one
transmission.

**Range is the room.** Sound stops at the walls. You cannot receive a message you
were not physically present for. Proximity becomes a property of the medium rather
than something you have to attest to with GPS you can spoof.

And it travels wherever audio already travels: a PA system, a phone call, a radio
broadcast, a video file, a voicemail. That is a distribution network nobody has to
build.

---

## 3. Who buys, and the thing most people get wrong about it

### Segment A — developers (self-serve)

Small teams adding an offline handoff, a proximity check, a device-provisioning
path. Low contract value, high volume, near-zero sales cost. They arrive through
documentation and leave through documentation.

**They are not where the revenue is. They are where the evidence is.**

### Segment B — operators (mid-market)

Venues, transit operators, museums, retail chains, broadcasters, conference AV.
They already have speakers everywhere and a content system to drive them. They buy
because the alternative — an app install, a network join, a QR sticker somebody
has to maintain — has a conversion rate they can measure and hate.

$300–$2,000 a month, sold through a demo, closed in weeks.

### Segment C — regulated and air-gapped (enterprise)

Emergency management, defence, industrial control, healthcare, critical
infrastructure. This segment has the sharpest need and the most money.

**And it cannot use your cloud API. That is the whole point of the technology.**

An organisation choosing a medium *because* it works without a network is not going
to call an HTTPS endpoint to render its audio. If the SaaS is the only way to buy,
the buyer with the strongest need is the one who cannot.

This is the trap the obvious business model walks into. The correct response is not
to talk them into the cloud. It is to sell them the thing they actually need: an
annual, per-site, self-hosted licence with source escrow and support, at
$25,000–$150,000 a year.

**So the model is deliberately dual.** The SaaS is the funnel, the documentation and
the proof. The on-premises licence is the revenue. Each one makes the other
credible — a self-hosted buyer will not take a black box seriously, and a developer
will not adopt something with no visible production users.

---

## 4. Pricing

| | Free | Pro | Scale | Self-hosted |
|---|---|---|---|---|
| | $0 | **$49/mo** | **$299/mo** | **from $25,000/yr** |
| Renders / month | 1,000 | 50,000 | 1,000,000 | unlimited |
| Server decodes | 500 | 25,000 | 500,000 | unlimited |
| Channels | 1 | 10 | unlimited | unlimited |
| Cards | 100 | 10,000 | unlimited | unlimited |
| Signed channels | — | ✓ | ✓ | ✓ |
| Receipt retention | 24 h | 30 days | 1 year | your disk |
| Overage | blocked | $2 / 1k renders | $1 / 1k renders | — |
| **Receiving** | **free** | **free** | **free** | **free** |

### Receiving is free, permanently, and not out of generosity

Decoding happens on the listener's own device. It costs us nothing, we cannot
observe it, and any attempt to meter it would be a lie enforced by a licence
agreement. Making it free and open is the honest description of what is happening —
and it is also the entire adoption mechanism. Once an estate of devices is
listening, somebody has to pay for something to say.

### The metering problem, stated plainly

**Renders are the wrong meter for static deployments.** A museum with twenty
exhibits renders twenty transmissions and then plays them for a year. Metering
renders would put that customer in the free tier forever while they run a real
deployment on us.

So the plans meter two different things on purpose:

- **Channels and cards** price *deployment scale* — the museum, the terminal, the
  chain of stores. This is what correlates with value in the static case.
- **Renders and decodes** price *dynamic content* — flight updates, queue numbers,
  per-visitor tokens, anything genuinely novel each time.

A customer pays on whichever axis they actually consume. That is why the Free tier's
binding constraint is **one channel**, not a thousand renders: one channel is a
demo, and the second channel is a deployment.

### Calibration

Pro's 50,000 renders is one venue broadcasting a fresh message every 30 seconds,
twelve hours a day (≈43,000/month). That is a deliberately chosen ceiling: a single
busy site fits, a second one does not.

---

## 5. The product surface, and why it is shaped this way

Four things need a server. Everything else belongs on the client, and is there.

**1. Rendering at scale.** Broadcast automation, CI pipelines and content systems
want a URL that returns a WAV. `POST /v1/transmissions` → `audio_url`.

**2. Key custody.** A signing key must never sit in a browser or a content system.
Cicada mints Ed25519 keys, keeps the private half, signs on request, and publishes
only the public half to receivers. Rotation retires the old key but keeps it in the
trust bundle for 90 days — a broadcast has no return channel over which to
coordinate a cutover, so both keys must verify during the overlap.

**3. The card registry — the feature that changes the economics.**

Airtime is the scarce resource. Storage is not. Publish a payload once through the
API, broadcast its four-byte code, and the receiver resolves it from a cached
bundle:

| | On the air | Airtime |
|---|---|---|
| 65-byte JSON payload, sent directly | 65 B | 1.85 s |
| The same payload as a card reference | **4 B** | **0.55 s** |
| A 60 KB payload as a card reference | **4 B** | **0.55 s** |

Airtime stops depending on payload size at all. For the venue case — where the set
of things you might say is known in advance — this is the difference between a
system that works and one that does not.

**4. Metering and receipts.** Usage, billing, and optional telemetry from receivers
that choose to report.

### The console, the studio and the receiver

The **Studio** is the page that sells the product. Type a payload, watch the
waveform and spectrogram appear, press play, and watch the *same page* hear it back
through the microphone and decode it. The demo is the product working, in ten
seconds, with nothing installed. That is not a marketing site; it is the shortest
path from scepticism to belief.

The **Console** is operations: usage, channels, keys, cards, transmission history,
receipts.

The **Receiver** is a deployable artifact, not a toy. Point it at a channel's
receive token and it pins that channel's keys, caches its cards, and works offline
from then on.

### Receive tokens

Channels issue a second credential (`rk_…`) designed to ship inside client code. It
can read the trust bundle and the card bundle, and post receipts. It cannot render,
decode, or read anything else. Without this, every deployed receiver would need a
secret key, and the product would be teaching people to leak one.

---

## 6. Competition

| | Position |
|---|---|
| **ggwave** (open source, free) | The honest benchmark. 8–16 B/s. Cicada is ~10× faster, adds signing, framing, reassembly and a registry. If someone's payload is ten bytes once a minute, they should use ggwave, and saying so is cheaper than losing the argument later. |
| **LISNR** | Ultrasonic, enterprise-only, closed. Inaudible carriers are a covert side channel; Cicada is audible on purpose. Different ethical position, and an easier compliance conversation. |
| **Chirp** | Acquired by Sonos in 2020 and withdrawn from the market. Their customers had to migrate. That is a live, addressable list. |
| **QR codes** | Free and universal. Genuinely better when a person is willing to point a camera. Worse for hands-free, one-to-many, headless devices, and anything moving. |
| **BLE beacons** | Better range and battery. Needs hardware in the room, OS permissions that keep tightening, and a pairing model. Cicada needs a speaker that is already there. |

The defensible position is not the modem — it is standard OFDM and anyone competent
can write one. It is the **card registry, key custody and profile tooling**: the
parts that turn a modem into something you can operate, and the parts that take a
year of arguing with real rooms to get right.

---

## 7. What would have to be true

This is the part a business case usually omits. Each of these is a real risk with a
stated test.

**The simulations must survive real rooms.** Every number in this document comes
from software. The next milestone is not a feature — it is a measured matrix across
three phones, two speakers and four real spaces, published with the failures
included. If reverberant halls turn out to be unusable rather than merely hard, the
venue segment shrinks to small rooms and the business is smaller.

**The reverberation limit is real and unfixed.** The cyclic prefix is 8 ms. Rooms
whose echoes run much longer smear symbols into each other, and volume does not
help. An atrium is a harder problem than distance ever was.

**Somebody's audio pipeline will eat it.** Broadcast limiters and voice-tuned noise
suppression remove exactly what this signal looks like. `broadcastFm` is in the
simulator because it is the most common real-world killer.

**Audibility is a product constraint, not just a virtue.** You cannot transmit
continuously in a quiet space without annoying people. Every deployment is bursts.

**The on-prem segment has a long sales cycle.** Twelve to eighteen months, security
review, procurement. The SaaS has to fund the wait.

---

## 8. Where to start

1. **Measure real rooms and publish it, failures included.** Nothing else can be
   claimed honestly until this exists, and it is the asset competitors will not
   bother to make.
2. **Ship the receiver SDK free and open.** It is the wedge and it cannot be metered
   anyway.
3. **Win one lighthouse in each of B and C.** A transit operator or museum, and one
   emergency-management or industrial buyer. The second one pays for the year.
4. **Sell the card registry, not the modem.** The modem is table stakes. Airtime
   that does not depend on payload size is the thing nobody else has bothered to
   build.

---

## Appendix — what is measured and what is not

**Measured** (reproduce with `npm test` and `npm run bench`):
throughput per profile; SNR cliffs in additive white noise; delivery rates through
eight modelled acoustic conditions; bit-exact round trips at 8, 16, 22.05, 44.1 and
48 kHz; signature verification and tamper rejection; duplicate suppression;
reassembly under frame loss and reordering.

**Not measured**: any physical speaker, room or microphone. No RF. No phone
hardware. No real broadcast chain. No load testing. No security audit.

The modem's DSP core is derived from the Atbalsts radio-validation work in the
adjacent directory, where it was verified bit-exact against an independent Python
implementation. That provenance is why it is trustworthy enough to build on; it is
not a substitute for the field measurement above.
