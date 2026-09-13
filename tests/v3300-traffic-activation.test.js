'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');
const SQL = read('supabase/migrations/supabase_v3300_traffic_activation.sql');
const EVIDENCE = read('supabase/migrations/supabase_v3300_postdeploy_evidence.sql');
const EDGE = read('supabase/functions/nexus-copywriter-v3200/index.ts');
const HUMANIZER = read('edge/jetstream/humanizer.ts');
const COMPOSE = read('edge/jetstream/compose.ts');

assert.match(SQL, /^-- Nexus v3300\.0/);
assert.match(SQL, /begin;[\s\S]*set local statement_timeout = '2000ms';/i);
assert.match(SQL, /set local lock_timeout = '1000ms';/i);
assert.match(SQL, /where policy_version='v3200\.0'/);
assert.match(SQL, /'activation_profile','v3300\.0'/);
assert.match(SQL, /'organic_consumer_impersonation',false/);
assert.match(SQL, /'false_endorsement_allowed',false/);
assert.match(SQL, /'disclosure_own_line_before_link',true/);
assert.match(SQL, /create or replace function public\.nexus_v3300_operator_status\(\)/);
assert.match(SQL, /'submission_is_delivery_proof',false/);
assert.match(SQL, /'realtime_human_traffic_proven',false/);
assert.match(SQL, /'fourteen_account_v3300_deploy_proven',false/);
assert.match(SQL, /'sub_1ms_guaranteed',false/);
assert.match(SQL, /'sub_50ms_fallback_guaranteed',false/);
assert.match(SQL, /'cloudflare_project_deployed',false/);
assert.match(SQL, /jobid=60 and active and schedule='10 seconds'/);
assert.match(SQL, /relpersistence[\s\S]*nexus_v420_channel_outbox[\s\S]*'u'::"char"/);
assert.match(SQL, /chat_id=-1004417007577/);
assert.match(SQL, /chat_id=-1003951454560/);
assert.doesNotMatch(SQL, /cron\.schedule\s*\(/i);
assert.doesNotMatch(SQL, /(insert\s+into|update|delete\s+from)\s+public\.(?:ads|nexus_v370_keyword_source|nexus_v380_keyword_vectors)\b/i);
assert.doesNotMatch(SQL, /attachShadow|createShadowRoot|fetchpriority/i);

assert.match(EVIDENCE, /'master_projects_deployed',1/);
assert.match(EVIDENCE, /'satellites_deployed',0/);
assert.match(EVIDENCE, /'management_version',3/);
assert.match(EVIDENCE, /'fourteen_account_deployment_claimed',false/);
assert.match(EVIDENCE, /'warm_cache_p50_ms',0\.934/);
assert.match(EVIDENCE, /'warm_cache_p99_ms',1\.256/);
assert.match(EVIDENCE, /'warm_cache_max_ms',20\.165/);
assert.match(EVIDENCE, /'sub_1ms_guaranteed',false/);
assert.match(EVIDENCE, /'placement_added_or_duplicated',false/);
assert.doesNotMatch(EVIDENCE, /'satellites_deployed',13|'fourteen_account_deployment_claimed',true|'sub_1ms_guaranteed',true/);

assert.match(EDGE, /V3300_POLICY_VERSION/);
assert.match(EDGE, /V3300_ACTIVATION_PROFILE/);
assert.match(EDGE, /policy_version: POLICY_VERSION/);
assert.match(EDGE, /activation_profile: ACTIVATION_PROFILE/);
assert.match(EDGE, /publication_claimed: false/);
assert.match(EDGE, /human_or_residential_proven: false/);
assert.doesNotMatch(EDGE, /EdgeRuntime\.waitUntil|setInterval|attachShadow|createShadowRoot|\.click\(/);

assert.match(HUMANIZER, /factual contextual copy core/);
assert.doesNotMatch(HUMANIZER, /Achei esse|vim dividir|Found this one and had to share|mimetiza um usuário residencial/);
assert.match(COMPOSE, /linhas\.splice\(indice, 0, rotulo\)/);
assert.strictEqual(sha('api/ads/go.js'), 'e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716');
assert.strictEqual(sha('edge/jetstream/compose.ts'), 'd99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0');

console.log('v3300 truthful traffic activation tests: PASS');
