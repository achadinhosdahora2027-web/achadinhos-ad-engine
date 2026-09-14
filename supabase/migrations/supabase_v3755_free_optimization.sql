-- Nexus v3755.0 — Liquid LFM catalog lock and Cloudflare Pages quarantine.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
create temp table pg_temp.nexus_v3755_baseline on commit drop as
select(select count(*)from public.ads)ads_rows,(select count(*)from public.ads where active)active_ads_rows,
(select count(*)from public.nexus_v370_keyword_source)keyword_rows,(select count(*)from public.nexus_shopee_offers)shopee_rows,
(select count(*)from public.nexus_v3680_intent_target_matrix)matrix_rows;

insert into public.nexus_v3750_provider_policy(provider,model_id,enabled,catalog_price_zero_verified,verified_at,policy_version,publication_allowed,cost_zero_guaranteed)
values('openrouter','liquid/lfm-2.5-2.6b:free',true,true,clock_timestamp(),'v3200.0',false,false)
on conflict(provider,model_id)do update set enabled=true,catalog_price_zero_verified=true,verified_at=excluded.verified_at,publication_allowed=false,cost_zero_guaranteed=false;

create table public.nexus_v3755_pages_quarantine(
 project_name text primary key check(project_name='aquitem'),
 live_files_compared integer not null check(live_files_compared=39),
 exact_matches integer not null check(exact_matches=8),
 mismatches integer not null check(mismatches=31),
 wrangler_asset_download_supported boolean not null default false check(not wrangler_asset_download_supported),
 wrangler_config_download_supported boolean not null default true check(wrangler_config_download_supported),
 direct_upload_allowed boolean not null default false check(not direct_upload_allowed),
 production_deployed boolean not null default false check(not production_deployed),
 protected_placements_modified boolean not null default false check(not protected_placements_modified),
 reason text not null,
 checked_at timestamptz not null default clock_timestamp()
);
insert into public.nexus_v3755_pages_quarantine(project_name,live_files_compared,exact_matches,mismatches,reason)
values('aquitem',39,8,31,'Wrangler downloads Pages configuration only; no exact asset tree is available, so Direct Upload remains blocked.');
revoke all on table public.nexus_v3755_pages_quarantine from public,anon,authenticated,service_role;

create or replace function public.nexus_v3755_operator_status()
returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 return jsonb_build_object('version','v3755.0','observed_at',clock_timestamp(),
 'liquid_policy',(select jsonb_build_object('provider',provider,'model_id',model_id,'enabled',enabled,'catalog_price_zero_verified',catalog_price_zero_verified,'cost_zero_guaranteed',cost_zero_guaranteed)from public.nexus_v3750_provider_policy where provider='openrouter'and model_id='liquid/lfm-2.5-2.6b:free'),
 'replay',jsonb_build_object('gateways_expected',14,'keyword_mappings',(select count(*)from public.nexus_v370_keyword_source),'x_transport_used',false,'third_party_cookie_used',false,'scraper_used',false),
 'cloudflare',(select to_jsonb(q)-'reason' from public.nexus_v3755_pages_quarantine q where project_name='aquitem'),
 'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command)from cron.job where jobid=60),
 'claims',jsonb_build_object('groq_continuous_guaranteed',false,'cost_zero_guaranteed',false,'continuous_24x7_proven',false,'go_js_modified',false,'compose_ts_modified',false,'placements_modified',false));
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3755_operator_status() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3755_operator_status() to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
('v3755_liquid_lfm_policy',false,jsonb_build_object('model','liquid/lfm-2.5-2.6b:free','catalog_price_zero_verified',true,'reason','awaiting authenticated runtime proof','cost_zero_guaranteed',false),clock_timestamp()),
('v3755_copywriter_parallel_pool',false,jsonb_build_object('reason','awaiting master Edge deployment proof','fanout','Promise.allSettled','groq_result_preferred',true,'continuous_groq_guaranteed',false),clock_timestamp()),
('v3755_cloudflare_pages_quarantine',true,jsonb_build_object('project','aquitem','mismatches',31,'direct_upload_allowed',false,'production_deployed',false,'protected_placements_modified',false),clock_timestamp()),
('v3755_replay_matrix_retained',false,jsonb_build_object('reason','awaiting 14-project revalidation','keyword_mappings',17605),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$ declare b record;p "char";begin
 select*into b from pg_temp.nexus_v3755_baseline;
 if b.ads_rows<>14301 or b.active_ads_rows<>12165 or b.keyword_rows<>17605 or b.shopee_rows<>1201 or b.matrix_rows<>27 then raise exception 'v3755 baseline drift';end if;
 if not exists(select 1 from public.nexus_v3750_provider_policy where provider='openrouter'and model_id='liquid/lfm-2.5-2.6b:free'and enabled and catalog_price_zero_verified and not cost_zero_guaranteed and not publication_allowed)then raise exception 'v3755 Liquid policy invalid';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v3755_pages_quarantine'::regclass;if p<>'p'::"char"then raise exception 'v3755 quarantine not LOGGED';end if;
 if exists(select 1 from public.nexus_v3755_pages_quarantine where direct_upload_allowed or production_deployed or protected_placements_modified)then raise exception 'v3755 Cloudflare quarantine violated';end if;
 if exists(select 1 from cron.job where active and schedule~*'second'and jobid<>60)then raise exception 'v3755 unexpected sub-minute polling job';end if;
 if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)and active)then raise exception 'v3755 legacy poller active';end if;
 if not exists(select 1 from cron.job where jobid=60 and jobname='v360-tg-flush-10s'and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v3755 Job 60 changed';end if;
 if(select count(*)from public.ads)<>b.ads_rows or(select count(*)from public.nexus_v370_keyword_source)<>b.keyword_rows then raise exception 'v3755 protected catalog changed';end if;
exception when others then raise;end $assert$;
commit;
