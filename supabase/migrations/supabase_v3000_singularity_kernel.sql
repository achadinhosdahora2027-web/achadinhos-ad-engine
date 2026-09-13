-- Nexus v3000.0 — Cosmic Traffic Singularity Kernel (cumulative safe core)
-- PostgreSQL 17.6 · additive · atomic · radical truth
--
-- This migration installs the database-side CDN-header router, quarantines
-- measured high-frequency polling jobs, hardens campaign decryption ACLs, and
-- records the actual deployment boundary. It does not modify public.ads,
-- /api/ads/go, programmatic tags, or claim a KV/24x7 runtime that is not bound.

begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- ---------------------------------------------------------------------------
-- 1. Quarantine only catalog-verified legacy pollers at <=5 minute cadence.
-- Job 60 is the explicit operator-approved 10-second queue flush exception.
-- ---------------------------------------------------------------------------
insert into public.nexus_v360_cron_quarantine(
  jobid,jobname,schedule,command,motivo,desativado_em)
select jobid,jobname,schedule,command,
       'v3000: polling/scan temporizado <=5min desativado; event-driven only',
       clock_timestamp()
  from cron.job
 where jobid in(15,16,18,41,44,62,63,64,65)
on conflict(jobid) do update
  set jobname=excluded.jobname,schedule=excluded.schedule,
      command=excluded.command,motivo=excluded.motivo,
      desativado_em=excluded.desativado_em;

select cron.alter_job(15,active=>false);
select cron.alter_job(16,active=>false);
select cron.alter_job(18,active=>false);
select cron.alter_job(41,active=>false);
select cron.alter_job(44,active=>false);
select cron.alter_job(62,active=>false);
select cron.alter_job(63,active=>false);
select cron.alter_job(64,active=>false);
select cron.alter_job(65,active=>false);

select cron.alter_job(60,
  schedule=>'10 seconds',
  command=>'select public.nexus_v1510_flush_event(40);',
  active=>true);

