# Round 1 research: civic

23 September 2026. Hypotheses: VALUE-HYPOTHESES.md in this folder. Source kinds: docs / independent / marketing; pain strength: data / practitioner / anecdote / vendor. Raw agent output, not edited.

## V4 — partly_served
GAP: Residents can already see a vote traced to a status and to done, with notifications (Decidim, Go Vocal). What is missing: (a) no tool found links an individual's own contribution to fulfilment; (b) status depends on PB staff chasing departments by hand. The documented failures are organisational: feasibility, project managers left out, scope changes, cancellations, one person holding the data. A missing display is not the cause. The concept paper misquotes the OECD. In PP No.72 (2025), 'black boxes' refers to opaque digital technologies, not to input-to-outcome. 'Months or years without updates' and 'ideas absent from final plans' were not found in the full text of either 2025 OECD report. What the OECD does say: in 'Exploring New Frontiers', consultation fatigue comes from uncoordinated, overlapping invitations ('institutional amnesia'). In PP No.72, it lists lack of feedback and accountability as hindering impact. Not checked: Consul 'budget executions', Stanford PB, Your Priorities, housing co-ops, OECD Government at a Glance 2025, Paris audit reports.
  - [docs] Decidim Accountability component: Admins create results linked to proposals, budget projects and meetings, with statuses, completion %, milestones, sub-results, version history and CSV import. Docs do not mention recording volunteer or material contributions, or residents offering help. <https://docs.decidim.org/en/develop/admin/components/accountability>
  - [docs] Decidim notification to proposal followers: People who follow a linked proposal are notified when a result's progress is updated. Not opened: taken from a search snippet of the vendor's merged PR. <https://github.com/decidim/decidim/pull/4466>
  - [docs] Go Vocal input statuses and official feedback: Admins set statuses and post official feedback on ideas, and everyone who posted, commented or voted gets an email. Not opened: taken from support-site search snippets, and one support URL returned 404. <https://support.govocal.com/en/articles/3548594-giving-official-feedback-on-and-updating-the-status-of-many-ideas-at-once>
  - [docs] Paris open data: PB winning-project operations to completion: The city publishes a dataset tracking each winning project's operations through to completion. Not opened: taken from a search result. <https://opendata.paris.fr/explore/dataset/budget-participatif_operations-projets-gagnants-realisations/>
  - [independent] Mapseed dashboard (Durham NC PB): A web map of funded PB project locations that the city used to show implemented projects. Auditors used it to check project status. <https://www.durhamnc.gov/DocumentCenter/View/46652/Participatory-Budgeting-Process-Performance-Audit_final->
  PAIN:
  * [data] Durham NC audit: 12 of 18 Cycle 1 projects (~$2.1M) were complete by Sept 2022, against a target of end of FY2021. Delay causes: about 66% COVID, 34% internal processes (overlap with other projects, approval workflows). Metrics were not enough to track goal attainment. Participant data sat with one employee who resigned. One project's scope changed from construction to staff positions. <https://www.durhamnc.gov/DocumentCenter/View/46652/Participatory-Budgeting-Process-Performance-Audit_final->
  * [practitioner] Brennan Center (Aug 2022), 23 interviews across 8 cities. San Jose residents were not told what happened to their requests. Toronto agencies changed projects after the vote. In Hamilton, a councillor cancelled approved projects. Greensboro staff resisted or delayed projects. <https://www.brennancenter.org/our-work/analysis-opinion/making-participatory-budgeting-work-experiences-front-lines>
  * [practitioner] OECD PP No.72 (2025) lists 'low levels of accountability after a participatory process' and an 'inconsistent feedback loop'. Not closing the loop discourages future participation. <https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/04/tackling-civic-participation-challenges-with-emerging-technologies_bbe2a7f5/ec2ca9a2-en.pdf>
  * [data] Only 32% (OECD Trust Survey 2024) think government would adopt opinions from a public consultation. I read the full text from a copy of this PDF already in the scratchpad (title matched); I did not fetch it myself. <https://www.oecd.org/content/dam/oecd/en/publications/reports/2025/03/exploring-new-frontiers-in-citizen-participation-in-the-policy-cycle_3b33d845/77f5098c-en.pdf>

