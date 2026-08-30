#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
AGENT_ID=${TCPIPE_OPENCLAW_AGENT_ID:-tcpipe-ops}

if ! command -v openclaw >/dev/null 2>&1; then
    echo "ERROR: openclaw is not installed or not on PATH." >&2
    echo "Install OpenClaw, then rerun: $ROOT/openclaw/setup-openclaw.sh" >&2
    exit 127
fi

if openclaw agents list --json | AGENT_ID="$AGENT_ID" python3 -c '
import json, os, sys
data = json.load(sys.stdin)
target = os.environ["AGENT_ID"]
def found(value):
    if isinstance(value, dict):
        if value.get("id") == target or value.get("agentId") == target:
            return True
        return any(found(item) for item in value.values())
    if isinstance(value, list):
        return any(found(item) for item in value)
    return False
raise SystemExit(0 if found(data) else 1)
'; then
    echo "OpenClaw agent already exists: $AGENT_ID"
else
    openclaw agents add "$AGENT_ID" --workspace "$ROOT" --non-interactive
fi

openclaw agents set-identity --agent "$AGENT_ID" --from-identity

# The agent gets one executable, not a generic shell or writable workspace. The wrapper
# provides the finer action gates in agent-policy.conf.
openclaw config set "agents.entries.${AGENT_ID}.tools.exec.mode" allowlist
openclaw config set "agents.entries.${AGENT_ID}.tools.exec.strictInlineEval" true
openclaw config set "agents.entries.${AGENT_ID}.tools.deny" \
    '["write","edit","apply_patch"]'
openclaw approvals allowlist add --agent "$AGENT_ID" "$ROOT/bin/tcpipe-agent"

if [ ! -f "$ROOT/work/pilot.db" ]; then
    "$ROOT/bin/tcpipe-agent" init
else
    echo "Keeping existing governed database: $ROOT/work/pilot.db"
fi
"$ROOT/bin/tcpipe-agent" preflight
"$ROOT/bin/tcpipe-agent" readiness

echo
echo "OpenClaw agent prepared: $AGENT_ID"
echo "Network remains disabled. Complete G2 and egress configuration before changing"
echo "ALLOW_NETWORK=1 in openclaw/agent-policy.conf."
echo "Optional oversight schedules: $ROOT/openclaw/install-automations.sh"

