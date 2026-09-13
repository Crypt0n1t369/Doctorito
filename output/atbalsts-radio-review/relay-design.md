# Atbalsts: verified public updates and sealed private reports

Design proposal, 9 September 2026. Builds on the demonstrated offline audio loop. This document specifies the next implementation; it does not claim the encryption, relay or centre-offline features are already deployed.

**Pilot scope superseded:** use the smaller [centre-led architecture and tested protocol](../atbalsts-radio-security-proof/architecture.md). That proof tests HPKE interoperability and the existing audio modem. General resident report-carrying, delta sync and a broad mesh are not requirements for the pilot.

## Decision

Use two separate data paths:

1. **Public bulletin:** a centre approves and digitally signs a public update. Residents verify, display, store and retransmit the original signed bytes.
2. **Sealed report:** a resident encrypts an observation for a designated centre. Other devices may store and forward the ciphertext, but cannot open it or use it to update the public situation. The centre decrypts it into a private review inbox. Approval creates a new, redacted public bulletin.

The modem only moves bytes. Acceptance and trust belong to the object above it, so audio, a local connection or an internet upload can all carry the same objects.

The measured 904-byte status body already uses most of the demo's 1 KB object limit once its signature is included. Production metadata and wider revisions will not be free. Start with 32–64 status records per independently verifiable object, measure their encoded sizes and completion times, and retain the hard object-size check. These batch sizes are proposed starting points, not validated throughput claims. Short text reports and region-specific changes fit this link better than attachments.

```mermaid
flowchart LR
  R[Resident observation] --> E[Encrypt for centre]
  E --> Q[Relay devices: sealed storage only]
  Q --> I[Centre: decrypt into private inbox]
  I --> V[Operator verification and public redaction]
  V --> S[Centre signs a new public bulletin]
  S --> A[Residents verify and update local app]
  A --> T[Retransmit the original signed bulletin]
  T --> A
```

**Scope of the guarantee:** conforming Atbalsts clients can ensure that only authorized signed objects change public state and that relays lack private-report decryption keys. They cannot stop arbitrary audio transmissions, prove that every encrypted report is true or harmless, conceal the existence of an audible transfer, or guarantee delivery through a disconnected region.

## 1. Object classes and strict boundaries

| Class | May residents read it? | May it change public state? | Relay behavior |
|---|---|---|---|
| Authorized public bulletin | Yes | Only after signature, authority, schema and revision checks | Forward unchanged |
| Sealed resident report | No, except the author knows their own observation | Never | Store bounded ciphertext and forward toward its destination |
| Centre receipt | Only minimal delivery information | No | Forward the original signed receipt |
| Invalid, unknown or exercise object | Never as a current public fact | Never | Reject; exercise traffic stays in the exercise environment |

Use separate decoders, queues and storage APIs. For example, `verified_public_objects`, `sealed_report_queue` and `centre_receipts`. Public map queries cannot read the sealed queue. There is no client-controlled `verified: true` property and no “convert encrypted report to public” operation.

Protocol class, application identifier and version must be cryptographically bound. A public object includes them in its signed content/protected headers. A sealed object binds its application, class, recipient key ID, size policy and immutable routing metadata to encryption. Changing an outer transport label cannot turn a report into an update. Unknown classes and algorithms fail closed.

## 2. Public updates: approve once, verify at every hop

