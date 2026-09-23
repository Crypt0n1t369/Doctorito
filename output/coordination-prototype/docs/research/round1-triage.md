# Round 1 research: triage

23 September 2026. Hypotheses: VALUE-HYPOTHESES.md in this folder. Source kinds: docs / independent / marketing; pain strength: data / practitioner / anecdote / vendor. Raw agent output, not edited.

## V7 — partly_served
GAP: Commoditized: the general confidence gate (act on high, queue the rest) is in Zendesk, and the exact cheap calibrated gate with a review branch is now a public n8n node on the same API. Deterministic code for dates and eligibility exists in Fin Procedures. The cost comparison is not like for like: incumbents bill $0.49 to $2.00 per resolution or session for answering, while Zendesk classification comes with a per-seat add-on. Unserved: (a) binding an offer against limited, dated capacity and replying on the sender's channel; triage products do not do this, and it is V3, not V7. (b) Near-zero cost per decision for organisations with no helpdesk seats and no n8n builder. (c) Learning from corrections: Zendesk's model does not learn from them, and the prototype only records them. The 'logged reason' consists of rule results plus model probabilities, not a rationale. Not checked: ServiceNow; Freshdesk and Agentforce vendor docs; Front Topics and Autopilot; whether Fin shows its reasoning; incumbent accuracy; DIY token prices.
  - [docs] Zendesk intelligent triage: Predicts topic/intent, sentiment, language and entities (e.g. order numbers) with confidence levels that triggers can use: auto-act on high confidence, send the rest to a manual queue. No explanation of why a prediction was made. Needs Professional plan or above plus the Copilot add-on to use it in workflows. <https://support.zendesk.com/hc/en-us/articles/5222280338202-Intelligent-triage-use-cases-and-workflows>
  - [docs] Intercom Fin (pricing): $0.99 per outcome on a $49/month base that includes 50. Billed outcomes include 'assumed' resolutions, where the customer leaves or goes quiet for 24h, and configured procedure handoffs to a human. Default escalations are not billed. <https://fin.ai/help/en/articles/13975800-fin-pricing-outcomes>
  - [docs] Intercom Fin Procedures: Deterministic if/else branching and Python code conditions for eligibility checks, date calculations and record updates, so these are not left to AI interpretation. Source: the search snippet of this vendor page. The page opened, but its body did not render. <https://www.intercom.com/help/en/articles/13459814-how-to-write-code-conditions-for-fin-procedures>
  - [independent] Salesforce Agentforce: Third-party guides say session tracing and an audit trail log the prompt, response, masking and score chain for every action in Data Cloud. Price reported as $0.10 per action via Flex Credits. The Salesforce docs page returned 403, so this is not verified. <https://salesforcebreak.com/2026/05/28/setting-up-agentforce-observability/>
  - [independent] Freshdesk Freddy AI Agent: Reported at about $0.49 per email session ($49 per 100 sessions after 500 one-time) and about $0.10 per chat session on Omni. Source is a third-party search snippet; not opened or verified. <https://www.eesel.ai/blog/freshdesk-freddy-ai-pricing>
  - [docs] Front AI Tagging (legacy): Applies tags to email from prompt-described tags after approving 10 examples per tag. Not available to new users (replaced by Topics and Autopilot, which were not checked). The docs describe no confidence score and no explanation. <https://help.front.com/en/articles/759488>
  - [docs] n8n Text Classifier (built-in): LLM routes items to category branches, with an optional 'Other' branch or discard for items that match nothing. The docs describe no confidence score, threshold or reason in the output. <https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.text-classifier>
  - [marketing] Jev Classification n8n community node: Posted 21 Sep 2026 by a community member. Runs the same TypeSafe Jev API inside n8n: calibrated probability distribution, a confidence threshold, a 'Needs Review' branch, and probabilities kept on each item for audit. This is the product's gate, available to anyone building in n8n. <https://community.n8n.io/t/n8n-community-node-jev-classification-route-items-by-category-with-calibrated-confidence-built-for-high-volume/315339>
  PAIN:
  * [anecdote] A Zendesk admin (June 2026) reports a 'meaningful volume' of misclassified tickets even after refining intents. Agent corrections do not improve future classifications, and Zendesk support confirmed this. The post has 4 votes and 0 replies. <https://community.zendesk.com/ideas/intelligent-triage-should-learn-from-agent-intent-corrections-21877>
  * [vendor] Fin bills 'assumed' resolutions: the customer leaves without asking again, or 24h of inactivity. The cost therefore grows with volume whether or not the issue was actually resolved. <https://fin.ai/help/en/articles/13975800-fin-pricing-outcomes>
  * [vendor] A competitor's guide says per-resolution costs rise as the AI improves and spike with seasonal volume, and that Zendesk charges $2.00 per resolution on overage versus $1.50 committed. Seen as a search snippet only. <https://www.usefini.com/guides/ai-customer-support-pricing-per-resolution-vs-per-seat>
  * [anecdote] n8n users ask for a fallback model on Text Classifier because it has none when the AI call fails. Seen as a search snippet only. <https://community.n8n.io/t/text-classifier-node-add-fallback-ai-model-support-and-stronger-classification-mechanisms/287651?tl=en>

