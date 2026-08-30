# Operate tcpipe with OpenClaw

This folder is an OpenClaw workspace. It includes the standard root context files, a
`tcpipe-operations` workspace skill, a single guarded executable, and optional oversight
automations. OpenClaw does not need direct Python, SQLite, or filesystem-write access.

## 1. Install and verify tcpipe

From the extracted project folder:

```bash
./openclaw/setup-openclaw.sh
```

The script idempotently creates agent `tcpipe-ops`, points it at this workspace, loads its
identity, restricts host execution to `bin/tcpipe-agent`, denies direct file editing,
initializes `work/pilot.db` once, and runs preflight/readiness. Set
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

## 4. Enable live fetching only after G2

Networking ships disabled. After source/route policy reviews and robots snapshots are
recorded, configure an egress proxy in the OpenClaw Gateway environment:

```text
TCPIPE_PROXY=http://your-controlled-egress-proxy:3128
```

Then, as the human operator, change `ALLOW_NETWORK=0` to `ALLOW_NETWORK=1` in
`openclaw/agent-policy.conf`. Keep `REQUIRE_PROXY=1`. A proxy flag is not an enforcement
boundary; confine the worker at the network layer in production.

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

No live-fetch automation is installed while G2 is open. Once all five routes have real
fixtures and approved egress, schedule a bounded agent turn that checks
`due_fetchable_routes` and handles at most one route per invocation.

## Security model

- OpenClaw sees one allowlisted executable, not a general interpreter.
- The wrapper confines database/artifact paths to the workspace and blocks URL/rules/proxy
  overrides.
- Direct workspace edits are denied for this agent.
- Network, approval decisions and audit attestations have separate operator-owned gates.
- Source content is explicitly untrusted and cannot authorize actions.

