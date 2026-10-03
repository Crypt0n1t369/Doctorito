# Mission spine: PostgreSQL first-build slice

2 October 2026. This is a **synthetic implementation slice**, separate from the existing SQLite prototype. It implements a deterministic mission command boundary in JavaScript and a PostgreSQL schema. It is not a deployed service, a user interface, a pilot result or permission to process real private data.

The slice follows the [first-build contract](</Users/kristaps/Documents/ChatGPT/New project/output/mission-spine-first-build-contract-2026-10-02.md>) and [C1–C9 constraints](</Users/kristaps/Documents/New project/output/coordination-prototype/docs/CONSTRAINTS.md>). The full product still needs the simple Talk / Mission map / My trail experience and a real hosted run.

## What exists

- `sql/001_init.sql` defines mission, charter, mandate, plan, separated source metadata and erasable payload revisions, purpose/action/provider grants, issue, claim and reviewed relation, decision, work card, invitation, two-sided offer and commitment, resource account and reservation, result and independent finding, reporter receipt, context manifest, single-source public excerpt, lineage, audit, outbox and idempotency records.
- `src/tx.js` gives each command a serializable transaction, a non-owner role, scoped session context, idempotency check, minimal audit fact and outbox intent. A retry of the same logical command returns the same result. Stale plan versions raise `version_conflict` with the current version.
- `src/mission.js` implements the synthetic episode without calling a model: two separate reports, reviewed support/dispute edges, one human plan amendment, a bounded work invitation and two-sided commitment, a resource reservation, submitted and separately reviewed result, and a generic honest receipt for each reporter. A source holder can correct, withdraw or revoke a grant. Revocation immediately suppresses managed public excerpts and invalidates dependent work, results, receipts and context manifests.
- `test/postgres.test.js` is an explicit real-server acceptance harness. It checks simultaneous plan amendments and €80 reservations, recipient isolation, source lineage, idempotency, receipt access, private text absent from dedupe/audit/outbox, public excerpt revocation and stale propagation. It **skips** unless a dedicated test database is supplied.
- `test/embedded-smoke.mjs` replays the complete synthetic episode with PGlite in one connection. It checks sequential state transitions, several recipient boundaries, correction and revocation. **It does not prove server concurrency, deployment roles or crash recovery.**

## Trust boundary

The gateway must derive `mission` and `actor` from an authenticated channel or a private bearer receipt. It must never accept arbitrary `app.mission_id`, `app.principal_id` or `app.receipt_hash` values from a browser or tool caller. PostgreSQL custom session settings are settable by a trusted database role; RLS therefore adds defense in depth, not identity proof. The application login must be a member of `mission_spine_app` and must not own the tables. Clients never receive SQL access. The owner-only principal registry links channel identities only after verified control; a display name cannot create or merge identities. This slice seeds identities in the test harness and does not implement production authentication. Its synthetic `createMission` gives the verified founder initial mandates; **it does not verify that a founder may speak for a named workshop, company or public body**. Production mission activation needs a separately accepted host mandate and a proposed state before external invitations or public representation.

For an accountless first report, the trusted gateway calls `newBearerToken()` to generate **32 cryptographically random bytes**, returns the token once over TLS, and stores only its SHA-256 hash with the source. It must not log the token, put it in a URL, or reuse it for another source. The lower-level command API accepts the generated token as `meta.actor`. This is a private receipt and source-control capability, not a review or governance mandate. A bearer can read only that source's receipts and can correct, withdraw or revoke its grants. Lost bearer tokens cannot be recovered by guessing a display name.

The `source_grant` record separates `allow_read`, `allow_process`, `allow_publish` and `allow_train`, with named grantee, purpose, action and provider. The implemented context compiler accepts only `audience=reviewer`, `provider=none`, `modelVersion=none`; hosted processing is disabled. It stores IDs, revisions, grant checks and omissions in `context_manifest`, then reads text in a separate transaction that rechecks the manifest, plan, source revision and grants. Raw text is never put in `command_dedupe`, audit or outbox. The public read endpoint only reads a human-approved **verbatim excerpt of one source**; its public grant cannot expose the full original payload. Multi-source public briefs require complete dependency rights and are not implemented.

