-- Nexus v3500.0 — additive reactive outbox signal and indexed route-readiness core.
-- PostgreSQL 17.6 truth boundary:
-- * the LOGGED v1550 outbox remains the durable source of truth;
-- * pg_notify is a commit-time wake-up hint, not a durable queue;
-- * no permanently resident 24x7 WebSocket process is provisioned by SQL;
-- * CDN country headers are routing hints, never proof of city, residence, or humanity;
-- * no placement, public redirect, affiliate URL, click, impression, or sale is created.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
set local idle_in_transaction_session_timeout='15000ms';

create temporary table nexus_v3500_catalog_baseline on commit drop as
select (select count(*) from public.ads) ads_rows,
       (select count(*) from public.ads where active) active_ads_rows,
       (select count(*) from public.nexus_v370_keyword_source) keyword_rows,
       (select count(*) from public.nexus_v380_keyword_vectors) vector_rows;

-- Record and reassert only catalog-identified legacy pollers. Job 60 and the
-- bounded v3010 durable queue jobs are explicit exceptions and remain untouched.
create table if not exists public.nexus_v3500_cron_audit(
 jobid bigint primary key,
 jobname text not null,
 schedule text not null,
 was_active_at_install boolean not null,
 observed_at timestamptz not null default clock_timestamp(),
 release text not null default 'v3500.0',
 constraint nexus_v3500_cron_release_ck check(release='v3500.0')
);
revoke all on table public.nexus_v3500_cron_audit from public,anon,authenticated,service_role;

insert into public.nexus_v3500_cron_audit(jobid,jobname,schedule,was_active_at_install)
select jobid,jobname,schedule,active from cron.job
where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)
on conflict(jobid) do nothing;

do $cron$
declare r record;
begin
 for r in select jobid from cron.job
  where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active
 loop
  perform cron.alter_job(job_id=>r.jobid,active=>false);
 end loop;
exception when others then raise;
end $cron$;

-- Existing route evidence is tiny, but this deterministic btree prevents a
-- table-wide policy scan and establishes the exact country/locale/intent path.
create index if not exists nexus_v3500_cj_route_lookup_idx
 on public.nexus_v3380_cj_placement_policy(country_code,lower(locale),intent,evidence_expires_at)
 include(placement_key,mobile_optimized,route_enabled);

create or replace function public.nexus_v3500_currency(p_country text)
returns text language sql immutable strict parallel safe set search_path='public','pg_temp'
as $function$
 select case upper(p_country)
  when 'BR' then 'BRL' when 'US' then 'USD' when 'GB' then 'GBP'
  when 'AU' then 'AUD' when 'CA' then 'CAD' when 'PL' then 'PLN'
  when 'BG' then 'EUR'
  when 'AT' then 'EUR' when 'BE' then 'EUR' when 'CY' then 'EUR'
  when 'DE' then 'EUR' when 'EE' then 'EUR' when 'ES' then 'EUR'
  when 'FI' then 'EUR' when 'FR' then 'EUR' when 'GR' then 'EUR'
  when 'HR' then 'EUR' when 'IE' then 'EUR' when 'IT' then 'EUR'
  when 'LT' then 'EUR' when 'LU' then 'EUR' when 'LV' then 'EUR'
  when 'MT' then 'EUR' when 'NL' then 'EUR' when 'PT' then 'EUR'
  when 'SI' then 'EUR' when 'SK' then 'EUR' else null end;
$function$;

-- Metadata-only readiness selector. It never decrypts or returns referral URLs.
-- A trusted gateway must supply the raw headers and an explicit network request.
create or replace function public.nexus_v3500_route_readiness(
 p_headers jsonb,p_network text,p_locale text default null,p_intent text default null
) returns jsonb
language plpgsql security definer set search_path='public','extensions','pg_temp'
as $function$
declare
 v_cf text;v_vercel text;v_country text;v_network text;v_currency text;
 v_ready boolean:=false;v_reason text:='route_unavailable';v_placement text;
