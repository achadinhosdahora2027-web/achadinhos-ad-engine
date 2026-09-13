'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'tools/deploy_shards_v3000.sh'), 'utf8');
const EDGE = fs.readFileSync(path.join(ROOT, 'supabase/functions/nexus-edge-ingest-v3000/index.ts'), 'utf8');
const REACH = fs.readFileSync(path.join(ROOT, 'supabase/migrations/supabase_v3005_satellite_edge_reach.sql'), 'utf8');
const refs = [
  'ayzpzuoyhgtfsbfreiap','xyzpfccmzvekfvcpqlke','gionwubuzicttggpclrg',
  'kfuwmalepnctoykkkkgx','rdirplibrghfbazkieeo','gztiuddoiekytwwlpeyq',
  'foxcedesytfhiqdtnlgg','lknnxwbezqmpkuxwxgur','ucviyoteadgwjnwecopw',
  'duipcjiiytrfxzyktswk','tpoqmpjnffuvfoqqasqn','hodcyytojobguvbcevct',
  'snkauzzqnzirngacoxiv',
];
for (const ref of refs) assert.match(SCRIPT, new RegExp(ref));
assert.strictEqual(refs.length, 13);
assert.match(SCRIPT, /accessible.*-ne 13/);
assert.match(SCRIPT, /refusing partial deployment/);
assert.match(SCRIPT, /exit 42/);
assert.match(SCRIPT, /NEXUS_INGEST_HMAC is required after access preflight/);
assert.match(SCRIPT, /NEXUS_MASTER_URL is required after access preflight/);
assert.match(SCRIPT, /NEXUS_MASTER_SERVICE_ROLE_KEY is required after access preflight/);
assert.match(SCRIPT, /NEXUS_MANAGEMENT_TOKENS_FILE/);
assert.match(SCRIPT, /token_for_ref/);
assert.match(SCRIPT, /json\.load\(open\(sys\.argv\[1\]\)\)\[sys\.argv\[2\]\]/);
assert.match(SCRIPT, /SUPABASE_ACCESS_TOKEN="\$token" npx/);
assert.match(SCRIPT, /secret configuration failures/);
assert.match(SCRIPT, /secrets set --project-ref/);
assert.match(SCRIPT, /functions deploy "\$FUNCTION_NAME"/);
assert.match(SCRIPT, /deployment verification configured=13 active=/);
assert.doesNotMatch(SCRIPT, /git\s+push\s+--force|--no-verify-jwt/);
assert.doesNotMatch(SCRIPT, /pgp_sym_decrypt|nexus_satellites_kms.*(?:select|update|insert)/i,
  'account-management tokens must not be derived from the webhook KMS');

assert.match(EDGE, /Deno\.env\.get\("NEXUS_MASTER_URL"\)/);
assert.match(EDGE, /Deno\.env\.get\("NEXUS_MASTER_SERVICE_ROLE_KEY"\)/);
assert.match(EDGE, /permanent_24x7_claimed:false/);
assert.match(EDGE, /EdgeRuntime\.waitUntil\(activeSession\)/);
for (const event of ['session_start','automaton_loaded','socket_open','socket_close','session_complete']) {
  assert.match(EDGE, new RegExp(`event:\"${event}\"`));
}
assert.doesNotMatch(EDGE, /console\.log\([^\n]*(?:MASTER_KEY|INGEST_HMAC|START_SECRET)/);

assert.match(REACH, /capability = 'satellite_edge_deploy_13'/);
assert.match(REACH, /'alcances_verificados', '13\/13'/);
assert.match(REACH, /'websocket_open_projects', 13/);
assert.match(REACH, /'all_three_websockets_open_projects', 12/);
assert.match(REACH, /'permanent_24x7_claimed', false/);
assert.match(REACH, /'project_ref', 'duipcjiiytrfxzyktswk'/);
assert.match(REACH, /'state', 'reconnecting_with_backoff'/);

console.log('v3005 shard deployment preflight tests: PASS');
