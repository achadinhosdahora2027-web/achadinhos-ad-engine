#!/bin/sh
# Nexus v3005.0 — fail-closed deployment of nexus-edge-ingest-v3000.
#
# Required:
#   SUPABASE_ACCESS_TOKEN          Management API token with all 13 projects
#   NEXUS_INGEST_HMAC              >=32 characters; must match master ingest
#   NEXUS_MASTER_URL               https://<master-ref>.supabase.co
#   NEXUS_MASTER_SERVICE_ROLE_KEY  server-side key used only as Edge secret
# Optional:
#   NEXUS_V3000_START_SECRET       defaults to NEXUS_INGEST_HMAC
#
# The script deploys nothing unless every configured satellite passes the
# Management API preflight. It never decrypts nexus_satellites_kms: that KMS
# protects webhook credentials, not Supabase account-management authorization.
set -eu

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"

FUNCTION_NAME="nexus-edge-ingest-v3000"
API="https://api.supabase.com/v1"
PROJECTS="
ayzpzuoyhgtfsbfreiap
xyzpfccmzvekfvcpqlke
gionwubuzicttggpclrg
kfuwmalepnctoykkkkgx
rdirplibrghfbazkieeo
gztiuddoiekytwwlpeyq
foxcedesytfhiqdtnlgg
lknnxwbezqmpkuxwxgur
ucviyoteadgwjnwecopw
duipcjiiytrfxzyktswk
tpoqmpjnffuvfoqqasqn
hodcyytojobguvbcevct
snkauzzqnzirngacoxiv
"

work=$(mktemp -d "${TMPDIR:-/tmp}/nexus-v3005.XXXXXX")
cleanup() { rm -rf "$work"; }
trap cleanup EXIT HUP INT TERM

missing=""
accessible=0
for ref in $PROJECTS; do
  code=$(curl -sS -o "$work/$ref.json" -w '%{http_code}' \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H 'Accept: application/json' "$API/projects/$ref" || printf '000')
  if [ "$code" = "200" ]; then
    accessible=$((accessible+1))
  else
    missing="$missing $ref:$code"
  fi
done

printf 'preflight configured=13 accessible=%s\n' "$accessible"
if [ "$accessible" -ne 13 ]; then
  printf 'refusing partial deployment; inaccessible projects:%s\n' "$missing" >&2
  exit 42
fi

: "${NEXUS_INGEST_HMAC:?NEXUS_INGEST_HMAC is required after access preflight}"
: "${NEXUS_MASTER_URL:?NEXUS_MASTER_URL is required after access preflight}"
: "${NEXUS_MASTER_SERVICE_ROLE_KEY:?NEXUS_MASTER_SERVICE_ROLE_KEY is required after access preflight}"
[ "${#NEXUS_INGEST_HMAC}" -ge 32 ] || { echo 'NEXUS_INGEST_HMAC must be >=32 characters' >&2; exit 43; }
case "$NEXUS_MASTER_URL" in https://*.supabase.co|https://*.supabase.co/) ;; *) echo 'invalid NEXUS_MASTER_URL' >&2; exit 44;; esac
start_secret=${NEXUS_V3000_START_SECRET:-$NEXUS_INGEST_HMAC}

for ref in $PROJECTS; do
  printf 'configuring %s\n' "$ref"
  npx --yes supabase@latest secrets set --project-ref "$ref" \
    NEXUS_INGEST_HMAC="$NEXUS_INGEST_HMAC" \
    NEXUS_V3000_START_SECRET="$start_secret" \
    NEXUS_MASTER_URL="$NEXUS_MASTER_URL" \
    NEXUS_MASTER_SERVICE_ROLE_KEY="$NEXUS_MASTER_SERVICE_ROLE_KEY" >/dev/null

done

# Parallelize only after all projects have their server-side secrets.
pids=""
for ref in $PROJECTS; do
  (
    npx --yes supabase@latest functions deploy "$FUNCTION_NAME" \
      --project-ref "$ref" --use-api
  ) >"$work/$ref.deploy.log" 2>&1 &
  pids="$pids $!:${ref}"
done

failed=""
for item in $pids; do
  pid=${item%%:*}; ref=${item#*:}
  if ! wait "$pid"; then
    failed="$failed $ref"
    printf 'deploy failed: %s\n' "$ref" >&2
  else
    printf 'deploy accepted: %s\n' "$ref"
  fi
done
[ -z "$failed" ] || { printf 'deployment failures:%s\n' "$failed" >&2; exit 45; }

verified=0
for ref in $PROJECTS; do
  code=$(curl -sS -o "$work/$ref.functions.json" -w '%{http_code}' \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H 'Accept: application/json' "$API/projects/$ref/functions")
  if [ "$code" = "200" ] && python3 - "$work/$ref.functions.json" <<'PY'
import json,sys
rows=json.load(open(sys.argv[1]))
raise SystemExit(0 if any(x.get('slug')=='nexus-edge-ingest-v3000' and x.get('status')=='ACTIVE' for x in rows) else 1)
PY
  then
    verified=$((verified+1))
  else
    printf 'verification failed: %s HTTP %s\n' "$ref" "$code" >&2
  fi
done
printf 'deployment verification configured=13 active=%s\n' "$verified"
[ "$verified" -eq 13 ] || exit 46
