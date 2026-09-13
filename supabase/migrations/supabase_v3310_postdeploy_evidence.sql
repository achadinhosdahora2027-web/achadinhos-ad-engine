-- Nexus v3310.0 — measured postdeploy evidence (master only).
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';

do $assert$
declare v_status jsonb;
begin
  v_status:=public.nexus_v3310_operator_status();
  if v_status->>'version'<>'v3310.0'
     or v_status#>>'{vault,installed}'<>'true'
     or v_status#>>'{vault,relation_logged}'<>'true'
     or v_status#>>'{vault,ciphertext_decryptable}'<>'true'
     or v_status#>>'{vault,strict_host_valid}'<>'true'
     or v_status#>>'{vault,plaintext_persisted}'<>'false' then
    raise exception 'v3310 vault postdeploy invariant failed';
  end if;
  if v_status#>>'{routing,cloudflare_pages_deployed}'<>'false'
     or v_status#>>'{routing,shortener_modified}'<>'false'
     or v_status#>>'{routing,compose_modified}'<>'false'
     or v_status#>>'{routing,sub_1ms_guaranteed}'<>'false'
     or v_status#>>'{routing,fallback_anti_404_deployed}'<>'false'
     or v_status#>>'{routing,sub_50ms_fallback_guaranteed}'<>'false' then
    raise exception 'v3310 unsupported deployment claim detected';
  end if;
end
$assert$;

update public.nexus_v3000_capability_registry
   set enabled=true,
       evidence=jsonb_build_object(
         'master_projects_deployed',1,
         'supabase_edge_deployed',true,
         'supabase_function','nexus-aliexpress-route-v3310',
         'supabase_function_version',2,
         'supabase_function_status','ACTIVE',
         'supabase_verify_jwt',true,
         'copywriter_function','nexus-copywriter-v3200',
         'copywriter_version',5,
         'copy_policy_version','v3200.0',
         'activation_profile','v3310.0',
         'cloudflare_pages_deployed',false,
         'cloudflare_reason','no verified credential/project binding',
         'shortener_modified',false,
         'compose_modified',false,
         'edge_redirect_performed',false,
         'edge_click_recorded',false,
         'controlled_br_branch_http',200,
         'outside_scope_http',422,
         'missing_internal_secret_http',401,
         'wrong_internal_secret_http',401,
         'missing_jwt_http',401,
         'deployment_scope','master_only'
       ),checked_at=clock_timestamp()
 where capability='v3310_edge_deployment';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3310_protected_surfaces',true,jsonb_build_object(
    'api_ads_go_modified',false,
    'compose_ts_modified',false,
    'api_ads_go_sha256','e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716',
    'compose_ts_sha256','d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0',
    'binding_header_expected','pop=bound;sb=bound',
    'adsterra_or_monetag_tag_modified',false,
    'placement_added_or_duplicated',false),clock_timestamp()),
 ('v3310_measured_status',true,public.nexus_v3310_operator_status(),clock_timestamp()),
 ('v3310_runtime_correction',true,jsonb_build_object(
    'first_route_version',1,
    'first_result','host_not_allowed',
    'corrected_route_version',2,
    'correction','removed invalid managed-proxy host identity assumption',
    'access_control','JWT plus independent internal secret',
    'redirect_or_click_during_test',false),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

commit;
