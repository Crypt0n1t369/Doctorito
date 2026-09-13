# Atbalsts: architecture, R&D, funding and partner plan

Consolidated working plan · 8 September 2026

**1. The next decision and the first deliverable**

**Recommendation: organise a 10-12-week demonstrator with one operational partner, one accountable technical lead and a planning budget of EUR 30,000 excluding VAT.** Allocate approximately EUR 5,000 to initial feasibility work, then commit the remainder against measured results. The first allocation is part of the EUR 30,000 total.

The demonstrator should show this complete journey: an authorised test publisher creates a signed update; a radio gateway receives it; a phone verifies it and updates its downloaded map; another phone receives it during a nearby exchange; a resident creates an encrypted report; that report reaches the centre later; a verifiable receipt returns to the originating phone.

The first operational scenarios should concern prolonged outages, resource availability and delayed assistance reports. Delivery through future encounters has no guaranteed arrival time. Any role in time-critical warnings needs separately established delivery requirements alongside official warning channels.

This document brings together the technical research, proposed next steps, funding research and all relationships named in this conversation. Appendix A retains the full technical assessment and its limitations. Appendix B contains the Latvian IDC response draft. Source links are collected at the end.

**Evidence and commitment status.** The technical findings describe the code revisions reviewed on 8 September 2026; they do not verify a later deployment. No physical Atbalsts radio, acoustic, range, battery or background-phone measurements were performed. Budgets and thresholds are proposals. Contacts and access were described by Kristaps; no new commitments, funding awards or institutional endorsements were secured in this conversation. No outreach has been sent. Personal names and roles should be confirmed before external use; Dzintars's name is explicitly uncertain.

The first month should produce a named integration lead, a radio lead, a candidate test site, an agreed institutional scenario, an initial funding commitment and a recorded feasibility result. The wider network supports those deliverables through bounded assignments, equipment, facilities, introductions and supervised testing.

**2. Architecture to carry into the pilot**

The baseline is a locally installed application with durable storage, preloaded reference data and a shared message format that remains verifiable across different communication paths. External LoRa radios connect local gateways. Phones reach gateways through tested local Wi-Fi or BLE interfaces. Nearby phone exchange starts with the app open and explicit user action.

| Layer | Pilot responsibility | Main limitation to test |
|---|---|---|
| Publishing and regional distribution | Approve, version and sign immutable bulletins; provide a route into the region and predelegated local publishing where needed | An isolated local mesh cannot obtain a national update without an independent feed or physical carrier |
| LoRa and community gateway | External radio, persistent queues, local phone access and backup power planning | Range, airtime, interference, upstream capacity and energy use depend on the installation |
| Phone and offline map | Verify messages, apply event revisions, show source/age and preserve private outgoing reports | Ordinary phones have no usable LoRa receiver; map and trust material must be installed before the outage |
| Nearby exchange | Exchange missing signed objects and encrypted reports; deduplicate and carry them onward | Foreground exchange is the baseline; background and locked-phone behaviour require device-specific evidence |
| Audio experiment | Decode audible modem data from a separate radio receiver into the same signed objects | A one-way broadcast path; decoder success, broadcast compatibility and airtime are unmeasured |

**Security belongs above every transport.** Official messages are signed by authorised publishers; relays carry no authority signing keys. Private reports are encrypted for their recipient. Version, expiry, cancellation, deduplication, quotas and bounded queues contain stale-state and flooding failures. The application distinguishes saved locally, copied to a relay, received by the centre and reviewed/acted on.

A compromised relay can still delay, drop or flood traffic. Signatures cannot prevent jamming or establish the truth of a citizen observation. Test failure visibility and recovery as well as successful delivery. Appendix A contains the detailed threat model and proposed tests.

Keep the audio work independent of the core build. The 10-30 bit/s figure remains an unverified application-throughput assumption. Preapproved text and map references can be selected by compact codes; pictures and video wait for a faster link. Near-ultrasonic sound is not the initial broadcast choice.

