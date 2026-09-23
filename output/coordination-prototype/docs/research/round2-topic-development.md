# Round 2 research: developing a topic, plus the skeptic

23 September 2026. Hypotheses: TOPIC-HYPOTHESES.md in this folder. Raw agent output, not edited.


##########################################################################################
SEGMENT ['T2', 'T5']

## T2 — partly_served
GAP: Typed questions, claims and evidence exist, but only in a niche plugin that researchers built for themselves, or in schemas users build in Tana. Mainstream team tools treat decisions as flat inline markers (Confluence) and freshness as page-level (Notion). No tool I checked keeps per-item state that a team shares, such as open, answered, contested or superseded, with sources on each claim. Demand is unproven outside academic synthesis: a targeted search for requests to track open questions or contradictions found nothing. The DG study shows real benefit for heavy users, but also a high cost of formalizing, a need for domain-specific types, and no evidence yet of shared use. Not checked: Roam multiplayer, Coda, Are.na, Logseq DB properties, Tana workspace sharing, AI 'open questions' features in Notion or Confluence.
  - [marketing] Discourse Graphs (Roam and Obsidian plugin): Question, Claim, Evidence and Source as typed nodes, with supports, opposes, informs and derivedFrom relations, plus a canvas. It is pitched for sharing claims and evidence across teams, but the site does not describe how shared graphs sync or merge. <https://discoursegraphs.com/>
  - [docs] Discourse Graphs field study (Chan et al., arXiv 2407.20666): Three years of deployment in Roam. About 30 daily active users (Nov 2022). Of 41 survey respondents, 23 were current users. Users had to extend the base four-node grammar for their own fields, moving to other tools is unresolved, and there is little data on shared use across labs. <https://arxiv.org/html/2407.20666>
  - [docs] Confluence decision report macro: Collects inline /decision items from pages and live docs across one or more spaces, filtered by label or CQL. The docs describe no decision states, rationale, supersession or history. It is a reporting view, not a decision record. <https://support.atlassian.com/confluence-cloud/docs/insert-the-decision-report-macro/>
  - [docs] Notion page verification (2.49, Mar 2025): A 'verified' badge on a whole page, with reminders to re-verify. Verified pages rank higher in search and citations. Freshness is tracked per page, not per claim or question. <https://www.notion.com/releases/2025-03-26>
  - [docs] Heptabase whiteboard chat: Each shared whiteboard has a chat. Members drag important messages onto the board as cards to build shared understanding. The page describes no typed questions, claims or decisions and no public publishing. <https://wiki.heptabase.com/collaborate-and-discuss-with-others>
  - [marketing] Tana supertags: Users can define their own typed objects with fields, such as a claim or evidence tag, and query or group them, for example claim boards grouped by evidence strength. The schema is built by the user, not shipped. Source is a search snippet; page not opened. <https://tana.inc/supertags>
  PAIN:
  * [data] Active DG users call typed-discourse context core to their workflow (70% of active users). They report retrieving details in seconds, tracking sources better, and drafting a dissertation introduction in under two days. The sample is small and self-selected. <https://arxiv.org/html/2407.20666>
  * [data] The base question/claim/evidence grammar was not enough; users needed to extend it for their own domains. This means a fixed schema will not fit everyone. <https://arxiv.org/html/2407.20666>
  * [vendor] Notion shipped re-verification reminders 'so nothing ever gets stale'. This signals that stale team knowledge is a recognised pain, handled at page level. <https://www.notion.com/releases/2025-03-26>
  * [anecdote] Obsidian users have asked how to get question-claim-evidence structures in Obsidian (forum thread, 2022; seen in search results only, not opened). <https://forum.obsidian.md/t/questions-claim-evidence-discourse-graph-in-obsidian/48685>

## T5 — partly_served
GAP: Going from private to team to public in one tool is solved for people who already work in Notion, and partly in Heptabase (per whiteboard). The unsolved case is people who think in a local-first personal tool like Obsidian and want to share part of it with a small group while keeping the rest private. They copy by hand between vaults or share the whole vault. Counter-evidence: some vendors and users deliberately switch tools, because private thinking is messy and gets rewritten before sharing. In that case losing lineage may not bother them. Not checked: Obsidian Publish docs, Tana workspace permissions, Logseq DB real-time sync in practice, how writers move a draft to public, Reddit complaints.
  - [docs] Obsidian Sync shared vaults: Shares a whole remote vault only. The docs say 'Fine-grained permissions are not supported yet'; everyone has the owner's permissions except inviting. Every collaborator needs a Sync subscription. Version history and merge on sync are included. <https://obsidian.md/help/sync/collaborate>
  - [docs] Heptabase whiteboard sharing: Shares specific whiteboards and their cards with anyone, including free users, at four levels: View, Chat, Edit, Full Access. The rest of the space stays private. Cards take the permissions of the whiteboard they sit on, and the page describes no public publishing. <https://wiki.heptabase.com/collaborate-and-discuss-with-others>
  - [marketing] Capacities (single-player by design): The vendor's own workflow: private research in Capacities, then collaboration in Notion. Tasks that come out of the research are written by hand into Notion tickets. The tool switch is intended, not a gap they plan to close. <https://capacities.io/blog/how-we-collab>
  - [marketing] Obsidian multiplayer plugins (Relay, Team Relay): CRDT real-time co-editing with per-folder access. Team Relay had about 56 downloads in mid-September 2026. Source is a search snippet; page not opened. <https://github.com/entire-vc/evc-team-relay-plugin>
  - [docs] Notion (from round 1): Private, team and public audiences in one tool, with page and database permissions. Not re-researched. <https://www.notion.com/releases/2025-03-26>
  PAIN:
  * [anecdote] A team member wanted to share /People and /Locations with the team while keeping /SecretNotes private. Unresolved; they settled on manually syncing data between vaults. Replies noted Obsidian does not prioritise team features. (March 2023) <https://forum.obsidian.md/t/selective-sync-between-vaults-in-a-team/56306>
  * [vendor] Capacities' own team splits private ideation (Capacities) from team action (Notion) and moves work across by hand. They describe collaborative spaces as noisy for early thinking. <https://capacities.io/blog/how-we-collab>
  * [vendor] Obsidian cannot give different collaborators different permissions within one shared vault, which forces all-or-nothing sharing. <https://obsidian.md/help/sync/collaborate>

## APPLICATIONS

- Literature review or thesis chapter developed over months, shared selectively [medium] (T2, T5)
  WHO: A PhD student and supervisor, sometimes plus one co-author
  TODAY: Obsidian or Zotero notes kept private; Google Docs or Overleaf drafts shared; feedback in email and meetings
  SHORT: The supervisor sees only prose drafts, not which claims are sourced, which questions are open, or what was decided in the last meeting. Sharing part of a private Obsidian vault means copying by hand.
  VALUE: The supervisor can review the state of the argument (open questions, claims with sources) between drafts. The student shares only what is ready.

