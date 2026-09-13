#!/bin/bash
set -euo pipefail

expected=664b5e58bde2fe39287b806c5606eb573a78c1ae
app=atbalsts-prototype.service
tunnel=sortium-openclaw-gateway-tunnel.service

app_before=$(systemctl --user show "$app" -p MainPID --value)
systemctl --user kill --kill-whom=all --signal=SIGKILL "$app"
app_after=0

for attempt in {1..30}; do
  app_after=$(systemctl --user show "$app" -p MainPID --value)
  if [ "$app_after" != "0" ] && [ "$app_after" != "$app_before" ] && [ "$(systemctl --user is-active "$app")" = active ]; then
    if curl -fsS --max-time 3 http://127.0.0.1:4178/api/health | jq -e --arg expected "$expected" '.build == $expected' >/dev/null; then
      break
    fi
  fi
  sleep 1
done

test "$app_after" != "$app_before"
test "$(systemctl --user is-active "$app")" = active
printf 'app_restart=%s->%s active\n' "$app_before" "$app_after"

tunnel_before=$(systemctl --user show "$tunnel" -p MainPID --value)
systemctl --user kill --kill-whom=all --signal=SIGKILL "$tunnel"
tunnel_after=0

for attempt in {1..45}; do
  tunnel_after=$(systemctl --user show "$tunnel" -p MainPID --value)
  if [ "$tunnel_after" != "0" ] && [ "$tunnel_after" != "$tunnel_before" ] && [ "$(systemctl --user is-active "$tunnel")" = active ]; then
    if curl -fsS --max-time 4 "https://atbalsts.sortium.co/api/health?restart-test=$(date +%s)" | jq -e --arg expected "$expected" '.build == $expected' >/dev/null; then
      break
    fi
  fi
  sleep 1
done

test "$tunnel_after" != "$tunnel_before"
test "$(systemctl --user is-active "$tunnel")" = active
curl -fsS --max-time 10 "https://atbalsts.sortium.co/api/health?restart-test=final-$(date +%s)" \
  | jq -e --arg expected "$expected" '.ok == true and .build == $expected and (keys | sort) == ["build", "ok"]' >/dev/null
printf 'tunnel_restart=%s->%s active\n' "$tunnel_before" "$tunnel_after"

systemctl --user show "$app" -p Restart -p UnitFileState -p ActiveState -p SubState
systemctl --user show "$tunnel" -p Restart -p UnitFileState -p ActiveState -p SubState
loginctl show-user drg -p Linger