-- ---------------------------------------------------------------------------
-- 2. Header adapter over the existing encrypted v360 campaign selector.
-- PostgreSQL cannot inspect an HTTP request implicitly: the trusted Edge caller
-- must pass the CDN headers explicitly as JSONB. CF-IPCountry has precedence.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_v3000_route_from_cdn(
  p_headers jsonb,
  p_intent text default 'oferta',
  p_gateway_base text default 'https://achadinhos-ad-engine.vercel.app'
) returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
declare
  v_country text;
  v_source text;
  v_route jsonb;
  v_brand text;
  v_gateway text;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    if p_headers is null or jsonb_typeof(p_headers)<>'object' then
      return jsonb_build_object('estado','Sintonizado em Análise',
        'motivo','headers_invalidos','destino',null);
    end if;

    v_country:=upper(left(btrim(coalesce(
      p_headers->>'CF-IPCountry',p_headers->>'cf-ipcountry',
      p_headers->>'x-vercel-ip-country',p_headers->>'X-Vercel-IP-Country',
      p_headers->>'x-country-code','')),2));
    v_source:=case
      when coalesce(p_headers->>'CF-IPCountry',p_headers->>'cf-ipcountry','')<>''
        then 'cf-ipcountry'
      when coalesce(p_headers->>'x-vercel-ip-country',p_headers->>'X-Vercel-IP-Country','')<>''
        then 'x-vercel-ip-country'
      when coalesce(p_headers->>'x-country-code','')<>'' then 'x-country-code'
      else 'none' end;

    if v_country!~'^[A-Z]{2}$' or v_country in('XX','T1') then
      return jsonb_build_object('estado','Sintonizado em Análise',
        'motivo','cdn_country_unavailable','geo_source',v_source,
        'residential_human_claimed',false,'destino',null);
    end if;
    if p_gateway_base!~'^https://[a-zA-Z0-9.-]+(?::[0-9]+)?/?$' then
      return jsonb_build_object('estado','Sintonizado em Análise',
        'motivo','gateway_base_invalido','destino',null);
    end if;

    v_route:=public.nexus_v360_geo_route(v_country,p_intent);
    if coalesce(v_route->>'estado','')<>'ok' then
      return v_route||jsonb_build_object(
        'geo_source',v_source,'country',v_country,
        'residential_human_claimed',false);
    end if;

    v_brand:=case v_route->>'rede'
      when 'mercado_livre' then 'mercadolivre'
      when 'shopee_br' then 'shopee'
      when 'ebay_epn' then 'ebay'
      when 'booking' then 'booking'
      else null end;
    if v_brand is null then
      return jsonb_build_object('estado','Sintonizado em Análise',
        'motivo','rede_sem_gateway','country',v_country,'destino',null);
    end if;

    v_gateway:=rtrim(p_gateway_base,'/')||'/api/ads/go?brand='||v_brand||
      '&geo='||v_country;
    return v_route||jsonb_build_object(
      'version','v3000.0','country',v_country,'geo_source',v_source,
      'interstitial_url',v_gateway,'interstitial_path','/api/ads/go',
      'binding_header_expected','pop=bound;sb=bound',
      'residential_human_claimed',false,
      'kv_fallback_enabled',false);
  exception when others then
    perform public.nexus_v420_sintonizado('v3000-route',coalesce(v_country,'unknown'),
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object('estado','Sintonizado em Análise',
      'motivo','erro_roteador','destino',null);
  end;
end;
$function$;

-- The existing v360 selector decrypts campaign material. It is internal, not a
-- public PostgREST endpoint. The v3000 adapter is also service-role only.
revoke all on function public.nexus_v360_geo_route(text,text),
                       public.nexus_v3000_route_from_cdn(jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v360_geo_route(text,text),
                          public.nexus_v3000_route_from_cdn(jsonb,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Truth registry. False means not provisioned, never "planned = deployed".
-- ---------------------------------------------------------------------------
create table if not exists public.nexus_v3000_capability_registry(
  capability text primary key,
  enabled boolean not null,
  evidence jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default clock_timestamp()
);
alter table public.nexus_v3000_capability_registry enable row level security;
revoke all on public.nexus_v3000_capability_registry
  from public,anon,authenticated,service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)
values
 ('master_sql',true,jsonb_build_object('migration','supabase_v3000_singularity_kernel.sql'),clock_timestamp()),
 ('cdn_header_router',true,jsonb_build_object('cf_ipcountry_precedence',true,'gateway_untouched',true),clock_timestamp()),
 ('cloudflare_kv_binding',false,jsonb_build_object('reason','namespace/binding not verified'),clock_timestamp()),
 ('shadow_dom_ad_injection',false,jsonb_build_object('reason','programmatic media wiring protected'),clock_timestamp()),
 ('permanent_websocket_runtime',false,jsonb_build_object('reason','no durable runtime provisioned'),clock_timestamp()),
 ('satellite_edge_deploy_13',false,jsonb_build_object('deployed',0,'configured',13),clock_timestamp())
on conflict(capability) do update
 set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

create or replace function public.nexus_v3000_capabilities()
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
declare v_result jsonb;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    select coalesce(jsonb_object_agg(capability,
      jsonb_build_object('enabled',enabled,'evidence',evidence,'checked_at',checked_at)
      order by capability),'{}'::jsonb)
      into v_result from public.nexus_v3000_capability_registry;
    return v_result;
  exception when others then
    perform public.nexus_v420_sintonizado('v3000-capabilities',null,
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object('estado','Sintonizado em Análise');
  end;
end;
$function$;
revoke all on function public.nexus_v3000_capabilities()
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3000_capabilities() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Catalog assertions. They roll back the whole release on any mismatch.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_persistence "char";
  v_ads_before bigint;
begin
  select count(*) into v_ads_before from public.ads;
  if v_ads_before<1 then raise exception 'public.ads unexpectedly empty'; end if;

  select c.relpersistence into v_persistence
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='nexus_telegram_message_buffer';
  if v_persistence is distinct from 'u'::"char" then
    raise exception 'legacy telegram buffer is not UNLOGGED: %',v_persistence;
  end if;
  select c.relpersistence into v_persistence
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='nexus_v420_channel_outbox';
  if v_persistence is distinct from 'u'::"char" then
    raise exception 'active channel outbox is not UNLOGGED: %',v_persistence;
  end if;
  if exists(select 1 from cron.job
             where jobid in(15,16,18,41,44,62,63,64,65) and active) then
    raise exception 'high-frequency polling job remains active';
  end if;
  if not exists(select 1 from cron.job where jobid=60 and active
                 and schedule='10 seconds'
                 and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'paced Job 60 exception not preserved';
  end if;
  if has_function_privilege('anon',
      'public.nexus_v3000_route_from_cdn(jsonb,text,text)','EXECUTE') then
    raise exception 'v3000 internal router exposed to anon';
  end if;
end;
$assert$;

commit;
