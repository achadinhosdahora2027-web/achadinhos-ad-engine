#!/bin/sh
# Nexus v3005.0 — fail-closed deployment of nexus-edge-ingest-v3000.
#
# Required management authentication (choose one):
#   SUPABASE_ACCESS_TOKEN          one PAT with all 13 projects; or
#   NEXUS_MANAGEMENT_TOKENS_FILE   chmod-600 JSON object {"project_ref":"sbp_..."}
# Required runtime secrets:
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

if [ -n "${NEXUS_MANAGEMENT_TOKENS_FILE:-}" ]; then
  [ -r "$NEXUS_MANAGEMENT_TOKENS_FILE" ] || {
    echo 'NEXUS_MANAGEMENT_TOKENS_FILE must be a readable JSON file' >&2; exit 40;
  }
elif [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo 'SUPABASE_ACCESS_TOKEN or NEXUS_MANAGEMENT_TOKENS_FILE is required' >&2
  exit 40
fi

token_for_ref() {
  ref=$1
  if [ -n "${NEXUS_MANAGEMENT_TOKENS_FILE:-}" ]; then
    python3 - "$NEXUS_MANAGEMENT_TOKENS_FILE" "$ref" <<'PY'
import json,sys
try:
    value=json.load(open(sys.argv[1]))[sys.argv[2]]
except (OSError,KeyError,TypeError,ValueError,json.JSONDecodeError):
    raise SystemExit(1)
if not isinstance(value,str) or not value.startswith('sbp_') or len(value)<20:
    raise SystemExit(1)
sys.stdout.write(value)
PY
  else
    printf '%s' "$SUPABASE_ACCESS_TOKEN"
  fi
}

work=$(mktemp -d "${TMPDIR:-/tmp}/nexus-v3005.XXXXXX")
cleanup() { rm -rf "$work"; }
trap cleanup EXIT HUP INT TERM

missing=""
accessible=0
for ref in $PROJECTS; do
  if ! token=$(token_for_ref "$ref"); then
    missing="$missing $ref:no_token"
    continue
  fi
  code=$(curl -sS -o "$work/$ref.json" -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
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

secret_failures=""
for ref in $PROJECTS; do
  token=$(token_for_ref "$ref")
  printf 'configuring %s\n' "$ref"
  if ! SUPABASE_ACCESS_TOKEN="$token" npx --yes supabase@latest secrets set --project-ref "$ref" \
    NEXUS_INGEST_HMAC="$NEXUS_INGEST_HMAC" \
    NEXUS_V3000_START_SECRET="$start_secret" \
    NEXUS_MASTER_URL="$NEXUS_MASTER_URL" \
    NEXUS_MASTER_SERVICE_ROLE_KEY="$NEXUS_MASTER_SERVICE_ROLE_KEY" >/dev/null; then
    secret_failures="$secret_failures $ref"
    printf 'secret configuration failed: %s\n' "$ref" >&2
  fi
done
[ -z "$secret_failures" ] || { printf 'secret configuration failures:%s\n' "$secret_failures" >&2; exit 47; }

# Parallelize only after all projects have their server-side secrets.
pids=""
for ref in $PROJECTS; do
  token=$(token_for_ref "$ref")
  (
    SUPABASE_ACCESS_TOKEN="$token" npx --yes supabase@latest functions deploy "$FUNCTION_NAME" \
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
[ -z "$failed" ] || printf 'deployment command failures (reconciling through Management API):%s\n' "$failed" >&2

verified=0
for ref in $PROJECTS; do
  token=$(token_for_ref "$ref")
  code=$(curl -sS -o "$work/$ref.functions.json" -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
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
if [ "$verified" -ne 13 ]; then
  [ -z "$failed" ] || exit 45
  exit 46
fi
