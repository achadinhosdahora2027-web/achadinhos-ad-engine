-- Nexus v3300.0 — measured postdeploy evidence.
-- External Edge metadata is recorded only after physical master deployment.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';

do $assert$
declare v_status jsonb;
begin
  v_status:=public.nexus_v3300_operator_status();
  if v_status->>'version'<>'v3300.0'
     or (v_status#>>'{catalogs,ads_read_only_count}')::bigint<>14301
     or (v_status#>>'{catalogs,canonical_keyword_count}')::bigint<>17605
     or (v_status#>>'{catalogs,local_vector_count}')::bigint<>11568 then
    raise exception 'v3300 operator status invariant failed';
  end if;
  if v_status#>>'{claims,realtime_human_traffic_proven}'<>'false'
     or v_status#>>'{claims,fourteen_account_v3300_deploy_proven}'<>'false'
     or v_status#>>'{routing,sub_50ms_fallback_guaranteed}'<>'false' then
    raise exception 'v3300 unsupported claim detected';
  end if;
end
$assert$;

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'master_deployed',true,
      'master_projects_deployed',1,
      'satellites_deployed',0,
      'function','nexus-copywriter-v3200',
      'activation_profile','v3300.0',
      'management_status','ACTIVE',
      'management_version',3,
      'verify_jwt',true,
      'get_http_status',200,
      'post_http_status',200,
      'side_effects',false,
      'deployment_scope','master_only',
      'fourteen_account_deployment_claimed',false
    ),checked_at=clock_timestamp()
where capability='v3300_edge_deployment';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3300_measured_operator_status',true,
   public.nexus_v3300_operator_status(),clock_timestamp()),
 ('v3300_protected_surfaces',true,jsonb_build_object(
    'api_ads_go_modified',false,
    'compose_ts_modified',false,
    'api_ads_go_sha256','e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716',
    'compose_ts_sha256','d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0',
    'binding_header_preserved','pop=bound;sb=bound',
    'shadow_dom_added',false,
    'placement_added_or_duplicated',false),clock_timestamp()),
 ('v3300_latency_observation',true,jsonb_build_object(
    'source_release','v3100.0',
    'sample_n',200,
    'warm_cache_p50_ms',0.934,
    'warm_cache_p99_ms',1.256,
    'warm_cache_max_ms',20.165,
    'sub_1ms_guaranteed',false,
    'latency_sla',false),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

commit;