- Lab-level synthesis that outlives individual students [medium] (T2, T3)
  WHO: A research lab: a PI and 5 to 10 students or postdocs working on related questions
  TODAY: Discourse Graphs in Roam or Obsidian (a few labs), a Notion or Confluence lab wiki, shared Zotero
  SHORT: DG works for individuals, but shared or merged graphs are not evidenced and it is tied to specific tools. Wiki pages flatten claims into prose and track freshness only per page.
  VALUE: A newcomer can see what the lab believes, from which evidence, and what is still open, without asking the PI.

- Mapping positions on a contested policy question [low] (T2, T6, T5)
  WHO: A 4 to 6 person think-tank or advocacy team working on one policy file for months
  TODAY: Google Docs memos, Notion or Confluence, spreadsheets of stakeholder positions, Slack
  SHORT: Positions and disagreements get merged into memo prose. Confluence decisions are flat markers with no rationale or supersession.
  VALUE: One current map of who holds which position, on what evidence, what the team decided and why. It can later be published in part.

- Opening part of a personal vault to a few collaborators [medium] (T5)
  WHO: An Obsidian user starting a side project with 2 or 3 collaborators (a hobby build, a local-history dig, a course)
  TODAY: Whole-vault Obsidian Sync, copying between vaults by hand, cloud-drive folders, Relay-type plugins, or moving the project to Notion
  SHORT: Obsidian has no per-folder or per-note permissions. Plugins have tiny adoption. Moving to Notion leaves the private notes behind.
  VALUE: Share a subset with the group, keep the rest private, and keep the link to where each shared item came from.

- Turning team discussion into kept, typed items [low] (T2)
  WHO: A 3 to 5 person team exploring a design or product direction
  TODAY: Heptabase whiteboard chat (drag messages onto the board), Notion, Slack
  SHORT: Heptabase already covers the 'keep from conversation' step. Kept cards are untyped: there is no open question, decision or contested state, and no public audience.
  VALUE: Only marginal over Heptabase unless typed state and audiences clearly matter to the team. This is the head-to-head test of the product's 'Keep' idea.

- Community history project with contested accounts, going from private research to public [low] (T2, T5, T6)
  WHO: A 5-volunteer local-history group publishing to their town
  TODAY: Google Docs, a Facebook group, a WordPress site
  SHORT: Sources per claim and competing accounts get lost when research becomes a published page. Moving to the public site is a separate rewrite.
  VALUE: Readers see claims with sources and disagreements kept. Volunteers keep their unfinished research private.

## NOT WORTH IT
- A question/claim/evidence/decision schema as the differentiator: Tana supertags and the free Discourse Graphs plugin already let people define these types. The DG study shows users need their own domain-specific types and that formalizing is costly, and adoption is tiny (about 30 daily users in 2022). Value has to come from shared, correctable state and contribution, not from the types themselves.
- Competing on 'keep from team chat': Heptabase already lets a team drag chat messages onto a shared whiteboard, with guests joining for free. Matching that alone adds nothing.
- Replacing the private thinking tool: Crowded (round 1), and vendors like Capacities deliberately keep private thinking single-player and hand off to Notion. It is better to connect to where people already think (Obsidian and others) than to ask them to move.
- A general team wiki with freshness: Notion page verification and Confluence decision reports already cover page-level freshness and decision listing for teams who work that way. 'One more wiki' is not a reason to adopt.
- Promising 'no tool switch' to writers: People often rewrite messy private notes before sharing them, so they may not value keeping the link back to the original. No evidence was found that writers complain about this. Writers' workflows were not checked this round.


##########################################################################################
SEGMENT ['T1', 'T4']

## T4 — partly_served
GAP: The verification burden is backed by data. The building blocks exist for developers and for Notion-savvy teams: provenance, validity windows, conflict links. What I did not find is an end-user product where results from several agents or vendors enter a shared record as unconfirmed, sourced claims, and a person confirms or rejects each one, or leaves a conflict open. Zep settles conflicts by recency. Lore works through MCP/CLI inside Notion. A research position paper (Feb 2026) calls claim-level auditability 'the bottleneck' and says it has no standard. No direct evidence that small groups ask for a claim ledger; the demand is inferred from the verification pain. Strongest pain signals: researchers, and teams receiving colleagues' AI output. Not checked: Elicit, NotebookLM, citation views inside deep-research products, Claude Code Projects, Microsoft and Google agent workspaces, user forums.
  - [docs] Notion Lore (open source, MIT, 18 Aug 2026): Shared memory for agents, stored in Notion databases (Projects, Topics, Memories, Entities, Facts). Agents use it over MCP; people use Notion or a CLI. Has supersedes and conflicts_with links, stale facts that expire unless reinforced, and human review through Notion version history. Aimed at teams already on Notion. <https://www.notion.com/blog/building-shared-memory-for-ai-agents-in-notion>
  - [marketing] Zep / Graphiti: Temporal knowledge graph for agent memory. Each fact links to the episode it came from and carries valid-from, valid-to, observed and recorded times. When a new fact conflicts, it closes the old fact's window automatically instead of deleting it. Built for developers; the page shows no end-user screen for reviewing or confirming facts. <https://www.getzep.com/ai-agents/temporal-knowledge-graph/>
  PAIN:
  * [data] Deep-research configurations produce large shares of unsupported statements, with citation accuracy of about 40–80% across systems (DeepTRACE; from the search snippet of the abstract, page not opened). <https://arxiv.org/html/2509.04499>
  * [data] In a Sept 2025 survey of 1,150 US desk workers, 40% had received AI-generated work lacking substance in the past month, and each case took about 2 hours to resolve. Recipients do the cleanup. <https://www.betterup.com/workslop>
  * [data] Survey of 2,430 researchers (Aug 2025): 64% cite inaccuracy or hallucination as a barrier, up from 51% in 2024, while 84% use AI (search snippet, PDF not opened; Wiley sells AI services). <https://www.wiley.com/content/dam/wiley-com/en/pdfs/about/wiley-explanaitions-2025-the-evolution-of-ai-in-research.pdf>
  * [practitioner] Position paper: as generating reports gets cheap, auditing the links between claims and evidence becomes the bottleneck. It proposes provenance coverage, contradiction transparency and audit effort as measures. It is not empirical. <https://arxiv.org/abs/2602.13855>
  * [vendor] Notion built Lore because follow-ups, decision records and procedures disappear when agent sessions end. Its authors warn that vague or stale memory harms agents. <https://www.notion.com/blog/building-shared-memory-for-ai-agents-in-notion>

