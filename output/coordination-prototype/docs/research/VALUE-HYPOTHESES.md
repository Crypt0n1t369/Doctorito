# Value hypotheses to test

Each is a claim that could be false. The job is to find out which survive contact with
what people already use. "Value" means: someone with a real problem would get an outcome
they cannot reasonably get today with tools they already have or could adopt cheaply.

## What exists today (so nobody credits the product with what is not built)

Built and tested (synthetic data only, no real users yet):
- Free-text offers arriving by web form, email webhook or Telegram, in Latvian, Russian or
  English, matched against a catalogue of specific needs (quantity, unit, time window,
  place, required credentials, risk class). Deterministic code handles dates, amounts,
  geography and eligibility; a typed-judgment model (TypeSafe Jev, ~$0.0001 per message)
  handles semantic fit. A confidence gate decides: bind automatically, queue for a
  coordinator, or ask one clarifying question. Every decision is logged with its inputs.
- Specific replies on the sender's channel ("you're down for Saturday, 08:00, bring
  gloves"), a confirm/withdraw link, capacity that cannot be double-booked, a coordinator
  queue that records every correction, outbound asks to people who declared capabilities
  when a need goes unfilled, and a public page showing needs closing.
- Measured on synthetic scenarios: ~68% of decisions matched a human label, ~74% decided
  without a human, ~0.7 s per message. No real-traffic wrong-bind rate exists.

Not built: the "keep" record (findings, questions, decisions kept from conversation), the
three audiences (me / project / everyone), the personal space, any conversational
assistant.

## The hypotheses

**V1 — Kept vs said.** Turning conversation (chat, email, meetings) into a durable,
sourced, correctable record, where people can tell what was kept or decided versus only
discussed, is a problem people have and existing tools do not solve well.

**V2 — Audience you choose, enforced, including AI.** Per-item audiences (me / project /
everyone) in one place, with a hard guarantee about which content may reach which AI
service, matter to some users and are not available in tools they can adopt.

**V3 — Open intake in free text.** Organisations that need contributions from people
outside their organisation (volunteers, suppliers, partners, residents) struggle to take
offers that arrive as free text on many channels and turn them into specific, reliable
commitments; existing tools force forms, sign-up slots or manual reading.

**V4 — Visible outcome for contributors and the public.** Contributors and the public
cannot currently see what happened to what they gave or voted for (decision -> need ->
who -> done), and would value it; no common tool provides that trail.

**V5 — Asking the right people.** When a need goes unfilled, asking specific people who
declared a relevant capability and willingness (with consent and cooldown) works better
than broadcast messages, and tools for this are missing or clumsy.

**V6 — Same concepts at every scale.** One model spanning one person, a team and open
collaboration is something users would value, rather than only a design convenience.

**V7 — Cheap, auditable judgment with an act/queue/ask gate.** Unattended handling of
high message volume at very low cost, with a logged, explainable reason for each action
and a human queue for the uncertain cases, is a capability organisations need and cannot
get from existing AI triage and routing products.
