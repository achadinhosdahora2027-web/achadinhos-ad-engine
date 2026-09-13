-- Nexus v3010.0 — safe cumulative Trends staging + durable IndexNow core.
-- PostgreSQL 17.6 / pg_net 0.20.x / pg_cron 1.6.x.
--
-- Boundaries:
-- - public.ads and the 17,605-keyword source remain read-only.
-- - Google Trends items are staged, never promoted into the canonical keyword set.
-- - IndexNow only receives same-host URLs after an observed HTTP 200 probe.
-- - net.http_* returning a request id is not treated as delivery success.
-- - /api/ads/go and compose.ts are not changed by this migration.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- ---------------------------------------------------------------------------
-- 1. LOGGED Google Trends staging. No DML targets the canonical keyword table.
-- ---------------------------------------------------------------------------
create table if not exists public.nexus_v3010_trends_staging (
  id                 bigint generated always as identity primary key,
  source_name        text not null default 'google_trends_rss',
  source_url         text not null default 'https://trends.google.com/trending/rss?geo=BR',
  geo                text not null default 'BR',
  term               text not null,
  normalized_term    text not null,
  approx_traffic     text,
  source_published_at timestamptz,
  feed_fetched_at    timestamptz not null,
  raw_payload        jsonb not null,
  item_hash          text not null,
  state              text not null default 'staged',
  staged_at          timestamptz not null default clock_timestamp(),
  constraint nexus_v3010_trends_geo_ck check (geo ~ '^[A-Z]{2}$'),
  constraint nexus_v3010_trends_term_ck check (length(term) between 2 and 200),
  constraint nexus_v3010_trends_normalized_ck check (length(normalized_term) between 2 and 200),
  constraint nexus_v3010_trends_hash_ck check (item_hash ~ '^[0-9a-f]{64}$'),
  constraint nexus_v3010_trends_state_ck check (state in ('staged','quarantined','reviewed')),
  unique(source_name,geo,item_hash)
);
alter table public.nexus_v3010_trends_staging set logged;
create index if not exists nexus_v3010_trends_recent_idx
  on public.nexus_v3010_trends_staging(geo,staged_at desc);

create table if not exists public.nexus_v3010_trend_keyword_matches (
  trend_id     bigint not null references public.nexus_v3010_trends_staging(id) on delete cascade,
  keyword      text not null,
  offer_hash   text,
  matched_at   timestamptz not null default clock_timestamp(),
  primary key(trend_id,keyword)
);
alter table public.nexus_v3010_trend_keyword_matches set logged;

create or replace function public.nexus_v3010_normalize_term(p_value text)
returns text
language sql
immutable
parallel safe
set search_path='pg_catalog','pg_temp'
as $function$
  select lower(regexp_replace(btrim(coalesce(p_value,'')), '[[:space:]]+', ' ', 'g'));
$function$;