## V3 — unclear
GAP: In PB, the city's budget pays for delivery, through departments and procurement. Residents do not supply time or materials, so free-text offer intake has little use there. Resident in-kind contributions show up in civic crowdfunding and community-led grants. No evidence was found that offers arriving as free text on many channels are a pain for these bodies. Energy communities do rely on volunteers, but the documented problem is too little volunteer time and too much management effort, not parsing offers. Not checked: housing co-ops, REScoop member tooling.
  - [docs] Spacehive (civic crowdfunding, used by the Greater London Authority and councils): Projects take money pledges, can request in-kind contributions, and post updates to backers. Not opened: help pages returned 403, so this comes from search snippets only. <https://help.spacehive.com/en/articles/10577966-how-spacehive-works>
  PAIN:
  * [practitioner] A 2025 review of energy communities: they rely on volunteers, and finding citizens with enough time is 'a major challenge' (Sweden). Austria reports 'excessive management effort with poor compensation'. In Denmark, professionals working alongside unpaid volunteers creates power asymmetries. <https://academic.oup.com/ooenergy/article/doi/10.1093/ooenergy/oiaf002/8071961>
  * [anecdote] No evidence found that free-text offer intake is a pain in PB or civic participation delivery. <https://www.brennancenter.org/our-work/analysis-opinion/making-participatory-budgeting-work-experiences-front-lines>

## APPLICATIONS

- A delivery record fed by city departments, with a reason logged for each delay or scope change and voters notified [low] (V4, V1)
  WHO: PB programme manager in a mid-size city's budget office (Durham-style: ~18 capital projects, ~$2M per cycle, delivered by several departments over 2+ years)
  TODAY: PB platform accountability module or map dashboard, spreadsheets, email to project managers
  SHORT: PB staff re-type status by hand, project managers were not part of feasibility checks, scope changes happen outside the framework, and the data sat with one person who left
  VALUE: An audit-ready trail, fewer 'what happened to my project' complaints, and a record that survives staff turnover. The display itself is already served; the value lies in capturing updates and reasons (V1, not built).

- An answer to 'what happened to my request', including why it changed [low] (V4)
  WHO: PB lead volunteer or resident delegate (San Jose / Toronto style) who fields residents' questions after the vote
  TODAY: Go Vocal or Decidim status updates and follower notifications, when staff update them; otherwise nothing
  SHORT: Notifications only fire when staff update the status. Post-vote changes and cancellations arrive without explanation.
  VALUE: Trust in the next cycle. But the root cause is departments not reporting, which a new front end does not fix.

- In-kind pledges (volunteer hours, materials) tracked as dated commitments through to fulfilment, visible to the person who pledged and to the funder [low] (V3, V4)
  WHO: Civic crowdfunding programme officer at a city or regional funder matching community projects on Spacehive, and the community group lead delivering each project
  TODAY: Spacehive money pledges, in-kind requests and backer update posts
  SHORT: Unverified: in-kind offers look like campaign-time declarations and free-text updates, not tracked commitments
  VALUE: The one segment where V3 and V4 both apply: a pledger sees their hours scheduled and used, and the funder can verify the in-kind match

- Asking members who declared skills (permits, roofs, electricians) when an energy project stalls [low] (V5, V3)
  WHO: Volunteer board member of a citizen energy community delivering a rooftop PV project (Swedish or Austrian type)
  TODAY: Email, group chat, AGMs, share-offer platforms, spreadsheets
  SHORT: The documented pain is too little volunteer time and heavy management load. No evidence that members cannot see what happens to the project.
  VALUE: Possibly less coordination load. V4 visibility is unproven here.

- A shared record of what the administration has already asked, heard and decided, so agencies do not re-consult on the same issue [low] (V1)
  WHO: Participation coordinator in a national or regional government centre (for example France's CIPC) coordinating ministries' consultations
  TODAY: A separate platform per process (Go Vocal, Decidim), with no register across departments
  SHORT: The OECD attributes consultation fatigue to overlapping invitations that look like 'institutional amnesia'
  VALUE: Less fatigue, and consultations that build on earlier input. This rests on V1, which is not built.

- A retained, sourced record, accessible to several people, of each PB project's decision, scope change, approver and status [low] (V1, V4)
  WHO: City internal auditor or council oversight reviewing a PB cycle
  TODAY: Asking PB staff for data, then rebuilding status from dashboards and interviews
  SHORT: Durham auditors struggled to get data one departed employee held, and metrics could not show goal attainment
  VALUE: Cheaper audits and visible scope-change approvals. The buyer would still be the PB office, not the auditor.

## NOT WORTH IT
- Another public tracker for PB showing decision, status and done: Decidim Accountability (statuses, %, milestones, CSV, links to proposals and budgets, follower notifications), Go Vocal statuses with email feedback, and Paris open data already cover it
- Free-text offer intake for PB capital projects: Departments and contractors deliver these through procurement. Residents do not supply time or materials, and no evidence of demand was found.
- Selling 'the delivery half' on the OECD 'black box' claim: The claim is misattributed. The OECD's 'black boxes' means opaque technology, and 'months or years without updates' does not appear. The documented failures (feasibility, staff buy-in, handoff to project managers, cancellations, COVID) are organisational, not a missing tool.
- Energy communities as a V4 visibility buyer: No evidence found that members lack visibility of delivery. The documented pain is volunteer capacity and management load.
