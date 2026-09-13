'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('../workers/traffic-core-v1510.js');

const ROOT = path.resolve(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/migrations/supabase_v1510_hybrid_alignment.sql'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'workers/traffic-core-v1510.js'), 'utf8');
const ORCHESTRATOR = fs.readFileSync(path.join(ROOT, 'scripts/orchestrator-run.sh'), 'utf8');
const COMPOSE = fs.readFileSync(path.join(ROOT, 'edge/jetstream/compose.ts'), 'utf8');

assert.strictEqual(core.EXPECTED_KEYWORDS, 17605);
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/shopee-offer-links.json'), 'utf8'));
assert.strictEqual(Object.keys(inventory.keywords).length, 17605, 'measured inventory must not be inflated');

const automaton = core.buildAutomaton([
  { keyword: 'smart tv', normalized: 'smart tv', offerHash: 'offer-tv' },
  { keyword: 'tv', normalized: 'tv', offerHash: 'offer-short' },
]);
assert.strictEqual(core.searchAutomaton(automaton, 'Comparando uma Smart TV hoje').offerHash, 'offer-tv');
assert.strictEqual(core.searchAutomaton(automaton, 'activity tracker'), null, 'substring without word boundary rejected');
assert.strictEqual(core.keywordEligible('10ml'), false);
assert.strictEqual(core.keywordEligible('usb 2.0'), true);
assert.strictEqual(core.keywordEligible('smart television'), true);

assert.strictEqual(core.classifyLikelyHuman({ actor: 'deal-bot', text: 'texto humano longo para teste seguro', langs: ['pt'] }).allowed, false);
assert.strictEqual(core.classifyLikelyHuman({ actor: 'did:plc:abc', text: 'buy cocaine now with a guaranteed discount', langs: ['en'] }).allowed, false);
assert.strictEqual(core.classifyLikelyHuman({ actor: 'did:plc:abc', text: 'I am discussing a wireless keyboard as a work of art.', langs: ['en'] }).allowed, false, 'non-commerce mention rejected');
assert.strictEqual(core.classifyLikelyHuman({ actor: 'did:plc:abc', text: 'I am comparing a wireless keyboard before buying one.', langs: [] }).allowed, false);
assert.strictEqual(core.classifyLikelyHuman({ actor: 'did:plc:abc', text: 'I am comparing a wireless keyboard before buying one.', langs: ['en'] }).allowed, true);

const fixture = {
  event_id: 'bluesky:did:plc:test:rkey', platform: 'bluesky', keyword: 'smart tv',
  offer_hash: 'offer-tv', content_sha256: 'a'.repeat(64), occurred_at_ms: 1789300000000,
};
const expectedMaterial = 'bluesky:did:plc:test:rkey|bluesky|smart tv|offer-tv|' + 'a'.repeat(64) + '|1789300000000';
assert.strictEqual(core.signingMaterial(fixture), expectedMaterial);
const secret = 'x'.repeat(43);
assert.strictEqual(core.signEvent(fixture, secret), crypto.createHmac('sha256', secret).update(expectedMaterial).digest('hex'));
assert.match(core.signContentTrigger(fixture.event_id, 'c2_channel', core.sha256(expectedMaterial), secret), /^[0-9a-f]{64}$/);

assert.match(SQL, /create unlogged table if not exists public\.nexus_v1510_ingress_buffer/i);
assert.match(SQL, /for update skip locked/i);
assert.match(SQL, /grant execute on function public\.nexus_v1510_ingest_event\(jsonb\) to anon,authenticated,service_role/i);
assert.match(SQL, /cron\.alter_job\(15,active:=false\)/i);
assert.match(SQL, /cron\.alter_job\(16,active:=false\)/i);
assert.match(SQL, /cron\.alter_job\(18,active:=false\)/i);
assert.match(SQL, /cron\.alter_job\(60,active:=false\)/i);
assert.match(SQL, /cron\.alter_job\(62,active:=false\)/i);
assert.match(SQL, /cron\.alter_job\(64,active:=false\)/i);
assert.match(SQL, /cron\.alter_job\(65,active:=false\)/i);
assert.match(SQL, /trg_v1510_click_source_flush/i);
assert.match(SQL, /trg_v1510_capture_source_flush/i);
assert.match(SQL, /trg_v1510_sales_source_flush/i);
assert.match(SQL, /trg_v1510_offer_source_flush/i);
assert.match(SQL, /nexus_v1510_immutability_guard/i);
assert.match(SQL, /pacing_3m_40h/i);
assert.doesNotMatch(SQL, /insert\s+into\s+public\.ads\b/i, 'catalog must stay read-only');
assert.doesNotMatch(SQL, /update\s+public\.ads\b/i, 'catalog must stay read-only');
assert.doesNotMatch(SQL, /delete\s+from\s+public\.ads\b/i, 'catalog must stay read-only');

assert.match(WORKER, /Promise\.allSettled\(/);
assert.match(WORKER, /verifyEvent\(note\)/);
assert.match(WORKER, /no residential-IP claim/);
assert.doesNotMatch(WORKER, /setInterval\s*\(/, 'no polling loop');
assert.match(ORCHESTRATOR, /telegram-brazil-deals-publisher\.js --dry/, 'push orchestrator must not materialize duplicate C2 offers');
assert.match(COMPOSE, /linhas\.splice\(indice, 0, rotulo\)/, 'disclosure remains on its own line before URL');

console.log('v1510 hybrid alignment static/unit tests: PASS');
