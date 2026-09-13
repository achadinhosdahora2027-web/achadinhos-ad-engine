'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(
  ROOT, 'supabase/migrations/supabase_v1555_remote_metadata_sync.sql'), 'utf8');
const PUSH = fs.readFileSync(path.join(ROOT, 'tools/update_github_env.sh'), 'utf8');

for (const [id, name] of [
  [60, 'v360-tg-flush-10s'],
  [61, 'v365-yield-hourly'],
  [62, 'v365-yield-consume-2min'],
  [63, 'v380-embed-cycle-2min'],
]) {
  assert.match(SQL, new RegExp(`\\(${id},'${name}'\\)`));
  assert.match(SQL, new RegExp(`cron\\.alter_job\\(${id},[\\s\\S]*?active=>true\\)`, 'i'));
}
assert.match(SQL, /cron\.alter_job\(60,[\s\S]*?nexus_v1510_flush_event\(40\)/i);
assert.match(SQL, /cron\.alter_job\(61,[\s\S]*?nexus_v365_yield_sync\(7\)/i);
assert.match(SQL, /cron\.alter_job\(62,[\s\S]*?nexus_v365_yield_consume\(\)/i);
assert.match(SQL, /cron\.alter_job\(63,[\s\S]*?nexus_v380_cycle\(8, 10\)/i);
for (const id of [15, 16, 64]) {
  assert.match(SQL, new RegExp(`cron\\.alter_job\\(${id},active=>false\\)`, 'i'));
}
assert.match(SQL, /revoke all on function public\.nexus_v365_yield_sync/i);
assert.match(SQL, /from public, anon, authenticated, service_role/i);
assert.doesNotMatch(SQL, /cron\.schedule/i, 'existing cron identifiers must not be recreated');
assert.doesNotMatch(SQL, /nexus_v1550_drain\s*\(/i, 'v1555 must not fabricate a durable retry executor');
assert.doesNotMatch(SQL, /(?:insert\s+into|update|delete\s+from)\s+public\.ads\b/i,
  'active-ad catalog must remain read-only');

assert.match(PUSH, /: "\$\{GITHUB_PAT:\?GITHUB_PAT is required\}"/);
assert.match(PUSH, /git merge-base --is-ancestor/);
assert.match(PUSH, /refusing non-fast-forward publication/);
assert.doesNotMatch(PUSH, /git\s+push\s+--force/i);
assert.doesNotMatch(PUSH, /nexus_satellites_kms.*(?:insert|update)/i);

console.log('v1555 remote metadata/cron static tests: PASS');
