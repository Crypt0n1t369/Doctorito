#!/bin/bash
set -euo pipefail

current=/home/drg/projects/palidzi-current
new_release=/home/drg/projects/palidzi-releases/664b5e58bde2fe39287b806c5606eb573a78c1ae
old_release=/home/drg/projects/palidzi-releases/6636f6fae01bba5a4a9697c196638b7f0ee84ea9
new_sha=664b5e58bde2fe39287b806c5606eb573a78c1ae
old_sha=6636f6fae01bba5a4a9697c196638b7f0ee84ea9
to_old=/home/drg/projects/palidzi-current.to-old
to_new=/home/drg/projects/palidzi-current.to-new
restore_link=/home/drg/projects/palidzi-current.restore-new

wait_for_local_health() {
  for attempt in {1..30}; do
    if curl -fsS --max-time 3 http://127.0.0.1:4178/api/health >/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

switch_release() {
  local target=$1
  local temporary_link=$2
  test -d "$target"
  test ! -e "$temporary_link"
  test ! -L "$temporary_link"
  ln -s "$target" "$temporary_link"
  mv -T "$temporary_link" "$current"
  systemctl --user restart atbalsts-prototype.service
  wait_for_local_health
}

restore_new_on_error() {
  if [ "$(readlink "$current" 2>/dev/null || true)" != "$new_release" ]; then
    if [ ! -e "$restore_link" ] && [ ! -L "$restore_link" ]; then
      ln -s "$new_release" "$restore_link"
      mv -T "$restore_link" "$current"
    fi
    systemctl --user restart atbalsts-prototype.service || true
  fi
}

test "$(git -C "$new_release" rev-parse HEAD)" = "$new_sha"
test "$(git -C "$old_release" rev-parse HEAD)" = "$old_sha"
test "$(readlink "$current")" = "$new_release"
test ! -e "$to_old"
test ! -L "$to_old"
test ! -e "$to_new"
test ! -L "$to_new"
test ! -e "$restore_link"
test ! -L "$restore_link"

trap restore_new_on_error EXIT HUP INT TERM

switch_release "$old_release" "$to_old"
old_local=$(curl -fsS --max-time 10 http://127.0.0.1:4178/api/health)
old_public=$(curl -fsS --max-time 20 "https://atbalsts.sortium.co/api/health?rollback-test=old-$(date +%s)")
jq -e --arg expected "$old_sha" '.ok == true and .build == $expected' <<<"$old_local" >/dev/null
jq -e --arg expected "$old_sha" '.ok == true and .build == $expected' <<<"$old_public" >/dev/null
printf 'rollback_local=%s\n' "$(jq -c '{ok,build}' <<<"$old_local")"
printf 'rollback_public=%s\n' "$(jq -c '{ok,build}' <<<"$old_public")"

switch_release "$new_release" "$to_new"
new_local=$(curl -fsS --max-time 10 http://127.0.0.1:4178/api/health)
new_public=$(curl -fsS --max-time 20 "https://atbalsts.sortium.co/api/health?rollback-test=new-$(date +%s)")
jq -e --arg expected "$new_sha" '.ok == true and .build == $expected and (keys | sort) == ["build", "ok"]' <<<"$new_local" >/dev/null
jq -e --arg expected "$new_sha" '.ok == true and .build == $expected and (keys | sort) == ["build", "ok"]' <<<"$new_public" >/dev/null
printf 'restored_local=%s\n' "$(jq -c '{ok,build}' <<<"$new_local")"
printf 'restored_public=%s\n' "$(jq -c '{ok,build}' <<<"$new_public")"
printf 'active_release=%s\n' "$(readlink "$current")"

trap - EXIT HUP INT TERM