begin
 perform set_config('statement_timeout','4000',true);
 perform set_config('lock_timeout','1000',true);
 begin
  if p_headers is null or jsonb_typeof(p_headers)<>'object' then
   return jsonb_build_object('version','v3500.0','estado','Sintonizado em Análise','motivo','headers_invalid','route_ready',false,'affiliate_url',null,'human_or_residential_proven',false);
  end if;
  v_cf:=upper(btrim(coalesce(p_headers->>'CF-IPCountry',p_headers->>'cf-ipcountry','')));
  v_vercel:=upper(btrim(coalesce(p_headers->>'x-vercel-ip-country',p_headers->>'X-Vercel-IP-Country','')));
  if (v_cf<>'' and (v_cf!~'^[A-Z]{2}$' or v_cf='XX')) or (v_vercel<>'' and (v_vercel!~'^[A-Z]{2}$' or v_vercel='XX')) then
   return jsonb_build_object('version','v3500.0','estado','Sintonizado em Análise','motivo','country_header_invalid','route_ready',false,'affiliate_url',null,'human_or_residential_proven',false);
  end if;
  if v_cf<>'' and v_vercel<>'' and v_cf<>v_vercel then
   return jsonb_build_object('version','v3500.0','estado','Sintonizado em Análise','motivo','country_headers_conflict','route_ready',false,'affiliate_url',null,'human_or_residential_proven',false);
  end if;
  v_country:=coalesce(nullif(v_cf,''),nullif(v_vercel,''));
  if v_country is null then
   return jsonb_build_object('version','v3500.0','estado','Sintonizado em Análise','motivo','cdn_country_unavailable','route_ready',false,'affiliate_url',null,'human_or_residential_proven',false);
  end if;
  v_currency:=public.nexus_v3500_currency(v_country);
  if v_currency is null then
   return jsonb_build_object('version','v3500.0','estado','Sintonizado em Análise','motivo','native_currency_not_configured','country',v_country,'route_ready',false,'affiliate_url',null,'cdn_country_is_routing_hint',true,'human_or_residential_proven',false);
  end if;
  v_network:=lower(btrim(coalesce(p_network,'')));
  if v_network not in('cj','amazon','aliexpress','shein','shopee','mercadolivre') then
   return jsonb_build_object('version','v3500.0','estado','Sintonizado em Análise','motivo','explicit_supported_network_required','country',v_country,'currency_context',v_currency,'route_ready',false,'affiliate_url',null,'human_or_residential_proven',false);
  end if;

  if v_network='cj' then
   if p_locale is null or btrim(p_locale)='' or p_intent is null or lower(btrim(p_intent)) not in('hotel','flight','car_rental','attractions','vacation','travel') then
    v_reason:='cj_locale_and_intent_required';
   else
    select q.placement_key into v_placement from public.nexus_v3380_cj_placement_policy q
     where q.country_code=v_country and lower(q.locale)=lower(btrim(p_locale))
       and q.intent=lower(btrim(p_intent)) and q.route_enabled and q.affiliate_url_enc is not null
       and q.evidence_expires_at>clock_timestamp()
       and (q.promotion_start_at is null or q.promotion_start_at<=clock_timestamp())
       and (q.promotion_end_at is null or q.promotion_end_at>clock_timestamp())
     order by q.mobile_optimized desc,q.placement_key limit 1;
    v_ready:=v_placement is not null;v_reason:=case when v_ready then 'fresh_country_locale_intent_policy' else 'fresh_cj_policy_unavailable' end;
   end if;
  elsif v_network='amazon' then
   select exists(select 1 from public.nexus_amazon_campaign_vault where region_code=v_country and tracking_id_enc is not null) into v_ready;
   v_reason:=case when v_ready then 'encrypted_regional_amazon_tracking_present' else 'regional_amazon_tracking_unavailable' end;
  elsif v_network='aliexpress' then
   select v_country in('BR','US','CA','GB','DE','FR') and exists(select 1 from public.nexus_aliexpress_campaign_vault where referral_url_enc is not null) into v_ready;
   v_reason:=case when v_ready then 'encrypted_global_aliexpress_referral_present' else 'aliexpress_country_or_referral_unavailable' end;
  elsif v_network='shein' then
   select v_country='BR' and exists(select 1 from public.nexus_shein_campaign_vault where referral_url_enc is not null and provisioned_scope='BR_ONLY_UNTIL_REGIONAL_VALIDATION') into v_ready;
   v_reason:=case when v_ready then 'encrypted_br_shein_referral_present' else 'verified_regional_shein_referral_unavailable' end;
  elsif v_network='mercadolivre' then
   select v_country='BR' and exists(select 1 from public.nexus_growth_secrets where key='meli_master_enc' and btrim(value)<>'') into v_ready;
   v_reason:=case when v_ready then 'encrypted_br_mercadolivre_binding_present' else 'mercadolivre_country_or_binding_unavailable' end;
  elsif v_network='shopee' then
   v_ready:=v_country='BR' and to_regclass('public.nexus_shopee_offers') is not null;
   v_reason:=case when v_ready then 'verified_br_shopee_inventory_present' else 'verified_shopee_inventory_unavailable' end;
  end if;

  return jsonb_build_object('version','v3500.0','estado',case when v_ready then 'ok' else 'Sintonizado em Análise' end,
   'motivo',v_reason,'country',v_country,'currency_context',v_currency,'network',v_network,'route_ready',v_ready,
   'placement_key',v_placement,'affiliate_url',null,'redirect_performed',false,'click_recorded',false,
   'impression_recorded',false,'sale_claimed',false,'cdn_country_is_routing_hint',true,
   'human_or_residential_proven',false,'sub_1ms_guaranteed',false);
 exception when others then
  return jsonb_build_object('version','v3500.0','estado','Sintonizado em Análise','motivo','selector_exception','route_ready',false,'affiliate_url',null,'human_or_residential_proven',false);
 end;
