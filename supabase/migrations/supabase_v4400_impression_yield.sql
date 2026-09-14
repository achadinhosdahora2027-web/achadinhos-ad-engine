-- Nexus v4400.0 — Sovereign Passive Impression Yield safety matrix.
-- PostgreSQL 17.6. Additive and fail-closed. This migration does not render an
-- ad, claim a billable impression, mutate a placement, redirect a visitor,
-- emulate a human/residential session, or create a durable Edge daemon.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
create temp table pg_temp.nexus_v4400_baseline on commit drop as
select(select count(*)from public.ads)ads,(select count(*)from public.ads where active)active_ads,
(select count(*)from public.nexus_v370_keyword_source)keywords,(select count(*)from public.nexus_v380_keyword_vectors)vectors,
(select count(*)from public.nexus_shopee_offers)shopee;

create table public.nexus_v4400_cron_lock(
 jobid bigint primary key,jobname text not null,schedule text not null,was_active boolean not null,
 locked_inactive boolean not null default true check(locked_inactive),
 technical_permanence_guaranteed boolean not null default false check(not technical_permanence_guaranteed),
 reason text not null,locked_at timestamptz not null default clock_timestamp());
insert into public.nexus_v4400_cron_lock(jobid,jobname,schedule,was_active,reason)
select jobid,jobname,schedule,active,'v4400 known legacy timed poller retained inactive; event-driven path only'
from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65);
do $disable$declare r record;begin for r in select jobid from public.nexus_v4400_cron_lock loop perform cron.alter_job(r.jobid,active=>false);end loop;exception when others then raise;end$disable$;
revoke all on public.nexus_v4400_cron_lock from public,anon,authenticated,service_role;

-- The three complete bindings are locked by metadata only. Placement URLs and
-- script bodies are neither selected nor copied into v4400 objects.
create table public.nexus_v4400_impression_policy(
 host text primary key check(host in('achadinhos-ad-engine.vercel.app','aquitemachadinhos.com.br','solvegrid.com.br')),
 existing_popunder_bound boolean not null check(existing_popunder_bound),
 existing_socialbar_bound boolean not null check(existing_socialbar_bound),
 expected_binding_header text not null default'pop=bound;sb=bound'check(expected_binding_header='pop=bound;sb=bound'),
 placement_mutation_allowed boolean not null default false check(not placement_mutation_allowed),
 shadow_dom_injection_enabled boolean not null default false check(not shadow_dom_injection_enabled),
 automatic_impression_enabled boolean not null default false check(not automatic_impression_enabled),
 is_bot_false_proves_humanity boolean not null default false check(not is_bot_false_proves_humanity),
 kv_404_fallback_enabled boolean not null default false check(not kv_404_fallback_enabled),
 direct_affiliate_fallback_enabled boolean not null default false check(not direct_affiliate_fallback_enabled),
 sub_50ms_guaranteed boolean not null default false check(not sub_50ms_guaranteed),
 commission_lossless_guaranteed boolean not null default false check(not commission_lossless_guaranteed),
 reason text not null,checked_at timestamptz not null default clock_timestamp());
insert into public.nexus_v4400_impression_policy(host,existing_popunder_bound,existing_socialbar_bound,reason)
select host,true,true,'Original placement remains immutable; automatic/Shadow DOM impression rendering is not authorized by verified anti-IVT evidence.'
from public.nexus_host_tag_alignment where host in('achadinhos-ad-engine.vercel.app','aquitemachadinhos.com.br','solvegrid.com.br')and is_active and popunder_url is not null and socialbar_url is not null;
revoke all on public.nexus_v4400_impression_policy from public,anon,authenticated,service_role;

create table public.nexus_v4400_model_catalog_lock(
 provider text not null,model_id text not null,catalog_present boolean not null,catalog_price_zero_observed boolean not null,
 enabled_in_broker boolean not null,cost_zero_guaranteed boolean not null default false check(not cost_zero_guaranteed),
 availability_guaranteed boolean not null default false check(not availability_guaranteed),observed_at timestamptz not null,
 primary key(provider,model_id),check(enabled_in_broker=(catalog_present and catalog_price_zero_observed)));
