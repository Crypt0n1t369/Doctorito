# Round 1 research: conversation

23 September 2026. Hypotheses: VALUE-HYPOTHESES.md in this folder. Source kinds: docs / independent / marketing; pain strength: data / practitioner / anecdote / vendor. Raw agent output, not edited.

## V1 — partly_served
GAP: Tracing an item back to the exact meeting moment is already served (Meet, reportedly Granola). What stays unserved: (1) a confirmed state that separates a decision from AI-extracted text; only pilot-stage Slack apps have an approve step. (2) One record across meetings, chat, email and messengers; every tool is tied to one platform. (3) Correcting a single decision while keeping its history; not shown in any source opened. (4) Groups spanning several organisations or languages; Facilitator excludes external meetings/chats and supports one language per meeting. Not checked: Otter, Fireflies, Fathom, Zoom AI Companion, Slack AI recaps, Notion AI notes, Confluence/Rovo, Coda, Loop, ChatGPT/Claude Projects, NotebookLM, Obsidian, Mem, Tana, Reflect, Heptabase, Google Docs version history, pricing.
  - [docs] Microsoft Teams Facilitator (Copilot): Live AI notes of key points, decisions and action items that all participants can edit (GA). Planner task tracking is in preview. Notes are stored as a .loop file in the initiator's OneDrive. Limits: no 1:1, group or external chats/meetings; one spoken language per meeting; not collected by eDiscovery; needs a Copilot licence. <https://learn.microsoft.com/en-us/microsoftteams/facilitator-teams>
  - [docs] Google Meet 'Take notes for me' (Gemini): Writes a Google Doc per meeting with a summary and auto-captured next steps. Timestamp citations jump to the matching transcript moment, but only when transcription is on. Business Standard/Plus and Enterprise editions. <https://workspaceupdates.googleblog.com/2025/02/transcript-citations-take-notes-for-me-google-meet.html>
  - [marketing] Scientia (Slack): /scientia capture turns a Slack thread into a structured decision: question, evidence, rationale. Decisions are approved or sent back before entering a Decision Log. Search says honestly when nothing is on record. Versioning and superseding are not mentioned. Guided pilot, not self-serve. <https://scientiaos.io/>
  - [marketing] Granola: UNVERIFIED (seen only in search snippets of vendor blog posts; no page opened). Reportedly adds transcript quotes to the user's notes, and chat answers carry citations to the meeting and timestamp. <https://www.granola.ai/blog/meeting-action-items-ai-extraction>
  PAIN:
  * [vendor] Survey of 12,000 knowledge workers: 25% of time goes on searching for answers, and 56% say the only way to get information is to ask someone or hold a meeting. Taken from a search summary; the page was not opened. <https://www.atlassian.com/blog/state-of-teams-2025>
  * [data] The usual automatic metrics correlate only weakly with human-judged errors in meeting summaries, and about a third of them mask errors. So AI-extracted records need a human to confirm them. The paper gives no error rate. <https://arxiv.org/abs/2404.11124>
  * [vendor] A vendor statistics page cites '14-37% hallucinated summaries' to Kirstein et al. The paper's abstract has no such figure. Treat as unverified. <https://www.saner.ai/blogs/ai-note-taking-statistics>
  * [vendor] '70% of meeting decisions forgotten within 24h' appears on vendor statistics blogs with no primary source. Do not use. <https://dectrack.com/en/resources/decision-making-statistics>
  * [anecdote] A PM describes decisions lost in Slack and the same questions coming back; the workarounds are #decisions channels and manual syncing to Notion. Seen only in a search summary; the author is probably a vendor. <https://dev.to/quely/slack-is-where-context-goes-to-die-1cbp>
  * [vendor] At least five Slack decision-log apps exist (Scientia opened; Decision Tracker, Loqbooq, Afinio and Dcyde seen only in search). This shows supply, not demand. Scientia is still a pilot seeking teams 'with live decision-structure pain'. <https://scientiaos.io/>
  * [practitioner] Counter-evidence: an NGO running community programmes over WhatsApp reports no record-keeping pain and manages with pinned messages and polls. <https://eduspots.org/using-whatsapp-to-drive-community-led-change-the-eduspots-approach/>