Use a standard compact signed representation, such as deterministic CBOR inside **COSE_Sign1 with Ed25519**, using a maintained implementation and interoperability test vectors. The signature covers the payload and relevant protected headers; authenticity of the transport CRC or a carrier device is insufficient. [COSE](https://www.rfc-editor.org/rfc/rfc9052.html), [Ed25519](https://www.rfc-editor.org/rfc/rfc8032.html)

The authenticated payload should carry:

- Application and protocol version; message class.
- Centre/authority ID, key ID, authority epoch and sequence.
- Region and registry version/hash.
- Issued time and validity/expiry information.
- Stable entity IDs, entity revisions and changed fields.
- Withdrawal/tombstone records where needed.
- A signed manifest identifying the object/chunk set required for a complete regional update.

A signature establishes that the authorized key published these bytes. It does not prove that the centre's underlying assessment is correct. The operator's verification process remains necessary.

In the current code, connect signing to the centre's controlled publication workflow around `publishCenterEvent` and its audit records. Require explicit verification approval and public-field redaction; do not assume that any existing `published` flag is sufficient. Audit every alternative route that can publish or amend an event so none bypasses that gate.

Use a transactional publication outbox: commit the approved revision and durable signing job together; sign exactly that revision; store the immutable result. Retries return the same object. Withdrawals and corrections go through the same path. Internet and radio exports use identical signed objects rather than rebuilding an unsigned view of the database.

### Authority and keys

Preload a trust directory signed by an Atbalsts root authority. It names centre verification keys, separate report-encryption public keys, permitted regions/entity namespaces, permitted actions, validity and epochs. Keep the root signing key out of routine operation.

Residents receive public keys only. No centre secret or derivation seed is present in the public app, offline package or service-worker cache. Keep the current public exercise key in a separate exercise-only namespace and reject it in the production verifier.

Assign one publisher of record for each entity/stream during the first pilot. A backup centre needs an explicit authorized handover with a higher authority epoch; its local timestamp or larger sequence number is not enough. Two centres must not resolve disagreements through whichever update arrived last.

For a blackout centre, provision an offline workstation before the event. It needs a local review database, decrypting ability, a protected delegated signing key, an operator-unlock method that works offline, trustworthy time handling and power. A cached copy of the existing web login is not an offline centre. Retain key recovery under controlled centre procedures, not on relay devices.

Revocations, trust-directory updates and handovers must themselves be signed and prioritized for distribution. A disconnected device cannot know about a revocation it has not received. Bound delegated authority and expose trust-directory age. Key-expiry and outage-grace policy require explicit operational decisions rather than silently accepting forever or disabling every centre during a long outage.

## 3. Private reports: encrypt before persistence or transmission

1. The resident writes a short structured observation: type, time observed, location/area and brief text. Optional contact details remain inside the protected report.
2. The app verifies the selected centre's encryption key against its installed trust directory. It never accepts an unauthenticated replacement key announced by a nearby relay.
3. Encrypt the entire report on the originating device, using **single-shot HPKE** with a pinned suite, e.g. X25519, HKDF-SHA256 and AES-128-GCM. Use a maintained implementation and RFC vectors; do not assemble a bespoke ECDH/nonce construction. A fresh context per report avoids a shared encryption stream that depends on packets arriving in order. [HPKE](https://www.rfc-editor.org/rfc/rfc9180.html)
4. Persist only the sealed envelope for onward transfer by default. Keep a minimal local receipt such as “Report prepared; not delivered”. Offer any plaintext draft retention explicitly. Browser strings, screenshots, device backups and a compromised originating device prevent an absolute secure-erasure promise.
5. Relays store the exact ciphertext. They have no decryption key, plaintext search, map overlay, preview, analytics content or model access. No reporter name, phone number, exact location, incident category or severity is placed in the outer header.
6. The designated centre decrypts, validates and quarantines the report. Only an operator approval creates a separate public bulletin containing the minimum information necessary for public action.

The outer envelope needs a protocol/class version, opaque recipient key ID, size class and a stable ciphertext/object digest for routing, deduplication and resumable transfer. Encrypt sensitive routing detail inside when it is not required by relays. Pad reports to a small set of size buckets when affordable. A digest and recipient label allow tracking of a repeated envelope; padding reduces length leakage but does not hide timing, proximity or the existence of audio.

“Only the centre can read it” assumes the centre key and relevant endpoints remain secure. Anyone holding a retained copy of that recipient private key can decrypt. HPKE to a long-term recipient does not by itself provide forward secrecy against later compromise of that recipient key. Rotate recipient epochs and define retention/recovery periods with this limitation in mind. [HPKE security limits](https://www.rfc-editor.org/rfc/rfc9180.html#section-9.7.4)

### Centre failure and receipts

For the first pilot use a designated centre with a protected recovery copy of its recipient key. If a second centre must also decrypt, name it explicitly and encrypt for both recipients using an established multi-recipient construction or two independent envelopes. That widens the set of readers and costs airtime. Do not promise both “only centre A” confidentiality and arbitrary-centre decryption.

The centre emits a signed minimal **received** receipt only after durable storage of the report. It references an opaque report/ciphertext identifier, not the reporter or observation. This receipt may be relayed back and lets honest queues retire the object. Rich review outcomes or contact responses should be encrypted to a per-report reply key if needed later.

Distinguish **saved locally**, **copied to another device**, **received by centre**, and **reviewed**. Copying is not delivery; delivery is not verification; verification is not a dispatched response. Lack of a receipt means unknown, not failed. A receipt cannot force malicious relays to erase copies.

## 4. Reliable relay and “latest known” synchronization

Retain original signed objects and sealed envelopes, not only decoded map rows. Regenerate clean audio from their bytes at each hop instead of recording and replaying already degraded audio. Relays never refresh the issue time or re-sign someone else's update.

### Public synchronization

For the first version, one device presses **Share latest updates**, the other presses **Listen**. Send, in order: essential trust changes, urgent authorized alerts/withdrawals, a signed regional manifest, then the public object chunks it names. Repeat short cycles. Reception starts at any point in the cycle.

Apply independently authenticated complete objects progressively, while indicating whether the regional bundle is complete. Store incomplete fragments with bounded size and timeout. Deduplicate by cryptographic object identity. A later fragment can finish an earlier partial object.

Use both periodic compact regional snapshots and deltas. A delta identifies its required base; a receiver missing that base requests or waits for a snapshot. A highest-seen sequence alone does not prove that all lower updates arrived. Full-snapshot omission means deletion only if explicitly specified and the complete authenticated snapshot is present. Preserve tombstones or equivalent revision floors so stale relays cannot resurrect withdrawn records.

Replace one-byte revisions with a sufficiently wide persistent counter plus a provisioned authority epoch. Compare versions only within their proper authority/entity stream. Persist the latest accepted revision and trust state across restarts. After a device reset or unknown clock state, request a fresh authenticated snapshot and label uncertainty rather than presenting old content as fresh.

An offline participant can provide **the latest verified state it knows**, not prove that no newer state exists elsewhere. Show last issue time, local receipt time, area coverage and trust-directory age. A recently received relay of an old bulletin is still old. If reliable time is unavailable, revisions protect ordering but expiry confidence must be shown as uncertain.

### Sealed-report synchronization

Make carrying reports a separate opt-in action: **Help deliver sealed reports**. First deliver urgent public data; use a bounded share of transfer time and storage for encrypted reports so a flood cannot crowd out alerts. Proposed starting pilot limits are 1 KB per envelope, 100 stored envelopes/100 KB and 30 seconds of report forwarding per encounter; tune these from measured phone performance. Larger messages should be rejected before allocation, not decompressed speculatively.

Without an audio return path, repeat bundles and retain them until a signed centre receipt or the local retention limit. For the first pilot, use a small group of designated carriers and one-hop receipt delivery. Later, add a half-duplex inventory/acknowledgment exchange that requests only missing object IDs or fragments. Ordinary peer ACKs may reduce retries during that encounter but must not authorize deletion as though the centre received the report.

Use quotas, deduplication, bounded retry time and expiry/retention limits on each relay. These limit damage but do not defeat Sybil flooding by an attacker who invents many reports. Relays cannot inspect ciphertext for truth or harmful semantics. If abuse becomes material, add authenticated carrier enrollment or report-admission credentials without confusing admission with verification. Do not make proof-of-work or complex anonymous credentials prerequisites for the first audio proof.

An FM broadcast provides the outward path. A phone speaker only reaches nearby listeners; it does not transmit a report back to the radio station. Reports reach a centre through physical carriers, a nearby centre receiver or a later network connection. Delivery requires such a path, power and cooperating devices. Use faster local transfer methods later without changing the signed/encrypted envelope model. This follows a store/carry/forward approach; implementing all of Bundle Protocol v7 is not required for the pilot. [Bundle Protocol](https://www.rfc-editor.org/rfc/rfc9171.html)

## 5. Safe processing and resident behavior

“Harmless” should mean **unable to alter public state and bounded in resource use**. Encryption does not make arbitrary content harmless to a centre. Start with a strict bounded text/enum schema; no executable HTML, scripts, live links, images or attachments. Decrypt into a private queue, render as plain text, and keep unverified content from automated publication or tool execution. A known reporter's identity still does not establish that a report is accurate.

The resident-facing app needs four clear actions:

- **Nearby help:** last verified local situation, with freshness and missing-area indicators.
- **Listen for updates:** receive, verify, apply and stop when the selected bundle is complete.
- **Share latest updates:** retransmit retained official objects, showing their original age.
- **Send a private report:** seal an observation for a centre, show truthful delivery state, and optionally ask to carry other sealed reports.

Hide transit-report content from every public surface, including maps, search, logs, notifications and any assistant. Be transparent that the device is carrying encrypted reports; hiding content should not mean secretly using a person's battery or storage. Clear storage boundaries reduce accidental disclosure but do not make one web origin a hardened sandbox against an XSS compromise.

Use large touch targets, the user's language and a manual area selector. Ask for microphone permission at the point of use. Show actual progress, not simulated animation. Recommend one actionable signal adjustment at a time. Require a foreground listening session for the initial browser pilot; evaluate native capture only if measured phone constraints justify it. After successful reception stop capture and preserve battery. Keep spoken radio instructions usable by people who have no installed app.

## 6. Smallest implementation sequence

1. **Repair and unify offline readiness.** Resolve the main-worker cache deletion; preserve both working packages through upgrades. Test offline close/reopen on real Android and iPhone devices. Extract the modem without changing its waveform.
2. **Add public trust and shared state.** Introduce the signed trust directory and versioned public envelope. Connect centre approval, outbox signing and the resident verifier. Feed the same verified local store from online and audio paths. Support situations, shelters, aid points and withdrawals.
3. **Add public retransmission.** Retain original signed objects, send regional manifests and snapshots, survive duplicates/loss/restarts, and show partial versus complete regional coverage.
4. **Add sealed reports.** Origin-side encryption, a ciphertext-only queue, centre-only decryption into the existing private verification workflow, bounded parsing and explicit carrying consent. Keep reports out of public state by construction.
5. **Add an offline centre and receipts.** Provision centre keys and local operator access; persist reports before signing receipts. Approve one report offline, sign its public form and relay that bulletin back to residents.
6. **Run field trials, then optimize.** Try ordinary phone receivers, a real radio path, multiple carriers and battery constraints. Add missing-fragment handshakes or an erasure code only when measured failures justify the extra protocol. Avoid a new modem, full mesh routing, blockchain or a consensus system as prerequisites.

Suggested code boundaries for the existing repository:

- `public/sw.js` and `public/radio-exercise/sw.js`: coordinate cache ownership, offline readiness and safe upgrades.
- `src/lib/offline/public-envelope.ts` and `trust-directory.ts` (new): signed object verification and scoped publisher authority.
- `src/lib/offline/public-state.ts` (new): versioned local public data and retained original signed objects, shared by online and audio inputs.
- `src/lib/offline/sealed-reports.ts` (new): encryption and opaque relay storage; never import this store into public map queries.
- `src/lib/offline/relay-session.ts` (new): bounded manifests, fragmentation, priorities and resumable transfers, independent of the modem.
- `src/lib/center-store.ts` and centre publication endpoints: approval gate, public redaction, audit and transactional publication outbox.
- A separately provisioned centre receiver application: private-key operations and offline inbox/review. Public browser routing or an operator role flag is not key isolation.

Keep these modules small and testable; they are proposed boundaries, not a requirement to introduce a new framework. The first integration can continue using the existing audio waveform and UI components.

## 7. Acceptance tests that decide whether this is reliable

| Test | Required outcome |
|---|---|
| Centre → resident A → B → C, all offline | Same authenticated public fields; original publisher/time retained |
| Modify one public field; use an exercise/wrong/out-of-scope key | No public-state change; no forwarding as trusted news |
| Sealed report → two relays → designated centre | Relays retain ciphertext only; centre decrypts the original report |
| Change encrypted bytes or routing class | Rejected or quarantined; never enters public state |
| Centre decrypts a plausible false report | It stays unverified until an explicit operator decision |
| Approve and redact a report | New signed public object; no private contact/detail leakage |
| Replay duplicates, old revisions and withdrawals out of order | No double application, rollback or resurrection |
| Join late, lose bursts, stop/restart midway | Bounded partial progress survives; complete objects verify before display |
| Receive only part of a region snapshot | UI says partial; missing records are not silently marked current or removed |
| Phone claims “latest” after isolation; clock is wrong | UI shows last-known freshness/uncertainty rather than a false guarantee |
| Fake peer ACK versus genuine centre receipt | Only the centre-signed receipt establishes delivery |
| Flood malformed/oversized/sealed objects | Bounded memory/work; public alerts retain service priority |
| Install/update main app after saving radio page; reopen offline | Both required offline surfaces still work |
| Centre offline, locked or primary device lost | Planned offline unlock/recovery or explicit undeliverable state; no fallback secret in public app |

The first pilot should demonstrate both round trips: **approved update travels outward**, and **sealed report travels inward, is reviewed, then its approved public result travels outward**. Measure completion within the promised window and battery cost across real devices. The existing log is a starting point, not a reliability certificate for this larger system.

## Sources and evidence boundary

The code review covers the deployed radio exercise and main offline worker matched to GitHub, plus the local `palidzi` centre publication/verification workflow. Exact snapshot and numeric evidence are recorded in `review.md` and `log-summary.json`. The cryptographic references above support the mechanism choices; the integration, queue policies, UX and rollout sequence are proposed engineering decisions.
