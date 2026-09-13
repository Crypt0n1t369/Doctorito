# Atbalsts radio demonstration

Edit data → play audio → receive offline → the app updates. The registry and the
map are already on the device; the radio carries only what changed.

## Testing on a phone (needs HTTPS)

The microphone needs a *secure context*. `http://localhost` counts, a LAN IP does
not, and neither does an embedded frame. So a phone test needs the page on https.
Two ways:

**A. Put it on the domain.** A commit is ready on the local branch
`demo/radio-exercise` in the app repo, adding `public/radio-exercise/index.html`.
It is one static file — no Worker route, no app-bundle dependency, no network
calls. Push and merge and CI deploys it to
`https://atbalsts.sortium.co/radio-exercise/`.

```bash
cd palidzi-oauth-recovery
git push -u origin demo/radio-exercise      # then open a PR
```

I have not pushed it. Worth deciding deliberately: this puts *fictional shelter
statuses* on a live civil-protection domain. The page carries a permanent
bilingual exercise banner and `robots: noindex`, and sits on a path of its own —
but a separate hostname would separate it further if you would rather.

**B. A temporary tunnel**, which touches nothing:

```bash
python3 serve.py
npx cloudflared tunnel --url http://localhost:8000
```

That prints an https URL you can open on the phone. Nothing is installed on this
machine yet, so the first run downloads cloudflared.

## Run it locally — this is the path where the microphone works

```bash
python3 serve.py
```

Then open **http://localhost:8000/receiver.html**.

Browsers grant microphone access only in a *secure context*: `https`, or
`http://localhost`. A `file://` page, or a page inside an embedded frame that was
never granted the permission, is refused no matter how many times you allow it —
which is why the microphone appeared dead before. Running the server is the fix,
and the page now says which of those cases it is in rather than failing silently.

**Two devices.** Open the page on device A, press *Listen with microphone*. On
device B play a bulletin — from this folder, or from device B's own copy of the
page using *Prepare update* → *Play update*. Hold B's speaker within about
10–30 cm of A indoors.

**One device.** Press *Play a bulletin file* and pick a WAV. It plays aloud and
decodes at the same time. Useful for checking the pipeline; it does not test a
speaker or a microphone.

**Erase received data** clears everything the radio delivered and the counters.
The 803-shelter registry stays — it is preinstalled, not received.

**Export log** writes a diagnostic report: what the microphone was actually
granted, the input level over time, how many burst preambles were heard versus
decoded, and a plain-language verdict. It saves a file, copies to the clipboard,
and — when the page is served by `serve.py` — posts itself to `logs/`. That last
one is the useful path: run the server, test, and the reports are on disk to read.

The verdict distinguishes the cases that look identical from the outside:

| Verdict | Meaning |
|---|---|
| `microphone silent` | nothing reaching the page — permission, wrong input, muted |
| `audio present but no burst preamble detected` | it hears the room but not a bulletin: too quiet, too far, or the wrong file |
| `bursts heard but none decoded` | level, distance, or a processed capture path |
| `frames decoded but no complete signed object` | partial reception, needs more passes |
| `working` | frames decoded and objects verified |

## The three bulletins

| File | Length | Carries | Records |
|---|---|---|---|
| `01-riga.wav` | 16.7 s | Status for every shelter in Rīga | 112 |
| `02-situation.wav` | 20.7 s | A flood situation and the 12 closures around it | 13 |
| `03-latvija.wav` | 24.8 s | A national sweep across the other municipalities | 180 |

**305 records in 62 seconds of audio.** The page can also build and play these
itself — *Play a demonstration bulletin* — so no files are needed on the device
doing the transmitting.

They sound alike because they are the same modem: the tone character comes from
the waveform, not the content, the way two Wi-Fi transmissions look identical on
a spectrum analyser. Their bytes and lengths differ entirely.

They also sound thin, and that is measured rather than assumed: no clipping,
peak 0.72, out-of-band energy 26 dB down, but the average level sits 18 dB below
peak. That is inherent to OFDM — 106 subcarriers give a ~16 dB peak-to-average
ratio, and normalising to the loudest sample leaves the average low. A
peak-limiter was tried to recover about 5 dB of it and **made decoding worse**
(95/100 to 74/100 at DRR +9 dB, SNR +8 dB), because clipping has to be filtered
back per symbol with the cyclic prefix rebuilt; filtering the whole burst at once
introduced −15.4 dB EVM. It was removed. Doing it properly is real range work,
listed as known and not shipped broken.

## Why this is not a mock-up

- **The registry is real.** 803 shelters from the 112 `patvertnes` list with their
  actual coordinates, addresses and building types, plus the 2026 municipality
  boundaries — the same reference layers the Atbalsts app ships. Only the
  *statuses* are fictional exercise data.
- **The radio never sends a name, an address or a coordinate** for a known
  facility. A status update is five bytes: id, state, free places, revision. One
  signed status object is 9 bytes plus a 64-byte signature. That is the whole
  bandwidth argument, and `protocol.js` enforces it rather than leaving it as a
  convention.
- **Building types collapse to a ten-entry codebook**, so the phone draws the
  right symbol and label from a code instead of receiving the words.
- **Nothing is displayed until its Ed25519 signature verifies.** A valid checksum
  is never enough, and a browser that cannot verify signatures rejects objects
  rather than showing them as trusted.
- **Revisions cannot roll back.** A repeated or stale bulletin changes nothing.

## Measured

`test_demo.js` runs the page's own decoder, protocol and state code headlessly
over the bulletins, optionally through the impairment chain from `../sim`:

```
clean  45 frames, 4 signed objects, 1722 verified bytes, 305 records applied
room   45 frames, 4 signed objects, 1722 verified bytes, 305 records applied
car    45 frames, 4 signed objects, 1722 verified bytes, 305 records applied
cheap  45 frames, 4 signed objects, 1722 verified bytes, 305 records applied
```

`room` is a living room at ~20 cm with television-level babble; `car` is a cabin
with the phone on the seat at city speed; `cheap` is a pocket radio at ~10 cm in a
noisy room. Regenerate the degraded copies with the snippet in this folder's
history, or from `../sim/README.md`.

```bash
python3 build_data.py     # bundle registry + map from the app repo's GeoJSON
python3 make_demo.py      # sign and render the three bulletins
node test_demo.js clean   # headless end-to-end
python3 build_app.py      # splice tested modules into receiver.html
```

## Files

| File | Purpose |
|---|---|
| `build_data.py` | Bundles the real shelter registry and municipality boundaries into `data.js`. |
| `modem_demo.py` / `decoder.js` | The modem: Python transmitter, JavaScript receiver, deliberately free of RNG-dependent choices so the two agree exactly. |
| `protocol.js` | Records, framing, signature checks, revision rules, streaming detector. Shared by the page and the tests. |
| `encoder.js` | In-page transmitter, so a device can originate an update. |
| `app.js` / `app.template.html` | The interface. |
| `build_app.py` | Produces `receiver.html` (standalone, charset declared) and `artifact.html` (fragment for the hosted copy). |
| `serve.py` | Local HTTPS-equivalent origin so the microphone is permitted. |
| `test_demo.js` | Headless end-to-end over the bulletins. |

## Scope and honesty

All statuses, free-place counts and the situation are fictional exercise
material, and the bundled signing key is the project's public test key — a
production receiver must never trust it. The hosted copy of this page runs inside
an embedded frame, where microphone access is normally blocked; use the local
server for any real speaker-to-microphone test.
