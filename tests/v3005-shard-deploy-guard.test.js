'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'tools/deploy_shards_v3000.sh'), 'utf8');
const EDGE = fs.readFileSync(path.join(ROOT, 'supabase/functions/nexus-edge-ingest-v3000/index.ts'), 'utf8');
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

console.log('v3005 shard deployment preflight tests: PASS');