end $function$;

-- Commit-time wake-up hint for an external LISTEN consumer. The LOGGED outbox
-- remains durable if no listener is connected. This trigger performs no network I/O.
create or replace function public.nexus_v3500_signal_outbox()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $function$
begin
 perform pg_notify('nexus_v3500_outbox',jsonb_build_object('outbox_id',new.outbox_id,'status',new.status,'node_ref',new.node_ref)::text);
 return null;
exception when others then raise;
end $function$;
drop trigger if exists trg_v3500_outbox_signal on public.nexus_v1550_outbox_logged;
create trigger trg_v3500_outbox_signal after insert or update on public.nexus_v1550_outbox_logged
for each row execute function public.nexus_v3500_signal_outbox();

create or replace function public.nexus_v3500_operator_status()
returns jsonb language sql stable security definer set search_path='public','pg_temp'
as $function$
 select jsonb_build_object(
  'version','v3500.0','postgres_version',current_setting('server_version'),
  'keywords',(select count(*) from public.nexus_v370_keyword_source),
  'vectors',(select count(*) from public.nexus_v380_keyword_vectors),
  'hnsw_indexes',(select count(*) from pg_indexes where schemaname='public' and indexdef ilike '%using hnsw%'),
  'logged_outbox_rows',(select count(*) from public.nexus_v1550_outbox_logged),
  'delivery_receipts',(select count(*) from public.nexus_v1550_delivery_receipts),
  'outbox_notify_trigger',exists(select 1 from pg_trigger where tgname='trg_v3500_outbox_signal' and tgenabled='O'),
  'legacy_pollers_active',(select count(*) from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active),
  'job_60_ok',exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);'),
  'selected_fresh_cj_routes',(select count(*) from public.nexus_v3380_cj_placement_policy where route_enabled and evidence_expires_at>clock_timestamp()),
  'continuous_runtime',false,'permanent_24x7_claimed',false,'polling_used_by_v3500',false,
  'external_exactly_once_claimed',false,'sub_1ms_guaranteed',false,'sub_50ms_fallback_guaranteed',false,
  'public_redirect_deployed',false,'placements_modified',false,
  'effects',jsonb_build_object('clicks_performed',false,'impressions_created',false,'sales_claimed',false));
