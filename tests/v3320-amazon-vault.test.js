'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

const SQL = read('supabase/migrations/supabase_v3320_amazon_vault.sql');
const EVIDENCE = read('supabase/migrations/supabase_v3320_postdeploy_evidence.sql');
const EDGE = read('supabase/functions/nexus-amazon-route-v3320/index.ts');
const COPY = read('supabase/functions/nexus-copywriter-v3200/index.ts');
const COMPOSE = read('edge/jetstream/compose.ts');

// No concrete operator Tracking ID may be committed. The only allowed tag text
// is the parameter name used to attach a runtime-decrypted value.
assert.doesNotMatch(SQL, /garimpocert|tag=garim/i);
assert.doesNotMatch(EDGE, /garimpocert|tag=garim/i);
assert.doesNotMatch(COPY, /garimpocert|tag=garim/i);

// Explicit ordinary/LOGGED vault and encrypted regional model.
assert.match(SQL, /create table if not exists public\.nexus_amazon_campaign_vault/i);
assert.doesNotMatch(SQL, /create\s+unlogged\s+table\s+if\s+not\s+exists\s+public\.nexus_amazon_campaign_vault/i);
assert.match(SQL, /primary key\(network_id,region_code\)/i);
assert.match(SQL, /check\(network_id=6\)/i);
assert.match(SQL, /network_name='Amazon Associates'/i);
assert.match(SQL, /tracking_id_enc\s+bytea\s+not null/i);
assert.doesNotMatch(SQL, /\btracking_id\s+text/i);
assert.match(SQL, /current_setting\([\s\S]*nexus\.v3320_amazon_tracking_id/i);
assert.match(SQL, /nexus_satellites_kms/i);
assert.match(SQL, /extensions\.pgp_sym_encrypt\(/i);
assert.match(SQL, /cipher-algo=aes256/i);
assert.match(SQL, /extensions\.pgp_sym_decrypt\(/i);
assert.match(SQL, /perform set_config\('nexus\.v3320_amazon_tracking_id','',true\)/i);

// Only BR is provisioned; Tier-1 must fail closed until regional IDs exist.
assert.match(SQL, /6,'BR','Amazon Associates','amazon\.com\.br'/i);
assert.match(SQL, /'motivo','regional_tracking_id_unavailable'/i);
assert.match(SQL, /'tier1_tracking_ids_ready',false/i);
assert.match(SQL, /'US',exists\(/i);
assert.match(SQL, /'CA',exists\(/i);
assert.match(SQL, /'GB',exists\(/i);
assert.match(SQL, /'DE',exists\(/i);
assert.match(SQL, /'FR',exists\(/i);
assert.match(SQL, /region_code<>'BR'/i);
assert.doesNotMatch(SQL, /'tier1_tracking_ids_ready',true/i);

// Resolver validates region, marketplace host, existing tag, and appends only a
// decrypted safe Tracking ID. It never performs the HTTP request.
assert.match(SQL, /create or replace function public\.nexus_v3320_route_amazon\(/i);
assert.match(SQL, /replace\(v_expected_host,'\.','\[\.\]'\)/i);
assert.match(SQL, /'motivo','amazon_product_host_not_allowed'/i);
assert.match(SQL, /'motivo','product_url_already_tagged'/i);
assert.match(SQL, /'tag='\|\|v_tracking_id/i);
assert.match(SQL, /'tracking_tag_attached',true/i);
assert.match(SQL, /'price_adapted',false/i);
assert.match(SQL, /'ebay_swap_applied',false/i);
assert.match(SQL, /'sub_1ms_guaranteed',false/i);
assert.match(SQL, /'fallback_anti_404_deployed',false/i);
assert.match(SQL, /'sub_50ms_fallback_guaranteed',false/i);
assert.match(SQL, /'commission_lossless_guaranteed',false/i);
assert.match(SQL, /'cdn_country_is_human_proof',false/i);
assert.match(SQL, /'vector_latency_2_87ms_independently_verified',false/i);

// Bounded fail-closed PL/pgSQL and private ACLs.
assert.match(SQL, /set local statement_timeout = '2000ms'/i);
assert.match(SQL, /set local lock_timeout = '1000ms'/i);
assert.match(SQL, /exception when others/i);
assert.match(SQL, /Sintonizado em Análise/i);
assert.match(SQL, /grant execute on function public\.nexus_v3320_route_amazon\(jsonb,text\)\s+to service_role/i);
assert.match(SQL, /grant execute on function public\.nexus_v3320_operator_status\(\) to service_role/i);
assert.match(SQL, /case lower\(e\.key\) when 'cf-ipcountry' then 0 else 1 end/i);

// Catalog, policy, Telegram, and cumulative AliExpress invariants.
assert.doesNotMatch(SQL, /(?:insert\s+into|update|delete\s+from)\s+public\.ads\b/i);
assert.match(SQL, /\(select count\(\*\) from public\.ads\)<>14301/i);
assert.match(SQL, /\(select count\(\*\) from public\.nexus_v370_keyword_source\)<>17605/i);
assert.match(SQL, /\(select count\(\*\) from public\.nexus_v380_keyword_vectors\)<>11568/i);
assert.match(SQL, /nexus_aliexpress_campaign_vault[\s\S]*network_id=5/i);
assert.match(SQL, /jobid=60[\s\S]*jobname='v360-tg-flush-10s'[\s\S]*schedule='10 seconds'/i);
assert.match(SQL, /select public\.nexus_v1510_flush_event\(40\);/i);
assert.match(SQL, /chat_id=-1004417007577/i);
assert.match(SQL, /chat_id=-1003951454560/i);
assert.match(SQL, /v_persistence<>'u'/i);
assert.doesNotMatch(SQL, /cron\.schedule|cron\.unschedule|create\s+trigger[\s\S]*public\.ads/i);

// Postdeploy evidence distinguishes the deployed Supabase adapter from missing
// Cloudflare/Tier-1/fallback capabilities and preserves measured latency semantics.
assert.match(EVIDENCE, /'supabase_edge_deployed',true/i);
assert.match(EVIDENCE, /'supabase_function_version',1/i);
assert.match(EVIDENCE, /'aliexpress_function_version',3/i);
assert.match(EVIDENCE, /'copywriter_version',7/i);
assert.match(EVIDENCE, /'tier1_tracking_ids_ready',false/i);
assert.match(EVIDENCE, /'cloudflare_pages_deployed',false/i);
assert.match(EVIDENCE, /'shortener_modified',false/i);
assert.match(EVIDENCE, /'compose_modified',false/i);
assert.match(EVIDENCE, /'server_side_warm_p50_ms',0\.984/i);
assert.match(EVIDENCE, /'server_side_warm_p99_ms',1\.382/i);
assert.match(EVIDENCE, /'server_side_warm_max_ms',6\.167/i);
assert.match(EVIDENCE, /'vector_latency_measurement',false/i);
assert.match(EVIDENCE, /'latency_sla',false/i);
assert.match(EVIDENCE, /'sub_1ms_guaranteed',false/i);
assert.doesNotMatch(EVIDENCE, /'cloudflare_pages_deployed',true|'tier1_tracking_ids_ready',true|'sub_1ms_guaranteed',true/i);

// Internal Edge adapter: JWT is enforced by platform, then an independent secret.
assert.match(EDGE, /NEXUS_V3320_EDGE_SECRET/);
assert.match(EDGE, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(EDGE, /rpc\/nexus_v3320_route_amazon/);
assert.match(EDGE, /p_product_url: productUrl/);
assert.match(EDGE, /request\.headers\.get\("cf-ipcountry"\)/);
assert.match(EDGE, /request\.headers\.get\("x-vercel-ip-country"\)/);
assert.match(EDGE, /redirect_performed: false/);
assert.match(EDGE, /click_recorded: false/);
assert.match(EDGE, /price_adapted: false/);
assert.match(EDGE, /fallback_anti_404_deployed: false/);
assert.doesNotMatch(EDGE, /Response\.redirect|location\s*:/i);

// Copy policy and immutable protected surfaces.
assert.match(COPY, /V33(?:20|30)_POLICY_VERSION/);
assert.match(COPY, /V33(?:20|30)_ACTIVATION_PROFILE/);
assert.match(COPY, /"v3200\.0"/);
assert.match(COPY, /"v33(?:20|30)\.0"/);
assert.match(COMPOSE, /#publi/);
assert.match(COMPOSE, /#ad/);
assert.match(COMPOSE, /linhas\.splice\(indice, 0, rotulo\)/);
assert.strictEqual(sha256('api/ads/go.js'), 'e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716');
assert.strictEqual(sha256('edge/jetstream/compose.ts'), 'd99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0');

console.log('v3320 encrypted Amazon regional vault tests: PASS');
