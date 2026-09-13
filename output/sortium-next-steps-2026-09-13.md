# Sortium: next decisions after the crisis-centre meeting

Working decision memo · 13 September 2026

## The strategic choice

Make **Sortium the coordination layer for existing communities and organisations**. Its first job is to help a group turn a recurring issue into trusted information, assigned work, resource commitments and a visible outcome. The product must earn regular use when there is no emergency. **Atbalsts is the crisis-resilience application of that layer** and a test bed for degraded communications. The crisis centre can be an expert and exercise partner without being the only plausible customer.

The proposed first offer is: *“Give your group one shared, accountable workflow from incoming reports to decisions, tasks and updates, while keeping control over who sees what.”* This is a hypothesis to test with an actual group, not a validated market claim.

Keep two separate development bets:

1. **Coordination and information stewardship — main product bet.** A specific community coordinator receives a report, identifies what is known and uncertain, decides who can see it, assigns a bounded task or resource, and closes the loop. An agent may organise intake and propose source-linked summaries or next steps. A named human approves consequential decisions and publication. The current Atbalsts situation workspace already demonstrates parts of this pattern; it remains a labelled simulation, so real multi-organisation operation requires further work.
2. **Grid-down communications — bounded R&D bet.** Test signed compact updates over audible radio and, separately, a LoRa gateway path. The existing measured result is a phone-speaker-to-MacBook-microphone offline reception, not a phone receiving an actual broadcast or a field-proven LoRa system. Ordinary phones need a radio receiver/gateway for LoRa. The audio channel can broadcast down to listeners; a return path needs another transport. Neither path should determine the whole product roadmap before end-to-end field evidence exists.

Use established groups' existing membership, role decisions and trust practices. Defer building a general volunteer recruitment, credential-verification or training marketplace. For the first pilot, restrict action to the group's known adults and low-risk tasks.

## Ordered 12-week sequence

| When | Action | Evidence required to move on |
|---|---|---|
| **Now–24 September** | Name a product owner and one technical lead. Make a shortlist of 6–8 existing groups in two or three segments (for example aid networks, neighbourhood associations and community service groups). Ask LIAA immediately whether the legal entity and current MVP qualify for the incubation intake. | Two or three groups agree to show a *recent actual* coordination process; LIAA eligibility/applicant decision before the 24 September deadline. |
| **Weeks 1–3** | Observe 8–12 coordinators/participants across the shortlist. Reconstruct one issue from first report to outcome: channels used, handoffs, duplicate work, delays, mistakes, and who pays for coordination today. Choose **one recurring, low-risk workflow** and one design partner with a named coordinator and weekly access. Run one cycle manually or with existing tools before changing the product. | A written pilot agreement covers the workflow, participants, data handling, success measures, staff time and either a pilot fee, a sponsor, or a credible route to a budget. If no group will commit, revise the segment and offer before a build. |
| **Weeks 4–8** | Adapt the existing situation workflow to the chosen group's language: intake and provenance; status of known/uncertain facts; editor-approved updates for specific audiences; task/resource owner and deadline; completion and correction history. Give the agent only source-linked triage, summary and draft actions. Use a real non-emergency issue with the partner. | Several real cycles complete; coordinator effort and time to assignment/closure improve against the observed baseline; participants understand which information is verified and who approved it. Record failures, not only usage. |
| **Weeks 5–9, separately funded** | Run a fixed-scope radio feasibility assignment with an RF/DSP lead and an eligible external research/test provider if a voucher is used. First test transmitter audio → real radio receiver → target phone → signed object → offline reopening. Only then add a battery-backed LoRa gateway and test the same object format through it. | Per-device completion rate, latency, failed sessions, power and operator effort are measured under stated conditions. Make a go/revise/stop decision. This is an exercise capability until validated for a defined operational setting. |
| **Weeks 9–12** | Repeat the coordination workflow with a second group. Obtain a renewal, paid pilot or budget-owner commitment. Review the radio evidence with the crisis-centre/IDC counterpart and ask for a specific next exercise or research role. | Similar problem and value in a second group; a plausible repeatable payer; a technical scope that can be quoted and funded. Otherwise narrow the product again. |

The first product slice should be small enough to show a complete journey: `report → human assessment → audience-approved update and/or task → resource commitment → status → outcome`. Do not build an all-purpose community platform around speculative functions. Measure whether the group returns each week and whether coordination becomes easier, including the work needed to maintain the system.

## Funding, in order of usefulness

