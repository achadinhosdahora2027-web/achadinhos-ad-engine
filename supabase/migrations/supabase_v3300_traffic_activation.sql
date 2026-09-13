-- Nexus v3300.0 — factual activation policy and on-demand operator status.
-- Master project: etbxbaaaspdcoiakifbb.
--
-- Boundaries:
-- - No programmatic-media placement or /api/ads/go source is changed.
-- - CDN country is a routing hint, not human/residential evidence or a timezone.
-- - No CTR, conversion, affiliate revenue, sub-1ms, sub-50ms, lossless, or 24/7
--   guarantee is created.
-- - Status is computed on demand; this migration creates no polling job.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- ---------------------------------------------------------------------------
-- 1. Pin the active factual policy to v3200.0 and append v3300 boundaries.
-- Existing per-intent policy snapshots are immutable; new signed intents receive
-- this updated policy through nexus_v1510_queue_content_trigger.
-- ---------------------------------------------------------------------------
update public.nexus_v3200_copy_policies
   set active=true,
       directives=directives||jsonb_build_object(
         'activation_profile','v3300.0',
         'assistance_mode','neutral_product_support',
         'objective_question_resolution',true,
         'explicit_language_context_required',true,
         'timezone_inferred_from_country',false,
         'personal_experience_claimed',false,
         'organic_consumer_impersonation',false,
         'false_endorsement_allowed',false,
         'verified_facts_only',true,
         'disclosure_own_line_before_link',true,
         'ctr_or_conversion_guaranteed',false,
         'publication_claimed',false
       ),
       checked_at=clock_timestamp()
 where policy_version='v3200.0';