insert into public.nexus_v4400_model_catalog_lock values
('openrouter','meta-llama/llama-3-8b-instruct:free',false,false,false,false,false,clock_timestamp()),
('openrouter','liquid/lfm-2.5-2.6b:free',true,true,true,false,false,clock_timestamp());
revoke all on public.nexus_v4400_model_catalog_lock from public,anon,authenticated,service_role;

-- Wrapper over the already verified v4310 selector. No new table scan, URL
-- persistence, public PostgREST grant, redirect, or impression side effect.
create or replace function public.nexus_v4400_campaign_select(p_headers jsonb,p_network text default'auto',p_product_url text default null,p_offer_key text default null)
returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
declare r jsonb;begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 r:=public.nexus_v4310_campaign_select(p_headers,p_network,p_product_url,p_offer_key);
 return r||jsonb_build_object('matrix_version','v4400.0','render_action','existing_protected_interstitial_only','shadow_dom_injection_enabled',false,'automatic_impression_enabled',false,'billable_impression_claimed',false,'is_bot_false_proves_humanity',false,'kv_404_fallback_enabled',false,'direct_affiliate_fallback_enabled',false,'sub_1ms_guaranteed',false,'sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false);
exception when others then raise;end$function$;
revoke all on function public.nexus_v4400_campaign_select(jsonb,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.nexus_v4400_campaign_select(jsonb,text,text,text)to service_role;

-- Diagnostic-only event path. It cannot represent or submit a network-billable
-- impression. The LOGGED outbox and NOTIFY are committed atomically.
create table public.nexus_v4400_impression_diagnostic_ledger(
 diagnostic_id uuid primary key default gen_random_uuid(),event_sha256 text not null unique check(event_sha256~'^[0-9a-f]{64}$'),
 host text not null references public.nexus_v4400_impression_policy(host)on delete restrict,
 measurement_source text not null check(measurement_source in('synthetic_fixture','operator_authorized_diagnostic')),
 country_hint text check(country_hint is null or country_hint~'^[A-Z]{2}$'),http_status integer check(http_status between 100 and 599),
 binding_observed text check(binding_observed is null or binding_observed='pop=bound;sb=bound'),
 billable_impression_claimed boolean not null default false check(not billable_impression_claimed),
 ad_network_request_performed boolean not null default false check(not ad_network_request_performed),
 automatic_render_performed boolean not null default false check(not automatic_render_performed),
 human_or_residential_proven boolean not null default false check(not human_or_residential_proven),
 affiliate_click_performed boolean not null default false check(not affiliate_click_performed),
 recorded_at timestamptz not null default clock_timestamp());
create index nexus_v4400_diagnostic_time_idx on public.nexus_v4400_impression_diagnostic_ledger(recorded_at desc,diagnostic_id);
create table public.nexus_v4400_impression_diagnostic_outbox(
 outbox_id bigint generated always as identity primary key,diagnostic_id uuid not null unique references public.nexus_v4400_impression_diagnostic_ledger(diagnostic_id)on delete restrict,
 payload jsonb not null check(jsonb_typeof(payload)='object'),state text not null default'pending'check(state in('pending','delivered','dead_letter')),
 created_at timestamptz not null default clock_timestamp(),delivered_at timestamptz,
 check(not(payload?'affiliate_url')and not(payload?'placement_url')and not(payload?'raw_html')));
revoke all on public.nexus_v4400_impression_diagnostic_ledger,public.nexus_v4400_impression_diagnostic_outbox from public,anon,authenticated,service_role;
revoke all on sequence public.nexus_v4400_impression_diagnostic_outbox_outbox_id_seq from public,anon,authenticated,service_role;

create or replace function public.nexus_v4400_diagnostic_to_outbox()returns trigger language plpgsql security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 insert into public.nexus_v4400_impression_diagnostic_outbox(diagnostic_id,payload)values(new.diagnostic_id,jsonb_build_object('version','v4400.0','diagnostic_id',new.diagnostic_id,'host',new.host,'http_status',new.http_status,'binding_observed',new.binding_observed,'billable_impression_claimed',false,'automatic_render_performed',false));return new;
exception when others then raise;end$function$;
create trigger trg_v4400_diagnostic_to_outbox after insert on public.nexus_v4400_impression_diagnostic_ledger for each row execute function public.nexus_v4400_diagnostic_to_outbox();
create or replace function public.nexus_v4400_notify_diagnostic()returns trigger language plpgsql security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);perform pg_notify('nexus_v4400_diagnostic',jsonb_build_object('outbox_id',new.outbox_id,'diagnostic_id',new.diagnostic_id)::text);return null;
exception when others then raise;end$function$;
create trigger trg_v4400_notify_diagnostic after insert on public.nexus_v4400_impression_diagnostic_outbox for each row execute function public.nexus_v4400_notify_diagnostic();

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
('v4400_master_sql',true,jsonb_build_object('diagnostic_ledger','LOGGED','diagnostic_outbox','LOGGED','automatic_impression_enabled',false),clock_timestamp()),
('v4400_campaign_selector',false,jsonb_build_object('reason','awaiting bounded runtime benchmark','sub_1ms_guaranteed',false),clock_timestamp()),
('v4400_fleet_safety_gate',false,jsonb_build_object('reason','awaiting 14-project deployment'),clock_timestamp()),
('v4400_shadow_dom_impression_renderer',false,jsonb_build_object('reason','would mutate protected rendering behavior and lacks anti-IVT authorization'),clock_timestamp()),
('v4400_permanent_websocket_runtime',false,jsonb_build_object('reason','Deno Edge request lifecycle is not a durable process supervisor','continuous_24x7_proven',false),clock_timestamp()),
('v4400_kv_404_affiliate_fallback',false,jsonb_build_object('reason','KV binding and protected artifact alignment not verified','sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$declare b record;p "char";begin
 select*into b from pg_temp.nexus_v4400_baseline;if b.ads<>14301 or b.active_ads<>12165 or b.keywords<>17605 or b.vectors<>11568 or b.shopee<>1201 then raise exception 'v4400 protected baseline drift';end if;
 if(select count(*)from public.nexus_v4400_impression_policy)<>3 then raise exception 'v4400 complete host binding count drift';end if;
 if exists(select 1 from public.nexus_v4400_impression_policy where placement_mutation_allowed or shadow_dom_injection_enabled or automatic_impression_enabled or is_bot_false_proves_humanity or kv_404_fallback_enabled or direct_affiliate_fallback_enabled)then raise exception 'v4400 unsafe impression policy enabled';end if;
 if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)and active)then raise exception 'v4400 legacy poller active';end if;
 if not exists(select 1 from cron.job where jobid=60 and jobname='v360-tg-flush-10s'and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v4400 Job 60 drift';end if;
 if(select pg_get_functiondef('public.nexus_v1510_flush_event(integer)'::regprocedure)not like'%v_minute>=3 or v_hour>=40%')then raise exception 'v4400 pacer drift';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v4400_impression_diagnostic_ledger'::regclass;if p<>'p'::"char"then raise exception 'v4400 diagnostic ledger not LOGGED';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v4400_impression_diagnostic_outbox'::regclass;if p<>'p'::"char"then raise exception 'v4400 diagnostic outbox not LOGGED';end if;
 if(select count(*)from public.nexus_v4310_tracking_lock where credential_or_inventory_verified)<>5 then raise exception 'v4400 tracking lock drift';end if;
 if exists(select 1 from public.nexus_v4400_model_catalog_lock where not catalog_present and enabled_in_broker)then raise exception 'v4400 absent model enabled';end if;
 if has_function_privilege('anon','public.nexus_v4400_campaign_select(jsonb,text,text,text)','EXECUTE')or has_function_privilege('authenticated','public.nexus_v4400_campaign_select(jsonb,text,text,text)','EXECUTE')then raise exception 'v4400 selector exposed';end if;
 if(select count(*)from public.ads)<>b.ads or(select count(*)from public.nexus_v370_keyword_source)<>b.keywords then raise exception 'v4400 catalog changed';end if;
exception when others then raise;end$assert$;
commit;
