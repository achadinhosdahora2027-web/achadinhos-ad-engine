-- Nexus v3320.0 — measured postdeploy evidence (master only).
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';

do $assert$
declare v_status jsonb;
begin
  v_status:=public.nexus_v3320_operator_status();
  if v_status->>'version'<>'v3320.0'
     or v_status#>>'{vault,relation_logged}'<>'true'
     or v_status#>>'{vault,br_ciphertext_decryptable}'<>'true'
     or v_status#>>'{vault,br_tracking_id_format_valid}'<>'true'
     or v_status#>>'{vault,plaintext_tracking_id_persisted}'<>'false'
     or v_status#>>'{regional_readiness,BR}'<>'true'
     or v_status#>>'{regional_readiness,US}'<>'false' then
    raise exception 'v3320 vault/regional postdeploy invariant failed';
  end if;
  if v_status#>>'{routing,cloudflare_pages_deployed}'<>'false'
     or v_status#>>'{routing,shortener_modified}'<>'false'
     or v_status#>>'{routing,compose_modified}'<>'false'
     or v_status#>>'{routing,sub_1ms_guaranteed}'<>'false'
     or v_status#>>'{routing,fallback_anti_404_deployed}'<>'false'
     or v_status#>>'{routing,sub_50ms_fallback_guaranteed}'<>'false' then
    raise exception 'v3320 unsupported deployment claim detected';
  end if;
end
$assert$;

update public.nexus_v3000_capability_registry
   set enabled=true,
       evidence=jsonb_build_object(
         'master_projects_deployed',1,
         'supabase_edge_deployed',true,
         'supabase_function','nexus-amazon-route-v3320',
         'supabase_function_version',1,
         'supabase_function_status','ACTIVE',
         'supabase_verify_jwt',true,
         'aliexpress_function','nexus-aliexpress-route-v3310',
         'aliexpress_function_version',3,
         'copywriter_function','nexus-copywriter-v3200',
         'copywriter_version',7,
         'copy_policy_version','v3200.0',
         'activation_profile','v3320.0',
         'provisioned_regions',jsonb_build_array('BR'),
         'tier1_tracking_ids_ready',false,
         'cloudflare_pages_deployed',false,
         'cloudflare_reason','no verified credential/project binding',
         'shortener_modified',false,
         'compose_modified',false,
         'edge_redirect_performed',false,
         'edge_click_recorded',false,
         'controlled_br_http',200,
         'tier1_without_regional_id_http',422,
         'external_host_http',422,
         'already_tagged_http',422,
         'missing_country_http',422,
         'missing_internal_secret_http',401,
         'wrong_internal_secret_http',401,
         'missing_jwt_http',401,
         'deployment_scope','master_only'
       ),checked_at=clock_timestamp()
 where capability='v3320_edge_deployment';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3320_protected_surfaces',true,jsonb_build_object(
    'api_ads_go_modified',false,
    'compose_ts_modified',false,
    'api_ads_go_sha256','e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716',
    'compose_ts_sha256','d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0',
    'binding_header_expected','pop=bound;sb=bound',
    'adsterra_or_monetag_tag_modified',false,
    'placement_added_or_duplicated',false),clock_timestamp()),
 ('v3320_route_benchmark',true,jsonb_build_object(
    'sample_n',200,
    'server_side_warm_p50_ms',0.984,
    'server_side_warm_p99_ms',1.382,
    'server_side_warm_avg_ms',1.029,
    'server_side_warm_max_ms',6.167,
    'includes_network_time',false,
    'includes_edge_runtime',false,
    'vector_latency_measurement',false,
    'latency_sla',false,
    'sub_1ms_guaranteed',false),clock_timestamp()),
 ('v3320_measured_status',true,public.nexus_v3320_operator_status(),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

commit;