**3. Institutional relationships and first commitments**

Use the existing questions from Iekšlietu digitālais centrs as the starting point for a jointly reviewed pilot brief. The first institutional meeting should settle three use cases, who may publish the test information, who receives incoming reports, which site is realistic and what evidence would justify further work.

| Relationship | Proposed contribution | First bounded ask |
|---|---|---|
| Artūrs Pokšāns / Iekšlietu digitālais centrs | Requirements counterpart and technical evaluation | Review the proposed end-to-end scenario, nominate a participant and help identify an operational pilot owner |
| VUGD contacts | Practitioner requirements and exercise observation | One practitioner to review resident reports, information wording and the exercise; identify relevant existing workflows |
| Valsts krīzes centrs leadership | Institutional coordination and sponsorship of the evaluation process | Nominate a counterpart; clarify publication authority and the organisation that could own a subsequent pilot |
| One municipality, to be recruited | Test location and local operations | Two usable locations, a civil-protection contact, power/access arrangements and roughly 10-20 initial exercise participants |
| Mentor already consulted | Critical review and introductions | Review the two-page brief; introduce a decision-maker, a senior engineer and a possible sponsor |

Aim to record the named person, contribution, availability, next date and limits of each commitment. A pilot participation letter should describe the site, staff time or evaluation role actually offered. Interest in the project is not evidence of a grant award or purchase commitment.

Kristaps should coordinate a 60-minute initial session and circulate the resulting brief. Include the message journey, operator responsibilities, test/real-message separation, a proposed exercise site and measurable success criteria. Ask who would handle resident reports outside office hours and who could fund continued operation after a pilot.

**4. Technical advisers and delivery leadership**

| Relationship | Proposed role | First bounded ask |
|---|---|---|
| Senior hackers / experienced technical contacts | Integration leadership and independent technical challenge | One person to estimate and own the complete implementation; a different reviewer to challenge security and test results |
| Dzintars - name to confirm | Candidate radio engineering lead and radio-community mentor | A four-week feasibility assignment: equipment/configuration review, a few representative routes, one controlled field test and supervision of two contributors |
| Andrejs - described by Kristaps as founder of Tildes birojs | Senior product/technical adviser and introductions | A 45-minute architecture and pilot review; an introduction to an experienced implementation reviewer or engineer; assess a possible bounded contribution |
| RTU students and a supervisor to be recruited | Measurements, tooling and supervised research | A small team with named assignments, a reviewer and a demonstration deadline |
| Make Riga hackerspace | Practical radio/hardware sessions | Confirm bench access, inventory possible loan equipment, find experienced operators and organise two build/test sessions |

Confirm native iPhone/Android integration experience and practical RF measurement experience separately. Enthusiasm and general coding skill do not by themselves cover those responsibilities. The integration lead owns software interfaces and release readiness; the radio lead owns radio configuration, antenna/power choices and measurements. They jointly demonstrate the complete chain.

**Andrejs and a possible Tilde contribution.** Explore approved multilingual instruction packs, consistent crisis terminology and comprehension testing. Compact event codes should select approved wording already installed on the phone. Version the dictionaries and define behaviour when a device lacks the required package. Ask what advice, staff time or sponsorship is realistically available; do not assume an organisational commitment from a personal introduction.

**Dzintars and the radio community.** Ask him to identify what can be borrowed, recommend a small number of configurations, check permitted operating conditions with the relevant expertise, and document delivery probability, latency, capacity in both directions and energy use. Pair experienced operators with RTU or Startschool contributors who build logs and dashboards. The community can also develop future installation, maintenance and exercise skills.

