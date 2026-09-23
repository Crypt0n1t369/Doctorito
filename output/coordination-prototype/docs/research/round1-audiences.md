# Round 1 research: audiences

23 September 2026. Hypotheses: VALUE-HYPOTHESES.md in this folder. Source kinds: docs / independent / marketing; pain strength: data / practitioner / anecdote / vendor. Raw agent output, not edited.

## V2 — partly_served
GAP: No checked tool lets an ordinary member mark one item 'never to AI provider X' or send different audiences to different model providers. Microsoft and Google offer this only as admin-set labels or IRM rules, and only for their own assistant. Notion documents no per-page or per-provider control, so a small team's only switch is turning AI off completely. The 'mix private, team and public in one place' part is already met by Notion. None of V2 is built in the prototype. The prototype itself sends every incoming message to a hosted judgment API, so any guarantee would have to cover that too.
  - [docs] Microsoft Purview DLP for Microsoft 365 Copilot: An admin can stop Copilot using files and emails that carry chosen sensitivity labels. Limits: those items still show up in citations, calendar invites are not covered, email only from 1 Jan 2025, files uploaded into a prompt are not scanned, and a policy change can take up to 4 hours. It controls only Microsoft's own Copilot. <https://learn.microsoft.com/en-us/purview/dlp-microsoft365-copilot-location-learn-about>
  - [docs] Google Workspace with Gemini: Gemini only retrieves what the user can already access. It will not retrieve files locked by IRM rules (download, print or copy blocked), and it cannot see client-side-encrypted content. Admins can switch Gemini off app by app. The page does not mention an EU processing region. <https://knowledge.workspace.google.com/admin/generative-ai/generative-ai-in-google-workspace-privacy-hub>
  - [docs] Notion (sharing): One workspace already mixes a Private section, teamspace and people-level sharing, and public web or Notion Sites publishing. <https://www.notion.com/help/sharing-and-permissions>
  - [docs] Notion AI: Uses models from Anthropic and OpenAI, plus models Notion hosts itself. Zero data retention only on Enterprise; on other plans the model providers keep data for up to 30 days. Notion documents no way to exclude a page, teamspace or database from AI, and no way to choose which provider sees which content. <https://www.notion.com/help/notion-ai-security-practices>
  - [docs] Atlassian data security policies (Confluence/Jira): The rules cover export, public links, anonymous access, apps, and a separate rule that blocks external AI agents via the Rovo MCP server. The rules page lists no rule that blocks Atlassian's own AI assistant, Rovo, from classified content. <https://support.atlassian.com/security-and-access-policies/docs/manage-data-security-policy-rules/>
  - [marketing] Atlassian Guard Premium (Rovo Chat security): Says it blocks or redacts sensitive data in Rovo prompts and responses and scans connector data before ingestion. The tier is Premium. This is a marketing claim; no docs page was checked. <https://www.atlassian.com/blog/rovo/ai-governance-built-in>
  PAIN:
  * [data] In a Gartner survey (June 2024, 132 IT leaders), 40% delayed their Copilot rollout by 3+ months over oversharing, and 64% said governance and security risks took significant time and resources. The problem is AI surfacing badly-permissioned content to people. Microsoft's label-based controls now address it for large organisations. <https://www.computerworld.com/article/3542000/microsoft-365-copilot-rollouts-slowed-by-data-security-roi-concerns.html>
  * [practitioner] The Dutch government and SURF privacy impact assessment (DPIA) of M365 Copilot first found 4 high risks. By Oct 2025 those were mitigated to 2 medium ones (complaints about inaccurate data; retention of diagnostic data). Municipalities may use Copilot if they adopt an AI usage policy. The public-sector concern is settled at the provider and contract level, not per item. <https://gce.scgemeenten.nl/nieuws/herziene-dpia-microsoft-365-copilot/>
  * [vendor] Microsoft's own worked example of the label control is keeping GDPR and 'Personal' items out of Copilot summaries, which suggests enterprise customers ask for this. <https://learn.microsoft.com/en-us/purview/dlp-microsoft365-copilot-location-learn-about>
  * [anecdote] No evidence found that small teams, NGOs or individuals are asking for per-item AI exclusion or per-provider routing. No evidence found that users want private, team and public mixed in one tool rather than separate tools (one search, no forum threads found). <https://www.notion.com/help/sharing-and-permissions>

## APPLICATIONS

- Mark a single page or item 'never sent to any AI' in a shared small-team workspace, while AI stays on for team and public items [low] (V2)
  WHO: Coordinator of a 3-10 person EU NGO (e.g. refugee or shelter support) keeping case notes next to project plans and public updates
  TODAY: Notion or Google Workspace Business with AI switched off entirely, or case data kept in a separate spreadsheet or tool
  SHORT: Notion documents no per-page AI exclusion or provider choice, and non-Enterprise plans let model providers keep data for up to 30 days. Microsoft and Google exclusion needs admin-set labels or IRM rules
  VALUE: They could use AI on non-sensitive work without moving case notes to another tool. Unproven: no evidence found that this group asks for it

- Choose which model provider each audience's content may reach (e.g. EU-hosted model for resident data, any model for public project updates), with a per-item log [low] (V2, V4)
  WHO: Municipal project or participatory-budget officer in an EU municipality whose privacy assessment covers one AI provider only
  TODAY: M365 Copilot under the Dutch government's assessment conditions (an AI usage policy) plus Purview labels, or no AI
  SHORT: Label exclusion covers only Microsoft's Copilot. Excluded items still appear in citations, uploaded files are not scanned, and policy changes lag up to 4 hours. There is no multi-provider routing
  VALUE: Modest. The main blockers are settled at contract and assessment level, which incumbents already pass

- A stated, checkable promise to volunteers about where their free-text offers go (which AI service, what retention) in the product's own intake [low] (V2, V3)
  WHO: Volunteer coordinator of a town clean-up taking offers by Telegram or email from residents
  TODAY: Forms or group chats, with no statement about AI processing
  SHORT: The prototype itself sends every message to a hosted judgment API. V2 is not built, so today the product cannot make this promise either
  VALUE: A trust and compliance requirement for V3 rather than something people buy on its own

## NOT WORTH IT
- 'One space that mixes private, team and public' as the headline: Notion already does it in one workspace (Private section, teamspaces, public web publishing). No evidence found that users ask for more
- Per-item AI exclusion for organisations on Microsoft 365 or Google Workspace: Purview DLP blocks labelled files and emails from Copilot. Gemini skips IRM-restricted and client-side-encrypted files and respects existing permissions. The Gartner oversharing pain is being addressed by these controls
- 'Never reaches a US AI provider' as a feature sold to public bodies: The Dutch Copilot assessment shows public bodies decide this per provider and contract, with an AI usage policy, not per item. Per-item routing does not remove the need for that assessment
- Competing on permission-aware retrieval: Google Gemini and Microsoft Copilot both say they retrieve only what the user can access. Glean and Slack were not checked
- Not checked (budget): Glean, Slack AI, Atlassian's docs on the Guard Premium tier, EU AI Act deployer duties, GDPR Art. 28 text, licensing for Copilot DLP and Gemini IRM, Latvian public-sector rules, EU-hosted or local alternatives (e.g. Nextcloud Assistant), user forums on private vs work notes
