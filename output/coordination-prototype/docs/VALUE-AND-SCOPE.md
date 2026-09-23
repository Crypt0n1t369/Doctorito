# Where this adds value, and for whom

23 September 2026. Value first, applications derived from it, not the other way round.
Based on two rounds of research (ten researchers and two skeptics, every capability claim
sourced) and three sources re-checked by hand. Where demand is inferred rather than
observed, this says so.

## The question

The primary use is a person or a group looking into a topic: exploring it, developing it
over time, and contributing to it, with delegation to people and to AI agents. Why
wouldn't they just use what they already have, and where, if anywhere, does this add
something they cannot get?

## What does not give anyone a reason to adopt it

| Idea | Why it is not enough |
|---|---|
| Remembering where you left off | The platforms have largely solved it: project memory in ChatGPT and Claude, saved chats and cited notes in NotebookLM. Claude's memory has spanned chat and Cowork on every plan since August 2026, and ChatGPT shared projects reached free users in October 2025. Competing on recall means fighting the owners of the conversation. |
| Solo exploration and note-taking | A crowded market with strong habits (Obsidian, Tana, Heptabase, NotebookLM), with no evidence of unmet need. |
| Keeping decisions from meetings | Google Meet and Teams already extract decisions and link them to the transcript moment. |
| Private, team and public in one tool | Notion, Google Docs and Heptabase already do it. |
| A schema of questions, claims and evidence | Any Notion or Airtable database, Tana or the Discourse Graphs plugin can hold one. Its users say it is costly to keep up and needs field-specific types. |
| Open contribution to a topic outside code | Where checking is cheap, GitHub, CI and Lean already provide the loop (Equational Theories Project). Elsewhere the scarce thing is a curator's time, which no tool creates. |
| Keeping minority views | Served in the niches where the pain is documented (Mukurtu, Kialo, Polis, Talk to the City). It is a feature here, not a reason to switch. |
| Choosing which AI may see which item | Large organisations handle it with admin labels; small groups are not asking for it. It is a trust requirement, not a selling point. |
| Reading free-text offers of help | A real gap only in disaster surges, where offers vary widely. That is not the primary use. |
| A cheap "act, queue for a person, or ask" gate | Helpdesk AI (Zendesk, Intercom) already acts on high confidence and hands off the rest. Since 21 September 2026 a public n8n node runs the same Jev API, with a confidence threshold, a "Needs Review" branch and the full probabilities kept on each item. No buyer we found chooses on cost per message. |

## What survives

**Trust in shared understanding when much of it comes from AI and from other people.**

More and more of what a group knows about a topic arrives from AI tools: deep-research
reports, assistant chats, agents working on sub-questions. That output is measurably
unreliable. Deep-research systems' citations support the claim they are attached to only
40–80% of the time, and the systems stay one-sided on contested questions (DeepTRACE,
2025). The people receiving the work pay for it: 41% of US desk workers received AI output
lacking substance in the past month, it took about two hours each time to sort out, and
42% then trusted the sender less (Stanford and BetterUp, Harvard Business Review, 2025).

Memory is solved. Trust isn't. Nothing we found lets a group see, item by item:

- whether something is only said, kept, checked, decided or disputed;
- where it came from, and who confirmed it;
- who can see it;
- what it said before it was corrected;

when the items come from several people and from AI tools of more than one vendor. The
closest things are Notion Lore (August 2026), which is automatic, self-expiring memory for
agents with no human confirmation or sources, and specialist tools that check claims
inside one workflow: Elicit for literature, Hebbia for finance due diligence.

**What would have to be true for this to matter.** The skeptics set three conditions,
and they are the right ones:

1. It sits **beside** the AI tools people already use, taking in their output by import or
   a connector (MCP), not replacing them.
2. It makes **checking cheaper** than a shared document with comments. Storing claims is
   free; checking them is the expensive step.
3. It **doesn't decay.** Items are proposed automatically from conversations and agent
   output and confirmed by a person in one step, so the record stays current without
   someone maintaining it.

