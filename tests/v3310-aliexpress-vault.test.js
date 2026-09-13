'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, p))).digest('hex');

const SQL = read('supabase/migrations/supabase_v3310_aliexpress_vault.sql');
const EVIDENCE = read('supabase/migrations/supabase_v3310_postdeploy_evidence.sql');
const ROUTE_EDGE = read('supabase/functions/nexus-aliexpress-route-v3310/index.ts');
const COPY_EDGE = read('supabase/functions/nexus-copywriter-v3200/index.ts');
const COMPOSE = read('edge/jetstream/compose.ts');

// A concrete AliExpress referral URL must never enter the repository. The SQL
// may contain only the strict host/path regular expression used for validation.
assert.doesNotMatch(SQL, /https:\/\/s\.click\.aliexpress\.com\/e\//i);
assert.doesNotMatch(ROUTE_EDGE, /https:\/\/s\.click\.aliexpress\.com\/e\//i);
assert.doesNotMatch(COPY_EDGE, /https:\/\/s\.click\.aliexpress\.com\/e\//i);

// Explicit LOGGED vault, local network_id=5, encrypted bytea only.
assert.match(SQL, /create table if not exists public\.nexus_aliexpress_campaign_vault/i);
assert.doesNotMatch(SQL, /create\s+unlogged\s+table\s+if\s+not\s+exists\s+public\.nexus_aliexpress_campaign_vault/i);
assert.match(SQL, /network_id\s+smallint\s+primary key/i);
assert.match(SQL, /check \(network_id=5\)/i);
assert.match(SQL, /network_name='AliExpress Global'/i);
assert.match(SQL, /referral_url_enc\s+bytea\s+not null/i);
assert.doesNotMatch(SQL, /referral_url\s+text/i);
assert.match(SQL, /current_setting\([\s\S]*nexus\.v3310_aliexpress_referral_url/i);
assert.match(SQL, /nexus_satellites_kms/i);
assert.match(SQL, /extensions\.pgp_sym_encrypt\(/i);
assert.match(SQL, /cipher-algo=aes256/i);
assert.match(SQL, /extensions\.pgp_sym_decrypt\(/i);
assert.match(SQL, /perform set_config\('nexus\.v3310_aliexpress_referral_url','',true\)/i);

// Bounded PL/pgSQL and fail-closed operational behavior.
assert.match(SQL, /set local statement_timeout = '2000ms'/i);
assert.match(SQL, /set local lock_timeout = '1000ms'/i);
assert.match(SQL, /exception when others/i);
assert.match(SQL, /Sintonizado em Análise/i);
assert.match(SQL, /create or replace function public\.nexus_v3310_route_aliexpress\(p_headers jsonb\)/i);
assert.match(SQL, /create or replace function public\.nexus_v3310_operator_status\(\)/i);
assert.match(SQL, /grant execute on function public\.nexus_v3310_route_aliexpress\(jsonb\)\s+to service_role/i);
assert.match(SQL, /grant execute on function public\.nexus_v3310_operator_status\(\) to service_role/i);
assert.match(SQL, /case lower\(e\.key\) when 'cf-ipcountry' then 0 else 1 end/i);
for (const country of ['BR', 'US', 'CA', 'GB', 'DE', 'FR']) assert.match(SQL, new RegExp(`when '${country}'`));

// Truthful anti-IVT and affiliate boundaries.
assert.match(SQL, /'cdn_country_is_human_proof',false/i);
assert.match(SQL, /'human_or_residential_proven',false/i);
assert.match(SQL, /'price_adapted',false/i);
assert.match(SQL, /'tracking_identifiers_appended',false/i);
assert.match(SQL, /'ebay_swap_applied',false/i);
assert.match(SQL, /'sub_1ms_guaranteed',false/i);
assert.match(SQL, /'fallback_anti_404_deployed',false/i);
assert.match(SQL, /'sub_50ms_fallback_guaranteed',false/i);
assert.match(SQL, /'commission_lossless_guaranteed',false/i);
assert.doesNotMatch(SQL, /'cdn_country_is_human_proof',true|'price_adapted',true|'sub_1ms_guaranteed',true|'sub_50ms_fallback_guaranteed',true/i);

// Catalog and Telegram invariants are assertions, not mutations.
assert.doesNotMatch(SQL, /(?:insert\s+into|update|delete\s+from)\s+public\.ads\b/i);
assert.match(SQL, /\(select count\(\*\) from public\.ads\)<>14301/i);
assert.match(SQL, /\(select count\(\*\) from public\.nexus_v370_keyword_source\)<>17605/i);
assert.match(SQL, /\(select count\(\*\) from public\.nexus_v380_keyword_vectors\)<>11568/i);
assert.match(SQL, /jobid=60[\s\S]*jobname='v360-tg-flush-10s'[\s\S]*schedule='10 seconds'/i);
assert.match(SQL, /select public\.nexus_v1510_flush_event\(40\);/i);
assert.match(SQL, /chat_id=-1004417007577/i);
assert.match(SQL, /chat_id=-1003951454560/i);
assert.match(SQL, /v_persistence<>'u'/i);
assert.doesNotMatch(SQL, /cron\.schedule|cron\.unschedule|create\s+trigger[\s\S]*public\.ads/i);

// Postdeploy evidence distinguishes Supabase from an unavailable Cloudflare deploy.
assert.match(EVIDENCE, /'supabase_edge_deployed',true/i);
assert.match(EVIDENCE, /'supabase_function_version',2/i);
assert.match(EVIDENCE, /'copywriter_version',5/i);
assert.match(EVIDENCE, /'cloudflare_pages_deployed',false/i);
assert.match(EVIDENCE, /'shortener_modified',false/i);
assert.match(EVIDENCE, /'compose_modified',false/i);
assert.match(EVIDENCE, /'edge_redirect_performed',false/i);
assert.match(EVIDENCE, /'edge_click_recorded',false/i);
assert.match(EVIDENCE, /'first_result','host_not_allowed'/i);
assert.match(EVIDENCE, /'corrected_route_version',2/i);
assert.doesNotMatch(EVIDENCE, /'cloudflare_pages_deployed',true|'shortener_modified',true|'compose_modified',true/i);

// The Supabase adapter is internal, performs no redirect/click/publication, and
// delegates to the service-role-only SQL resolver.
assert.match(ROUTE_EDGE, /NEXUS_V3310_EDGE_SECRET/);
assert.match(ROUTE_EDGE, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(ROUTE_EDGE, /rpc\/nexus_v3310_route_aliexpress/);
assert.match(ROUTE_EDGE, /request\.headers\.get\("cf-ipcountry"\)/);
assert.match(ROUTE_EDGE, /request\.headers\.get\("x-vercel-ip-country"\)/);
assert.match(ROUTE_EDGE, /redirect_performed: false/);
assert.match(ROUTE_EDGE, /click_recorded: false/);
assert.match(ROUTE_EDGE, /price_adapted: false/);
assert.match(ROUTE_EDGE, /fallback_anti_404_deployed: false/);
assert.doesNotMatch(ROUTE_EDGE, /Response\.redirect|location\s*:/i);

// Copy policy is still v3200, with the activation profile advanced only to v3310.
assert.match(COPY_EDGE, /V3310_POLICY_VERSION/);
assert.match(COPY_EDGE, /V3310_ACTIVATION_PROFILE/);
assert.match(COPY_EDGE, /"v3200\.0"/);
assert.match(COPY_EDGE, /"v3310\.0"/);
assert.match(COMPOSE, /#publi/);
assert.match(COMPOSE, /#ad/);
assert.match(COMPOSE, /linhas\.splice\(indice, 0, rotulo\)/);

// Protected media/gateway surfaces remain byte-identical.
assert.strictEqual(sha256('api/ads/go.js'), 'e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716');
assert.strictEqual(sha256('edge/jetstream/compose.ts'), 'd99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0');

console.log('v3310 encrypted AliExpress vault tests: PASS');
