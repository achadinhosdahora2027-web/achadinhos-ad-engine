-- Nexus v3010.0 — production evidence observed after deployment
-- Scope: master project etbxbaaaspdcoiakifbb only.
-- This records HTTP receipts and database state, not crawl/indexing guarantees.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';

do $assert$
begin
  if not exists (
    select 1 from public.nexus_v3010_trends_requests
     where state='succeeded' and http_status=201
  ) then
    raise exception 'no reconciled HTTP 201 Trends receipt';
  end if;
  if not exists (
    select 1 from public.nexus_v3010_indexnow_queue
     where source_table='site_pages_inventory'
       and state='confirmed' and last_http_status in (200,202)
  ) then
    raise exception 'no reconciled HTTP 200/202 IndexNow receipt';
  end if;
  if (select count(*) from public.nexus_v370_keyword_source)<>17605 then
    raise exception 'canonical keyword cardinality drifted from 17605';
  end if;
  if (select count(*) from public.ads)<>14301 then
    raise exception 'public.ads cardinality drifted from read-only 14301';
  end if;
  if exists(select 1 from cron.job where jobid in(15,16,64) and active) then
    raise exception 'required inactive legacy jobs are active';
  end if;
  if exists(select 1 from cron.job where jobid in(23,33) and active) then
    raise exception 'superseded IndexNow jobs are active';
  end if;
  if not exists(
    select 1 from cron.job
     where jobid=60 and active and schedule='10 seconds'
       and command='select public.nexus_v1510_flush_event(40);'
  ) then
    raise exception 'Job 60 pacing drifted';
  end if;
  if not exists(
    select 1 from cron.job
     where jobname='v3010-indexnow-durable-10min' and active
       and schedule='*/10 * * * *'
       and command='select public.nexus_v3010_indexnow_cycle();'
  ) then
    raise exception 'v3010 IndexNow schedule drifted';
  end if;
  if not exists(
    select 1 from cron.job
     where jobname='v3010-trends-hourly' and active
       and schedule='17 * * * *'
       and command='select public.nexus_v3010_request_trends();'
  ) then
    raise exception 'v3010 Trends schedule drifted';
  end if;
end
$assert$;

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'logged',true,
      'geo','BR',
      'max_items_per_feed',20,
      'staged_rows_observed',(select count(*) from public.nexus_v3010_trends_staging),
      'matched_rows_observed',(select count(*) from public.nexus_v3010_trend_keyword_matches),
      'http_201_receipts_observed',(select count(*) from public.nexus_v3010_trends_requests where state='succeeded' and http_status=201),
      'edge_ingest_verified',true,
      'canonical_keyword_count_observed',(select count(*) from public.nexus_v370_keyword_source),
      'canonical_keyword_writes_authorized',false,
      'canonical_keywords_modified_by_worker',false,
      'edge_deployment_scope','master_only',
      'edge_projects_deployed',1,
      'continuous_24x7_guaranteed',false
    ),
    checked_at=clock_timestamp()
where capability='v3010_trends_staging';

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'logged',true,
      'endpoint','https://api.indexnow.org/indexnow',
      'live_probe_required',true,
      'request_id_is_not_success',true,
      'custom_user_agent_sent',false,
      'source_relation','site_pages_inventory',
      'confirmed_receipts_observed',(select count(*) from public.nexus_v3010_indexnow_queue where source_table='site_pages_inventory' and state='confirmed' and last_http_status in(200,202)),
      'delivery_verified',true,
      'crawl_or_indexing_proven',false,
      'google_indexing_claimed',false
    ),
    checked_at=clock_timestamp()
where capability='v3010_indexnow_durable';

update public.nexus_v3000_capability_registry
set enabled=true,
    evidence=jsonb_build_object(
      'go_js_modified',false,
      'compose_ts_modified',false,
      'protected_files_unchanged',true,
      'adsterra_binding_header_preserved','pop=bound;sb=bound',
      'duplicate_placements_added',false,
      'artificial_urgency_added',false,
      'expiry_timer_added',false,
      'affiliate_disclosure_preserved',true
    ),
    checked_at=clock_timestamp()
where capability='v3010_ui_compliance';

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)
values (
  'v3010_scheduler_state',true,
  jsonb_build_object(
    'job_60_active',true,
    'job_60_schedule','10 seconds',
    'jobs_15_16_64_active',false,
    'jobs_23_33_active',false,
    'indexnow_schedule','*/10 * * * *',
    'trends_schedule','17 * * * *'
  ),
  clock_timestamp()
)
on conflict(capability) do update set
  enabled=excluded.enabled,
  evidence=excluded.evidence,
  checked_at=excluded.checked_at;

commit;
