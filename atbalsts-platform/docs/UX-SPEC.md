# Atbalsts conversational UX specification

**Version:** 0.1 concept  
**Languages:** Latvian default; English supported  
**Initial users:** invited adults in Riga and exercise-authority participants

## 1. Interaction promise

Atbalsts provides one primary interaction:

> Speak or write what you need, can offer, observed or want to know.

The system responds with one clarification at a time and always shows a structured confirmation before consequential action.

## 2. Information architecture

### Citizen

1. **Ask / Jautāt** — single text field, push-to-talk, suggested examples.
2. **Situation / Situācija** — verified information, relevant requests, accepted tasks.
3. **Me / Es** — capabilities, resources, availability, privacy and access history.

### Authority

1. **Situation / Situācija** — incident state, verified information and unresolved observations.
2. **Query / Vaicāt** — conversational capacity and status queries.
3. **Tasks / Uzdevumi** — drafted, approved, offered, accepted and completed tasks.
4. **Audit / Audits** — actions, approvals, disclosures and handovers.

The production application derives the view from verified role credentials. A citizen cannot switch into authority mode.

## 3. Global status

Every screen displays:

- `KOPIENA / COMMUNITY`, `MĀCĪBAS / EXERCISE` or `INCIDENTS / INCIDENT`;
- connectivity state and last synchronisation;
- current language;
- authority issuer when official information is present.

Exercise mode is persistent and visually unmistakable. It cannot be dismissed.

## 4. Confirmation receipt

Before saving, sharing, messaging or assigning, show:

- **Understood:** the structured meaning.
- **Missing:** any unresolved information.
- **Will happen:** the exact next action.
- **Visible to:** recipient group and fields.
- **Expires:** retention or availability expiry.
- **Control:** Confirm, Change, Cancel.

Critical confirmation is visual even when input is spoken. Voice alone does not approve sensitive action.

## 5. Onboarding

The first session is conversational and takes approximately three minutes.

1. Show inviter, circle, purpose, data visibility and leave/delete rights.
2. Ask what the participant wants: prepare, ask for help, offer help, learn or organise.
3. Ask: “What do people usually rely on you for?”
4. Ask: “Are there tools, transport or other resources you might sometimes make available?”
5. Ask availability, distance and prohibited tasks.
6. Present proposed capability cards.
7. Show the profile from the personal, community and coordinator perspectives.
8. Confirm and provide immediate community-readiness value.

No contribution is required to receive help.

## 6. Example citizen flow

Input:

> “Man ir busiņš, un dažreiz varu palīdzēt brīvdienās.”

Clarification:

> “Vai vēlaties pārvadāt tikai mantas vai arī cilvēkus?”

User:

> “Tikai mantas.”

Confirmation:

```text
CAPABILITY       Goods transport
RESOURCE         Van
AREA             Riga
AVAILABILITY     Weekends, ask each time
BOUNDARY         No passenger transport
COMMUNITY SEES   Transport capacity exists
COORDINATOR SEES One eligible person can be contacted
EXPIRES          Reconfirm in 30 days
```

## 7. Example authority flow

Query:

> “Parādi pieejamo transporta kapacitāti ūdens piegādei Āgenskalnā šodien no 16.00 līdz 18.00.”

Structured result:

```text
AREA             Āgenskalns
TIME             Today, 16:00–18:00
NEED             Sealed water transport
RISK             Green community logistics
ELIGIBLE         5 people / 3 vehicles
IDENTITIES       Hidden
NEXT STEP        Draft a limited invitation to 3 candidates
```

The coordinator approves the task and outreach separately. Exact identities are shown only after acceptance and policy approval.

## 8. Writing style

- One question per message.
- Short sentences.
- Use verbs and concrete consequences.
- Avoid conversational filler and personification.
- Never imply certainty not present in source data.
- Say “reported,” “verified” or “official” explicitly.
- Use absolute time and date when ambiguity matters.
- Show why the person is being contacted.
- Prefer “Decline” over “Not now” when the action is a real refusal.

## 9. Accessibility

- Keyboard-complete interaction.
- Visible focus and minimum 44-pixel primary targets.
- Screen-reader labels for state, issuer and controls.
- Text alternative for every spoken instruction.
- User-controlled read-aloud; no autoplay of distressing content.
- High contrast without relying only on colour.
- Plain-language Latvian and English.
- Support for correcting names, addresses and numbers token by token.

## 10. Error handling

### Low interpretation confidence

Ask one clarifying question; do not guess.

### Poor audio

Show the uncertain words and offer text correction.

### No network

Save locally and show separate states: saved on device, shared to relay, accepted by gateway, acknowledged by authority.

### Conflicting official messages

Do not choose one automatically. Show the conflict to authorised operators and retain the last verified public instruction until reconciled or cancelled.

### No candidate accepts

Inform the coordinator and apply the configured widening or alternative-resource policy. Never treat silence as acceptance.

## 11. Future familiarity controls

Not shown in V1. Reserved controls may later include:

- prefer people already known;
- allow friends-of-friends;
- prefer a group task;
- privately exclude a pairing;
- request the same successful team again.

These controls affect optional collaboration, never access to public emergency help.

## 12. Prototype acceptance checks

- Latvian and English toggles update all primary interface text.
- Citizen and authority demonstrations are visibly distinct.
- The central text input works without a map or form.
- Voice control produces a visible simulated transcript.
- Confirmation shows meaning, next action, visibility and expiry.
- Confirm, change and cancel produce unambiguous states.
- Exercise mode remains visible.
- Layout remains usable on a 360-pixel-wide viewport.
