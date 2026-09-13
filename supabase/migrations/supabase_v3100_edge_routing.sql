-- Nexus v3100.0 — bounded CDN routing and legacy-poller quarantine.
-- Master project: etbxbaaaspdcoiakifbb.
--
-- Truth boundaries:
-- - CDN country headers are routing hints, never proof of a human/residential user.
-- - Existing encrypted v360 campaign material is reused; no affiliate credential is
--   copied into source code.
-- - /api/ads/go and programmatic placements are not modified.
-- - No KV binding, sub-50ms fallback, lossless commission, p99, or 24/7 claim is made.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- ---------------------------------------------------------------------------
-- 1. Quarantine catalog-identified timed pollers. Job 60 and the bounded v3010
-- durable queues are explicit non-legacy exceptions and remain unchanged.
-- PostgreSQL can make this state transactional; it cannot promise that no future
-- administrator will reactivate a job, so no "permanent" claim is recorded.
-- ---------------------------------------------------------------------------
with expected(jobid,jobname) as (values
  (21::bigint,'nexus-hunt-retry-sweeper'::text),
  (35::bigint,'v27-queue-drain-10min'::text),
  (36::bigint,'v99-galaxy-wave-sweep-2min'::text),
  (38::bigint,'v102-adsterra-watch'::text),
  (40::bigint,'v110-satellite-pull'::text),
  (47::bigint,'v255-guard-tags'::text),
  (48::bigint,'v255-guard-tags-close'::text)
)
insert into public.nexus_v360_cron_quarantine(
  jobid,jobname,schedule,command,motivo,desativado_em
)
select j.jobid,j.jobname,j.schedule,j.command,
       'v3100: legacy timed polling quarantined; no hot-table scan loop',
       clock_timestamp()
  from cron.job j join expected e using(jobid,jobname)
on conflict(jobid) do update set
  jobname=excluded.jobname,
  schedule=excluded.schedule,
  command=excluded.command,
  motivo=excluded.motivo,
  desativado_em=excluded.desativado_em;

do $cron$
declare r record;
begin
  for r in
    select j.jobid
      from cron.job j
      join (values
        (21::bigint,'nexus-hunt-retry-sweeper'::text),
        (35::bigint,'v27-queue-drain-10min'::text),
        (36::bigint,'v99-galaxy-wave-sweep-2min'::text),
        (38::bigint,'v102-adsterra-watch'::text),
        (40::bigint,'v110-satellite-pull'::text),
        (47::bigint,'v255-guard-tags'::text),
        (48::bigint,'v255-guard-tags-close'::text)
      ) e(jobid,jobname) using(jobid,jobname)
     where j.active
  loop
    perform cron.alter_job(job_id=>r.jobid,active=>false);
  end loop;
end
$cron$;

-- Reassert the already-quarantined <=5-minute pollers without assuming that every
-- historical job still exists.
do $cron$
declare r record;
begin
  for r in select jobid from cron.job
            where jobid in(15,16,18,41,44,62,63,64,65) and active
  loop
    perform cron.alter_job(job_id=>r.jobid,active=>false);
  end loop;
end
$cron$;

