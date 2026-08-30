#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
AGENT_ID=${TCPIPE_OPENCLAW_AGENT_ID:-tcpipe-ops}
TIMEZONE=${TCPIPE_AUTOMATION_TZ:-Europe/Riga}
CHANNEL=${TCPIPE_AUTOMATION_CHANNEL:-}
TARGET=${TCPIPE_AUTOMATION_TO:-}

if ! command -v openclaw >/dev/null 2>&1; then
    echo "ERROR: openclaw is not installed or not on PATH" >&2
    exit 127
fi

delivery=(--no-deliver)
if [ -n "$CHANNEL" ] || [ -n "$TARGET" ]; then
    if [ -z "$CHANNEL" ] || [ -z "$TARGET" ]; then
        echo "ERROR: set both TCPIPE_AUTOMATION_CHANNEL and TCPIPE_AUTOMATION_TO" >&2
        exit 64
    fi
    delivery=(--announce --channel "$CHANNEL" --to "$TARGET")
fi

add_once() {
    local schedule=$1
    local name=$2
    local prompt=$3
    if openclaw automations list --all | grep -Fq "$name"; then
        echo "Automation already exists: $name"
        return
    fi
    openclaw automations create "$schedule" "$prompt" \
        --name "$name" --agent "$AGENT_ID" --session isolated --tz "$TIMEZONE" \
        "${delivery[@]}"
}

add_once "0 8 * * *" "tcpipe-daily-oversight" \
    "Use the tcpipe-operations skill. Run recover, readiness, status, failed jobs, and pending reviews. Do not fetch, attest audit results, or decide approvals. Report changes, blockers, and the next safe operator action."

add_once "0 9 * * 1" "tcpipe-weekly-integrity" \
    "Use the tcpipe-operations skill. Run preflight and exhaustive doctor, then readiness. Do not mutate policy or approvals. Report integrity failures immediately and otherwise give a compact weekly gate summary."

echo "Installed oversight automations for $AGENT_ID."
if [ "${delivery[0]}" = "--no-deliver" ]; then
    echo "Delivery is internal; inspect with: openclaw automations runs --id <job-id>"
fi
echo "No acquisition schedule was added; public routes may be fetched autonomously when instructed."
