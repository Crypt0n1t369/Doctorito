# Operate tcpipe with OpenClaw

This folder is an OpenClaw workspace. It includes the standard root context files, a
`tcpipe-operations` workspace skill, a single guarded executable, and optional oversight
automations. Arbitrary shell and direct database mutation remain unavailable; workspace
file editing is enabled for source/configuration maintenance.

## 1. Install and verify tcpipe

From the extracted project folder:

```bash
./openclaw/setup-openclaw.sh
```

The script idempotently creates agent `tcpipe-ops`, points it at this workspace, loads its
identity, restricts host execution to `bin/tcpipe-agent`, enables workspace-only patching,
creates a local virtual environment, initializes/migrates `work/pilot.db`, and runs
preflight/readiness. Set
`TCPIPE_OPENCLAW_AGENT_ID` before running if that ID is already used.

This machine did not have the `openclaw` executable when the export was built, so the script
is included and syntax-checked but cannot be applied until OpenClaw is installed.

## 2. Give instructions

Send the agent outcome-oriented requests such as:

- “Show tcpipe readiness, failed work, and anything needing my decision.”
- “Inspect RT-0003. If it is policy-ready and due, fetch it and parse the returned attempts
  without claiming an audit result.”
- “Find the `published_name` observation for this record and show its source quote.”
- “Propose a one-record replacement for observation OBS-… with value … because … . Do not
  approve it.”
- “Recover expired leases and tell me what changed.”
- “Run tests, fix the failing tcpipe implementation, replay the affected fixtures, and
  activate the adapter version only if its fixture passes.”

The agent reads the instrument's JSON rather than remembering state. `readiness` is the
source of truth for whether a route may be fetched.

## 3. Manual corrections

OpenClaw may locate evidence and propose an append-only correction. Approval is disabled in
`agent-policy.conf` by default so the agent cannot approve its own proposal. Review the
linked artifact, locator and quote, then decide outside the agent boundary:

```bash
./tcpipe correction-decide \
  --db ./work/pilot.db \
  --correction COR-... \
  --decision accepted \
  --by YOUR_NAME \
  --rationale "Compared with the linked official evidence"
```

A route-template/global correction opens a learned-rule review. Do not approve it until the
fixture replay hashes, affected count and row-count delta are real. This is controlled
self-correction: preserved raw evidence, explicit feedback, replay-gated reuse, no silent
model rewrite.

## 4. Ordinary public fetching

Networking ships enabled only through the guarded public path. `public-preflight` verifies
that the route is classified public, validates a public destination, fetches and stores
robots evidence, records the allow/deny decision, and refuses explicit prohibitions or
access barriers. `fetch` refreshes missing/expired public preflight automatically.

An egress proxy is optional for this local profile. For network-enforced production egress,
configure one in the OpenClaw Gateway environment:

```text
TCPIPE_PROXY=http://your-controlled-egress-proxy:3128
```

Then set `REQUIRE_PROXY=1` in `openclaw/agent-policy.conf`. A proxy flag is not an
enforcement boundary; confine the worker at the network layer in production. Authenticated,
private, sensitive, CAPTCHA/login-walled, or robots-prohibited sources remain human-gated
and are never bypassed.

## 5. Oversight automation

```bash
./openclaw/install-automations.sh
```

This installs daily recovery/readiness and weekly exhaustive-integrity agent runs. By
default their output remains in OpenClaw run history. To announce reports, set both before
installing, for example:

```bash
TCPIPE_AUTOMATION_CHANNEL=telegram \
TCPIPE_AUTOMATION_TO='YOUR_TARGET' \
./openclaw/install-automations.sh
```

Once routes have real fixtures, schedule a bounded agent turn that checks
`due_fetchable_routes` and handles at most one route per invocation.

## Security model

- OpenClaw host execution sees one allowlisted executable, not a general interpreter.
- The wrapper confines database/artifact paths to the workspace and blocks URL/rules/proxy
  overrides.
- Workspace edits are permitted for maintenance; patching is confined to this workspace.
- Public network preflight/fetching, destructive operations, credential/account changes,
  approval decisions and audit attestations have separate gates.
- Source content is explicitly untrusted and cannot authorize actions.