## APPLICATIONS

- Binding spontaneous volunteer offers against dated shifts during a flood or large cleanup [low] (V7 supporting V3 (V3 carries the value))
  WHO: Volunteer-centre coordinator in a municipal civil-protection unit or Red Cross branch getting several hundred free-text offers on Telegram, email and forms within 48 hours
  TODAY: Forms, spreadsheets, a shared inbox and people reading messages. Not researched in this segment.
  SHORT: Helpdesk AI is built and priced ($0.49 to $2.00 per session or resolution) to answer questions, not to bind offers to limited, dated capacity. Using n8n means someone has to build and maintain the matching rules.
  VALUE: Most offers bound or queued in under a second at near-zero cost, each decision recorded; the coordinator reads only the uncertain share

- Multilingual inbound triage for a small NGO with no helpdesk budget [low] (V7, V3)
  WHO: Food-bank or community-association coordinator reading Latvian, Russian and English donation and help offers in a Telegram group, alone
  TODAY: Reading messages by hand. Buying Zendesk or Intercom seats is unlikely at this size (not verified).
  SHORT: Zendesk triage requires the Professional plan plus the Copilot add-on. Fin needs a $49/month base plus $0.99 per outcome. The DIY route needs someone who builds in n8n.
  VALUE: Routing and replies without a paid seat or a builder; only the uncertain messages reach a person

- Matching carrier availability emails to open loads [low] (V7, V3)
  WHO: Dispatcher at a small freight forwarder reading dozens of 'truck free Riga Thursday' emails a day against open loads
  TODAY: Not checked (probably a TMS, load boards and manual reading)
  SHORT: Helpdesk triage classifies and answers messages. It does not check dates, weights or places against open loads. Fin code conditions could, but the buyer would have to be a Fin customer.
  VALUE: Deterministic date, weight and place checks plus a semantic fit score, with a queue for doubtful cases

- A triage queue whose corrections improve future routing [low] (V7)
  WHO: Support-operations lead on Zendesk whose agents re-label misclassified intents every day
  TODAY: Zendesk intelligent triage with confidence-based triggers
  SHORT: Corrections do not feed back into the model (vendor confirmed, June 2026 post)
  VALUE: Fewer misroutes over time. Caveat: the prototype records corrections but does not learn from them yet, and a Zendesk shop would need a strong reason to add a separate layer.

- A per-decision record for automated routing of residents' requests [low] (V7)
  WHO: Municipal service-desk manager routing resident emails to departments who must be able to show why a request went where it did
  TODAY: Manual routing or helpdesk triggers
  SHORT: Zendesk documents no explanation for its predictions. Agentforce's audit trail (not verified) comes on an enterprise platform. n8n outputs carry no confidence or reason.
  VALUE: A record that separates the rule results (department, eligibility) from the model score and the gate decision

## NOT WORTH IT
- A general AI triage and routing layer for teams already on Zendesk, Intercom, Front or Freshdesk: They already have confidence-gated triggers, deterministic code conditions and handoff. Their cost sits in seats and resolutions, which cheap classification does not change, and switching costs are high.
- Selling the act/queue/ask gate on its own to people building on n8n or Zapier: Since 21 Sep 2026 the same Jev API is packaged as a public n8n node with calibrated confidence and a Needs Review branch.
- Leading with 'about $0.0001 vs $0.99 per message': This compares classifying with answering and resolving. Zendesk triage comes with a per-seat add-on, not a per-message fee, and the DIY route already reaches similar cost.
- Claiming explainability or compliance-grade audit against enterprise vendors: Jev returns probabilities, not reasons. Agentforce reportedly logs full prompt and response chains. The prototype has no real-traffic wrong-bind rate and has matched human labels on only about 68% of synthetic cases.
- High-volume B2C customer support: The crowded incumbent market; the buyer's problem there is answering questions, not binding offers to capacity.