## V6 — commoditized
GAP: The same model from one person to team to public already exists in Notion at page level. What is left: per-item audiences inside one page, and reaching people outside the workspace on their own channels. That is V2/V3, not V6. No evidence found that users want one model across scales for its own sake. Not checked: Obsidian Publish, Tana, Mem, Heptabase, Coda, Loop.
  - [docs] Notion: Private pages visible only to the owner, shared pages and teamspaces, and publish to web, all in one tool. Moving a page into a teamspace widens access. Permissions are per page, not per item on a page. <https://www.notion.com/help/guides/understanding-notions-sharing-settings>
  PAIN:

## APPLICATIONS

- One sourced decision record for a multi-partner, multilingual consortium [low] (V1 (V2 for the partner/internal split))
  WHO: Project manager of a 4-8 partner EU-funded NGO/municipal consortium in Latvia. Partners meet on Zoom/Teams/Meet and coordinate over email and Telegram/WhatsApp in Latvian, Russian and English.
  TODAY: Hand-written minutes in Word/Google Docs, email recaps, and each host platform's AI notes where someone has a licence
  SHORT: Facilitator excludes external meetings and chats and supports one language per meeting. Meet notes are one doc per meeting. Slack decision apps assume Slack. Nothing joins decisions across channels and organisations.
  VALUE: Partners and auditors can see what was decided, when and where, and how it changed, without searching each platform.

- Confirm step turning AI-extracted 'decisions' into kept ones [low] (V1)
  WHO: Ops or chief-of-staff lead at a 20-100 person remote company that already runs AI notetakers and needs to know which extracted next steps were actually agreed
  TODAY: Meet/Teams AI notes plus a manual skim; a few teams pilot Slack decision apps with an approve step
  SHORT: Notes present AI-extracted next steps as fact with no agreed/tentative state. Standard metrics hide summary errors. The approve-step tools are Slack-only and at pilot stage.
  VALUE: A short list of confirmed decisions and commitments, each linked to its source moment and correctable with history.

- Newcomer-readable 'what we know, what is open, what we decided' page for a volunteer project that has outgrown its chat group [low] (V1, V6)
  WHO: Volunteer coordinator of a residents' association or river clean-up group of 30+ rotating volunteers run from a WhatsApp/Telegram group
  TODAY: Pinned messages, polls, an occasional shared Google Doc
  SHORT: Only vendor claims say chat groups break once they outgrow 'everyone knows each other'. The one practitioner account found reports no such pain.
  VALUE: A new volunteer gets up to speed without asking the coordinator, and the coordinator stops being the group's only memory.

## NOT WORTH IT
- General meeting notes, summaries and action-item extraction for one organisation on M365 or Google Workspace: Commoditized and bundled: Teams Facilitator (co-authored notes, decisions, tasks) and Meet notes (next steps, transcript citations) come with licences these teams already hold.
- 'Trace to the source moment' as the headline differentiator: Meet already links notes to transcript timestamps, and Granola reportedly does the same. It is table stakes for meetings; it adds something only across chat, email and messengers.
- Slack-native decision log: Crowded niche with at least five small apps (only Scientia verified), still at pilot stage. Suggests weak or unproven demand, not an open field.
- V6 'same concepts at every scale' as a value proposition: Notion already covers private, team and public in one tool. No evidence found that users seek this for its own sake. Treat it as a design principle, not a selling point.
- Solo 'think out loud and keep what matters' (the Anna case) as a first market: Crowded with personal notetakers and PKM tools (not checked individually). No evidence of an unmet need, and a solo user never tests the audience line, as OUTCOMES.md itself notes.