**What this project brings, and what it doesn't.** The prototype already has the
mechanism these conditions need: something is proposed, a gate decides whether to accept
it, queue it for a person or ask one question, and every decision is recorded with why.
That is "an AI proposes, a person confirms, the record keeps the reason". The mechanism is
not ours alone: the same gate on the same API has been a public n8n node since 21
September 2026. What would be ours is applying it to a group's shared record, with
sources, confirmation, audiences and history. That is a head start, not a moat. A cheap
typed-judgment model (about $0.0001 per check) could also triage whether a source actually
supports a claim, so people check only the doubtful ones. **This is a hypothesis to test,
not a finding.** It is the one thing that would answer the "checking is the expensive
step" objection.

**What is not proven.** That groups want item-level status rather than drafts and
meetings. Demand is inferred from how unreliable AI output is and from people's
workarounds: handoff prompts, memory-bank files, and this project's own
CURRENT-STATE.md. Also unproven: that automatic proposals plus one-step confirmation
really lower upkeep, and that cheap claim-support triage is accurate enough to trust.

## Deriving the applications

The value is decisive only where all five of these hold:

1. **Long-running.** The topic is worked on for weeks or months; otherwise a chat is enough.
2. **Several contributors.** Several people, or AI tools from more than one source;
   otherwise personal memory is enough.
3. **AI-heavy.** A real share of the findings come from AI; otherwise ordinary documents
   are enough.
4. **Costly if wrong.** The result is published, delivered, decided on or built upon;
   otherwise good-enough notes are enough.
5. **No specialist owns it.** Otherwise the specialist wins.