create or replace function public.nexus_v3010_stage_trends(
  p_items jsonb,
  p_geo text default 'BR',
  p_fetched_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  v_item jsonb;
  v_term text;
  v_norm text;
  v_traffic text;
  v_published timestamptz;
  v_raw jsonb;
  v_hash text;
  v_id bigint;
  v_inserted integer:=0;
  v_duplicates integer:=0;
  v_matches integer:=0;
  v_rowcount integer;
  r_keyword record;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    if p_items is null or jsonb_typeof(p_items)<>'array'
       or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>20 then
      return jsonb_build_object('ok',false,'state','Sintonizado em Análise',
        'reason','items_must_be_array_1_to_20');
    end if;
    p_geo:=upper(left(btrim(coalesce(p_geo,'')),2));
    if p_geo<>'BR' then
      return jsonb_build_object('ok',false,'state','Sintonizado em Análise',
        'reason','only_geo_br_enabled');
    end if;

    for v_item in select value from jsonb_array_elements(p_items) loop
      v_term:=left(btrim(coalesce(v_item->>'term','')),200);
      v_norm:=public.nexus_v3010_normalize_term(v_term);
      v_traffic:=nullif(left(btrim(coalesce(v_item->>'approx_traffic','')),40),'');
      v_raw:=coalesce(v_item->'raw',v_item);
      v_published:=null;
      begin
        if nullif(v_item->>'published_at','') is not null then
          v_published:=(v_item->>'published_at')::timestamptz;
        end if;
      exception when others then
        v_published:=null;
      end;

      if length(v_norm)<2 or v_norm !~ '[[:alpha:]]{2}'
         or octet_length(v_raw::text)>16384 then
        continue;
      end if;
      v_hash:=encode(extensions.digest(convert_to(
        p_geo||'|'||v_norm||'|'||coalesce(v_published::text,'')||'|'||v_raw::text,'utf8'),
        'sha256'),'hex');
      v_id:=null;
      insert into public.nexus_v3010_trends_staging(
        geo,term,normalized_term,approx_traffic,source_published_at,
        feed_fetched_at,raw_payload,item_hash
      ) values (
        p_geo,v_term,v_norm,v_traffic,v_published,
        coalesce(p_fetched_at,clock_timestamp()),v_raw,v_hash
      ) on conflict do nothing returning id into v_id;

      if v_id is null then
        v_duplicates:=v_duplicates+1;
        continue;
      end if;
      v_inserted:=v_inserted+1;

      for r_keyword in
        select k.kw,k.oferta
          from public.nexus_v370_keyword_source k
         where length(btrim(k.kw)) between 3 and 160
           and (
             lower(btrim(k.kw))=v_norm
             or strpos(' '||v_norm||' ',' '||lower(btrim(k.kw))||' ')>0
           )
         order by length(k.kw) desc,k.kw
         limit 20
      loop
        insert into public.nexus_v3010_trend_keyword_matches(trend_id,keyword,offer_hash)
        values(v_id,r_keyword.kw,r_keyword.oferta)
        on conflict do nothing;
        get diagnostics v_rowcount=row_count;
        v_matches:=v_matches+v_rowcount;
      end loop;
    end loop;

    return jsonb_build_object('ok',true,'geo',p_geo,'inserted',v_inserted,
      'duplicates',v_duplicates,'keyword_matches',v_matches,
      'canonical_keywords_modified',false);
  exception when others then
    perform public.nexus_v420_sintonizado('v3010-trends-stage',p_geo,left(sqlerrm,300));
    return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
  end;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Durable two-phase IndexNow queue: live HTTP probe, then protocol POST.
-- ---------------------------------------------------------------------------
create table if not exists public.nexus_v3010_indexnow_queue (
  id                 bigint generated always as identity primary key,
  url                text not null,
  host               text not null,
  source_table       text not null,
  source_key         text not null,
  event_hash         text not null,
  state              text not null default 'probe_pending',
  request_kind       text,
  request_id         bigint,
  probe_attempts     integer not null default 0,
  index_attempts     integer not null default 0,
  next_attempt_at    timestamptz not null default clock_timestamp(),
  last_http_status   integer,
  last_error         text,
  queued_at          timestamptz not null default clock_timestamp(),
  dispatched_at      timestamptz,
  confirmed_at       timestamptz,
  updated_at         timestamptz not null default clock_timestamp(),
  constraint nexus_v3010_indexnow_url_ck check (url ~ '^https://[A-Za-z0-9.-]+(/[^[:space:]#]*)?$'),
  constraint nexus_v3010_indexnow_host_ck check (host ~ '^[a-z0-9.-]+$'),
  constraint nexus_v3010_indexnow_hash_ck check (event_hash ~ '^[0-9a-f]{64}$'),
  constraint nexus_v3010_indexnow_state_ck check (state in (
    'probe_pending','probe_in_flight','index_pending','index_in_flight','confirmed','blocked'
  )),
  constraint nexus_v3010_indexnow_request_ck check (
    (request_id is null and request_kind is null)
    or (request_id is not null and request_kind in ('probe','indexnow'))
  ),
  unique(url,event_hash)
);
alter table public.nexus_v3010_indexnow_queue set logged;
create index if not exists nexus_v3010_indexnow_due_idx
  on public.nexus_v3010_indexnow_queue(state,next_attempt_at,id)
  where state in ('probe_pending','index_pending');
create index if not exists nexus_v3010_indexnow_request_idx
  on public.nexus_v3010_indexnow_queue(request_id)
  where request_id is not null;

create or replace function public.nexus_v3010_host_of(p_url text)
returns text
language sql
immutable
parallel safe
set search_path='pg_catalog','pg_temp'
as $function$
  select lower(substring(btrim(coalesce(p_url,'')) from '^https://([A-Za-z0-9.-]+)'));
$function$;

create or replace function public.nexus_v3010_enqueue_indexnow(
  p_url text,p_source_table text,p_source_key text,p_source_version text
) returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  v_url text;
  v_host text;
  v_hash text;
  v_id bigint;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    v_url:=regexp_replace(left(btrim(coalesce(p_url,'')),2048),'#.*$','');
    v_host:=public.nexus_v3010_host_of(v_url);
    if v_host is null or v_url !~ '^https://'
       or not exists(
         select 1 from public.nexus_growth_hosts h
          where h.active and h.host in (v_host,regexp_replace(v_host,'^www\.','',''))
       ) then
      return jsonb_build_object('ok',false,'queued',false,'reason','url_not_owned_or_inactive');
    end if;
    v_hash:=encode(extensions.digest(convert_to(
      v_url||'|'||coalesce(p_source_table,'')||'|'||coalesce(p_source_key,'')||'|'||
      coalesce(p_source_version,''),'utf8'),'sha256'),'hex');
    insert into public.nexus_v3010_indexnow_queue(
      url,host,source_table,source_key,event_hash
    ) values(
      v_url,v_host,left(coalesce(p_source_table,'unknown'),80),
      left(coalesce(p_source_key,'unknown'),200),v_hash
    ) on conflict do nothing returning id into v_id;
    return jsonb_build_object('ok',true,'queued',v_id is not null,'id',v_id,'probe_required',true);
  exception when others then
    perform public.nexus_v420_sintonizado('v3010-indexnow-enqueue',v_host,left(sqlerrm,300));
    return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
  end;
end;
$function$;

create or replace function public.nexus_v3010_site_page_enqueue()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    if new.http_status=200 and new.noindex is false and new.canonical_ok is true
       and new.indexability_status='approved' and new.url is not null
       and (
         tg_op='INSERT'
         or old.indexability_status is distinct from new.indexability_status
         or old.url is distinct from new.url
         or old.content_hash is distinct from new.content_hash
       ) then
      perform public.nexus_v3010_enqueue_indexnow(
        new.url,'site_pages_inventory',new.page_key,
        coalesce(new.content_hash,new.updated_at::text,new.last_seen_at::text,'unknown')
      );
    end if;
  exception when others then
    perform public.nexus_v420_sintonizado('v3010-indexnow-trigger','site_pages_inventory',left(sqlerrm,300));
  end;
  return new;
end;
$function$;

drop trigger if exists trg_v3010_site_page_indexnow on public.site_pages_inventory;
create trigger trg_v3010_site_page_indexnow
after insert or update of url,http_status,noindex,canonical_ok,indexability_status,content_hash
on public.site_pages_inventory
for each row execute function public.nexus_v3010_site_page_enqueue();

create or replace function public.nexus_v3010_indexnow_probe_dispatch(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path='public','net','pg_temp'
as $function$
declare
  r record;
  v_req bigint;
  v_sent integer:=0;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  p_limit:=greatest(1,least(coalesce(p_limit,20),50));
  if not pg_try_advisory_xact_lock(hashtext('v3010-indexnow-probe')) then
    return jsonb_build_object('ok',true,'busy',true,'probes',0);
  end if;
  for r in
    select id,url,probe_attempts from public.nexus_v3010_indexnow_queue
     where state='probe_pending' and next_attempt_at<=clock_timestamp()
     order by id limit p_limit for update skip locked
  loop
    begin
      v_req:=net.http_get(url=>r.url,
        headers=>jsonb_build_object('Accept','text/html,application/xhtml+xml',
          'User-Agent','NexusIndexabilityProbe/3010'),timeout_milliseconds=>8000);
      update public.nexus_v3010_indexnow_queue
         set state='probe_in_flight',request_kind='probe',request_id=v_req,
             probe_attempts=probe_attempts+1,dispatched_at=clock_timestamp(),
             updated_at=clock_timestamp(),last_error=null
       where id=r.id;
      v_sent:=v_sent+1;
    exception when others then
      update public.nexus_v3010_indexnow_queue
         set probe_attempts=probe_attempts+1,
             next_attempt_at=clock_timestamp()+make_interval(secs=>
               least(21600,10*power(2,least(probe_attempts+1,10)))+(random()*5)::integer),
             last_error=left(sqlerrm,300),updated_at=clock_timestamp()
       where id=r.id;
      perform public.nexus_v420_sintonizado('v3010-indexnow-probe',r.url,left(sqlerrm,300));
    end;
  end loop;
  return jsonb_build_object('ok',true,'probes',v_sent);
exception when others then
  perform public.nexus_v420_sintonizado('v3010-indexnow-probe',null,left(sqlerrm,300));
  return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
end;
$function$;

create or replace function public.nexus_v3010_indexnow_dispatch(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path='public','net','pg_temp'
as $function$
declare
  v_key text;
  v_ready boolean;
  v_host text;
  v_ids bigint[];
  v_urls text[];
  v_req bigint;
  v_count integer:=0;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  p_limit:=greatest(1,least(coalesce(p_limit,100),1000));
  if not pg_try_advisory_xact_lock(hashtext('v3010-indexnow-dispatch')) then
    return jsonb_build_object('ok',true,'busy',true,'submitted',0);
  end if;
  select value into v_key from public.nexus_growth_secrets where key='indexnow_key';
  select lower(value)='true' into v_ready from public.nexus_growth_secrets where key='indexnow_engine_ready';
  if not coalesce(v_ready,false) or coalesce(length(v_key),0)<8
     or length(v_key)>128 or v_key !~ '^[A-Za-z0-9-]+$' then
    perform public.nexus_v420_sintonizado('v3010-indexnow-dispatch',null,'IndexNow key/engine not ready');
    return jsonb_build_object('ok',false,'state','Sintonizado em Análise','reason','indexnow_not_ready');
  end if;

  select host into v_host
    from public.nexus_v3010_indexnow_queue
   where state='index_pending' and next_attempt_at<=clock_timestamp()
   order by id limit 1;
  if v_host is null then return jsonb_build_object('ok',true,'submitted',0); end if;

  with picked as (
    select id,url from public.nexus_v3010_indexnow_queue
     where state='index_pending' and host=v_host and next_attempt_at<=clock_timestamp()
     order by id limit p_limit for update skip locked
  ) select array_agg(id),array_agg(url order by id) into v_ids,v_urls from picked;
  v_count:=coalesce(array_length(v_ids,1),0);
  if v_count=0 then return jsonb_build_object('ok',true,'submitted',0); end if;

  begin
    v_req:=net.http_post(url=>'https://api.indexnow.org/indexnow',
      body=>jsonb_build_object('host',v_host,'key',v_key,
        'keyLocation',format('https://%s/%s.txt',v_host,v_key),
        'urlList',to_jsonb(v_urls)),
      headers=>jsonb_build_object('Content-Type','application/json'),
      timeout_milliseconds=>8000);
    update public.nexus_v3010_indexnow_queue
       set state='index_in_flight',request_kind='indexnow',request_id=v_req,
           index_attempts=index_attempts+1,dispatched_at=clock_timestamp(),
           updated_at=clock_timestamp(),last_error=null
     where id=any(v_ids);
  exception when others then
    update public.nexus_v3010_indexnow_queue
       set index_attempts=index_attempts+1,
           next_attempt_at=clock_timestamp()+make_interval(secs=>
             least(21600,10*power(2,least(index_attempts+1,10)))+(random()*5)::integer),
           last_error=left(sqlerrm,300),updated_at=clock_timestamp()
     where id=any(v_ids);
    perform public.nexus_v420_sintonizado('v3010-indexnow-dispatch',v_host,left(sqlerrm,300));
    return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
  end;
  return jsonb_build_object('ok',true,'submitted',v_count,'host',v_host,
    'request_id',v_req,'delivery_confirmed',false);
exception when others then
  perform public.nexus_v420_sintonizado('v3010-indexnow-dispatch',v_host,left(sqlerrm,300));
  return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
end;
$function$;

create or replace function public.nexus_v3010_indexnow_reconcile(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path='public','net','pg_temp'
as $function$
declare
  r record;
  v_success integer:=0;
  v_retry integer:=0;
  v_blocked integer:=0;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  p_limit:=greatest(1,least(coalesce(p_limit,200),1000));
  for r in
    select q.request_id,q.request_kind,max(q.probe_attempts) probe_attempts,
           max(q.index_attempts) index_attempts,h.status_code,h.content_type,
           h.headers,h.content,h.timed_out,h.error_msg
      from public.nexus_v3010_indexnow_queue q
      join net._http_response h on h.id=q.request_id
     where q.state in ('probe_in_flight','index_in_flight')
     group by q.request_id,q.request_kind,h.status_code,h.content_type,
              h.headers,h.content,h.timed_out,h.error_msg
     order by q.request_id limit p_limit
  loop
    if r.request_kind='probe' then
      if r.status_code=200 and coalesce(r.content_type,'') like 'text/html%'
         and position('noindex' in lower(coalesce(r.headers::text,'')))=0
         and position('noindex' in lower(left(coalesce(r.content,''),20000)))=0 then
        update public.nexus_v3010_indexnow_queue
           set state='index_pending',request_id=null,request_kind=null,
               last_http_status=r.status_code,next_attempt_at=clock_timestamp(),
               updated_at=clock_timestamp(),last_error=null
         where request_id=r.request_id and state='probe_in_flight';
        v_success:=v_success+1;
      elsif coalesce(r.timed_out,false) or r.error_msg is not null
            or r.status_code=429 or r.status_code>=500 then
        update public.nexus_v3010_indexnow_queue
           set state='probe_pending',request_id=null,request_kind=null,
               last_http_status=r.status_code,last_error=left(coalesce(r.error_msg,'probe_retry'),300),
               next_attempt_at=clock_timestamp()+make_interval(secs=>
                 least(21600,10*power(2,least(probe_attempts,10)))+(random()*5)::integer),
               updated_at=clock_timestamp()
         where request_id=r.request_id and state='probe_in_flight';
        v_retry:=v_retry+1;
      else
        update public.nexus_v3010_indexnow_queue
           set state='blocked',request_id=null,request_kind=null,
               last_http_status=r.status_code,last_error='probe_not_indexable',
               updated_at=clock_timestamp()
         where request_id=r.request_id and state='probe_in_flight';
        v_blocked:=v_blocked+1;
      end if;
    elsif r.request_kind='indexnow' then
      if r.status_code in (200,202) then
        update public.nexus_v3010_indexnow_queue
           set state='confirmed',request_id=null,request_kind=null,
               last_http_status=r.status_code,confirmed_at=clock_timestamp(),
               updated_at=clock_timestamp(),last_error=null
         where request_id=r.request_id and state='index_in_flight';
        v_success:=v_success+1;
      elsif coalesce(r.timed_out,false) or r.error_msg is not null
            or r.status_code=429 or r.status_code>=500 then
        update public.nexus_v3010_indexnow_queue
           set state='index_pending',request_id=null,request_kind=null,
               last_http_status=r.status_code,last_error=left(coalesce(r.error_msg,'indexnow_retry'),300),
               next_attempt_at=clock_timestamp()+make_interval(secs=>
                 least(21600,10*power(2,least(index_attempts,10)))+(random()*5)::integer),
               updated_at=clock_timestamp()
         where request_id=r.request_id and state='index_in_flight';
        v_retry:=v_retry+1;
      else
        update public.nexus_v3010_indexnow_queue
           set state='blocked',request_id=null,request_kind=null,
               last_http_status=r.status_code,last_error='indexnow_http_'||coalesce(r.status_code::text,'null'),
               updated_at=clock_timestamp()
         where request_id=r.request_id and state='index_in_flight';
        v_blocked:=v_blocked+1;
      end if;
    end if;
    begin delete from net._http_response where id=r.request_id; exception when others then null; end;
  end loop;

  update public.nexus_v3010_indexnow_queue
     set state=case when request_kind='probe' then 'probe_pending' else 'index_pending' end,
         request_id=null,request_kind=null,last_error='stale_async_response',
         next_attempt_at=clock_timestamp()+interval '1 minute',updated_at=clock_timestamp()
   where state in ('probe_in_flight','index_in_flight')
     and dispatched_at<clock_timestamp()-interval '5 minutes';

  return jsonb_build_object('ok',true,'success_groups',v_success,
    'retry_groups',v_retry,'blocked_groups',v_blocked);
exception when others then
  perform public.nexus_v420_sintonizado('v3010-indexnow-reconcile',null,left(sqlerrm,300));
  return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Hourly Trends Edge invocation with durable pg_net response evidence.
-- ---------------------------------------------------------------------------
create table if not exists public.nexus_v3010_trends_requests (
  id               bigint generated always as identity primary key,
  request_id       bigint unique,
  state            text not null default 'submitted',
  attempt           integer not null default 1,
  http_status      integer,
  last_error       text,
  requested_at     timestamptz not null default clock_timestamp(),
  completed_at     timestamptz,
  constraint nexus_v3010_trends_request_state_ck check (state in ('submitted','succeeded','failed'))
);
alter table public.nexus_v3010_trends_requests set logged;

create or replace function public.nexus_v3010_request_trends()
returns jsonb
language plpgsql
security definer
set search_path='public','net','pg_temp'
as $function$
declare
  v_url text;
  v_secret text;
  v_anon text;
  v_req bigint;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    if exists(select 1 from public.nexus_v3010_trends_requests
               where state='submitted' and requested_at>clock_timestamp()-interval '10 minutes')
       or exists(select 1 from public.nexus_v3010_trends_requests
                  where state='succeeded' and completed_at>clock_timestamp()-interval '50 minutes') then
      return jsonb_build_object('ok',true,'skipped','recent_request');
    end if;
    select value into v_url from public.nexus_growth_secrets where key='v3010_trends_function_url';
    select value into v_secret from public.nexus_growth_secrets where key='v3010_trends_start_secret';
    select value into v_anon from public.nexus_growth_secrets where key='v3010_master_anon_key';
    if v_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/nexus-trends-ingest-v3010$'
       or coalesce(length(v_secret),0)<32 or coalesce(length(v_anon),0)<20 then
      perform public.nexus_v420_sintonizado('v3010-trends-request',null,'runtime secrets not configured');
      return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
    end if;
    v_req:=net.http_post(url=>v_url,body=>jsonb_build_object('geo','BR'),
      headers=>jsonb_build_object('Content-Type','application/json',
        'Authorization','Bearer '||v_anon,'apikey',v_anon,
        'x-nexus-v3010-secret',v_secret,'User-Agent','NexusTrendsScheduler/3010'),
      timeout_milliseconds=>20000);
    insert into public.nexus_v3010_trends_requests(request_id) values(v_req);
    return jsonb_build_object('ok',true,'request_id',v_req,'delivery_confirmed',false);
  exception when others then
    perform public.nexus_v420_sintonizado('v3010-trends-request',null,left(sqlerrm,300));
    return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
  end;
end;
$function$;

create or replace function public.nexus_v3010_trends_reconcile(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path='public','net','pg_temp'
as $function$
declare
  r record;
  v_ok integer:=0;
  v_failed integer:=0;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  p_limit:=greatest(1,least(coalesce(p_limit,50),200));
  for r in
    select q.id,q.request_id,h.status_code,h.timed_out,h.error_msg
      from public.nexus_v3010_trends_requests q
      join net._http_response h on h.id=q.request_id
     where q.state='submitted' order by q.id limit p_limit
  loop
    if r.status_code=201 and not coalesce(r.timed_out,false) and r.error_msg is null then
      update public.nexus_v3010_trends_requests
         set state='succeeded',http_status=201,completed_at=clock_timestamp(),last_error=null
       where id=r.id;
      v_ok:=v_ok+1;
    else
      update public.nexus_v3010_trends_requests
         set state='failed',http_status=r.status_code,completed_at=clock_timestamp(),
             last_error=left(coalesce(r.error_msg,'http_'||coalesce(r.status_code::text,'null')),300)
       where id=r.id;
      perform public.nexus_v420_sintonizado('v3010-trends-request',null,
        'Edge HTTP '||coalesce(r.status_code::text,'null'));
      v_failed:=v_failed+1;
    end if;
    begin delete from net._http_response where id=r.request_id; exception when others then null; end;
  end loop;
  update public.nexus_v3010_trends_requests
     set state='failed',completed_at=clock_timestamp(),last_error='stale_async_response'
   where state='submitted' and requested_at<clock_timestamp()-interval '5 minutes';
  return jsonb_build_object('ok',true,'succeeded',v_ok,'failed',v_failed);
exception when others then
  perform public.nexus_v420_sintonizado('v3010-trends-reconcile',null,left(sqlerrm,300));
  return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
end;
$function$;

create or replace function public.nexus_v3010_indexnow_cycle()
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
declare
  v_reconcile jsonb;
  v_probe jsonb;
  v_dispatch jsonb;
  v_trends jsonb;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    v_reconcile:=public.nexus_v3010_indexnow_reconcile(200);
    v_probe:=public.nexus_v3010_indexnow_probe_dispatch(20);
    v_dispatch:=public.nexus_v3010_indexnow_dispatch(100);
    v_trends:=public.nexus_v3010_trends_reconcile(50);
    return jsonb_build_object('ok',true,'reconcile',v_reconcile,
      'probe',v_probe,'dispatch',v_dispatch,'trends',v_trends);
  exception when others then
    perform public.nexus_v420_sintonizado('v3010-cycle',null,left(sqlerrm,300));
    return jsonb_build_object('ok',false,'state','Sintonizado em Análise');
  end;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. ACL, schedules and truthful capability registry.
-- ---------------------------------------------------------------------------
alter table public.nexus_v3010_trends_staging enable row level security;
alter table public.nexus_v3010_trend_keyword_matches enable row level security;
alter table public.nexus_v3010_indexnow_queue enable row level security;
alter table public.nexus_v3010_trends_requests enable row level security;
revoke all on table public.nexus_v3010_trends_staging,
                    public.nexus_v3010_trend_keyword_matches,
                    public.nexus_v3010_indexnow_queue,
                    public.nexus_v3010_trends_requests
  from public,anon,authenticated,service_role;
revoke all on all sequences in schema public from anon,authenticated;
revoke all on function public.nexus_v3010_normalize_term(text),
                       public.nexus_v3010_stage_trends(jsonb,text,timestamptz),
                       public.nexus_v3010_host_of(text),
                       public.nexus_v3010_enqueue_indexnow(text,text,text,text),
                       public.nexus_v3010_site_page_enqueue(),
                       public.nexus_v3010_indexnow_probe_dispatch(integer),
                       public.nexus_v3010_indexnow_dispatch(integer),
                       public.nexus_v3010_indexnow_reconcile(integer),
                       public.nexus_v3010_request_trends(),
                       public.nexus_v3010_trends_reconcile(integer),
                       public.nexus_v3010_indexnow_cycle()
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3010_stage_trends(jsonb,text,timestamptz)
  to service_role;

select cron.alter_job(23,active=>false)
 where exists(select 1 from cron.job where jobid=23);
select cron.alter_job(33,active=>false)
 where exists(select 1 from cron.job where jobid=33);

do $cron$
declare v_id bigint;
begin
  select jobid into v_id from cron.job where jobname='v3010-indexnow-durable-10min';
  if v_id is null then
    perform cron.schedule('v3010-indexnow-durable-10min','*/10 * * * *',
      'select public.nexus_v3010_indexnow_cycle();');
  else
    perform cron.alter_job(v_id,schedule=>'*/10 * * * *',
      command=>'select public.nexus_v3010_indexnow_cycle();',active=>true);
  end if;
  select jobid into v_id from cron.job where jobname='v3010-trends-hourly';
  if v_id is null then
    perform cron.schedule('v3010-trends-hourly','17 * * * *',
      'select public.nexus_v3010_request_trends();');
  else
    perform cron.alter_job(v_id,schedule=>'17 * * * *',
      command=>'select public.nexus_v3010_request_trends();',active=>true);
  end if;
end
$cron$;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)
values
 ('v3010_trends_staging',true,
  jsonb_build_object('logged',true,'geo','BR','max_items_per_feed',20,
    'canonical_keywords_modified',false,'edge_ingest_verified',false),clock_timestamp()),
 ('v3010_indexnow_durable',true,
  jsonb_build_object('logged',true,'live_probe_required',true,
    'request_id_is_not_success',true,'delivery_verified',false,
    'endpoint','https://api.indexnow.org/indexnow'),clock_timestamp()),
 ('v3010_ui_compliance',true,
  jsonb_build_object('go_js_modified',false,'compose_ts_modified',false,
    'duplicate_placements',false,'artificial_urgency',false,
    'real_expiry_timer_enabled',false),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

-- ---------------------------------------------------------------------------
-- 5. Catalog/cron/persistence assertions. Abort atomically on drift.
-- ---------------------------------------------------------------------------
do $assert$
declare
  v_persistence "char";
begin
  if (select count(*) from public.ads)<>14301 then
    raise exception 'public.ads cardinality drifted from read-only 14301';
  end if;
  if (select count(*) from public.nexus_v370_keyword_source)<>17605 then
    raise exception 'canonical keyword cardinality drifted from 17605';
  end if;
  foreach v_persistence in array array[
    (select relpersistence from pg_class where oid='public.nexus_v3010_trends_staging'::regclass),
    (select relpersistence from pg_class where oid='public.nexus_v3010_trend_keyword_matches'::regclass),
    (select relpersistence from pg_class where oid='public.nexus_v3010_indexnow_queue'::regclass),
    (select relpersistence from pg_class where oid='public.nexus_v3010_trends_requests'::regclass)
  ] loop
    if v_persistence is distinct from 'p'::"char" then
      raise exception 'v3010 relation is not LOGGED';
    end if;
  end loop;
  if exists(select 1 from cron.job where jobid in(15,16,64) and active) then
    raise exception 'protected high-frequency jobs 15/16/64 must remain inactive';
  end if;
  if not exists(select 1 from cron.job where jobid=60 and active
                 and schedule='10 seconds'
                 and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'paced Job 60 changed';
  end if;
  if exists(select 1 from cron.job where jobid in(23,33) and active) then
    raise exception 'legacy premature-success IndexNow jobs remain active';
  end if;
  if not exists(select 1 from cron.job where jobname='v3010-indexnow-durable-10min' and active)
     or not exists(select 1 from cron.job where jobname='v3010-trends-hourly' and active) then
    raise exception 'v3010 schedules missing';
  end if;
  if has_function_privilege('anon','public.nexus_v3010_stage_trends(jsonb,text,timestamptz)','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3010_stage_trends(jsonb,text,timestamptz)','EXECUTE') then
    raise exception 'v3010 staging RPC exposed to clients';
  end if;
end
$assert$;

commit;
