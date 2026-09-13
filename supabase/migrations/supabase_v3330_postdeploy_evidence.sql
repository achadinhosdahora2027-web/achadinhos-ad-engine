-- Nexus v3330.0 — sanitized physical deployment evidence.
-- Captured after successful PostgreSQL apply and Supabase Edge runtime checks.
-- Contains no affiliate URL, KMS material, internal secret, API key, or JWT.
begin;
set local statement_timeout='2000ms';
set local lock_timeout='1000ms';
set local idle_in_transaction_session_timeout='10000ms';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3330_edge_deployment',true,jsonb_build_object(
   'supabase_edge_deployed',true,
   'supabase_function','nexus-shein-route-v3330',
   'supabase_function_version',1,
   'supabase_function_status','ACTIVE',
   'supabase_verify_jwt',true,
   'copywriter_function','nexus-copywriter-v3200',
   'copywriter_version',9,
   'copy_policy_version','v3200.0',
   'activation_profile','v3330.0',
   'aliexpress_function','nexus-aliexpress-route-v3310',
   'aliexpress_function_version',4,
   'amazon_function','nexus-amazon-route-v3320',
   'amazon_function_version',2,
   'controlled_br_http',200,
   'tier1_without_regional_link_http',422,
   'outside_scope_http',422,
   'missing_country_http',422,
   'missing_internal_secret_http',401,
   'wrong_internal_secret_http',401,
   'missing_jwt_http',401,
   'edge_redirect_performed',false,
   'edge_click_recorded',false,
   'tracking_identifiers_appended',false,
   'price_adapted',false,
   'provisioned_regions',jsonb_build_array('BR'),
   'tier1_regional_links_ready',false,
   'master_projects_deployed',1,
   'cloudflare_pages_deployed',false,
   'cloudflare_reason','no verified credential/project binding',
   'shortener_modified',false,
   'compose_modified',false,
   'protected_go_sha256','e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716',
   'protected_compose_sha256','d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0'
 ),clock_timestamp()),
 ('v3330_shein_route_benchmark',true,jsonb_build_object(
   'sample_n',200,
   'server_side_warm_p50_ms',0.667,
   'server_side_warm_p99_ms',1.508,
   'server_side_warm_avg_ms',0.830,
   'server_side_warm_max_ms',27.168,
   'includes_network_time',false,
   'includes_edge_runtime',false,
   'high_frequency_capacity_test',false,
   'latency_sla',false,
   'sub_1ms_guaranteed',false
 ),clock_timestamp()),
 ('v3330_shein_inventory',false,jsonb_build_object(
   'database_shein_ads',0,
   'database_active_shein_ads',0,
   'repository_cj_feed_rows_observed_preflight',20,
   'catalog_mutated',false,
   'cj_feed_conflated_with_operator_affiliate_program',false,
   'reason','active catalog required read-only; repository CJ feed is not a database ingestion receipt'
 ),clock_timestamp()),
 ('v3330_fallback_anti_404',false,jsonb_build_object(
   'cloudflare_pages_deployed',false,
   'verified_kv_binding',false,
   'anti_404_interception_path',false,
   'direct_merchant_fallback_enabled',false,
   'sub_50ms_guaranteed',false,
   'commission_lossless_guaranteed',false,
   'reason','no verified Cloudflare project credential or KV binding'
 ),clock_timestamp()),
 ('v3330_truthful_claim_boundary',true,jsonb_build_object(
   'human_or_residential_proven',false,
   'active_buyer_traffic_proven',false,
   'continuous_24x7_proven',false,
   'high_frequency_throughput_proven',false,
   'ctr_guaranteed',false,
   'conversion_guaranteed',false,
   'cart_preservation_guaranteed',false,
   'commission_lossless_guaranteed',false,
   'programmatic_affiliate_redirect_tested',false,
   'affiliate_url_followed_by_automation',false
 ),clock_timestamp())
on conflict(capability) do update set
 enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

