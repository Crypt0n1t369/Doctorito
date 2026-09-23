# Round 1 research: commercial

23 September 2026. Hypotheses: VALUE-HYPOTHESES.md in this folder. Source kinds: docs / independent / marketing; pain strength: data / practitioner / anecdote / vendor. Raw agent output, not edited.

## V3 — commoditized
GAP: US brokerage (carrier emails and truck lists) is crowded and well funded. Staffing mostly avoids free text by design, using app claims and reply-YES SMS. The only openings I saw are narrow and unverified: (1) carrier capacity posted in free text in RU/LV/PL messenger groups (Telegram, Viber, WhatsApp) for small CEE/Baltic forwarders, since the EU exchanges' AI I read covers loads, not capacity; (2) small WhatsApp-run temp or event agencies whose workers reply with partial availability. I did not check Cargofy's actual RU/LV coverage.
  - [docs] Parade CoDriver: Takes over the broker's carrier inbox. Carriers' emails are forwarded to it, it replies and moves them toward a quote, captures carrier availability from quotes, and has Escalations and a Strict Mode for carrier validation. Extracting truck lists from text, PDFs and emails appears only in search snippets of parade.ai pages that I did not open. <https://help.parade.ai/en/collections/10358944-codriver>
  - [independent] Vooma: Automates quote emails (claims 5 min saved per quote) and order entry (claims 80% automated), with a multichannel agent across email, text, calls and the TMS. Raised $16.6M (Dec 2024). <https://www.freightwaves.com/news/vooma-grabs-16-6m-in-funding-as-brokers-prepare-for-market-swing>
  - [marketing] TIMOCOM AI (EU freight exchange): Pasted email text, PDFs or screenshots become a freight offer in under 20 s, translated across marketplace languages. The user checks it before publishing. It covers loads only, not vehicle or capacity offers. <https://www.timocom.co.uk/blog/ai-logistics-freight-entry-691846>
  - [marketing] Trans.eu (EU freight exchange): Turns customers' email enquiries into ready-to-publish freight offers (route, cargo, date, dimensions, weight) and suggests carriers from job history and ratings. It covers the demand side, not carrier capacity. <https://enterprise.trans.eu/en/blog/freight-forwarding-automation-without-an-it-overhaul-how-to-integrate-new-tools-with-your-existing-tms/>
  - [marketing] Cargofy: Claims AI workers that quote, dispatch and track by call, email and WhatsApp in 28 languages, 24/7. The page gives no details on how it works. <https://cargofy.com/>
  - [marketing] Teambridge: Fills open shifts by SMS: workers reply YES, and the first qualified taker is confirmed automatically after credential, overtime, rest and blocklist checks. Replies are structured, not free text. <https://www.teambridge.com/blog/ai-shift-replacement-fill-callouts-faster>
  - [marketing] Zelos, Connecteam, Ubeya, Shiftboard (per Zelos): Shift-signup apps that small temp agencies adopt to replace WhatsApp groups (signup, messaging, hours). <https://getzelos.com/staffing-tools-for-agencies>
  PAIN:
  * [vendor] Investors paid for the inbox-automation pain: $16.6M to Vooma. Its co-founder says earlier tools could not handle unstructured email, text and calls. <https://www.freightwaves.com/news/vooma-grabs-16-6m-in-funding-as-brokers-prepare-for-market-swing>
  * [vendor] Parade shipping capacity capture and escalations for carrier email shows the market leader treats carrier inbox handling as a paid product line. <https://help.parade.ai/en/collections/10358944-codriver>
  * [anecdote] Small temp agencies run shifts in WhatsApp groups. Above about 50 workers they lose track of confirmations and hours, and changes get buried. The source cites no data. <https://getzelos.com/staffing-tools-for-agencies>
  * [vendor] Filling a shift by manual call-out takes 30 to 90 min, against 2 to 10 min with parallel SMS offers (the vendor's own claim). <https://www.teambridge.com/blog/ai-shift-replacement-fill-callouts-faster>
  * [vendor] Trucker Tools (2021) automated the hundreds of daily carrier emails advertising trucks. This is a search snippet only: the page returned 403 and is unverified. <https://www.businesswire.com/news/home/20211118005535/en>

## V7 — partly_served
GAP: Inside these verticals, acting unattended while escalating the rest is already standard. Audit trails exist for rule-based decisions (Teambridge). I found no incumbent documenting a logged, explainable reason for each AI extraction or match decision, nor an 'ask one clarifying question' step. I also found no buyer asking for either. Cost per message (~$0.0001) is not a buying criterion I could find: buyers pay per seat, per load or per fill.
  - [marketing] Teambridge: Auto-confirms routine fills and sends only the exceptions to humans. It keeps an audit trail of who was offered, in what order, who accepted, and who was filtered out and why (rule-based). <https://www.teambridge.com/blog/ai-shift-replacement-fill-callouts-faster>
  - [docs] Parade CoDriver: Handles carrier email unattended, with an Escalations feature for cases it should not resolve and a Strict Mode for validation. The docs I read do not mention confidence thresholds or per-decision logs. <https://help.parade.ai/en/collections/10358944-codriver>
  - [marketing] TIMOCOM AI: A human-review gate: the user checks the AI-extracted offer before publishing. <https://www.timocom.co.uk/blog/ai-logistics-freight-entry-691846>
  PAIN:
  * [anecdote] No evidence found that brokers or staffing agencies seek per-decision explainable logs or cheaper per-message AI. The pain they report is speed and labour. <https://www.freightwaves.com/news/vooma-grabs-16-6m-in-funding-as-brokers-prepare-for-market-swing>
  * [vendor] A vendor presents audit trails and exceptions-only human handling as selling points in shift fill. The demand signal is inferred from the vendor, not from users. <https://www.teambridge.com/blog/ai-shift-replacement-fill-callouts-faster>

## APPLICATIONS

- Extract carrier capacity (trucks free, route, date, equipment) from free-text messenger-group and email posts in RU/LV/PL, and match it to open loads [low] (V3, V7)
  WHO: A dispatcher at a 2 to 10 person Baltic or CEE forwarder who reads Telegram, Viber and WhatsApp carrier groups alongside TIMOCOM or Trans.eu
  TODAY: Manual reading of messenger groups and exchange search. The exchanges' AI turns emailed loads (demand) into offers.
  SHORT: The TIMOCOM and Trans.eu AI I read covers loads, not incoming capacity messages. US tools (Parade, Vooma) are built around US load boards and TMSs. Cargofy claims WhatsApp and 28 languages, but that is unverified.
  VALUE: Fewer missed trucks and faster covering of loads. Willingness to pay at small, thin-margin forwarders is unknown.

- Keep shift coordination in WhatsApp, but turn workers' free-text replies ("can do Sat till 4") into confirmed, non-double-booked assignments with a confirm or withdraw link [low] (V3)
  WHO: The owner-dispatcher of a temp or event-staffing agency with 20 to 100 casual workers, currently run from WhatsApp groups
  TODAY: WhatsApp groups, then switching to shift apps (Zelos, Connecteam, Ubeya, Shiftboard)
  SHORT: The apps make every worker adopt a new app. The group chat loses track of confirmations and last-minute changes.
  VALUE: Tracking without forcing a channel switch. But cheap shift apps already solve the core pain, so the edge is small.

- Offer the typed-judgment act/queue/ask gate, with its per-decision log, as a component to regional freight or staffing software builders instead of as an end product [low] (V7)
  WHO: A small software vendor or integrator adding email or messenger intake to a regional TMS or exchange workflow
  TODAY: General LLM APIs or rules. Exchanges ship their own AI with human review.
  SHORT: Not established. I found no evidence these builders lack a cheap, logged, gated extractor.
  VALUE: Cheaper auditable intake inside someone else's product. This is an unproven B2B2B path.

## NOT WORTH IT
- US truckload brokerage: carrier capacity emails, truck lists and quote inbox: A real, paid pain, but crowded and moving fast. Parade (docs), Vooma ($16.6M), HappyRobot, Augment and FleetWorks all automate it, and HappyRobot's $1.22B and FleetWorks' $17M were seen in search snippets only. Incumbents are integrated with the load boards and TMSs a newcomer cannot match.
- Gig shift marketplaces (Instawork, Wonolo, Indeed Flex): Supply is claimed through structured in-app slots, so there is no free-text intake problem to solve. This is inferred from how these marketplaces work; I did not fetch their docs.
- Credentialed shift fill (healthcare, security, home care): Teambridge-style reply-YES SMS already auto-confirms with credential, overtime and rest checks and an audit trail. Free text adds little.
- Construction subcontractor bid leveling: Many AI vendors (Buildr, MeltPlan, EstimateHawk, Mirage Metrics) already parse emailed and PDF bids. This comes from search results only, not opened pages. The input is documents, not capacity offers.
- Competing on cost per message (~$0.0001): Buyers in these verticals pay per seat, per load or per fill, and the pain is labour and speed. Model cost is not the binding constraint, so it is not a wedge (inference, no counter-evidence found).
- Not checked (budget spent): The concept paper's take-rate claims (brokers 15 to 20%, staffing 20 to 35%). DAT and Truckstop's own AI features. Restoration TPA networks (Contractor Connection, Alacrity). Field Nation auto-dispatch, seen in snippets only. Event-staffing specifics. Cargofy's real RU/LV support. Pricing. Any independent survey of broker email volume. The Trucker Tools 2021 release returned 403.
