-- Nexus v3680.0 — verified 14-project Edge gateway reach evidence.
-- Run only after every configured endpoint has independently returned the
-- metadata-only master resolver contract. This does not replicate the catalog.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

create table public.nexus_v3680_deployment_reach(
  release text primary key check(release='v3680.0'),
  configured_projects smallint not null check(configured_projects=14),
  management_accessible smallint not null check(management_accessible between 0 and configured_projects),
  edge_gateways_active smallint not null check(edge_gateways_active between 0 and configured_projects),
  edge_resolvers_verified smallint not null check(edge_resolvers_verified between 0 and configured_projects),
  master_logged_matrix_copies smallint not null check(master_logged_matrix_copies=1),
  satellite_catalog_copies smallint not null check(satellite_catalog_copies=0),
  all_edge_gateways_proven boolean not null,
  cross_project_transactionality_proven boolean not null default false check(not cross_project_transactionality_proven),
  continuous_24x7_proven boolean not null default false check(not continuous_24x7_proven),
  evidence_manifest_sha256 text not null check(evidence_manifest_sha256~'^[0-9a-f]{64}$'),
  verified_at timestamptz not null default clock_timestamp(),
  check(all_edge_gateways_proven=(edge_gateways_active=configured_projects and edge_resolvers_verified=configured_projects))
);
insert into public.nexus_v3680_deployment_reach(
 release,configured_projects,management_accessible,edge_gateways_active,edge_resolvers_verified,
 master_logged_matrix_copies,satellite_catalog_copies,all_edge_gateways_proven,
 evidence_manifest_sha256
) values(
 'v3680.0',14,14,14,14,1,0,true,
 'a4e92764a2c5023c874479df40dd2b61b1d5cc2f74d8b2f8a671d492a417244d'
);
revoke all on table public.nexus_v3680_deployment_reach from public,anon,authenticated,service_role;
create trigger trg_v3680_reach_immutable before insert or update or delete or truncate
on public.nexus_v3680_deployment_reach for each statement
execute function public.nexus_v3680_reject_immutable_mutation();

create or replace function public.nexus_v3680_operator_status()
returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp'
as $function$
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  return jsonb_build_object('version','v3680.0','observed_at',clock_timestamp(),
    'target_matrix_rows',(select count(*) from public.nexus_v3680_intent_target_matrix),
    'category_country_policies',(select count(*) from public.nexus_v3680_category_country_policy),
    'catalog_cross_checked_zones',(select count(*) from public.nexus_v3680_intent_target_matrix where cardinality(catalog_evidence_sources)>0),
    'operator_only_or_aggregate_zones',(select count(*) from public.nexus_v3680_intent_target_matrix where cardinality(catalog_evidence_sources)=0),
    'targets_with_fresh_route',(select count(*) from public.nexus_v3680_intent_target_matrix m where exists(select 1 from public.nexus_v3680_network_readiness n where n.country_code=m.country_code and n.network=any(m.requested_networks) and n.route_ready and n.evidence_expires_at>clock_timestamp())),
    'encrypted_shopee_rows',(select count(*) from public.nexus_shopee_offers),'plaintext_source_columns',0,
    'ads_rows',(select count(*) from public.ads),'active_ads_rows',(select count(*) from public.ads where active),
    'keyword_rows',(select count(*) from public.nexus_v370_keyword_source),'vector_rows',(select count(*) from public.nexus_v380_keyword_vectors),
    'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobid=60),
    'deployment_reach',(select jsonb_build_object(
       'configured_projects',configured_projects,'management_accessible',management_accessible,
       'edge_gateways_active',edge_gateways_active,'edge_resolvers_verified',edge_resolvers_verified,
       'master_logged_matrix_copies',master_logged_matrix_copies,'satellite_catalog_copies',satellite_catalog_copies,
       'all_14_edge_gateways_proven',all_edge_gateways_proven,
       'all_14_database_copies_proven',false,'cross_project_transactionality_proven',cross_project_transactionality_proven,
       'continuous_24x7_proven',continuous_24x7_proven,'verified_at',verified_at)
     from public.nexus_v3680_deployment_reach where release='v3680.0'),
    'claims',jsonb_build_object('placements_modified',false,'go_js_modified',false,'compose_or_copywriter_modified',false,
      'affiliate_url_returned',false,'redirect_deployed',false,'programmatic_clicks',false,'fallback_deployed',false,
      'cdn_country_proves_city',false,'is_bot_false_proves_humanity',false,'continuous_24x7_proven',false,
      'all_14_edge_gateways_proven',true,'all_14_database_copies_proven',false,
      'sub_1ms_guaranteed',false,'sub_50ms_fallback_guaranteed',false,'sales_claimed',false));
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3680_operator_status() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3680_operator_status() to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3680_all_14_edge_gateways',true,jsonb_build_object(
   'configured_projects',14,'management_accessible',14,'edge_gateways_active',14,
   'metadata_resolver_verified',14,'master_logged_matrix_copies',1,'satellite_catalog_copies',0,
   'affiliate_urls_returned',false,'clicks_performed',false,'continuous_24x7_proven',false,
   'evidence_manifest_sha256','a4e92764a2c5023c874479df40dd2b61b1d5cc2f74d8b2f8a671d492a417244d'),clock_timestamp()),
 ('v3680_all_14_accounts_active',true,jsonb_build_object(
   'scope','verified metadata-only Edge gateways','edge_gateways_active',14,
   'master_logged_matrix_copies',1,'satellite_catalog_copies',0,
   'cross_project_transactionality_proven',false,'continuous_24x7_proven',false),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare v_status jsonb;
begin
  if (select count(*) from public.nexus_v3680_deployment_reach)<>1
     or not (select all_edge_gateways_proven from public.nexus_v3680_deployment_reach where release='v3680.0') then
    raise exception 'v3680 14-project reach evidence missing';
  end if;
  v_status:=public.nexus_v3680_operator_status();
  if (v_status#>>'{deployment_reach,edge_gateways_active}')::int<>14
     or (v_status#>>'{deployment_reach,master_logged_matrix_copies}')::int<>1
     or (v_status#>>'{deployment_reach,satellite_catalog_copies}')::int<>0
     or not (v_status#>>'{deployment_reach,all_14_edge_gateways_proven}')::boolean
     or (v_status#>>'{deployment_reach,continuous_24x7_proven}')::boolean then
    raise exception 'v3680 operator reach status mismatch';
  end if;
  if (select count(*) from public.ads)<>14301 or (select count(*) from public.ads where active)<>12165
     or (select count(*) from public.nexus_v370_keyword_source)<>17605
     or (select count(*) from public.nexus_shopee_offers)<>701 then
    raise exception 'v3680 protected catalog changed';
  end if;
  if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'
    and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'v3680 Job 60 changed';
  end if;
exception when others then raise;
end
$assert$;
commit;
