'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(
  ROOT, 'supabase/migrations/supabase_v1550_outbox_logged_core.sql'), 'utf8');
const V1510 = fs.readFileSync(path.join(
  ROOT, 'supabase/migrations/supabase_v1510_hybrid_alignment.sql'), 'utf8');

assert.match(SQL, /create table if not exists public\.nexus_v1550_outbox_logged/i);
assert.doesNotMatch(SQL, /create\s+unlogged\s+table\s+if\s+not\s+exists\s+public\.nexus_v1550_outbox_logged/i);
assert.match(SQL, /create unique index if not exists idx_v1550_event_node_uniq\s+on public\.nexus_v1550_outbox_logged\(event_hash,node_ref\)/i);
assert.match(SQL, /on conflict\(event_hash,node_ref\) do nothing/i);
assert.match(SQL, /create table if not exists public\.nexus_v1550_delivery_receipts/i);
assert.match(SQL, /for update of q skip locked/i);
assert.match(SQL, /for update skip locked/i);
assert.match(SQL, /if v_http=201 then/i);
assert.match(SQL, /delete from public\.nexus_v1550_outbox_logged where outbox_id=r\.outbox_id/i);
assert.match(SQL, /10::bigint \* \(1::bigint <</i);
assert.match(SQL, /least\(3600::bigint/i);
assert.match(SQL, /perform set_config\('statement_timeout','1000',true\)/i);
assert.match(SQL, /perform set_config\('lock_timeout','500',true\)/i);
assert.match(SQL, /'X-Nexus-Idempotency-Key',r\.event_hash/i);
assert.match(SQL, /'durable_executor_provisioned',false/i);
assert.match(SQL, /'external_exactly_once_claimed',false/i);
assert.match(SQL, /cron\.alter_job\(15,active=>false\)/i);
assert.match(SQL, /cron\.alter_job\(16,active=>false\)/i);
assert.match(SQL, /cron\.alter_job\(64,active=>false\)/i);
assert.match(SQL, /cron\.alter_job\(60,\s*command=>'select public\.nexus_v1510_flush_event\(40\);',\s*active=>true\)/i);
assert.doesNotMatch(SQL, /cron\.schedule/i, 'v1550 must not create another cron job');
assert.doesNotMatch(SQL, /insert\s+into\s+public\.ads\b/i, 'ad catalog must remain read-only');
assert.doesNotMatch(SQL, /update\s+public\.ads\b/i, 'ad catalog must remain read-only');
assert.doesNotMatch(SQL, /delete\s+from\s+public\.ads\b/i, 'ad catalog must remain read-only');

assert.match(V1510,
  /grant execute on function public\.nexus_v1510_queue_content_trigger\(text,text,text\)\s+to service_role/i);
assert.doesNotMatch(V1510,
  /grant execute on function public\.nexus_v1510_queue_content_trigger\(text,text,text\)\s+to anon/i);

console.log('v1550 LOGGED outbox static tests: PASS');
