#!/usr/bin/env bash
# Concurrent-load check for a shared catalog asset (a global partner by default).
#
# Creates many runs at once that all bind the same global partner while the
# partner row is rewritten underneath them, then reports how many run creations
# succeeded. Use it to confirm that one shared asset serving many projects does
# not contend on the write side.
#
#   LF_COOKIE="agentflow_user=<token>" scripts/load-rw.sh [readers] [writes]
#
# Getting LF_COOKIE: sign in through the browser, then copy the cookie from
# devtools (Application → Cookies → agentflow_user). It is a session credential:
# pass it in the environment, never in a file that gets committed.
#
# The write side goes through MySQL rather than the HTTP API because editing a
# global partner is platform-admin only. It rewrites the same row the read path
# queries, which is what the check is about.
#
# Optional:
#   LOOPFORGE_WORKFLOW   workflow id to start (default: requires --workflow)
#   LOOPFORGE_PROJECT    project id for the run
#   LOOPFORGE_PARTNER    global partner id to thrash (default: all of them)
set -uo pipefail
cd "$(dirname "$0")/.."

readers="${1:-60}"
writes="${2:-30}"
workflow="${LOOPFORGE_WORKFLOW:-}"
project="${LOOPFORGE_PROJECT:-}"
partner="${LOOPFORGE_PARTNER:-}"
api="${LOOPFORGE_API:-http://127.0.0.1:8090}"

if [[ -z "${LF_COOKIE:-}" ]]; then
  echo "LF_COOKIE is required, e.g. LF_COOKIE='agentflow_user=<token>'" >&2
  echo "Sign in, then copy the agentflow_user cookie from devtools." >&2
  exit 2
fi
if [[ -z "$workflow" ]]; then
  echo "LOOPFORGE_WORKFLOW is required: a workflow whose nodes bind the partner." >&2
  exit 2
fi

# Database credentials come from .env, which is gitignored and already holds the
# compose stack's passwords.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
root_pw="${LOOPFORGE_DB_ROOT_PASSWORD:-}"
db_container="${LOOPFORGE_DB_CONTAINER:-loopforge-mysql-1}"
db_name="${LOOPFORGE_DB_NAME:-loopforge}"

if [[ -z "$root_pw" ]]; then
  echo "LOOPFORGE_DB_ROOT_PASSWORD is not set (expected in .env)." >&2
  exit 2
fi
if [[ -z "$partner" ]]; then
  partner=$(docker exec -i "$db_container" mysql -uroot -p"$root_pw" -N -e \
    "USE $db_name; SELECT id FROM global_partners LIMIT 1;" 2>/dev/null)
fi
if [[ -z "$partner" ]]; then
  echo "No global partner found. Create one first, or set LOOPFORGE_PARTNER." >&2
  exit 2
fi

echo "api=$api workflow=$workflow partner=$partner readers=$readers writes=$writes"

# Writers: rewrite the partner row repeatedly while readers create runs.
(
  for i in $(seq 1 "$writes"); do
    docker exec -i "$db_container" mysql -uroot -p"$root_pw" -e "
      USE $db_name;
      UPDATE global_partners
      SET payload = JSON_SET(payload, '\$.description', 'load edit $i')
      WHERE id = '$partner';" 2>/dev/null
  done
) &
writer_pid=$!

body_project=""
[[ -n "$project" ]] && body_project=",\"projectId\":\"$project\""

start=$(date +%s%N)
ok=0
fail=0
tmp=$(mktemp -d)
for i in $(seq 1 "$readers"); do
  code=$(curl -s -o "$tmp/$i.json" -w '%{http_code}' \
    -b "$LF_COOKIE" -X POST "$api/api/runs" \
    -H 'Content-Type: application/json' \
    -d "{\"workflowId\":\"$workflow\",\"input\":\"load $i\"$body_project}")
  if [[ "$code" == "201" ]]; then ok=$((ok + 1)); else fail=$((fail + 1)); fi
done
end=$(date +%s%N)

wait "$writer_pid" 2>/dev/null

echo "run create: ok=$ok fail=$fail elapsed=$(( (end - start) / 1000000 ))ms"
if (( fail > 0 )); then
  echo "sample failures:"
  grep -h error "$tmp"/*.json 2>/dev/null | sort | uniq -c | head -5
fi
rm -rf "$tmp"

# Fail loudly so the check can gate a script.
(( fail == 0 ))