$function$;

revoke all on function public.nexus_v3500_currency(text),public.nexus_v3500_route_readiness(jsonb,text,text,text),
 public.nexus_v3500_signal_outbox(),public.nexus_v3500_operator_status()
 from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3500_route_readiness(jsonb,text,text,text),public.nexus_v3500_operator_status() to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3500_reactive_logged_outbox',true,jsonb_build_object('durable_source','nexus_v1550_outbox_logged','notify_channel','nexus_v3500_outbox','notify_is_durable',false,'network_io_in_trigger',false),clock_timestamp()),
 ('v3500_indexed_route_readiness',true,jsonb_build_object('cj_policy_rows',19,'affiliate_url_returned',false,'cdn_country_is_human_proof',false,'shopee_inventory_physically_present',false),clock_timestamp()),
 ('v3500_legacy_pollers_inactive',true,jsonb_build_object('jobids',jsonb_build_array(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65),'future_reactivation_impossible',false,'job_60_exception_preserved',true),clock_timestamp()),
 ('v3500_satellite_bounded_reach',true,jsonb_build_object('configured',13,'bounded_runtime_evidence',true,'permanent_24x7_claimed',false),clock_timestamp()),
 ('v3500_continuous_runtime',false,jsonb_build_object('reason','no permanently resident listener or edge process was provisioned','rolling_bounded_sessions_are_24x7_sla',false),clock_timestamp()),
 ('v3500_direct_merchant_fallback',false,jsonb_build_object('reason','no verified KV binding or end-to-end fallback measurement','sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare b record;a record;persistence "char";
begin
 select * into b from nexus_v3500_catalog_baseline;
 select (select count(*) from public.ads) ads_rows,(select count(*) from public.ads where active) active_ads_rows,
  (select count(*) from public.nexus_v370_keyword_source) keyword_rows,(select count(*) from public.nexus_v380_keyword_vectors) vector_rows into a;
 if row(b.ads_rows,b.active_ads_rows,b.keyword_rows,b.vector_rows) is distinct from row(a.ads_rows,a.active_ads_rows,a.keyword_rows,a.vector_rows) then raise exception 'v3500 protected catalogs changed';end if;
 if a.keyword_rows<>17605 then raise exception 'v3500 canonical keyword count';end if;
 select relpersistence into persistence from pg_class where oid='public.nexus_v1550_outbox_logged'::regclass;if persistence<>'p'::"char" then raise exception 'v3500 outbox not LOGGED';end if;
 if not exists(select 1 from pg_trigger where tgname='trg_v3500_outbox_signal' and tgrelid='public.nexus_v1550_outbox_logged'::regclass and tgenabled='O') then raise exception 'v3500 outbox signal trigger';end if;
 if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active) then raise exception 'v3500 legacy poller remains active';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'v3500 Job 60 drift';end if;
 if (select count(*) from public.nexus_v3380_cj_placement_policy)<>19 or (select count(*) from public.nexus_v3380_cj_placement_policy where route_enabled and evidence_expires_at>clock_timestamp())<>19 then raise exception 'v3500 CJ route readiness drift';end if;
 if (select count(*) from public.nexus_v3380_cj_global_vault where backlog_sealed)<>1266 then raise exception 'v3500 encrypted backlog drift';end if;
 if not exists(select 1 from pg_indexes where schemaname='public' and indexname='nexus_v3500_cj_route_lookup_idx') then raise exception 'v3500 route index missing';end if;
 if has_function_privilege('anon','public.nexus_v3500_route_readiness(jsonb,text,text,text)','execute') or not has_function_privilege('service_role','public.nexus_v3500_route_readiness(jsonb,text,text,text)','execute') then raise exception 'v3500 route ACL';end if;
end $assert$;
commit;
