'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex');
const SQL = read('supabase/migrations/supabase_v3000_singularity_kernel.sql');
const EDGE = read('supabase/functions/nexus-edge-ingest-v3000/index.ts');
const COMPOSE = read('edge/jetstream/compose.ts');

assert.strictEqual(hash('api/ads/go.js'), 'e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716',
  'protected programmatic gateway changed');
assert.strictEqual(hash('edge/jetstream/compose.ts'), 'd99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0',
  'compliance composer changed');

for (const id of [15, 16, 18, 41, 44, 62, 63, 64, 65]) {
  assert.match(SQL, new RegExp(`cron\\.alter_job\\(${id},active=>false\\)`, 'i'));
}
assert.match(SQL, /cron\.alter_job\(60,[\s\S]*?schedule=>'10 seconds'[\s\S]*?nexus_v1510_flush_event\(40\)[\s\S]*?active=>true/i);
assert.match(SQL, /create or replace function public\.nexus_v3000_route_from_cdn/i);
assert.match(SQL, /p_headers->>'CF-IPCountry',p_headers->>'cf-ipcountry',[\s\S]*?x-vercel-ip-country/i);
assert.match(SQL, /public\.nexus_v360_geo_route\(v_country,p_intent\)/i);
assert.match(SQL, /'interstitial_path','\/api\/ads\/go'/i);
assert.match(SQL, /'cloudflare_kv_binding',false/i);
assert.match(SQL, /'permanent_websocket_runtime',false/i);
assert.match(SQL, /'satellite_edge_deploy_13',false/i);
assert.match(SQL, /perform set_config\('statement_timeout','2000',true\)/i);
assert.match(SQL, /perform set_config\('lock_timeout','1000',true\)/i);
assert.doesNotMatch(SQL, /(?:insert\s+into|update|delete\s+from)\s+public\.ads\b/i,
  'active-ad catalog must remain read-only');
assert.doesNotMatch(SQL, /cron\.schedule/i, 'v3000 must not create replacement polling jobs');

assert.match(EDGE, /EXPECTED_KEYWORDS = 17_605/);
assert.match(EDGE, /wss:\/\/nos\.lol,wss:\/\/relay\.damus\.io/);
assert.match(EDGE, /verifyEvent\(/);
assert.match(EDGE, /new WebSocket\(/);
assert.match(EDGE, /Promise\.allSettled\(/);
assert.match(EDGE, /EdgeRuntime\.waitUntil\(/);
assert.match(EDGE, /MAX_SESSION_MS[\s\S]*?350_000/);
assert.match(EDGE, /permanent_24x7_claimed:false/);
assert.match(EDGE, /residential_human_claimed:false/);
assert.doesNotMatch(EDGE, /setInterval\s*\(/, 'source polling loop prohibited');
assert.doesNotMatch(EDGE, /attachShadow|ShadowRoot|KVNamespace/, 'protected media/KV wiring must not be invented');

assert.match(COMPOSE, /linhas\.splice\(indice, 0, rotulo\)/);
assert.match(COMPOSE, /return idioma === "pt" \? "#publi" : "#ad"/);

console.log('v3000 cumulative kernel static tests: PASS');