-- ---------------------------------------------------------------------------
-- 2. On-demand, bounded operator status. Every figure is labeled according to
-- its actual lifecycle stage: queue depth, submission, reconciled HTTP receipt,
-- or accepted content intent. It never calls a third party or scans by cron.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_v3300_operator_status()
returns jsonb
language plpgsql
security definer
set search_path='public','cron','pg_temp'
as $function$
declare
  v_result jsonb;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    select jsonb_build_object(
      'version','v3300.0',
      'observed_at',clock_timestamp(),
      'catalogs',jsonb_build_object(
        'ads_read_only_count',(select count(*) from public.ads),
        'canonical_keyword_count',(select count(*) from public.nexus_v370_keyword_source),
        'local_vector_count',(select count(*) from public.nexus_v380_keyword_vectors)
      ),
      'content_intents',jsonb_build_object(
        'queued',(select count(*) from public.nexus_v1510_content_triggers where state='queued'),
        'contained',(select count(*) from public.nexus_v1510_content_triggers where state='contained'),
        'v3200_policy_tagged',(select count(*) from public.nexus_v1510_content_triggers where copy_policy_version='v3200.0'),
        'last_hour',(select count(*) from public.nexus_v1510_content_triggers where queued_at>=clock_timestamp()-interval '1 hour'),
        'publication_proven',false
      ),
      'telegram',jsonb_build_object(
        'outbox_depth',(select count(*) from public.nexus_v420_channel_outbox),
        'outbox_by_channel',(select coalesce(jsonb_object_agg(channel_key,n),'{}'::jsonb)
          from (select channel_key,count(*) n from public.nexus_v420_channel_outbox group by channel_key) q),
        'submissions_last_minute',(select count(*) from public.nexus_v420_dispatch_log where submitted_at>=clock_timestamp()-interval '1 minute'),
        'submissions_last_hour',(select count(*) from public.nexus_v420_dispatch_log where submitted_at>=clock_timestamp()-interval '1 hour'),
        'reconciled_2xx_last_hour',(select count(*) from public.nexus_v420_dispatch_log where reconciled_at>=clock_timestamp()-interval '1 hour' and http_status between 200 and 299 and telegram_ok),
        'reconciled_failures_last_hour',(select count(*) from public.nexus_v420_dispatch_log where reconciled_at>=clock_timestamp()-interval '1 hour' and not coalesce(telegram_ok,false)),
        'submission_is_delivery_proof',false,
        'pacing_per_destination','3/min and 40/hour'
      ),
      'jobs',jsonb_build_object(
        'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobid=60),
        'job_70',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobid=70),
        'job_71',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobid=71)
      ),
      'routing',jsonb_build_object(
        'cdn_header_router_enabled',coalesce((select enabled from public.nexus_v3000_capability_registry where capability='v3100_edge_router'),false),
        'cdn_country_is_human_proof',false,
        'sub_1ms_guaranteed',false,
        'sub_50ms_fallback_guaranteed',false,
        'kv_fallback_verified',false
      ),
      'claims',jsonb_build_object(
        'realtime_human_traffic_proven',false,
        'ctr_guaranteed',false,
        'conversion_guaranteed',false,
        'commission_lossless_guaranteed',false,
        'continuous_24x7_proven',false,
        'fourteen_account_v3300_deploy_proven',false
      )
    ) into v_result;
    return v_result;
  exception when others then
    perform public.nexus_v420_sintonizado(
      'v3300-operator-status',null,sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object(
      'version','v3300.0','state','Sintonizado em Análise',
      'observed_at',clock_timestamp());
  end;
end;
$function$;

revoke all on function public.nexus_v3300_operator_status()
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3300_operator_status() to service_role;

-- ---------------------------------------------------------------------------
-- 3. Truthful registry.
-- ---------------------------------------------------------------------------
insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)
values
 ('v3300_factual_activation_policy',true,jsonb_build_object(
    'copy_policy_version','v3200.0',
    'activation_profile','v3300.0',
    'neutral_product_assistance',true,
    'organic_consumer_impersonation',false,
    'false_endorsement_allowed',false,
    'verified_facts_only',true,
    'ctr_or_conversion_guaranteed',false),clock_timestamp()),
 ('v3300_hybrid_cdn_routing',true,jsonb_build_object(
    'database_router_version','v3100.0',
    'cf_ipcountry_precedence',true,
    'cdn_country_is_human_proof',false,
    'gateway_source_modified',false,
    'cloudflare_project_deployed',false,
    'reason','no verified Cloudflare Management credential/project binding'),clock_timestamp()),
 ('v3300_fallback_anti_404',false,jsonb_build_object(
    'reason','no verified KV binding or measured Edge fallback path',
    'sub_50ms_guaranteed',false,
    'lossless_commission_guaranteed',false),clock_timestamp()),
 ('v3300_operator_status',true,jsonb_build_object(
    'mode','on_demand','polling_job_created',false,
    'submissions_distinguished_from_receipts',true,
    'service_role_only',true),clock_timestamp()),
 ('v3300_edge_deployment',false,jsonb_build_object(
    'master_deployed',false,'satellites_deployed',0,
    'reason','pending physical postdeploy verification'),clock_timestamp()),
 ('v3300_continuous_runtime',false,jsonb_build_object(
    'reason','no permanently resident runtime provisioned or proven'),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

-- ---------------------------------------------------------------------------
-- 4. Atomic production invariants.
-- ---------------------------------------------------------------------------
do $assert$
declare v_persistence "char";
begin
  if (select count(*) from public.ads)<>14301 then
    raise exception 'public.ads cardinality drifted from read-only 14301';
  end if;
  if (select count(*) from public.nexus_v370_keyword_source)<>17605 then
    raise exception 'canonical keyword cardinality drifted from 17605';
  end if;
  if (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then
    raise exception 'local vector cardinality drifted from 11568';
  end if;
  if not exists(select 1 from public.nexus_v3200_copy_policies
                 where policy_version='v3200.0' and active
                   and directives->>'activation_profile'='v3300.0'
                   and directives->>'organic_consumer_impersonation'='false'
                   and directives->>'false_endorsement_allowed'='false'
                   and directives->>'disclosure_own_line_before_link'='true') then
    raise exception 'v3300 factual policy pin failed';
  end if;
  if has_function_privilege('anon','public.nexus_v3300_operator_status()','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3300_operator_status()','EXECUTE') then
    raise exception 'operator status exposed to public roles';
  end if;
  select relpersistence into v_persistence
    from pg_class where oid='public.nexus_v420_channel_outbox'::regclass;
  if v_persistence<>'u'::"char" then
    raise exception 'active Telegram outbox is not UNLOGGED';
  end if;
  if not exists(select 1 from cron.job
                 where jobid=60 and active and schedule='10 seconds'
                   and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'Job 60 pacing or command drifted';
  end if;
  if not exists(select 1 from public.nexus_v420_channel_routes
                 where channel_key='grupo_cliques' and enabled
                   and chat_id=-1004417007577)
     or not exists(select 1 from public.nexus_v420_channel_routes
                    where channel_key='atendimento' and enabled
                      and chat_id=-1003951454560)
     or (select chat_id from public.nexus_v420_channel_routes where channel_key='grupo_cliques')
        is not distinct from
        (select chat_id from public.nexus_v420_channel_routes where channel_key='atendimento') then
    raise exception 'CLIQUES/CAPTURA room separation drifted';
  end if;
  if exists(select 1 from cron.job
             where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)
               and active) then
    raise exception 'quarantined timed poller reactivated';
  end if;
end
$assert$;

commit;