All commitments are explicit: a verified invited contributor accepts the fixed card terms, then a different verified human with a coordination mandate approves. Risk class 3 is rejected outright. There is no auto-commit path, model authority or credential inference. A future class-3 path needs verified qualifications, safety approval and a global automation-off switch before use.

Money remains with an external accountable custodian. `pledged_cents` is separate from `cleared_cents`; the database only records the custodian's clearing reference. The account row is locked before a reservation, so available funds equal cleared minus spent minus active reservations. The €600 pledge, €80 cleared reservation, €72 spend and €8 release in the fixture are **synthetic accounting facts**, not a payment or proof of external custody.

## Run the checks

The small unit checks use only built-in Node and need no install:

```sh
npm run test:unit
npm run test:pg
```

The second command reports one skipped test without `TEST_DATABASE_URL`. To rerun the embedded single-connection smoke test, install the declared development dependencies when disk space permits, then run `npm run test:embedded`. On 2 October 2026, that replay passed the full synthetic sequence, including a funded invitation held until a reservation exists, source correction, grant revocation, public suppression, private receipt isolation, stale-plan rejection, idempotent retry, and sequential overspend rejection. It used no real PostgreSQL server.

For the actual integration gate, use a **disposable real PostgreSQL database whose name contains `test`** and a migration owner login able to create `mission_spine_app` and `SET ROLE` to it. Install the declared `pg` driver only when disk space and a server are available, then run:

```sh
TEST_DATABASE_URL='postgres://.../mission_spine_test' \
TEST_DATABASE_RESET=YES_I_OWN_THIS_DATABASE npm run test:pg
```

The harness drops only the `mission_spine` schema in that dedicated test database. It does not run automatically against any other URL. A successful embedded PGlite or single-connection run is useful for SQL and flow checks but does not prove concurrent server transactions, non-owner deployment privileges, crash recovery or production isolation. The real-server harness is present but **has not run here** because no PostgreSQL server was available; `npm run test:pg` reported one skip.

## Still open before a real private pilot

1. **Real PostgreSQL verification:** run the harness with distinct owner and non-owner logins and add a connection-pool/transaction-failure campaign. The local machine had no PostgreSQL server and minimal free disk when this slice was written.
2. **Recipient isolation:** broaden counterfactual tests from direct SQL and public excerpt to every public packet, search view, cache, model call, export and worker route. RLS has not been verified against a real server. Security-definer functions and column grants need an independent privilege review.
3. **Deletion and retention:** withdrawal erases original `source_payload.body` and suppresses managed descendants, but derived human text in claims, plans, decisions, work cards and findings can remain. Erasure, legal retention and manifest expiry cleanup need a policy and implementation before real personal data.
4. **Outbox delivery:** commands write one intent transactionally; an external dispatcher, grant recheck at execution, acknowledgement protocol, `unknown_external_effect` handling and provider-side idempotency are not yet implemented. `available` means an internal intent exists, not that anyone was notified.
5. **Human work and host authority:** the schema records a named reviewer, mentor and card capacity, but does not measure their actual availability, verify qualifications, verify the founder's right to represent an organization, or repair live obligations after a pause. Invitations stop on an inactive reviewer, missing required reservation or paused mission; a steward still has to renegotiate affected commitments. A proposed/accepted mission activation gate is required before the avatar speaks publicly for a real host.
6. **Product and proof:** build the avatar interface and onboarding, recruit a named community host, run a facilitated outcome pilot, then a separate paid operations pilot. No adoption, impact, coordination-effort or willingness-to-pay result is claimed here.

The immediate engineering gate is the real PostgreSQL replay and privacy review. Only then should a gateway or avatar surface expose this command boundary to people.