For research access beyond existing contacts, [RTU's Industry Partnership Hub](https://www.rtu.lv/en/innovations/center-for-industry-partnerships) provides a route to suitable researchers and facilities. For a later authorised broadcast experiment, [LVRTC's radio services](https://www.lvrtc.lv/pakalpojumi/raidorganizacijam/radio_apraide/) cover broadcast engineering and measurements. Neither access nor free airtime is assumed.

**5. Community, international connections and recruitment**

| Relationship | Proposed contribution | First bounded ask |
|---|---|---|
| JCI Latvia | Event organisation, business introductions and volunteers | One organiser and three introductions to companies that could fund a milestone, lend equipment or contribute staff time |
| Startschool | Practical coding challenges and recruitment | Run a small supervised challenge; recruit contributors who produce reviewable work into the pilot team |
| Ukraine-support organisations and Ukrainians in Latvia | Experience of communication failures and usability | Four to six voluntary interviews, then a small group reviewing the journey using fictional incidents |
| Partner studying for an MBA in Austin for six months | Sponsorship, research introductions and purchasing evidence | During the first month: ten relevant conversations, two tailored sponsor proposals, one research introduction and a short buyer/procurement assessment |
| Inga Ulmane - described by Kristaps as a diplomat representing LIAA in Austria | Introductions to programme owners and Austrian partners | Introduce the relevant Latvian funding adviser and one Austrian applied-research or civil-protection organisation; assess later consortium opportunities |

Ukrainian participants can surface failures involving depleted batteries, shared phones, confusing instructions, language, information trust and uncertainty over whether a request arrived. Use voluntary participation and fictional exercise data, compensate participation where possible, and record practical design findings without soliciting sensitive operational information. Lived experience informs the design; it is not proof that a particular radio architecture works.

Give the Austin partner a concise offer: maintaining trusted civilian information during prolonged communications outages, with a defined Latvian test setting and measurable results. Seek funding of engineering time, relevant research advice and evidence of purchasing requirements. Do not assume a particular university, laboratory or sponsor is already available through the MBA.

Give Inga the reviewed brief, actual partner contributions, the budget and two specific introduction requests. A subsequent Austrian evaluation could provide a second environment or a role in a European research consortium. LIAA programme owners assess eligibility; an introduction is not funding approval.

Start with Andrejs and the senior engineers reviewing the technical brief, then refine it with VUGD/IDC/crisis-centre contacts. Use that version for Inga's introductions and the Austin sponsorship conversations. Confirm full names and role descriptions before putting personal contacts into external partner materials.

**6. How to organise the R&D**

Kristaps owns scope, institutional relationships, funding and the decision log. One paid integration lead owns the backlog and complete demonstrator. The radio lead owns the RF work. A separate senior reviewer challenges the security model and results. One community organiser handles events and recruitment. These are proposed roles; assignments and availability must be agreed.

| Work package | Accountable role | Reviewable output |
|---|---|---|
| Shared protocol, publishing and receipts | Integration lead with security review | Signed immutable event objects, version/cancellation rules, private report envelopes and recipient-verifiable receipts |
| Native offline app | Mobile engineer under integration lead | Cold start without cloud dependencies; downloaded map; durable queues; clear data age and delivery states |
| Radio and gateway | Radio lead plus gateway engineer | Pinned configuration, durable priority queues, tested local connection, field logs and power/restart results |
| Nearby exchange | Mobile engineer with device-test contributors | Foreground iPhone/Android exchange of missing objects and delayed reports, including incompatible-device results |
| Audio feasibility | Radio/DSP contributor with a senior reviewer | Time-bounded bench study, then an authorised broadcast-chain experiment only if justified by the first results |
| Independent validation | Reviewer who did not implement the relevant control | Threat-model findings, malformed/replayed message tests, false-receipt rejection and operational walkthrough |

Run a weekly technical demonstration, a short weekly coordination meeting and a monthly institutional review when counterparts can participate. Each experiment records a hypothesis, equipment/configuration, software revision, conditions, sample size, observed failures and the resulting decision. Keep a separate list of unproven claims.

Agree code, data and publication rights before collaboration begins. Keep repositories, contribution review and test data organised around Atbalsts. Record borrowed equipment and donated time separately from cash spending. The lead reviews security-sensitive changes and controls releases; students contribute through bounded assignments with explicit acceptance criteria.

Useful student/challenge tasks include offline package validation, message-age UI, phone compatibility testing, a radio log collector, a gateway-status dashboard with synthetic data, audio-noise experiments and documentation of repeatable exercises. A first task should fit roughly one to three working days and end in a reviewed change or usable measurement record.

**7. Events that produce useful work**

Start with one organiser and a three-event sequence. Choose dates once the hosts and leads commit; this document does not create bookings or recurring calendar tasks. Keep a weekly technical session between the larger events where capacity permits.

| Event | Proposed hosts/contributors | Required output |
|---|---|---|
| Scenario and recruitment workshop | JCI, Startschool, operational contacts and Ukrainian participants who opt in | Agreed problems, a small set of contributor tasks, named reviewers and a participant list |
| Build and measurement session | Make Riga, radio community, senior engineers and RTU students | Working components, pinned configurations and recorded test results |
| Controlled outage exercise | Institutional/municipal partner, JCI volunteers and technical team | End-to-end observations, failures, user feedback and a decision about the next stage |

An event should yield reviewed code, measurement logs, a test-site commitment or a useful sponsor introduction. Demonstrations should expose limitations and show recovery behaviour. Use synthetic events and requests, clearly distinguished from real alerts. Radio experiments use permitted settings and agreed facilities; interference/abuse testing uses simulation or an appropriately controlled authorised setup.

After the first cycle, assess repeat attendance, maintainer capacity and the value of the results before extending the programme. Give volunteers a path from a small supervised task to equipment care, test coordination or a continuing development role.

**8. Budget and funding strategy**

The following EUR 30,000 target is an illustrative cash plan, excluding VAT and Kristaps's own time. It assumes access to borrowed phones/laptops and existing premises. It fits within the earlier demonstrator range but adds an explicit independent-review and contingency allowance. Obtain quotations and availability commitments before treating it as a funded delivery schedule.

| Use | Planning allowance |
|---|---:|
| Radios, gateways, accessories and spares | EUR 2,000 |
| Software and radio engineering | EUR 18,000 |
| Focused independent security review | EUR 3,000 |
| Field exercises, travel and test logistics | EUR 2,000 |
| Contingency | EUR 5,000 |
| Total | **EUR 30,000** |

Allocate approximately EUR 5,000 first for a bounded feasibility stage; it is included in the total. Commit the remaining approximately EUR 25,000 only against a reviewed result and a credible implementation plan. Donated labour reduces cash spending, not the underlying work. A focused review at this budget is not certification of an emergency service.

Seek one anchor sponsor or two smaller sponsors for the first EUR 5,000, using JCI/business contacts and the Austin partner's introductions. Later sponsor requests can be EUR 5,000-10,000 against a named milestone. Combine cash with documented loans of equipment, premises and engineering time. Offer participation in demonstrations and agreed research outputs; keep operational decisions and resident data under project governance.

The broader engineering model in Appendix A assumes EUR 400-700 per engineering day and 25-50 engineering days for a minimum end-to-end demonstrator. The EUR 18,000 labour allowance is roughly 26-45 days at those rates. The work plan must be resized if quotations or required expertise exceed that allowance. A public municipal deployment has a substantially larger budget and operating burden.

**Funding opportunities checked on 8 September 2026.** These are candidate routes, not awards or a confirmed combined funding package. Confirm current availability, applicant eligibility, suppliers, cost dates, co-financing and permitted combinations before committing expenditure. Keep each claimed cost allocated once; a voucher is payment for eligible work rather than unrestricted operating cash.

| Route | Verified programme information | Proposed next action |
|---|---|---|
| [LIAA innovation vouchers](https://liaa.business.gov.lv/atbalsta-iespejas/inovaciju-vauceru-atbalsts) | Applications open while funding remains. Introductory voucher up to EUR 10,000 at 100%; classic voucher up to EUR 25,000 at 85%, subject to conditions. Most supported work uses a qualifying external provider. | Request eligibility advice and a provider quotation for a defined feasibility, experimental-development or testing assignment |
| [LIAA business incubation](https://liaa.business.gov.lv/atbalsta-iespejas/biznesa-inkubacijas-atbalsts) | Intake 9-24 September 2026. Qualifying companies up to five years old need an MVP; listed support includes 70% co-funding and additional prototyping support for innovative companies. | Ask LIAA to assess the applicant company and existing app; prepare an application if eligible |
| [Horizon Europe Cluster 3: disaster resilience](https://rea.ec.europa.eu/funding-and-grants/horizon-europe-cluster-3-civil-security-society/disaster-resilient-society-europe_en) | 2026 call deadline 5 November; decisions anticipated April 2027 and grant agreements July 2027. Topic-specific fit is required. | Ask a research partner or National Contact Point for a consortium already addressing a suitable topic; use later-stage R&D as the proposed contribution |
| [Latvian Defence Ministry grants](https://www.mod.gov.lv/lv/uznemejiem/atbalsts-uznemejiem/grantu-programma) | 2026 deadline 18 September; information webinar 11 September. Priorities focus on autonomous military platforms and related capabilities. | Obtain a brief fit assessment before preparing an application; the civilian app alone is not an obvious match |

Inga can help reach the appropriate programme owners and potential partners. Andrejs may help sharpen a technical contribution or introduce a sponsor. The Austin partner can pursue cash sponsorship and research contacts in parallel. Record pending applications separately from committed cash and plan the immediate stage around funds actually available.

**9. The 12-week sequence and spending gates**

The delivery clock starts after the team, initial funds and test access are committed. The following sequence assumes a small team with sufficient combined engineering time; it is not a promise based solely on volunteer availability.

| Timing | Required result | Proposed decision |
|---|---|---|
| Before start | Two-page brief, named integration/radio leads, candidate institutional counterpart and site, costed feasibility assignment | Approve the initial allocation and responsibilities |
| Weeks 1-2 | Offline cold start, signed update on borrowed phones, initial radio transfer and documented failures | Review feasibility; resize or stop unsupported parts before committing remaining funds |
| Weeks 3-6 | Complete radio/gateway/phone/nearby-phone path, durable encrypted report and delayed return receipt | Confirm that the shared protocol and implementation work together |
| Weeks 7-9 | Repeated field/device tests, congestion, power interruptions, stale or malicious messages and operational walkthrough | Resolve critical findings; record service limitations and excluded conditions |
| Weeks 10-12 | Observed controlled exercise, reproducible evidence, cost model and next-stage proposal | Decide whether to pursue a larger municipal pilot |

Agree thresholds before testing. Appendix A proposes at least 95% of compact alerts within two minutes and 99% within five minutes on declared surveyed routes with awake apps under specified load; at least 95% successful foreground nearby exchanges in 30 seconds after setup; durable queued reports; and no accepted forged official messages or false centre receipts in the test suite.

Use at least 100 repeated opportunities per important link/state and report sample counts and uncertainty. These are initial engineering gates, not a demonstrated safety-critical service guarantee. Count device-specific failures and excluded conditions. If background behaviour fails the requirement, retain explicit foreground operation and dedicated gateways as the supported service model.

The reviewer should see both the successful round trip and failures: a removed node, an old event revision, a forged receipt, a restart with queued data and a delayed route back to the server. The institutional observer should assess wording, trust, user comprehension and operator workload as well as technical delivery.

**10. Decisions needed before a larger rollout**

Use the first pilot to identify an operator, a buyer and a recurring budget. Discuss installation, training, battery replacement, software updates, signing-key operations, exercises, support and who reviews incoming reports. A possible commercial offer is installation/integration plus annual maintenance and exercises, while citizen access remains free. This is a proposition to validate through buyer conversations.

The earlier municipal scenario of roughly 20 service points and 100-300 participants has an indicative EUR 75,000-225,000 scope budget. The wider illustration of 500 local points and 20 regional hubs is EUR 0.72-1.70 million initially with an EUR 100,000-300,000 annual operations placeholder. These are analytical examples, not quotations, funded plans or blanket national coverage. Stage figures should not be added without accounting for reused work and equipment.

Prioritise existing premises, power, staff and distribution arrangements. Independent regional connectivity remains necessary for fresh national information. Local radio nodes and volunteers do not substitute for an agreed upstream path, content authority or an organisation operating the service.

An Austrian evaluation or European consortium can follow once the Latvian pilot produces credible evidence. Seek equity when there is a defensible product, adoption evidence and a purchasing route. Keep subsequent applications anchored to the capability actually measured.

**11. First two weeks: action register**

All owners below are proposed. Kristaps should confirm people, dates and availability before marking any item committed.

| Action | Proposed owner / route | Concrete output |
|---|---|---|
| Prepare the introduction package | Kristaps, reviewed by mentor | Two-page pilot brief with architecture, three scenarios, funding target and one tailored ask per recipient |
| Review architecture and staffing | Andrejs plus senior technical contacts | Short review, named integration candidate and implementation estimate |
| Confirm radio lead and scope | Dzintars, name to confirm | Four-week assignment, time estimate, equipment loan list and initial test plan |
| Agree operational requirements | Kristaps with IDC, VUGD and crisis-centre contacts | Named counterpart, reviewed scenario and candidate municipal site |
| Recruit supervised contributors | Startschool, RTU and Make Riga | A small team, one-to-three-day starter tasks, named reviewers and first test-session date |
| Assign the event organiser | JCI and Kristaps | Owner and draft plan for the three-event sequence |
| Gather experience and usability findings | Ukraine-support contacts | Four to six voluntary interviews and a short list of design implications |
| Seek the first funding commitment | Kristaps, JCI contacts and Austin partner | A defined sponsor proposal for the initial EUR 5,000 stage; record actual commitments |
| Check grant eligibility and introductions | Inga / relevant LIAA programme owner | Eligibility response, suitable provider route and an application decision before relevant deadlines |
| Establish international work plan | Austin partner and Inga | Separate introduction targets, sponsor/buyer questions and a 30-day review date |

**12. Short outreach drafts**

These are suggested messages for adaptation. They have not been sent, and none should imply that an institution or named individual has already committed to participate.

**Institutional counterpart:** We are preparing a small Atbalsts pilot to test trusted information delivery during a prolonged cellular outage. Could we review three concrete scenarios with a nominated practitioner and agree what an exercise would need to demonstrate? We would bring a proposed architecture, test plan and budget, and document the limitations alongside the results.

**Mentor / senior adviser:** We have an architecture proposal and institutional questions to validate. Could you review a two-page pilot brief and help us reach a senior implementation engineer, a municipal pilot owner and a potential sponsor for the first EUR 5,000 feasibility stage? Each contribution would have a defined scope and reviewable result.

**Andrejs:** Could you give us a 45-minute review of the Atbalsts architecture and pilot plan, and suggest an experienced engineer who could assess the implementation? A possible contribution around approved multilingual crisis instructions and terminology would also be useful to explore.

**Dzintars, once identity is confirmed:** Would you help lead a four-week radio feasibility phase: review the design, recommend a small equipment set, mentor a couple of students and run one controlled field test? We would agree your time, available equipment and any paid work upfront.

**Inga:** We are preparing a Latvian demonstrator with a defined budget and measurable tests. Could you introduce us to the appropriate LIAA funding adviser and one Austrian applied-research or civil-protection contact? We can provide a concise brief showing the actual status of our prospective partnerships.

**Sponsor:** We are seeking support for a bounded feasibility stage in a civilian crisis-communications pilot. Would you consider funding a defined milestone, lending equipment or contributing engineering time? We would agree the deliverables, demonstration and reporting before work begins.

**Contributor:** We have small practical tasks in offline data, phone testing, radio logging and gateway tooling. Each task has a reviewer, fictional test data and a demonstrable result. The first assignment is designed to fit roughly one to three working days, with a path to a continuing role if the collaboration works well.
