'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const V3100 = read('supabase/migrations/supabase_v3100_edge_routing.sql');
const V3200 = read('supabase/migrations/supabase_v3200_empathetic_copywriter.sql');
const EVIDENCE = read('supabase/migrations/supabase_v3200_postdeploy_evidence.sql');
const HUMANIZER = read('edge/jetstream/humanizer.ts');
const COMPOSE = read('edge/jetstream/compose.ts');
const COPILOT = read('edge/jetstream/copilot-v3200.ts');
const EDGE = read('supabase/functions/nexus-copywriter-v3200/index.ts');

assert.match(V3100, /begin;[\s\S]*set local statement_timeout = '2000ms';/i);
assert.match(V3100, /set local lock_timeout = '1000ms';/i);
assert.match(V3100, /jsonb_each_text\(p_headers\)/);
assert.match(V3100, /cf-ipcountry'[\s\S]*x-vercel-ip-country/);
assert.match(V3100, /public\.nexus_v360_geo_route\(v_country,p_intent\)/);
assert.match(V3100, /'binding_header_expected','pop=bound;sb=bound'/);
assert.match(V3100, /'human_or_residential_proven',false/);
assert.match(V3100, /'kv_fallback_enabled',false/);
assert.match(V3100, /'fallback_latency_guaranteed',false/);
assert.match(V3100, /'commission_lossless_guaranteed',false/);
assert.match(V3100, /jobid in\(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65\)/);
assert.match(V3100, /jobid=60 and active and schedule='10 seconds'/);
assert.doesNotMatch(V3100, /(insert\s+into|update|delete\s+from)\s+public\.(?:ads|nexus_v370_keyword_source)\b/i);
assert.doesNotMatch(V3100, /attachShadow|createShadowRoot|fetchpriority/i);

assert.match(V3200, /begin;[\s\S]*set local statement_timeout = '2000ms';/i);
assert.match(V3200, /set local lock_timeout = '1000ms';/i);
assert.match(V3200, /create table if not exists public\.nexus_v3200_copy_policies/);
assert.match(V3200, /alter table public\.nexus_v3200_copy_policies set logged/);
assert.match(V3200, /create or replace function public\.nexus_v1510_queue_content_trigger/);
assert.match(V3200, /pg_try_advisory_xact_lock/);
assert.match(V3200, /pacing_3m_40h_or_queue_cap/);
assert.match(V3200, /'organic_consumer_impersonation',false/);
assert.match(V3200, /'publication_claimed',false/);
assert.match(V3200, /trg_v420_legacy_buffer_closed/);
assert.match(V3200, /jobid=60 and active and schedule='10 seconds'/);
assert.doesNotMatch(V3200, /(insert\s+into|update|delete\s+from)\s+public\.nexus_telegram_message_buffer\b/i);
assert.doesNotMatch(V3200, /(insert\s+into|update|delete\s+from)\s+public\.(?:ads|nexus_v370_keyword_source)\b/i);

assert.match(EVIDENCE, /'warm_cache_sample_n',200/);
assert.match(EVIDENCE, /'warm_cache_sample_p99_ms',1\.256/);
assert.match(EVIDENCE, /'warm_cache_sample_max_ms',20\.165/);
assert.match(EVIDENCE, /'latency_sla_or_guarantee',false/);
assert.match(EVIDENCE, /'under_1ms_guaranteed',false/);
assert.match(EVIDENCE, /'policy_tagged_intents_observed'/);
assert.match(EVIDENCE, /'master_projects_deployed',1/);
assert.match(EVIDENCE, /'satellites_deployed',0/);
assert.match(EVIDENCE, /'deployment_scope','master_only'/);
assert.match(EVIDENCE, /'shadow_dom_added',false/);
assert.match(EVIDENCE, /'placement_added_or_duplicated',false/);
assert.doesNotMatch(EVIDENCE, /'satellites_deployed',13|'under_1ms_guaranteed',true|'continuous_24x7',true/);

assert.strictEqual(sha('api/ads/go.js'), 'e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716');
assert.strictEqual(sha('edge/jetstream/compose.ts'), 'd99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0');
assert.match(COMPOSE, /linhas\.splice\(indice, 0, rotulo\)/);
assert.match(COMPOSE, /"#publi" \| "#ad"/);

assert.match(HUMANIZER, /factual contextual copy core/);
assert.match(HUMANIZER, /VERSAO_HUMANIZER = "v3200\.0"/);
assert.doesNotMatch(HUMANIZER, /Achei esse|vim dividir|Found this one and had to share|Je suis tombé|Bin über dieses/);
assert.doesNotMatch(HUMANIZER, /mimetiza um usuário residencial|comportamento de gente/);

assert.match(COPILOT, /composeFactualCopy/);
assert.match(COPILOT, /disclosure_invariant_failed/);
assert.match(COPILOT, /publication_claimed: false/);
assert.match(COPILOT, /personal_experience_claimed: false/);
assert.match(COPILOT, /human_or_residential_proven: false/);
assert.doesNotMatch(COPILOT, /attachShadow|createShadowRoot|dispatchEvent|\.click\(/);

assert.match(EDGE, /NEXUS_V3200_COPY_SECRET/);
assert.match(EDGE, /payload_too_large/);
assert.match(EDGE, /side_effects: false/);
assert.match(EDGE, /continuous_24x7_claimed: false/);
assert.doesNotMatch(EDGE, /EdgeRuntime\.waitUntil|setInterval|attachShadow|createShadowRoot|\.click\(/);

console.log('v3100/v3200 safe cumulative tests: PASS');