| Route | Fit and timing | Next move |
|---|---|---|
| **Paid design pilot or local sponsor** | Fastest possible cash for discovery and adaptation; the amounts are to be negotiated, not assumed. A sponsor can fund a community pilot while the group supplies a coordinator, participants and real work. | Prepare one two-page offer with the exact workflow, 6-week output, budget and measured outcomes. Ask 3–5 prospective payers/sponsors. Seek a cash commitment or written budget-owner intent, not expressions of general interest. |
| **[LIAA business incubation](https://liaa.business.gov.lv/atbalsta-iespejas/biznesa-inkubacijas-atbalsts)** | **Time-sensitive:** 9–24 September 2026 intake. For qualifying Latvian companies up to five years old with an MVP; later financial support covers 70% of eligible costs within category caps, with co-financing. Admission is not immediate unrestricted cash. | On 14 September, check company age, MVP evidence, tax/de minimis status and whether the repositioned Sortium/Atbalsts offer fits. Submit by 24 September if eligible. Show current working software and the concrete community pilot, not only a radio concept. |
| **[LIAA innovation voucher](https://liaa.business.gov.lv/atbalsta-iespejas/inovaciju-vauceru-atbalsts)** | Open while funds remain. Introductory voucher: up to €10,000 at 100% for qualifying feasibility/research/experimental development; classic: up to €25,000 at 85%. It pays an eligible external provider for a defined work package, subject to criteria and application approval. It is a strong candidate for the radio/audio feasibility, provided there is a credible market and commercialisation plan. | Define a measurable RF/audio test brief, identify a qualified research provider, obtain the required comparable price research, and confirm eligibility with LIAA. Keep the voucher budget separate from work paid by sponsors or incubation. |
| **[Horizon Europe CL3-2026-01-DRS-01](https://ec.europa.eu/info/funding-tenders/opportunities/docs/2021-2027/horizon/wp-call/2026-2027/wp-6-civil-security-for-society_horizon-2026-2027_en.pdf)** | Strong thematic match for community preparedness and collaboration, but a large research consortium with a **5 November 2026** deadline and expected decisions in 2027. The topic requires beneficiaries across at least three eligible countries, including a civil society organisation, national disaster-risk authority and local/regional authority representative. | Ask the [Latvian Cluster 3 National Contact Point](https://www.lzp.gov.lv/en/department/national-contact-point-horizon-europe) whether an existing consortium needs a Latvian technology/community pilot partner. Offer a precise work package and partner evidence. Do not plan near-term payroll around this call. |

The [2027 NVO fund intake](https://www.sif.gov.lv/lv/nvo-fonds) closed on 11 September 2026 for microprojects and 4 September for macroprojects. It is not a current funding source. A future NGO-led community programme may be relevant, but applicant status and programme fit must be checked when a new call opens.

The next funding document should distinguish **buyer**, **grant applicant**, **research provider**, **pilot operator** and **institutional adviser**. They may be different organisations. Keep one cost in only one funding request. LIAA decisions and cash arrival may take time; a voucher is not a substitute for operating cash.

For conversations this month, use two **provisional planning envelopes**, to be replaced by actual quotes: **€8,000–12,000** for a six-week community workflow pilot and **up to €10,000** for a separately contracted radio feasibility study. The community package buys observation, a small adaptation of the current software, partner onboarding and an outcome report; the radio package buys a repeatable test protocol, real receiver/phone and gateway measurements, and a go/no-go report. Neither amount is an awarded grant or a reliable delivery price yet. A sponsor-facing brief should name the chosen group's issue and coordinator before asking for cash.

## The next five concrete actions

1. Write one page describing the first target group's actual coordination pain and the `report → outcome` workflow. List 6–8 candidate groups and request observations of real recent cases.
2. Identify the applicant legal entity and ask LIAA about incubation eligibility this week; prepare the application before 24 September if the answer is positive.
3. Offer one group a six-week design pilot with a named coordinator, access to real low-risk work, simple baseline measures and an explicit funding conversation.
4. Give the crisis-centre/IDC contacts a **specific technical follow-up**: review the radio test protocol, nominate an observer and identify an authorised exercise path. Do not frame their interest as a purchase commitment.
5. Commission a short, costed feasibility proposal for audio through a real radio into a phone, followed by LoRa gateway relay only if the first path and use case justify it. Use that scope to check the LIAA voucher and sponsor options.

## Decision rules

- If no group gives regular access to a coordinator and real work by week 3, spend the next cycle on problem selection, not new features.
- If the workflow is used but nobody has a budget, identify the actual economic beneficiary (umbrella organisation, funder, company or municipality) before scaling.
- If the agent's suggestions cannot show evidence, uncertainty and human approval, keep them internal and non-consequential.
- If the radio chain fails on target phones or needs impractical power/attention, narrow the claimed offline mode; preserve the transport-independent message format.

### Existing project evidence

- [Atbalsts situation workspace](../palidzi-oauth-recovery/docs/CENTRE-SITUATION-COMMAND-WORKSPACE.md): versioned situations, source-specific intake, operator review and agent boundaries; the implementation is a simulation.
- [Offline audio review](atbalsts-radio-review/review.md): measured phone-speaker-to-MacBook-microphone session and its limits.
- [Encryption and audio proof](atbalsts-radio-security-proof/README.md): software-level security and audio tests; no physical RF or LoRa validation.
- [Earlier institutional pilot plan](atbalsts-offline/atbalsts-consolidated-plan-2026-09-08.md): useful technical work packages and contacts, with a government-centred commercial assumption that this meeting now changes.