## T1 — partly_served
GAP: Vendors are quickly fixing the loud pain, having to re-brief the assistant across sessions and surfaces. In the tools I checked, a remembered item has no status (established or speculated) and no source. Memory stays inside one vendor, and in Claude's case one person; ChatGPT shares it only in paid business tiers, as chat history rather than a list of what is established. Technical individuals already build their own versions (Obsidian vault + Claude Code + CLAUDE.md). No evidence found that users ask to tell established from speculated. The one thread I read on yet another shared-memory tool showed no pain and some mockery of its novelty. Not checked: NotebookLM, Perplexity Spaces, team sharing in Claude Projects, Gemini, Copilot Notebooks, Reddit.
  - [independent] Claude memory (chat + Cowork, since 25 Aug 2026): One memory shared by chat and Cowork, updated during conversations. Users can read, edit or delete any remembered topic. All plans. Memory is per user account, not per project or team, and nothing is said about sources. <https://techcrunch.com/2026/08/25/claude-cowork-finally-remembers-what-you-told-the-app-in-chat/>
  - [docs] ChatGPT Projects / shared projects: Memory limited to a project, so chats can refer to other chats in the same project. Shared projects (Business/Enterprise) give collaborators the same files, instructions and chat history. The help page returned 403, so this comes from the search snippet and is unverified. <https://help.openai.com/en/articles/10169521-projects-in-chatgpt>
  - [docs] Notion Lore: Persistent Facts, Memories and Topics that several agents and people share across sessions, backed by Notion (see T4). <https://www.notion.com/blog/building-shared-memory-for-ai-agents-in-notion>
  PAIN:
  * [anecdote] An open-source Obsidian memory for Claude Code and 6 other CLI agents says it exists to stop users re-explaining projects, decisions and people every session (repo title from search, not opened). <https://github.com/eugeniughelbur/obsidian-second-brain>
  * [vendor] Anthropic merged chat and Cowork memory so users stop re-briefing Claude on projects and preferences in each interface. <https://techcrunch.com/2026/08/25/claude-cowork-finally-remembers-what-you-told-the-app-in-chat/>
  * [anecdote] Power users describe ChatGPT memory filling with stale, contradictory notes and turning it off (search snippet, not opened). <https://futuredigestnews.substack.com/p/your-chatgpt-forgot-everything-again>
  * [anecdote] Counter-evidence: on a Show HN for a shared memory graph across Claude and ChatGPT, no commenter described losing context. Replies were sarcasm about novelty and a privacy objection to handing over memories. <https://news.ycombinator.com/item?id=49124733>

## APPLICATIONS

- Literature review where deep-research runs are delegated and each claim is checked before it counts [medium] (T4, T1)
  WHO: A PhD student and supervisor running a months-long literature review, with ChatGPT/Gemini deep research plus a reference manager
  TODAY: Deep-research reports pasted into Google Docs, Zotero, possibly NotebookLM (not checked this round)
  SHORT: Reports are prose, and citation accuracy was measured at about 40–80%. The supervisor cannot see which claims the student checked against the source. Weeks later, the checked and unchecked claims are mixed together.
  VALUE: Agent claims enter as 'asserted, unchecked, source X' and become 'checked by student' or 'rejected'. The supervisor reviews only what changed. Resuming starts from the checked set.

- One vendor-neutral record of what a small team has established, fed by whichever assistant each member uses [low] (T4, T1)
  WHO: A 4–8 person policy or think-tank team where members use different assistants (ChatGPT, Claude, Perplexity) on one topic over months
  TODAY: A shared Google Doc or Notion page, copy-paste from chats, ChatGPT shared projects (Business/Enterprise only), Claude memory per person
  SHORT: Assistant memory is per person and per vendor. Shared projects keep chats and files, not a list of findings with sources and who confirmed them. Colleagues' AI output costs recipients cleanup time.
  VALUE: A newcomer or the lead sees what is confirmed, from where and by whom, whichever tool produced it. Less time spent redoing colleagues' AI output.

- Conflicts between agents' findings kept as open questions for a person, not settled by recency [low] (T4, T6)
  WHO: A 2–3 person research team (market, policy or due diligence) running several agents in parallel on sub-questions of one topic
  TODAY: Reading each agent's report and reconciling by hand. Developer memory (Zep) or Notion Lore if technical.
  SHORT: Zep closes the older fact when a newer one conflicts, which is right for a changed address and wrong for contested evidence. Lore can mark a conflict, but only inside Notion, through MCP/CLI. Reports do not show contradictions with earlier findings.
  VALUE: A contradiction between agent B and a finding already confirmed shows up as an open question with both sources, and a person resolves it or keeps both views (links to T6).

- A record of what was checked that travels with AI-assisted work handed to someone else [low] (T4)
  WHO: A 3-person strategy or research consultancy sending AI-assisted market scans to clients or partners
  TODAY: Manual fact-checking, footnotes, reviewers re-doing work
  SHORT: The recipient cannot tell which statements a person verified and which the agent asserted. Workslop surveys show recipients spend hours cleaning up and think less of the sender.
  VALUE: Each claim in a deliverable shows its source and whether a named person checked it, which protects trust and cuts the reviewer's rework.

- Picking up a long-running topic weeks later across AI tools, for non-technical people [low] (T1)
  WHO: An independent journalist or nonfiction writer working one topic for months with Claude and ChatGPT, who will not build an Obsidian and Claude Code setup
  TODAY: Claude memory (all plans), ChatGPT project memory, notes apps
  SHORT: Memory holds topics and preferences, with no source and no established/speculated status, and does not cross vendors. The DIY fixes need technical skill and their context files go stale.
  VALUE: On return, sees what was established, from where, and what is still open. The gain over vendor memory is only status plus source, and that gain is marginal.