| Application | 1 | 2 | 3 | 4 | 5 | Fit |
|---|:-:|:-:|:-:|:-:|:-:|---|
| Policy, think-tank or advocacy team preparing a brief on a contested question | ✓ | ✓ | ✓ | ✓ | ✓ | **Strong** |
| Small research or strategy consultancy producing client deliverables | ✓ | ✓ | ✓ | ✓ | ✓* | **Strong** (*finance due diligence is Hebbia's) |
| Multi-partner consortium writing a proposal (e.g. an EU bid), across organisations and languages | ✓ | ✓ | ✓ | ✓ | ✓ | **Strong**. This is also where "who can see it" matters. |
| Investigative or data journalism team | ✓ | ✓ | ✓ | ✓ | ✓ | **Medium–strong**. Fact-checking culture, thin budgets. |
| People building something with several AI agents over many sessions (like this project) | ✓ | ✓ | ✓ | ✓ | ~ | **Design partners.** Real pain, but they build their own with markdown and git. |
| Research lab keeping a shared synthesis (a principal investigator and students) | ✓ | ✓ | ✓ | ~ | ~ | **Medium**. Literature review belongs to Elicit and NotebookLM; the lab-wide record is open. |
| Founders exploring a market | ~ | ✓ | ✓ | ~ | ~ | **Weak–medium**. A shared ChatGPT project mostly suffices. |
| Solo professional whose work goes to others (freelance researcher, journalist) | ✓ | ✗ | ✓ | ✓ | ~ | **Weak–medium**. The value is a record of what was checked; demand unproven. |
| Product discovery or UX research team | ✓ | ✓ | ~ | ~ | ? | **Unclear**. Probably served by research-repository tools; not checked. |
| Solo hobby or learning exploration | ✓ | ✗ | ✓ | ✗ | ✗ | **Weak**. Memory tools serve it. |
| Open topic with outside contributors (open-problem lists, open books) | ✓ | ✓ | ~ | ✓ | ~ | **Later**. The curator's time is the bottleneck. |
| Local history or cultural group with contested accounts | ✓ | ✓ | ✗ | ~ | ~ | **Weak now**. Not AI-heavy; "contested" is a feature. |
| Academic literature review / finance due diligence | ✓ | ✓ | ✓ | ✓ | ✗ | **Served** (Elicit, NotebookLM / Hebbia, AlphaSense) |
| Disaster-surge offer desk | ✗ | ✓ | ✗ | ✓ | ✓ | **Out of scope** for the primary use. The existing matcher fits it. |

## The three perspectives, honestly

- **One person.** Alone, there is no reason to adopt it: memory tools already serve
  exploration. A person benefits in two situations. One is their private space inside a
  group, where they check before sharing. The other is when their work goes to someone else
  and the record of what they checked goes with it.
- **A group.** This is the core: a small team working one question for weeks or months,
  with several AI tools, whose result others rely on.
- **Open collaboration.** Comes later. Once a group's checked state exists, outsiders can
  contribute to its open questions, and the proposal-and-confirmation gate is what could
  make a curator's time go further. Not a starting point.

## First real user

**A team of two to six people working one question for weeks or months, using several AI
tools, whose output others rely on.** Candidates, in order: a policy or think-tank team, a
small research consultancy, a proposal consortium. Build it with **this project as the
first test bed**. It already has the pain in full (two agents, compacted sessions, "don't
take it at face value") and costs nothing to recruit.

## What this means for the infrastructure (next step)

The core that survives is domain-neutral, so fitting it to different users is
configuration, not code. The configuration covers:

- which kinds of items a group keeps;
- what counts as "checked" in its field;
- who may confirm;
- which tools feed it.

This is the same principle the prototype already follows: a new case means a new
catalogue, not a new matcher. The pieces:

- items with a status, a source, who confirmed them and who can see them;
- connectors from the AI tools and conversations people already use;
- the proposal gate, generalised from the matcher: which open question does this address,
  does its source support it, does it repeat or contradict something already kept;
- a history on every item.

Details come in the next step.

## A proposed change to OUTCOMES.md

The why there leads with "conversation forgets". The research says forgetting is being
solved by others. The why that survives is **"we can no longer tell what is actually
established, because more and more of what we know comes from AI and from other
people."** Keep and Share stay; "Keep" means *kept with its source and who confirmed it*.
The solo Anna example should give way to a team example. This is a proposal, not yet
made.

## A correction to the concept paper

The concept paper says the OECD found "a black box between input and outcome" and
"months or years without updates". A researcher who read the full 2025 reports found
neither phrase used that way: there, "black boxes" refers to opaque digital technology.
What the OECD does document is low accountability after participatory processes and an
inconsistent feedback loop, which discourages further participation (Public Governance
Policy Paper No. 72, 2025). The underlying point survives; the quotation should not be
used.

## Sources checked by hand

- n8n community node for Jev classification (21 September 2026): <https://community.n8n.io/t/n8n-community-node-jev-classification-route-items-by-category-with-calibrated-confidence-built-for-high-volume/315339>
- DeepTRACE, auditing deep-research systems (2025): <https://arxiv.org/abs/2509.04499>
- AI-generated "workslop" (Harvard Business Review, 2025): <https://hbr.org/2025/09/ai-generated-workslop-is-destroying-productivity>
- Notion Lore (18 August 2026): <https://www.notion.com/blog/building-shared-memory-for-ai-agents-in-notion>

The full research, with per-claim sources and each source's kind (docs, independent,
marketing), is in [research/](research/): the hypotheses tested, both rounds, and the
skeptic. The main opened sources:
Claude project sharing (<https://support.claude.com/en/articles/9519189-manage-project-visibility-and-sharing>),
NotebookLM notes (<https://support.google.com/notebooklm/answer/16179559>), Obsidian
shared vaults (<https://obsidian.md/help/sync/collaborate>), the Discourse Graphs field
study (<https://arxiv.org/html/2407.20666>), the Equational Theories Project
(<https://arxiv.org/html/2512.07087v1>), Wikipedia NPOV
(<https://en.wikipedia.org/wiki/Wikipedia:Neutral_point_of_view>) and Mukurtu community
records (<https://mukurtu.org/support/how-to-create-community-records/>).
