-- Nexus v3100/v3200 — measured post-deployment evidence.
-- External observations are explicitly labeled; no receipt is upgraded into a
-- publication, human, conversion, latency-SLA, or permanent-runtime claim.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';

do $assert$
declare
  v_br jsonb;
  v_us jsonb;
  v_gb jsonb;
begin
  if (select count(*) from public.ads)<>14301 then
    raise exception 'public.ads cardinality drifted from read-only 14301';
  end if;
  if (select count(*) from public.nexus_v370_keyword_source)<>17605 then
    raise exception 'canonical keyword cardinality drifted from 17605';
  end if;
  if (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then
    raise exception 'local keyword vector cardinality drifted from 11568';
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
  if not exists(select 1 from public.nexus_v3200_copy_policies
                 where policy_version='v3200.0' and active
                   and directives->>'organic_consumer_impersonation'='false'
                   and directives->>'false_endorsement_allowed'='false'
                   and directives->>'disclosure_own_line_before_link'='true') then
    raise exception 'v3200 factual copy policy drifted';
  end if;

  v_br:=public.nexus_v3000_route_from_cdn('{"CF-IPCountry":"BR"}'::jsonb,'oferta');
  v_us:=public.nexus_v3000_route_from_cdn('{"x-vercel-ip-country":"US"}'::jsonb,'oferta');
  v_gb:=public.nexus_v3000_route_from_cdn('{"cf-ipcountry":"GB"}'::jsonb,'hotel');
  if v_br->>'country'<>'BR' or v_br->>'rede' not in('mercado_livre','shopee_br')
     or v_us->>'country'<>'US' or v_us->>'rede'<>'ebay_epn'
     or v_gb->>'country'<>'GB' or v_gb->>'rede'<>'booking' then
    raise exception 'v3100 observed route fixture drifted';
  end if;
  if v_br->>'human_or_residential_proven'<>'false'
     or v_us->>'human_or_residential_proven'<>'false'
     or v_gb->>'human_or_residential_proven'<>'false' then
    raise exception 'CDN routing incorrectly claims human/residential proof';
  end if;
end
$assert$;

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'master_project','etbxbaaaspdcoiakifbb',
      'cf_ipcountry_precedence',true,
      'vercel_country_supported',true,
      'br_route_observed','mercado_livre',
      'us_route_observed','ebay_epn',
      'gb_travel_route_observed','booking',
      'cdn_country_is_human_proof',false,
      'encrypted_v360_selector_reused',true,
      'gateway_source_modified',false,
      'warm_cache_sample_n',200,
      'warm_cache_sample_p50_ms',0.934,
      'warm_cache_sample_p95_ms',1.022,
      'warm_cache_sample_p99_ms',1.256,
      'warm_cache_sample_max_ms',20.165,
      'latency_sla_or_guarantee',false,
      'under_1ms_guaranteed',false
    ),checked_at=clock_timestamp()
where capability='v3100_edge_router';

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'policy_version','v3200.0',
      'factual_assistance',true,
      'organic_consumer_impersonation',false,
      'personal_experience_claimed',false,
      'false_endorsement_allowed',false,
      'verified_facts_only',true,
      'disclosure_own_line_before_link',true,
      'runtime_preview_http_status',200,
      'publication_claimed',false,
      'human_or_residential_proven',false
    ),checked_at=clock_timestamp()
where capability='v3200_copy_policy';

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'service_role_only',true,
      'hmac_required',true,
      'pacing_per_channel','3/min and 40/hour',
      'policy_tagged_intents_observed',(
        select count(*) from public.nexus_v1510_content_triggers
         where copy_policy_version='v3200.0'),
      'publication_receipt_required_separately',true
    ),checked_at=clock_timestamp()
where capability='v3200_signed_content_intents';

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'master_deployed',true,
      'master_projects_deployed',1,
      'satellites_deployed',0,
      'function','nexus-copywriter-v3200',
      'management_status','ACTIVE',
      'management_version',1,
      'verify_jwt',true,
      'get_http_status',200,
      'post_http_status',200,
      'side_effects',false,
      'deployment_scope','master_only',
      'duplicate_publishers_created',false
    ),checked_at=clock_timestamp()
where capability='v3200_edge_copywriter_deployment';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values (
  'v3200_protected_surfaces',true,
  jsonb_build_object(
    'api_ads_go_modified',false,
    'compose_ts_modified',false,
    'api_ads_go_sha256','e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716',
    'compose_ts_sha256','d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0',
    'binding_header_preserved','pop=bound;sb=bound',
    'shadow_dom_added',false,
    'placement_added_or_duplicated',false
  ),clock_timestamp()
)
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

commit;