## NOT WORTH IT
- Generic cross-session or cross-tool memory for individuals: Commoditized and moving fast. Claude memory spans chat and Cowork on all plans (Aug 2026), ChatGPT has project memory, Mem0 OpenMemory shares memory across MCP tools (search result), and many Obsidian + Claude Code repos exist. On HN, another shared-memory graph got mockery and a privacy objection, not described pain.
- Agent memory infrastructure for developers: Crowded: Mem0, Zep/Graphiti, Letta. Provenance links and validity windows already exist. Competing there means competing on retrieval quality and latency, not on what this product is for.
- Shared agent memory for teams already working in Notion: Notion's own open-source Lore (MIT, Aug 2026) keeps Facts and Memories with supersedes/conflicts_with, expiry and human review through version history, inside the workspace those teams already use.
- Context for coding agents (AGENTS.md/CLAUDE.md, repo memory): Agent vendors are serving this themselves (e.g., Claude Code Projects' shared operational memory, per a search result, not opened), and it is not the stated primary use.
- Capturing more automatically as the selling point: Automatic memory is exactly what goes stale and pollutes: Lore's authors say vague or stale memory harms agents, and users report switching ChatGPT memory off. Any value lies in the human confirm step and the source attached to each item, not in capturing more.


##########################################################################################
SEGMENT ['T1', 'T4']

## T1 — partly_served
GAP: Picking up where you left off is now largely handled: project memory, saved chat history, saved notes with citations and project summaries. What none of the opened sources offers is marking a kept item as established, speculative, open or decided; correcting an item while keeping its history; or crediting who contributed what. Collaboration covers inputs (files, sources, instructions). In Claude and NotebookLM, each person's chats, where the understanding forms, are private per user. The value left is the epistemic layer, not memory, and the platforms are closing the memory gap fast. NOT CHECKED: the ChatGPT help centre (403), so how memory works in shared projects and whether collaborators' chats are visible is unverified; Perplexity Spaces docs (search snippets only: view/add-thread permissions); Claude memory/Research docs; Gemini Gems; research tools (Elicit, Zotero, Obsidian, Heptabase, Tana, Notion AI). No quantitative data found on how often users need an established-vs-speculated distinction.
  - [docs] Claude Projects (Team/Enterprise sharing): Shared project knowledge and instructions with Can view / Can edit roles. Chats in a shared project stay private to each member unless shared as a snapshot link. The help page describes no co-edited notes, summary or state object. Sharing is Team/Enterprise only. <https://support.claude.com/en/articles/9519189-manage-project-visibility-and-sharing>
  - [docs] NotebookLM (Google's help pages now call it Gemini Notebook): chat and notes: Chat history is saved and 'kept private to you'. 'Save to note' pins an answer to the noteboard and keeps its tables and clickable inline citations. This is the closest thing to a kept finding with its source, but a note has no status (established, tentative or open) and the help page mentions no edit history. <https://support.google.com/notebooklm/answer/16179559?hl=en>
  - [docs] NotebookLM Enterprise sharing: Viewers can interact but cannot add sources or notes. Editors have owner-level rights except deleting, sharing and revoking access. Sharing to groups is supported, so collaborators contribute sources and notes, not status or decisions. <https://docs.cloud.google.com/gemini/enterprise/notebooklm-enterprise/docs/share-notebooks>
  - [independent] ChatGPT shared projects: Expanded to Free, Plus, Pro and Go on 23 Oct 2025 (Free: 5 collaborators and 5 files; Plus/Go: 10 and 25; Pro: 100 and 40). Collaborators can take part and make changes, with 'Only those invited' or 'Anyone with a link' visibility. The state is chats, files and instructions. The article does not say whether collaborators see each other's chats. <https://www.searchenginejournal.com/openai-releases-shared-project-feature-to-all-users/559136/>
  PAIN:
  * [practitioner] Practitioners hand-write 'handoff prompts' (goal, current status, decisions made, what to avoid, next step) to carry work into a new AI session. People are building the state object by hand. (Search result, not opened.) <https://www.jdhodges.com/blog/ai-session-handoffs-keep-context-across-conversations/>
  * [anecdote] Developers have built MCP servers and browser extensions only to move conversation context between chats, assistants and projects. (Search result, not opened.) <https://glama.ai/mcp/servers/trust-delta/conversation-handoff-mcp>
  * [anecdote] A secondary summary reports a Reddit thread of about 100 comments on long ChatGPT conversations degrading: forgetting earlier context and contradicting itself. (Not opened.) <https://vikotool.com/en/posts/chatgpt-kontext-verlust-langer-gespraeche-loesungen/>
  * [anecdote] A Tom's Guide reviewer calls ChatGPT-5 memory its 'biggest blind spot' and uses a manual workaround. (Headline only, not opened.) <https://www.tomsguide.com/ai/this-is-the-one-important-thing-chatgpt-5-still-cant-do-and-my-simple-workaround>
  * [anecdote] NotebookLM did not save chat history until late 2025, which a reviewer called one of their biggest frustrations. When it was added, the UI said messages are 'only visible to you, even when notebook is shared'. (Search results, not opened.) <https://www.threads.com/@testingcatalog/post/DPG-IEsAshM/notebooklm-will-start-saving-your-chat-conversations-soon-messages-and-chat-hist>
  * [practitioner] Perplexity users ask in the official forum for control over which threads are visible in a shared Space. (Title only, not opened.) <https://community.perplexity.ai/t/request-for-advanced-thread-visibility-control-in-spaces-restrict-threads-prompts-to-assigned-spaces-only/1420>

## T4 — underserved
GAP: Delegated AI research comes back as a report, a chat or a snapshot. No opened source breaks agent output into separate claims that a person can accept, reject or correct, with source and checker attached, in a state that several agents and people share over time. Even Kosmos, which has an internal shared world model, hands the user a report. The reliability gap is backed by data. Demand is inferred: I found no user complaint that directly asks for a place for delegated results to land. The risk is that checking, not storage, is the costly step. A landing place only adds value if it makes checking claims cheaper and reusable. NOT CHECKED: NotebookLM/Gemini Deep Research importing sources into notebooks, ChatGPT agent/deep-research output formats, Perplexity Labs, enterprise research platforms (Hebbia, AlphaSense), Elicit reports.
  - [docs] Kosmos (Edison Scientific AI scientist): Uses a 'structured world model' to share information between its data-analysis and literature agents across about 200 agent rollouts per run. Output is a report that cites every statement to code or primary literature. The vendor-authored paper does not say the world model is visible to users, editable, or kept across runs. <https://arxiv.org/abs/2511.02824>
  - [docs] NotebookLM 'Save to note': Moves a single AI answer, with its inline citations, into a shared noteboard. This is a landing spot at the level of whole answers, with no per-claim check status. <https://support.google.com/notebooklm/answer/16179559?hl=en>
  - [docs] Claude chat snapshots: The only documented way for work done in one member's chat inside a shared project to reach others: a link to a static snapshot that can be updated. It is not merged into shared project state. <https://support.claude.com/en/articles/9519189-manage-project-visibility-and-sharing>
  PAIN:
  * [data] DeepTRACE (ICLR 2026) audit: deep-research systems remain one-sided on debate queries, and citation accuracy ranges from about 40% to 80% across systems, with large fractions of unsupported statements. (Search result, not opened.) <https://arxiv.org/html/2509.04499>
  * [data] 'Cited but Not Verified' (2026): links in deep-research reports are valid over 94% of the time and relevant over 80%, but the specific claims attributed to them are supported only 39–77% of the time. (Search result, not opened.) <https://arxiv.org/html/2605.06635v1>
  * [data] Even with web retrieval, 3–13% of URLs cited by commercial LLMs and deep-research agents are fabricated. (Search result, not opened.) <https://arxiv.org/html/2604.03173v1>
  * [vendor] Independent scientists judged 79.4% of statements in Kosmos reports accurate, so roughly 1 in 5 needs catching before it is built on. <https://arxiv.org/abs/2511.02824>

## APPLICATIONS

- A brief or position paper on a contested question, developed over 1–3 months, with sub-questions delegated to analysts and deep-research agents [medium] (T4, T1, T2, T6)
  WHO: A 3–6 person policy or think-tank team (e.g. a municipal energy or housing brief)
  TODAY: A shared ChatGPT project or Claude Team project, deep-research reports pasted into a Google Doc, discussion in Slack or email
  SHORT: In Claude, members' chats are private unless snapshotted. Deep-research reports cite sources that support the attributed claim only about 40–80% of the time, and they are not split into checkable claims. The final doc flattens verified, asserted and disputed into the same prose.
  VALUE: Every claim in the brief traces to a source and to who checked it. A new analyst reads the current state instead of the chats, and rejected agent claims are not reintroduced.

- Due-diligence or market analysis where several deep-research runs feed one engagement [medium] (T4)
  WHO: A 4–10 person analyst team at a small consultancy or investment firm
  TODAY: ChatGPT, Gemini or Perplexity deep research, then reports copied into Docs or Slides, then manual fact-checking by a junior analyst
  SHORT: Reports are blobs, so checking happens per report and is lost afterwards. Fabricated or unsupported citations are measurable (3–13% fabricated URLs). Nothing keeps parallel runs consistent with each other.
  VALUE: Claims checked once are reused across runs and engagements. The team can see what an agent actually established versus what it asserted.

- A thesis question worked on over a year, reviewed at regular meetings [low] (T1, T2, T3)
  WHO: A PhD student and supervisor (optionally one co-supervisor)
  TODAY: NotebookLM with sources and saved notes, a personal ChatGPT or Claude project, Zotero, meeting notes in a doc
  SHORT: Saved notes keep their citations but have no status (established, tentative or open) and no documented correction history. The student's chats, where reasoning happens, are private per user. Resuming is handled; seeing what they now believe and why is not.
  VALUE: The supervisor reviews what changed since the last meeting instead of reading drafts. Open questions are explicit, and AI-found claims are marked checked or unchecked.

- Carrying accepted findings forward across repeated AI-scientist runs [low] (T4, T2)
  WHO: A computational or wet-lab biology group (a PI and 3–8 members) using Kosmos-style agents
  TODAY: Kosmos runs that produce cited reports, with the group reading and discussing each report
  SHORT: The world model is internal to the system. About 1 in 5 report statements is inaccurate. No documented way to record accepted and rejected findings and seed the next run or other members with them.
  VALUE: A checked record of findings that persists across runs and people, so the agents build on accepted results only.

- Two founders exploring a market or technical topic, splitting sub-questions between themselves and AI agents [low] (T1, T4)
  WHO: A 2–3 person early-stage founding team
  TODAY: A ChatGPT shared project (free tier: 5 collaborators, 5 files), handoff prompts pasted between sessions, a shared doc
  SHORT: The shared state is chats and files. The status summary (goal, decisions, what to avoid, next step) is rebuilt by hand in handoff prompts.
  VALUE: One maintained account of decided, known and still open that both founders and their agents work from.

- A solo investigation developed over weeks (e.g. a local story or a technical deep dive) [low] (T1, T4)
  WHO: A freelance journalist or independent researcher working alone with AI
  TODAY: NotebookLM or a ChatGPT project, handoff prompts, a notes app
  SHORT: Resuming is served. What is missing is keeping 'verified' apart from 'the AI said so', which fact-checking practice requires.
  VALUE: Fewer published errors traced to unchecked AI claims, and a trail showing how each claim was verified.

## NOT WORTH IT
- Resuming after weeks, or memory, as the headline value: ChatGPT project memory, Claude per-project memory and summaries, and NotebookLM saved chat history plus notes already cover it, and the platforms improve it monthly. Competing on recall means fighting the owners of the conversation.
- A 'chat with your sources' notebook: NotebookLM/Gemini Notebook already does it: saved notes keep inline citations, and it supports Editor/Viewer roles and group sharing.
- Multi-user AI workspaces as such: ChatGPT shared projects are on the Free tier (5 collaborators) since Oct 2025, alongside Claude Team projects and Perplexity Spaces. Sharing is table stakes; what is shared (chats and files, not checked state) is the gap.
- Building another deep-research agent: Commoditised across the major assistants. Measured weaknesses are in citation support and one-sidedness, which argues for a checking-and-landing layer rather than a better generator.
- Moving context between assistants: A pasted handoff prompt plus several free MCP servers and extensions already do this. The moat is thin.
- Solo hobby exploration (e.g. building a story bench) as the lead case: Stakes are too low to maintain an established-vs-speculated layer, projects and notebooks are good enough, and round 1 already found the solo space crowded.


##########################################################################################
SEGMENT ['T3', 'T6']

## T3 — partly_served
GAP: The loop 'claim an open question, contribute, get checked, see the state change, get credit' exists outside code only where checking is cheap and objective (Lean in formal maths). Elsewhere it needs a maintainer to act as the checker (Kialo admins) or heavy human support (Turing Way). Even the maths project, which had a verifier, names these as its hard problems: turning many discussions into one coherent piece, tracking progress, and parcelling out work to volunteers. For interpretive or empirical topics, no evidence was found of a general tool where an outsider's evidence visibly changes an open question's state, with credit. Note that the only relevant part the prototype has built, claims that cannot be double-booked, matches the one step GitHub+CI already does. The hard part, deciding and synthesising what counts as a state change, is not built. Not checked: OSF, Hypothesis, Hackaday.io/Printables logs, Discourse AI or Solved, non-code Stack Exchange sites, and erdosproblems.com (search snippets only: per-problem forum threads since August 2025, curator-set open/solved status). Also not checked: any direct demand from non-technical groups.
  - [docs] Equational Theories Project workflow (GitHub Projects + CI claiming + Lean + Zulip): Organisers post open sub-questions as issues. A volunteer claims one by comment, and CI lets only one person hold a claim at a time. They submit a PR, Lean and automated checks verify it, it is merged, and the open-implications view updates. More than 50 contributors took part; 24 are named authors, and the paper has an author-contributions appendix. The same method was later used by the Fermat's Last Theorem formalisation. <https://arxiv.org/html/2512.07087v1>
  - [docs] The Turing Way (open book on GitHub + all-contributors bot): Open data-science guide with more than 470 contributors. Non-code contributions are credited through all-contributors emoji types. Non-technical contributors are carried by human scaffolding: collaboration cafés, book dashes, and team members who fix CI and style for them. <https://jimmadge.github.io/fosdem24/>
  - [docs] Kialo (suggested claims): Outsiders suggest a pro or con claim under a thesis. Only the suggester and admins can see it until an admin accepts it or sends it back with comments, and the suggester is notified. The help page does not say whether the suggester is credited on the accepted claim or whether evidence can be attached. <https://support.kialo.com/hc/en-us/articles/115003791445-Suggesting-Claims>
  - [independent] Stack Overflow (public Q&A commons): Public question-and-answer site where contributions build up in the open. Stack Exchange Data Explorer data shows monthly questions fell to their lowest level since 2009 by May 2025, and the fall sped up after ChatGPT launched. <https://blog.pragmaticengineer.com/stack-overflow-is-almost-dead/>
  PAIN:
  * [practitioner] The ETP organisers list four scaling problems: parcelling out tasks to volunteers and tracking them, turning content from many discussions into one coherent piece, tracking progress against goals, and verifying contributions across time zones. They advise setting up these processes before announcing a project. <https://arxiv.org/html/2512.07087v1>
  * [practitioner] ETP maintainers needed both research-level maths and software-engineering skills. Onboarding meant maintainers across time zones watching Zulip, and managing tasks by hand in earlier projects was time-consuming. <https://arxiv.org/html/2512.07087v1>
  * [practitioner] Turing Way contributors vary widely in Git/GitHub skill and many will never build the book. The project gets around this with synchronous human help (cafés, dashes, team members fixing CI and style), not with tooling. <https://jimmadge.github.io/fosdem24/>
  * [data] Monthly Stack Overflow questions were back at 2009 levels by May 2025 (SEDE data). The author expects questions to move to Discord, WhatsApp or Telegram groups, so public contribution commons are shrinking as people ask AI and chat privately. <https://blog.pragmaticengineer.com/stack-overflow-is-almost-dead/>
  * [vendor] More than 8 million help-channel messages in 9 Discord communities are not reachable by search engines, so questions get asked again and again. This comes from a search snippet of a post by the Answer Overflow founder; the page was not opened. <https://medium.com/@rhys_80649/the-move-to-discord-from-forums-has-resulted-in-millions-of-questions-and-answers-being-lost-it-6ca6d7c63b36>

## T6 — partly_served
GAP: Keeping minority accounts is well served in two separate niches: heritage objects (Mukurtu) and one-off deliberation or argument maps (Talk to the City, Kialo, Polis). The largest open knowledge community (Wikipedia) deliberately weights and merges views by prominence. No tool was found where contested accounts live alongside findings, open questions and decisions in a topic that keeps developing, with each account's source and holder kept. However, pain evidence outside heritage and civic consultation is thin, and no small group was found asking for this. Communities also resist AI summaries layered over carefully weighted text. Not checked: Polis docs, Discourse AI summaries (whether they keep dissent), Community Notes bridging, and oral-history or local-history group practice.
  - [docs] Wikipedia NPOV / due weight: Covers viewpoints in proportion to how prominent they are in reliable sources, and leaves out views held by an extremely small minority whatever their truth. Spinoff sub-articles are allowed, but POV forks are banned. Disagreement is kept, but deliberately weighted and merged into one article. <https://en.wikipedia.org/wiki/Wikipedia:Neutral_point_of_view>
  - [docs] Mukurtu CMS community records: Several communities can attach their own record to the same heritage item. Each record has independent metadata and cultural protocols, is shown alongside the original, and nobody has to edit or erase anyone else's account. Only protocol stewards can create records. <https://mukurtu.org/support/how-to-create-community-records/>
  - [marketing] Talk to the City (AI Objectives Institute): LLM clustering of large-scale input into themes and points of difference, with summaries linked back to individual participants' claims. Used for Taiwan AI assemblies and in Michigan, Tokyo and California. Each report is a one-off for a project, not a living record, and the tool is described as a proof of concept. <https://ai.objectives.institute/talk-to-the-city>
  - [docs] Kialo: Pro/con argument trees under a thesis. Opposing claims sit side by side in the structure rather than being merged, and admins gate what gets added. <https://support.kialo.com/hc/en-us/articles/115003791445-Suggesting-Claims>
  PAIN:
  * [practitioner] The Wikimedia Foundation paused its AI 'Simple Article Summaries' pilot (June 2025) almost immediately after editors objected about accuracy and damage to credibility, even though the summaries carried an 'unverified' label. <https://techcrunch.com/2025/06/11/wikipedia-pauses-ai-generated-summaries-pilot-after-editors-protest>
  * [vendor] Mukurtu presents community records as a way for several communities to add knowledge to one item without erasing each other's, contrasting this with the single authority record in mainstream cataloguing. <https://mukurtu.org/support/how-to-create-community-records/>
  * [vendor] Talk to the City outputs are per-project reports, and its developers call it a proof of concept with open questions about LLM reliability, so the minority clusters it finds are not carried forward into later work. <https://ai.objectives.institute/talk-to-the-city>

## APPLICATIONS

- Carry dissent forward after a consultation: keep the minority clusters from a Talk to the City or Polis round as standing positions attached to later open questions and decisions [low] (T6, T2, T3)
  WHO: A 3-person civic-tech or city participation team running 1-2 consultations a year with 500-1000 respondents
  TODAY: Talk to the City or Polis reports, then Google Docs or slides for follow-up, and email to officials
  SHORT: Reports are one-off snapshots (TttC calls itself a proof of concept). Nothing links a minority cluster to what was later decided or tried, so participants cannot see whether their view went anywhere.
  VALUE: Respondents and officials can trace each cluster, including minority ones, to what came of it. The next round starts from the recorded state, not from a blank sheet.

- A maintained open-questions list outside formal maths: per-question state (open, partial, answered, contested), evidence added by outsiders, a curator confirms the status change, and the contributor is credited [low] (T3, T2)
  WHO: A researcher who curates an 'open problems' list in an empirical field, with 20-50 occasional outside contributors
  TODAY: A static website plus a forum thread per question (the erdosproblems.com pattern, seen only in search snippets), a GitHub wiki, and email
  SHORT: Without a verifier like Lean, every status change depends on the curator. ETP says turning many discussions into one coherent state and tracking progress are hard even with a verifier.
  VALUE: Outsiders can see what would move a question, contribute to it, and see the state change with their name on it. The curator confirms changes instead of writing them up.

- Non-git contribution path into a GitHub-based open book: a non-technical contributor takes an open question or gap, adds sources, and a maintainer accepts it into the repo with credit [low] (T3)
  WHO: An open-education or open-docs project with hundreds of contributors, many non-technical (Turing Way-sized)
  TODAY: GitHub PRs and issues, the all-contributors bot, collaboration cafés and book dashes, and maintainers fixing CI and style for contributors
  SHORT: Git skill is a known barrier, bridged by maintainers' synchronous time. Credit is per repo or per contribution type, not tied to what the contribution changed.
  VALUE: Less maintainer handholding, and non-technical contributors see what their input changed. However, the project chose GitHub deliberately and switching costs are high.

- Local-history or interpretive topic where several accounts are kept side by side per question, each with its source and holder, while the group keeps developing the topic [low] (T6, T2)
  WHO: A 5-10 person volunteer local-history group collecting neighbourhood stories, some of them contested
  TODAY: Facebook groups, Google Docs, occasionally a wiki. Mukurtu where an institution deploys it.
  SHORT: Wikipedia's no-tiny-minority and due-weight rules make it unsuitable for local accounts that are contested or have few sources. Mukurtu is organised around items and run by institutions, not around questions that are still being developed.
  VALUE: Competing accounts survive without one person merging them into prose, and newcomers can see what is agreed and what is contested.

- Keep answers and open questions from a chat-based community as a findable, correctable record, alongside Discord rather than replacing it [low] (T3, T1)
  WHO: An open-hardware or maker Discord of a few thousand members with 3-5 volunteer moderators
  TODAY: Discord forum channels, pinned messages, sometimes Answer Overflow or a separate wiki
  SHORT: Answers scroll away and cannot be found from outside, so the same questions come back. The evidence for this is vendor-sourced and was only seen in a snippet.
  VALUE: Fewer repeat questions, and contributors' answers last and are attributed.

## NOT WORTH IT
- Formal-maths collaborations (Lean projects, ETP-style): Already served: GitHub Projects with one-claimant CI, Lean kernel checking, Zulip, and credit in the paper. The Fermat's Last Theorem formalisation adopted the method. The prototype's claim-without-double-booking duplicates what GitHub+CI already does there.
- Competing with or layering onto Wikipedia: Due weight and the ban on POV forks are deliberate community choices. Editors got a clearly labelled AI summary pilot paused almost immediately in June 2025, so an outside layer would likely be rejected.
- Multiple narratives on heritage items: Mukurtu community records already provide independent per-community metadata and protocols on the same item, built with and for the communities involved.
- A new public Q&A commons: Monthly Stack Overflow questions fell to 2009 levels by May 2025 as people moved to private AI and chat groups. Building a new public place to answer answerable questions goes against a strong trend.
- One-off opinion mapping: Polis and Talk to the City already cluster views and keep minority groups. The product's only possible edge is carrying views forward over time, not the mapping itself.
- Research budget not spent (no verdict possible): Not checked within 10 searches and 8 fetches: OSF, Hypothesis, Hackaday.io/Printables project logs, Discourse AI and Solved, Polis docs, Community Notes, non-code Stack Exchange sites, and erdosproblems.com beyond search snippets.


##########################################################################################
SKEPTIC

## T1 — killed
  SUBSTITUTE: For a group: a ChatGPT shared project plus one pinned 'running brief' file (headings: Established / Hypotheses / Open / Decided) that the AI is asked to rewrite at the end of each session, with NotebookLM 'Save to note' for sourced findings. In ChatGPT shared projects every member sees every chat, and the project has one pooled memory (https://www.smithstephen.com/p/in-a-shared-chatgpt-project-everyone [independent], Aug 2026; the OpenAI help centre returned 403 again, so this is not checked against the docs). For one person: Claude memory or ChatGPT project memory plus a handoff prompt. For technical users: the Cline 'Memory Bank' convention, which keeps projectbrief.md, activeContext.md and progress.md in the repo and updates activeContext after each session (https://docs.cline.bot/best-practices/memory-bank [docs]).
  MISSES: The brief is flat prose that an AI rewrites. It can silently promote a guess to 'established', and nothing records who promoted it or from what source. History exists only per document or per git commit, not per item. The brief goes stale unless someone keeps it up. The Cline docs say nothing about decided versus speculative, provenance, or several collaborators. Pooled ChatGPT chats give visibility but no distillation: twelve people's threads are noise, not a state. Claude Team chats stay private. Memory stays within one vendor.
  WHY: Picking up weeks later, the loud part of T1, is now handled by project memory, pooled shared-project chats and saved notes. The remaining 'established versus speculated' distinction costs almost nothing to fake with a headed document, and no researcher found users asking for it. The product owner's own experience points the same way: they wrote exactly this requirement, then met it with a markdown file. What is left is not about memory. It is about trusting what another agent or person wrote, and that belongs under T4.

## T2 — survives_narrowly
  SUBSTITUTE: A Notion, Airtable or Google Sheet database, or Obsidian Bases, with one row per question or claim and properties for Status (open, answered, contested, decided, superseded), Source, Owner and linked items, plus Notion page verification for freshness. Researchers in synthesis-heavy fields can use the Discourse Graphs plugin. For literature, Elicit Reports link every claim to the exact quote in the source paper (https://elicit.com/solutions/reports [marketing]).
  MISSES: Someone has to design the schema and keep it current. The Discourse Graphs study found a high cost of formalising and a need for types specific to each field. Rows are cut off from the chats and agent runs where understanding forms, so they go stale. History is per page. Elicit's claims live inside reports that regenerate. A 2026 feasibility study found supporting quotes matched in only 46% of repeated extractions (https://pubmed.ncbi.nlm.nih.gov/42212591/, search snippet only, not opened). So a report is not a stable record you can correct.
  WHY: 'Not a first-class object anywhere' is false. The data model costs nothing in any database tool, and Discourse Graphs and Tana already ship or allow it. The one thing that could survive is lower upkeep: items proposed from conversations and agent output, then confirmed by a person, so the list does not decay. That is an unproven claim about maintenance cost. No demand was found outside academic synthesis, and the prototype has not built it. Who it is for: a lab or small research team that already keeps a questions and claims list and watches it go stale.

## T3 — killed
  SUBSTITUTE: Technical communities: GitHub Issues and Discussions (with a marked answer), labels as the state, and the all-contributors bot for credit, which the Equational Theories Project showed works end to end. Non-technical groups: a Discourse forum with a solved-answer marker, plus a curator-maintained status page. This is the erdosproblems.com pattern: a static list, one thread per problem, and a status the curator sets. I did not check this pattern myself this round.
  MISSES: Every status change waits on a curator. Git is a barrier for non-technical contributors. Credit goes to the repository or the contribution type, not to what the contribution changed.
  WHY: The benchmark loop exists wherever checking is cheap. Where checking is not cheap, the missing ingredient is curator and verifier time, which a tool does not create. The Equational Theories Project had Lean as a verifier and still named synthesis and task tracking as its hard parts. The Turing Way bridges the gap with people, not software. The only part the prototype has built, a claim that cannot be double-booked, duplicates GitHub plus CI. No non-technical group was found asking for this. The owner also now says open contribution comes after individual and group topic work, so this is not an initial wedge.

## T4 — survives_narrowly
  SUBSTITUTE: Literature: Elicit Reports, where each claim links to a supporting quote ([marketing], opened), or NotebookLM Deep Research, whose report and the sources you select are imported into the notebook (https://support.google.com/gemininotebook/answer/16215270 [docs], opened). Finance due diligence: Hebbia Matrix, which shows cells with source citations and says 'Collaborate with the entire deal team' (https://www.hebbia.com/ [marketing], opened). General and cheapest: paste each report into a Google Doc and mark claims as checked in comments, or keep a Sheet with the columns claim | source | checked by | status. Developers: Zep or Notion Lore.
  MISSES: No source I opened offers a status per claim (accepted, rejected or disputed) that lasts across runs and people and is fed by several vendors' agents. NotebookLM brings in sources, not claims, and its help page says nothing about checking. Elicit ties claims to quotes but documents no accept or reject state, and its reports regenerate. Hebbia is enterprise tooling for banks and funds, and I found no description of per-cell sign-off. The Sheet works, but all the checking is manual, and accepted findings do not feed the next agent run or the other members' agents.
  WHY: This is the strongest of the six, and the data on unreliable output holds up. But the two niches worth the most already have specialised tools aimed at them: academic literature (Elicit, NotebookLM) and finance due diligence (Hebbia, AlphaSense unchecked). Storage is not the expensive step; checking is. A place for results to land adds value only if it makes checking against the source cheaper and reusable, and the prototype does not do that yet. What survives: small generalist teams working one topic for months with several general-purpose AI tools across vendors, and AI-heavy builders running several agents (the owner's case).

## T5 — killed
  SUBSTITUTE: Notion (private page, then teamspace, then publish to web) or Google Docs (private, then shared, then published to web), which round 1 already found. Heptabase shares chosen whiteboards and keeps the rest private. Obsidian users have Obsidian Publish for selected notes, a second shared vault, or a Relay-type plugin. I did not check Publish or Relay adoption.
  MISSES: Inside Obsidian you cannot share one folder with a small group without a plugin or copying by hand. Lineage is lost when people deliberately move from a private tool to a team tool.
  WHY: This is served for anyone already in Notion, Google Workspace or Heptabase. The niche left over is local-first Obsidian users, and it rests on one 2023 forum anecdote. Those users are technical, attached to Obsidian's private-thinking experience, and have plugins. Some teams (Capacities) switch tools on purpose because early thinking is messy. To win them, a new tool would first have to beat Obsidian at private thinking, which round 1 found to be a crowded market.

## T6 — killed
  SUBSTITUTE: Kialo for pro and con trees; a 'Positions' table in a Google Doc or Notion database (holder, account, source, linked question); Mukurtu for heritage objects; Talk to the City or Polis for one-off consultations; Wikipedia talk pages for disputes.
  MISSES: Accounts are not tied to a topic state that keeps developing, and minority clusters from a consultation are not carried forward into later questions and decisions.
  WHY: No small group was found asking for this. Existing tools cover the niches where the pain is documented, and the obstacles there are institutional (who deploys it, who maintains it), not tooling. What survives is a feature inside T2: a 'contested' status with several attributed accounts. That is not a reason to switch.

UNIQUE STRENGTH: Only one narrow thing survives. It is a shared record where each item carries its status (said, kept, checked, decided or disputed), its source, who confirmed it and who can see it. It takes input from several people and from AI agents of more than one vendor, and a correction keeps the item's history. Nothing I opened offers this to end users. ChatGPT pools chats and memory but does not distil them. Claude keeps chats private. NotebookLM brings in sources, not claims. Elicit ties claims to quotes inside reports that regenerate. Hebbia is enterprise finance tooling. Lore and Zep are developer plumbing. The Cline memory bank is markdown with no status or provenance. The owner's anecdote fits: the failure was not forgetting, it was not knowing which of another agent's documents to trust. But a disciplined markdown and git habit already gets most of the way there. This strength sits in group work with delegated AI output (T4, with T2 as its data model), not in solo exploration.

WHO WOULD SWITCH: The most likely switchers are a 2–6 person policy or think-tank team, a small research consultancy, or a PhD lab. They work one question for months, members use different assistants and deep-research tools, and mistakes cost them: a published brief, a client deliverable, a thesis. They would switch only if the tool takes in output from the tools they already use without retyping, makes checking a claim against its source cheaper than a Google Doc with comments, and does not ask them to leave their chat tool. That argues for a layer beside ChatGPT, Claude and NotebookLM (import or MCP), not a new destination. A second group is AI-heavy builders running several agents across compacted sessions, like the owner. Their pain is real, but they build their own with markdown, git and MCP, so they suit design partnership rather than being a market. Unlikely to switch: solo explorers (memory and projects serve them), teams already in Notion (they can build T2 and T5 themselves), academic literature reviewers (Elicit, NotebookLM), finance due-diligence teams (Hebbia), heritage and civic groups, and GitHub or Discourse communities. I did not check: Relay or Obsidian Publish adoption, AlphaSense, per-cell sign-off in Hebbia, erdosproblems.com, Perplexity Spaces, Notion AI filling database properties, current Claude Projects docs, or the ChatGPT help centre (403 twice).

OVERREACH:
- Segment 1 rates T4 'underserved' because no opened source offered it, but it did not check NotebookLM Deep Research (which imports the report and chosen sources into the notebook [docs]), Elicit Reports (claims linked to quotes [marketing]) or Hebbia Matrix (cited cells, 'deal team' collaboration [marketing]). 'Partly served' fits better, and the due-diligence application's 'medium' confidence is too high, because Hebbia and AlphaSense target exactly that buyer.
- The T1 gap leans on 'each person's chats are private'. That is true for Claude and NotebookLM. In ChatGPT shared projects every member sees every chat and memory is pooled per project (independent article, Aug 2026; not checked against the help centre). Segments 1 and 4 also disagree on which ChatGPT plans have shared projects.
- Several pains labelled 'data' come from search snippets that were not opened (DeepTRACE's 40–80%, 'Cited but Not Verified', the 3–13% fabricated URLs, the Wiley survey). Even if they are right, they show that AI output is unreliable, not that small groups want a shared claim ledger. The demand is inferred, as segment 4 admits.
- T2 says 'no tool keeps per-item state that a team shares' (open, answered, contested, superseded). Any Notion or Airtable database with a status property, or Tana supertags, does this. The accurate claim is that no tool ships that schema ready-made and maintains it for you.
- Handoff prompts, CLAUDE.md files, Obsidian-plus-Claude-Code setups and MCP context movers are cited as evidence of pain. They are equally evidence that users solve it cheaply themselves. The Cline Memory Bank is a documented, widely copied convention for exactly this [docs].
- The 'PhD student and supervisor' application appears in three segments, but no source shows supervisors want claim-level status rather than drafts and meetings.
- T5 'partly served' is generous. Notion, Google Docs and Heptabase cover private to team to public, and the Obsidian gap rests on one 2023 forum post.
- The T3 and T6 applications (civic teams carrying dissent forward, curated open-problem lists in empirical fields, Discord knowledge capture) are all low confidence, with no demand found from those users. In each case the sources name human bottlenecks: curator time, institutional ownership.
- The Discourse Graphs field study's '70% of active users' is 70% of about 23 self-selected current users. It shows depth for a few enthusiasts, not market demand, and it offers no evidence of shared use.
