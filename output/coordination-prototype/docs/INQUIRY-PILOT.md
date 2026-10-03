# Local inquiry walkthrough

1 October 2026. This documents the new inquiry slice as a **single-operator local prototype**, not a live public service or completed pilot. Use public or sanitized material only. The comparison protocol and measures are in [EXPERIMENT.md](EXPERIMENT.md); the wider product direction is in [MISSION-PORTAL.md](MISSION-PORTAL.md).

## Run it

Use Node 22 or newer from this repository:

```bash
node --env-file-if-exists=.env --experimental-sqlite --no-warnings run.js
```

The server prints a coordinator sign-in link. Open it, then visit `/topics`. For repeatable local access, set `COORDINATOR_KEY` and `SESSION_SECRET` in `.env`. The current login is one shared coordinator key. All such sessions act under the same opaque `coordinator:local` principal, so separate people cannot be independently identified or assigned reviewer roles through this UI. Keep the server on a trusted local machine and do not treat the shared key as multi-organization authentication.

## Complete one episode

1. **Create a topic.** Give it a question and choose private or public visibility. A public topic remains invisible to anonymous visitors until a reviewed version is explicitly released. Its URL is opaque; the title and question live in deletable payload rows.
2. **Add sources.** Enter a publisher or origin, exact locator, and relevant passage or observation. A URL is optional for a local observation. Check public release only when the operator has authority to share that source. Source date and retrieval time are distinct. The source ID appears beside the saved source.
3. **Save an account.** Write a short current account, source-linked findings, uncertainty and useful next steps. Each finding requires at least one source ID. The editor can hold more than three findings; saving a draft does not publish it.
4. **Review the draft.** Inspect the source and uncertainty, enter a reason, and mark the draft reviewed. The current local operator can review their own work; this is not independent verification. Check the prominent working-account notice when comparing it with the released account.
5. **Release a selected version.** Only the topic owner can release a reviewed version. Every cited source and incorporated contribution must permit public release. An operator can view the exact released account through the “View the released account” link. New private drafts do not alter that public version.
6. **Receive contributions.** Anonymous visitors can submit a correction, observation or idea after a public release. The form states its target and public-release choice. Each submission receives a private bearer receipt; a contributor should keep that link. The contribution is not public merely because it was submitted.
7. **Review and respond.** The operator's review queue shows pending text, target, source IDs and release permission. Accepting creates a new reviewed account version, a disposition and a receipt together. Declining or asking for clarification records a reason. The contributor sees the reason on their receipt; there is no email or Telegram delivery worker for these receipts. A clarification is a new linked submission, with its own receipt.
8. **Handle consent and correction.** A contributor can grant or revoke public use from their receipt, and can withdraw submitted text. Revocation or withdrawal immediately hides a dependent public release from anonymous reads. To recover after withdrawal, the operator edits the account to remove the withdrawn input, selects its contribution ID under “Repair contribution lineage,” records a reason, reviews the corrected draft and publishes the new version. A source's public-release choice can also be changed in the operator view.

The receipt distinguishes made available from delivered or acknowledged. It currently reports the first and leaves the latter two unset. A public version is a selected reviewed snapshot, not an automatic summary of the latest private work.

## What this proves and does not prove

Focused tests cover public/private version isolation, retry deduplication, authority, consent, withdrawal, lineage repair, event replay and atomic review/receipt writes. Run them with:

```bash
node --experimental-sqlite --no-warnings --test test/inquiry*.test.js
```

The local UI still lacks separate human operator identities, a versioned change to the topic question, general goal/work-package/dependency records, opportunity discovery, agent clustering or freshness jobs. It has no completed external pilot or demonstrated reduction in coordination time. The existing matcher has separate Gate 0 questions, including a hard concurrent model-budget cap and end-to-end command recovery. The inquiry payload table supports logical deletion and SQLite `secure_delete`; this does not establish erasure from WAL files, storage snapshots, backups or copies already made. Do not enter real private participant material until the relevant boundaries and deletion operations are verified.
