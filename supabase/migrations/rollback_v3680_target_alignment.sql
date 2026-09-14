-- Nexus v3680.0 rollback — removes only v3680 objects and metadata.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

do $guard$
begin
  if to_regclass('public.nexus_v3680_intent_target_matrix') is null
     or to_regclass('public.nexus_shopee_offers') is null then
    raise exception 'v3680 rollback guard: expected relations are absent';
  end if;
  if exists(select 1 from public.nexus_shopee_offers where installed_by_release<>'v3680.0') then
    raise exception 'v3680 rollback guard: inventory contains a foreign release';
  end if;
exception when others then raise;
end
$guard$;

drop function if exists public.nexus_v3680_operator_status();
drop function if exists public.nexus_v3680_resolve_target(jsonb,text,text,text);
drop function if exists public.nexus_v3680_refresh_network_readiness();
drop trigger if exists trg_v3680_shopee_immutable on public.nexus_shopee_offers;
drop trigger if exists trg_v3680_matrix_immutable on public.nexus_v3680_intent_target_matrix;
drop trigger if exists trg_v3680_policy_immutable on public.nexus_v3680_category_country_policy;
drop function if exists public.nexus_v3680_reject_immutable_mutation();
drop table public.nexus_v3680_network_readiness;
drop table public.nexus_v3680_intent_target_matrix;
drop table public.nexus_v3680_category_country_policy;
drop table public.nexus_shopee_offers;

update public.nexus_v3600_route_readiness
   set route_ready=false,catalog_rows=0,evidence_scope='v3680_inventory_rolled_back',
       evidence_expires_at=clock_timestamp(),checked_at=clock_timestamp()
 where country_code='BR' and network='shopee';
update public.nexus_v3000_capability_registry
   set evidence=evidence||jsonb_build_object('shopee_inventory_physically_present',false,'encrypted_source_rows',0),
       checked_at=clock_timestamp()
 where capability='v3500_indexed_route_readiness';
delete from public.nexus_v3000_capability_registry where capability like 'v3680%';

do $assert$
begin
  if to_regclass('public.nexus_v3680_intent_target_matrix') is not null
     or to_regclass('public.nexus_shopee_offers') is not null
     or exists(select 1 from public.nexus_v3000_capability_registry where capability like 'v3680%') then
    raise exception 'v3680 rollback incomplete';
  end if;
  if (select count(*) from public.ads)<>14301
     or (select count(*) from public.ads where active)<>12165
     or (select count(*) from public.nexus_v370_keyword_source)<>17605 then
    raise exception 'v3680 rollback protected-catalog invariant';
  end if;
exception when others then raise;
end
$assert$;
commit;
