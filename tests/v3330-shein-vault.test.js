'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

const SQL = read('supabase/migrations/supabase_v3330_shein_vault.sql');
const EVIDENCE = read('supabase/migrations/supabase_v3330_postdeploy_evidence.sql');
const EDGE = read('supabase/functions/nexus-shein-route-v3330/index.ts');
const COPY = read('supabase/functions/nexus-copywriter-v3200/index.ts');
const COMPOSE = read('edge/jetstream/compose.ts');
const FEED = JSON.parse(read('data/cj-product-feed-live.json'));

// A concrete Shein OneLink must never enter versioned sources. The migration
// may contain only its escaped strict-validation regular expression.
assert.doesNotMatch(SQL, /https:\/\/onelink\.shein\.com\/[0-9]+\//i);
assert.doesNotMatch(EVIDENCE, /https:\/\/onelink\.shein\.com\/[0-9]+\//i);
assert.doesNotMatch(EDGE, /https:\/\/onelink\.shein\.com\/[0-9]+\//i);
assert.doesNotMatch(COPY, /https:\/\/onelink\.shein\.com\/[0-9]+\//i);

// Explicit ordinary/LOGGED encrypted vault.
assert.match(SQL, /create table if not exists public\.nexus_shein_campaign_vault/i);
assert.doesNotMatch(SQL, /create\s+unlogged\s+table\s+if\s+not\s+exists\s+public\.nexus_shein_campaign_vault/i);
assert.match(SQL, /network_id\s+smallint\s+primary key/i);
assert.match(SQL, /check\(network_id=7\)/i);
assert.match(SQL, /network_name='Shein Affiliates'/i);
assert.match(SQL, /referral_url_enc\s+bytea\s+not null/i);
assert.doesNotMatch(SQL, /\breferral_url\s+text/i);
assert.match(SQL, /current_setting\([\s\S]*nexus\.v3330_shein_referral_url/i);
assert.match(SQL, /nexus_satellites_kms/i);
assert.match(SQL, /extensions\.pgp_sym_encrypt\(/i);
assert.match(SQL, /cipher-algo=aes256/i);
assert.match(SQL, /extensions\.pgp_sym_decrypt\(/i);
assert.match(SQL, /perform set_config\('nexus\.v3330_shein_referral_url','',true\)/i);

// Bounded, private, fail-closed PL/pgSQL.
assert.match(SQL, /set local statement_timeout = '2000ms'/i);
assert.match(SQL, /set local lock_timeout = '1000ms'/i);
assert.match(SQL, /exception when others/i);
assert.match(SQL, /Sintonizado em Análise/i);
assert.match(SQL, /create or replace function public\.nexus_v3330_route_shein\(p_headers jsonb\)/i);
assert.match(SQL, /create or replace function public\.nexus_v3330_operator_status\(\)/i);
assert.match(SQL, /grant execute on function public\.nexus_v3330_route_shein\(jsonb\) to service_role/i);
assert.match(SQL, /grant execute on function public\.nexus_v3330_operator_status\(\) to service_role/i);
assert.match(SQL, /case lower\(e\.key\) when 'cf-ipcountry' then 0 else 1 end/i);

// BR only: no invented Tier-1 link, price, tracking parameters, traffic, or SLA.
assert.match(SQL, /provisioned_scope='BR_ONLY_UNTIL_REGIONAL_VALIDATION'/i);
assert.match(SQL, /if v_country<>'BR'/i);
assert.match(SQL, /'motivo','regional_link_unverified'/i);
assert.match(SQL, /'tier1_regional_links_ready',false/i);
assert.match(SQL, /'tracking_identifiers_appended',false/i);
assert.match(SQL, /'price_adapted',false/i);
assert.match(SQL, /'high_frequency_traffic_proven',false/i);
assert.match(SQL, /'sub_1ms_guaranteed',false/i);
assert.match(SQL, /'fallback_anti_404_deployed',false/i);
assert.match(SQL, /'sub_50ms_fallback_guaranteed',false/i);
assert.match(SQL, /'commission_lossless_guaranteed',false/i);
assert.match(SQL, /'cdn_country_is_human_proof',false/i);
assert.doesNotMatch(SQL, /'tier1_regional_links_ready',true|'price_adapted',true|'sub_1ms_guaranteed',true|'sub_50ms_fallback_guaranteed',true/i);

// Catalog remains read-only. Repository feed count is evidence, not ingestion.
assert.doesNotMatch(SQL, /(?:insert\s+into|update|delete\s+from)\s+public\.ads\b/i);
assert.match(SQL, /\(select count\(\*\) from public\.ads\)<>14301/i);
assert.match(SQL, /\(select count\(\*\) from public\.ads where active\)<>12165/i);
assert.match(SQL, /database_shein_ads',0/i);
assert.match(SQL, /repository_cj_feed_rows_observed_preflight',20/i);
assert.strictEqual(Array.isArray(FEED.produtos) ? FEED.produtos.length : -1, 20);
assert.strictEqual(FEED.produtos.filter((x) => /shein/i.test(String(x.brand)) || /shein/i.test(String(x.advertiser))).length, 20);

// Cumulative vault, Telegram, and policy invariants.
assert.match(SQL, /nexus_aliexpress_campaign_vault[\s\S]*network_id=5/i);
assert.match(SQL, /nexus_amazon_campaign_vault[\s\S]*network_id=6[\s\S]*region_code='BR'/i);
assert.match(SQL, /jobid=60[\s\S]*jobname='v360-tg-flush-10s'[\s\S]*schedule='10 seconds'/i);
assert.match(SQL, /select public\.nexus_v1510_flush_event\(40\);/i);
assert.match(SQL, /chat_id=-1004417007577/i);
assert.match(SQL, /chat_id=-1003951454560/i);
assert.match(SQL, /v_persistence<>'u'/i);
assert.doesNotMatch(SQL, /cron\.schedule|cron\.unschedule|create\s+trigger[\s\S]*public\.ads/i);

// Internal Edge adapter: no redirect/click and dual authorization.
assert.match(EDGE, /NEXUS_V3330_EDGE_SECRET/);
assert.match(EDGE, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(EDGE, /rpc\/nexus_v3330_route_shein/);
assert.match(EDGE, /request\.headers\.get\("cf-ipcountry"\)/);
assert.match(EDGE, /request\.headers\.get\("x-vercel-ip-country"\)/);
assert.match(EDGE, /redirect_performed: false/);
assert.match(EDGE, /click_recorded: false/);
assert.match(EDGE, /tracking_identifiers_appended: false/);
assert.match(EDGE, /price_adapted: false/);
assert.match(EDGE, /high_frequency_traffic_proven: false/);
assert.match(EDGE, /fallback_anti_404_deployed: false/);
assert.doesNotMatch(EDGE, /Response\.redirect|location\s*:/i);

// Sanitized measured postdeploy receipt retains strict negative claims.
assert.match(EVIDENCE, /'supabase_function','nexus-shein-route-v3330'/i);
assert.match(EVIDENCE, /'supabase_function_version',1/i);
assert.match(EVIDENCE, /'copywriter_version',9/i);
assert.match(EVIDENCE, /'controlled_br_http',200/i);
assert.match(EVIDENCE, /'tier1_without_regional_link_http',422/i);
assert.match(EVIDENCE, /'missing_jwt_http',401/i);
assert.match(EVIDENCE, /'server_side_warm_p99_ms',1\.508/i);
assert.match(EVIDENCE, /'server_side_warm_max_ms',27\.168/i);
assert.match(EVIDENCE, /'high_frequency_capacity_test',false/i);
assert.match(EVIDENCE, /'sub_1ms_guaranteed',false/i);
assert.match(EVIDENCE, /'cloudflare_pages_deployed',false/i);
assert.match(EVIDENCE, /'affiliate_url_followed_by_automation',false/i);
assert.doesNotMatch(EVIDENCE, /'cloudflare_pages_deployed',true|'sub_1ms_guaranteed',true|'commission_lossless_guaranteed',true/i);

// Copy policy and protected surfaces.
assert.match(COPY, /V33(?:30|40|50)_POLICY_VERSION/);
assert.match(COPY, /V33(?:30|40|50)_ACTIVATION_PROFILE/);
assert.match(COPY, /"v3200\.0"/);
assert.match(COPY, /"v33(?:30|40|50)\.0"/);
assert.match(COMPOSE, /#publi/);
assert.match(COMPOSE, /#ad/);
assert.match(COMPOSE, /linhas\.splice\(indice, 0, rotulo\)/);
assert.strictEqual(sha256('api/ads/go.js'), 'e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716');
assert.strictEqual(sha256('edge/jetstream/compose.ts'), 'd99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0');

console.log('v3330 encrypted Shein vault tests: PASS');