-- ---------------------------------------------------------------------------
-- 2. Strict adapter for explicitly supplied raw CDN headers.
-- PostgreSQL does not see HTTP headers by itself: a trusted Edge caller must pass
-- them as JSONB. Cloudflare wins over Vercel when both are present.
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
      return jsonb_build_object(
        'estado','Sintonizado em Análise','motivo','headers_invalidos',
        'destino',null,'human_or_residential_proven',false);
    end if;

    select upper(btrim(e.value)),lower(e.key)
      into v_country,v_source
      from jsonb_each_text(p_headers) e
     where lower(e.key) in('cf-ipcountry','x-vercel-ip-country')
       and btrim(e.value)<>''
     order by case lower(e.key) when 'cf-ipcountry' then 0 else 1 end,
              lower(e.key),e.key,e.value
     limit 1;

    if v_country is null or v_country!~'^[A-Z]{2}$' or v_country in('XX','T1') then
      return jsonb_build_object(
        'estado','Sintonizado em Análise','motivo','cdn_country_unavailable',
        'geo_source',coalesce(v_source,'none'),'destino',null,
        'cdn_country_is_routing_hint',true,
        'human_or_residential_proven',false);
    end if;
    if p_gateway_base!~'^https://[A-Za-z0-9.-]+(?::[0-9]+)?/?$' then
      return jsonb_build_object(
        'estado','Sintonizado em Análise','motivo','gateway_base_invalido',
        'destino',null,'human_or_residential_proven',false);
    end if;

    -- This selector reads the already encrypted v360 campaign material.
    v_route:=public.nexus_v360_geo_route(v_country,p_intent);
    if coalesce(v_route->>'estado','')<>'ok' then
      return v_route||jsonb_build_object(
        'version','v3100.0','geo_source',v_source,'country',v_country,
        'cdn_country_is_routing_hint',true,
        'human_or_residential_proven',false,
        'kv_fallback_enabled',false,
        'fallback_latency_guaranteed',false,
        'commission_lossless_guaranteed',false);
    end if;

    v_brand:=case v_route->>'rede'
      when 'mercado_livre' then 'mercadolivre'
      when 'shopee_br' then 'shopee'
      when 'ebay_epn' then 'ebay'
      when 'booking' then 'booking'
      else null end;
    if v_brand is null then
      return jsonb_build_object(
        'estado','Sintonizado em Análise','motivo','rede_sem_gateway',
        'country',v_country,'destino',null,
        'human_or_residential_proven',false);
    end if;

    v_gateway:=rtrim(p_gateway_base,'/')||'/api/ads/go?brand='||v_brand||
      '&geo='||v_country;
    return v_route||jsonb_build_object(
      'version','v3100.0','country',v_country,'geo_source',v_source,
      'cdn_country_is_routing_hint',true,
      'interstitial_url',v_gateway,'interstitial_path','/api/ads/go',
      'binding_header_expected','pop=bound;sb=bound',
      'human_or_residential_proven',false,
      'kv_fallback_enabled',false,
      'direct_merchant_fallback_enabled',false,
      'fallback_latency_guaranteed',false,
      'commission_lossless_guaranteed',false,
      'p99_latency_claimed',false);
  exception when others then
    perform public.nexus_v420_sintonizado(
      'v3100-route',coalesce(v_country,'unknown'),
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object(
      'estado','Sintonizado em Análise','motivo','erro_roteador',
      'destino',null,'human_or_residential_proven',false);
  end;
end;
$function$;

revoke all on function public.nexus_v3000_route_from_cdn(jsonb,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3000_route_from_cdn(jsonb,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Truthful capability state.
-- ---------------------------------------------------------------------------
insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)
values
 ('v3100_edge_router',true,jsonb_build_object(
    'master_project','etbxbaaaspdcoiakifbb',
    'cf_ipcountry_precedence',true,
    'vercel_country_supported',true,
    'cdn_country_is_human_proof',false,
    'encrypted_v360_selector_reused',true,
    'gateway_source_modified',false,
    'p99_latency_measured',false),clock_timestamp()),
 ('v3100_legacy_pollers_quarantined',true,jsonb_build_object(
    'jobids',jsonb_build_array(21,35,36,38,40,47,48),
    'job_60_preserved',true,
    'v3010_bounded_jobs_preserved',true,
    'future_reactivation_impossible',false),clock_timestamp()),
 ('v3100_kv_fallback',false,jsonb_build_object(
    'reason','no verified KV namespace/binding or measured fallback path',
    'sub_50ms_guaranteed',false,
    'lossless_commission_guaranteed',false),clock_timestamp()),
 ('v3100_shadow_dom_placements',false,jsonb_build_object(
    'reason','programmatic placements protected; no duplicate DOM placement allowed'),clock_timestamp()),
 ('v3100_satellite_deployment',false,jsonb_build_object(
    'master_sql_applied',true,'satellites_deployed',0,
    'reason','master database function; no duplicate satellite patch required'),clock_timestamp()),
 ('v3100_continuous_runtime',false,jsonb_build_object(
    'reason','no permanently resident runtime provisioned or proven'),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

-- ---------------------------------------------------------------------------
-- 4. Atomic invariants.
-- ---------------------------------------------------------------------------
do $assert$
begin
  if (select count(*) from public.ads)<>14301 then
    raise exception 'public.ads cardinality drifted from read-only 14301';
  end if;
  if (select count(*) from public.nexus_v370_keyword_source)<>17605 then
    raise exception 'canonical keyword cardinality drifted from 17605';
  end if;
  if exists(select 1 from cron.job
             where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)
               and active) then
    raise exception 'catalog-identified timed poller remains active';
  end if;
  if not exists(select 1 from cron.job
                 where jobid=60 and active and schedule='10 seconds'
                   and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'Job 60 pacing or command drifted';
  end if;
  if not exists(select 1 from cron.job
                 where jobname='v3010-indexnow-durable-10min' and active)
     or not exists(select 1 from cron.job
                    where jobname='v3010-trends-hourly' and active) then
    raise exception 'bounded v3010 schedules drifted';
  end if;
  if has_function_privilege(
       'anon','public.nexus_v3000_route_from_cdn(jsonb,text,text)','EXECUTE')
     or has_function_privilege(
       'authenticated','public.nexus_v3000_route_from_cdn(jsonb,text,text)','EXECUTE') then
    raise exception 'internal CDN router exposed to public roles';
  end if;
end
$assert$;

commit;