update public.nexus_v3200_copy_policies
   set active=true,
       directives=directives||jsonb_build_object(
         'activation_profile','v3330.0',
         'shein_edge_deployed',true,
         'shein_edge_version',1,
         'shein_tier1_regional_links_ready',false,
         'shein_database_ads',0,
         'shein_catalog_mutated',false,
         'shein_redirect_performed',false,
         'shein_click_recorded',false,
         'shein_affiliate_url_followed_by_automation',false,
         'shein_sub_1ms_guaranteed',false,
         'shein_fallback_anti_404_deployed',false,
         'shein_commission_lossless_guaranteed',false
       ),
       checked_at=clock_timestamp()
 where policy_version='v3200.0';

do $assert$
declare
  v_status jsonb;
  v_persistence "char";
begin
  v_status:=public.nexus_v3330_operator_status();
  if v_status->>'version'<>'v3330.0'
     or coalesce((v_status#>>'{vault,installed}')::boolean,false) is not true
     or coalesce((v_status#>>'{vault,relation_logged}')::boolean,false) is not true
     or coalesce((v_status#>>'{vault,ciphertext_decryptable}')::boolean,false) is not true
     or coalesce((v_status#>>'{vault,strict_host_valid}')::boolean,false) is not true
     or coalesce((v_status#>>'{vault,plaintext_persisted}')::boolean,true) is not false
     or coalesce((v_status#>>'{regional_readiness,BR}')::boolean,false) is not true
     or coalesce((v_status#>>'{regional_readiness,US}')::boolean,true) is not false
     or coalesce((v_status#>>'{regional_readiness,CA}')::boolean,true) is not false
     or coalesce((v_status#>>'{regional_readiness,GB}')::boolean,true) is not false
     or coalesce((v_status#>>'{regional_readiness,DE}')::boolean,true) is not false
     or coalesce((v_status#>>'{regional_readiness,FR}')::boolean,true) is not false then
    raise exception 'v3330 postdeploy vault/readiness assertion failed';
  end if;
  if (v_status#>>'{catalogs,ads_read_only_count}')::integer<>14301
     or (v_status#>>'{catalogs,active_ads_read_only_count}')::integer<>12165
     or (v_status#>>'{catalogs,database_shein_ads_count}')::integer<>0
     or (v_status#>>'{catalogs,database_active_shein_ads_count}')::integer<>0
     or (v_status#>>'{catalogs,canonical_keyword_count}')::integer<>17605
     or (v_status#>>'{catalogs,local_vector_count}')::integer<>11568 then
    raise exception 'v3330 postdeploy catalog assertion failed';
  end if;
  if coalesce((v_status#>>'{cumulative,aliexpress_v3310_preserved}')::boolean,false) is not true
     or coalesce((v_status#>>'{cumulative,amazon_v3320_br_preserved}')::boolean,false) is not true then
    raise exception 'v3330 cumulative vault assertion failed';
  end if;

  select relpersistence into v_persistence from pg_class
   where oid='public.nexus_v420_channel_outbox'::regclass;
  if v_persistence<>'u'::"char"
     or not exists(select 1 from cron.job where jobid=60 and active
       and schedule='10 seconds'
       and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'v3330 Job 60/outbox invariant failed';
  end if;
  if not exists(select 1 from public.nexus_v3000_capability_registry
       where capability='v3330_edge_deployment' and enabled
         and evidence->>'supabase_function_status'='ACTIVE'
         and evidence->>'supabase_verify_jwt'='true'
         and evidence->>'cloudflare_pages_deployed'='false'
         and evidence->>'shortener_modified'='false'
         and evidence->>'compose_modified'='false')
     or not exists(select 1 from public.nexus_v3000_capability_registry
       where capability='v3330_shein_inventory' and not enabled
         and evidence->>'database_shein_ads'='0'
         and evidence->>'catalog_mutated'='false')
     or not exists(select 1 from public.nexus_v3000_capability_registry
       where capability='v3330_fallback_anti_404' and not enabled
         and evidence->>'sub_50ms_guaranteed'='false'
         and evidence->>'commission_lossless_guaranteed'='false') then
    raise exception 'v3330 truthful capability evidence assertion failed';
  end if;
end
$assert$;

commit;
