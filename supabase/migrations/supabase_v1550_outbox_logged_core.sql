-- Nexus v1550.0 — Sovereign Outbox Logged & Event-Node Idempotency Suite
-- PostgreSQL 17.6 / pg_net 0.20.4
--
-- Truth boundary:
--   * The master provides durable, one-row-per-(event,node) admission and HTTP
--     response reconciliation. It does not claim exactly-once external delivery.
--   * No v1550 retry cron is installed. The pre-existing Job 60 is repointed to
--     the paced Telegram batch flush requested by the operator. A future durable
--     executor must invoke reconcile/drain when provisioned.
--   * HTTP 201 is the only terminal success. Every other completed response is
--     retained for a bounded exponential retry. Active-ad catalog rows are not
--     read or changed by this migration.

begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- ---------------------------------------------------------------------------
-- v1510 ACL correction. Only the HMAC-validated ingest RPC remains callable by
-- anon/authenticated. The content-trigger worker already uses service_role.
-- ---------------------------------------------------------------------------
revoke all on function public.nexus_v1510_signing_material(jsonb),
                       public.nexus_v1510_flush_event(integer),
                       public.nexus_v1510_source_event_flush(),
                       public.nexus_v1510_immutability_guard(),
                       public.nexus_v1510_ingest_event(jsonb),
                       public.nexus_v1510_queue_content_trigger(text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.nexus_v1510_ingest_event(jsonb)
  to anon, authenticated, service_role;
grant execute on function public.nexus_v1510_flush_event(integer),
                          public.nexus_v1510_queue_content_trigger(text,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Permanent WAL-backed state. relpersistence='p' is asserted below.
-- ---------------------------------------------------------------------------
create table if not exists public.nexus_v1550_outbox_logged (
  outbox_id       bigint generated always as identity primary key,
  event_hash      text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  node_ref        text not null references public.nexus_v360_node_endpoints(node)
                    on update cascade on delete restrict,
  payload         jsonb not null check (jsonb_typeof(payload) = 'object'),
  attempts        integer not null default 0 check (attempts >= 0),
  status          text not null default 'pending'
                    check (status in ('pending','submitted','retry')),
  error_log       jsonb not null default '[]'::jsonb
                    check (jsonb_typeof(error_log) = 'array'),
  next_retry_at   timestamptz not null default clock_timestamp(),
  request_id      bigint,
  last_http       integer,
  enqueued_at     timestamptz not null default clock_timestamp(),
  dispatched_at   timestamptz,
  updated_at      timestamptz not null default clock_timestamp(),
  constraint nexus_v1550_submitted_request_ck check (
    (status = 'submitted' and request_id is not null and dispatched_at is not null)
    or (status <> 'submitted' and request_id is null)
  )
);

create unique index if not exists idx_v1550_event_node_uniq
  on public.nexus_v1550_outbox_logged(event_hash,node_ref);
create unique index if not exists idx_v1550_request_uniq
  on public.nexus_v1550_outbox_logged(request_id)
  where request_id is not null;
create index if not exists idx_v1550_outbox_due
  on public.nexus_v1550_outbox_logged(next_retry_at,outbox_id)
  where status in ('pending','retry') and request_id is null;
create index if not exists idx_v1550_outbox_submitted
  on public.nexus_v1550_outbox_logged(dispatched_at,outbox_id)
  where status='submitted' and request_id is not null;

-- A durable receipt is the master-side tombstone. It prevents re-admission after
-- a successful row is removed from the live outbox. It is not proof that a
-- satellite enforces its own idempotency key.
create table if not exists public.nexus_v1550_delivery_receipts (
  receipt_id       bigint generated always as identity primary key,
  event_hash       text not null check (event_hash ~ '^[0-9a-f]{64}$'),
  node_ref         text not null references public.nexus_v360_node_endpoints(node)
                     on update cascade on delete restrict,
  request_id       bigint not null,
  http_status      integer not null check (http_status = 201),
  payload_sha256   text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  delivered_at     timestamptz not null default clock_timestamp(),
  unique(event_hash,node_ref),
  unique(request_id)
);

alter table public.nexus_v1550_outbox_logged enable row level security;
alter table public.nexus_v1550_delivery_receipts enable row level security;
revoke all on table public.nexus_v1550_outbox_logged,
                    public.nexus_v1550_delivery_receipts
  from public, anon, authenticated, service_role;
revoke all on sequence public.nexus_v1550_outbox_logged_outbox_id_seq,
                       public.nexus_v1550_delivery_receipts_receipt_id_seq
  from public, anon, authenticated, service_role;

comment on table public.nexus_v1550_outbox_logged is
  'v1550 WAL-backed satellite webhook outbox; one live row per event_hash/node_ref; no cron executor installed.';
comment on table public.nexus_v1550_delivery_receipts is
  'Master-side HTTP 201 receipts and idempotency tombstones; not an external exactly-once claim.';

-- Deterministic 0..25% jitter makes the schedule testable and prevents a retry
-- herd. First failed attempt starts at 10 seconds; the base caps at one hour.
create or replace function public.nexus_v1550_next_retry(
  p_attempt integer,p_event_hash text,p_node_ref text,p_from timestamptz default clock_timestamp()
) returns timestamptz
language sql
immutable
strict
set search_path='public','extensions','pg_temp'
as $function$
  with b as (
    select least(3600::bigint,
      10::bigint * (1::bigint << least(greatest(p_attempt-1,0),12))) as base_seconds
  ), j as (
    select base_seconds,
      (('x'||substr(encode(extensions.digest(
        p_event_hash||'|'||p_node_ref||'|'||p_attempt::text,'sha256'),'hex'),1,8))::bit(32)::bigint
       % greatest(1,base_seconds*250))::integer as jitter_ms
    from b
  )
  select p_from + make_interval(secs=>base_seconds::double precision)
                + (jitter_ms::text||' milliseconds')::interval
  from j;
$function$;

-- Keep only the latest 32 errors per live row so indefinite retries do not grow
-- a row without bound.
create or replace function public.nexus_v1550_error_append(
  p_log jsonb,p_error jsonb
) returns jsonb
language sql
immutable
set search_path='public','pg_temp'
as $function$
  select coalesce(jsonb_agg(e.value order by e.ord),'[]'::jsonb)
  from jsonb_array_elements(
    coalesce(case when jsonb_typeof(p_log)='array' then p_log end,'[]'::jsonb)
      || jsonb_build_array(p_error)
  ) with ordinality as e(value,ord)
  where e.ord > greatest(
    jsonb_array_length(
      coalesce(case when jsonb_typeof(p_log)='array' then p_log end,'[]'::jsonb)
        || jsonb_build_array(p_error)
    ) - 32, 0);
$function$;

-- Admission is idempotent both while live (UNIQUE index) and after HTTP 201
-- (receipt tombstone). The caller supplies one logical payload, never unit rows.
create or replace function public.nexus_v1550_enqueue_event(p_evento jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  r record;
  v_event_key text;
  v_event_hash text;
  v_payload jsonb;
  v_inserted integer:=0;
  v_existing integer:=0;
begin
  perform set_config('statement_timeout','1000',true);
  perform set_config('lock_timeout','500',true);
  begin
    if p_evento is null or jsonb_typeof(p_evento)<>'object'
       or btrim(coalesce(p_evento->>'keyword',''))=''
       or btrim(coalesce(p_evento->>'link',p_evento->>'source_url',''))='' then
      return jsonb_build_object('ok',false,'reason','evento_analitico_incompleto');
    end if;

    v_event_key:=coalesce(nullif(btrim(p_evento->>'event_id'),''),
                          nullif(btrim(p_evento->>'source_url'),''),
                          nullif(btrim(p_evento->>'link'),''));
    v_event_hash:=encode(extensions.digest(
      coalesce(p_evento->>'tipo','stream')||'|'||v_event_key,'sha256'),'hex');
    v_payload:=jsonb_build_object(
      'source_url',coalesce(p_evento->>'link',p_evento->>'source_url'),
      'target_keyword',p_evento->>'keyword',
      'platform',coalesce(p_evento->>'platform','bluesky'),
      'author_handle',coalesce(p_evento->>'casa',p_evento->>'author_handle','nexus'),
      'mention_text',left(coalesce(p_evento->>'produto',p_evento->>'texto',''),900),
      'language',coalesce(p_evento->>'language',
        case when upper(coalesce(p_evento->>'country','BR'))='BR' then 'pt' else 'en' end));

    for r in
      select node from public.nexus_v360_node_endpoints
       where ativo and secret_enc is not null order by node
    loop
      if exists(select 1 from public.nexus_v1550_delivery_receipts
                 where event_hash=v_event_hash and node_ref=r.node) then
        v_existing:=v_existing+1;
        continue;
      end if;
      insert into public.nexus_v1550_outbox_logged(event_hash,node_ref,payload)
      values(v_event_hash,r.node,v_payload)
      on conflict(event_hash,node_ref) do nothing;
      if found then v_inserted:=v_inserted+1; else v_existing:=v_existing+1; end if;
    end loop;
    return jsonb_build_object('ok',true,'event_hash',v_event_hash,
      'enfileirados',v_inserted,'ja_presentes',v_existing,
      'nos_ativos',(select count(*) from public.nexus_v360_node_endpoints
                     where ativo and secret_enc is not null));
  exception when others then
    perform public.nexus_v420_sintonizado('v1550-enqueue','satellite-outbox',
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object('ok',false,'sintonizado',true,
      'reason','Sintonizado em Análise');
  end;
end;
$function$;

-- Reconcile only completed pg_net responses. HTTP 201 creates a durable receipt
-- and removes the live row. HTTP 0, all non-201 responses, and stale submissions
-- are returned to retry state with exponential backoff.
create or replace function public.nexus_v1550_reconcile(p_limit integer default 60)
returns jsonb
language plpgsql
security definer
set search_path='public','extensions','net','pg_temp'
as $function$
declare
  r record;
  v_attempt integer;
  v_http integer;
  v_ok integer:=0;
  v_retry integer:=0;
  v_stale integer:=0;
  v_pending integer:=0;
begin
  perform set_config('statement_timeout','1000',true);
  perform set_config('lock_timeout','500',true);
  begin
    for r in
      select q.outbox_id,q.event_hash,q.node_ref,q.payload,q.attempts,q.request_id,
             h.status_code,h.timed_out,h.error_msg,h.content
        from public.nexus_v1550_outbox_logged q
        join net._http_response h on h.id=q.request_id
       where q.status='submitted' and q.request_id is not null
       order by q.outbox_id
       limit least(greatest(coalesce(p_limit,60),1),200)
       for update of q skip locked
    loop
      v_http:=coalesce(r.status_code,0);
      if v_http=201 then
        insert into public.nexus_v1550_delivery_receipts(
          event_hash,node_ref,request_id,http_status,payload_sha256)
        values(r.event_hash,r.node_ref,r.request_id,201,
          encode(extensions.digest(r.payload::text,'sha256'),'hex'))
        on conflict(event_hash,node_ref) do nothing;
        update public.nexus_v365_fleet_dispatch_log
           set http=201,veredito='espelhado (http 201)'
         where request_id=r.request_id;
        delete from public.nexus_v1550_outbox_logged where outbox_id=r.outbox_id;
        v_ok:=v_ok+1;
      else
        v_attempt:=r.attempts+1;
        update public.nexus_v1550_outbox_logged
           set attempts=v_attempt,status='retry',request_id=null,last_http=v_http,
               next_retry_at=public.nexus_v1550_next_retry(
                 v_attempt,r.event_hash,r.node_ref,clock_timestamp()),
               error_log=public.nexus_v1550_error_append(error_log,
                 jsonb_build_object('at',clock_timestamp(),'http',v_http,
                   'timed_out',coalesce(r.timed_out,false),
                   'error',left(coalesce(r.error_msg,r.content,'HTTP sem detalhe'),300))),
               updated_at=clock_timestamp()
         where outbox_id=r.outbox_id;
        update public.nexus_v365_fleet_dispatch_log
           set http=v_http,veredito='Sintonizado em Análise · HTTP '||v_http
         where request_id=r.request_id;
        v_retry:=v_retry+1;
      end if;
      delete from net._http_response where id=r.request_id;
    end loop;

    -- pg_net timeout is 1000 ms. Fifteen seconds without a response is treated
    -- as an orphaned submission while preserving the row for a later retry.
    for r in
      select q.outbox_id,q.event_hash,q.node_ref,q.attempts,q.request_id
        from public.nexus_v1550_outbox_logged q
       where q.status='submitted' and q.request_id is not null
         and q.dispatched_at < clock_timestamp()-interval '15 seconds'
         and not exists(select 1 from net._http_response h where h.id=q.request_id)
       order by q.dispatched_at,q.outbox_id
       limit least(greatest(coalesce(p_limit,60),1),200)
       for update skip locked
    loop
      v_attempt:=r.attempts+1;
      update public.nexus_v1550_outbox_logged
         set attempts=v_attempt,status='retry',request_id=null,last_http=0,
             next_retry_at=public.nexus_v1550_next_retry(
               v_attempt,r.event_hash,r.node_ref,clock_timestamp()),
             error_log=public.nexus_v1550_error_append(error_log,
               jsonb_build_object('at',clock_timestamp(),'http',0,
                                  'timed_out',true,'error','pg_net response ausente após 15s')),
             updated_at=clock_timestamp()
       where outbox_id=r.outbox_id;
      update public.nexus_v365_fleet_dispatch_log
         set http=0,veredito='Sintonizado em Análise · HTTP 0'
       where request_id=r.request_id and http is null;
      v_stale:=v_stale+1;
    end loop;

    select count(*) into v_pending
      from public.nexus_v1550_outbox_logged where status='submitted';
    return jsonb_build_object('http_201',v_ok,'retries',v_retry,
      'stale_reclaimed',v_stale,'submitted_pending',v_pending,
      'external_exactly_once_claimed',false);
  exception when others then
    perform public.nexus_v420_sintonizado('v1550-reconcile','satellite-outbox',
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object('ok',false,'sintonizado',true,
      'reason','Sintonizado em Análise');
  end;
end;
$function$;

-- One bounded SKIP LOCKED pass. This function never sleeps or scans in a loop;
-- the future durable executor is responsible for later event-driven invocations.
create or replace function public.nexus_v1550_drain(p_limit integer default 13)
returns jsonb
language plpgsql
security definer
set search_path='public','extensions','net','pg_temp'
as $function$
declare
  r record;
  v_kms text;
  v_cred text;
  v_hmac text;
  v_req bigint;
  v_gate jsonb;
  v_submitted integer:=0;
  v_retry integer:=0;
  v_paced integer:=0;
  v_attempt integer;
  v_reconcile jsonb;
begin
  perform set_config('statement_timeout','1000',true);
  perform set_config('lock_timeout','500',true);
  begin
    v_reconcile:=public.nexus_v1550_reconcile(least(greatest(coalesce(p_limit,13),1),100));
    select value into v_kms from public.nexus_growth_secrets
     where key='nexus_satellites_kms';
    if coalesce(btrim(v_kms),'')='' then
      return jsonb_build_object('ok',false,'reason','kms_unavailable',
                                'reconcile',v_reconcile);
    end if;

    for r in
      select q.outbox_id,q.event_hash,q.node_ref,q.payload,q.attempts,
             e.url,e.secret_enc
        from public.nexus_v1550_outbox_logged q
        join public.nexus_v360_node_endpoints e on e.node=q.node_ref
       where q.status in('pending','retry') and q.request_id is null
         and q.next_retry_at<=clock_timestamp()
         and e.ativo and e.secret_enc is not null
       order by q.next_retry_at,q.outbox_id
       limit least(greatest(coalesce(p_limit,13),1),100)
       for update of q skip locked
    loop
      begin
        -- The gate is evaluated at physical submission, not admission, so a
        -- paced event remains durable instead of being discarded.
        v_gate:=public.nexus_v360_tg_gate(
          'node:'||r.node_ref,'disp:'||to_char(now(),'YYYY-MM-DD HH24:MI'),
          1,3,40);
        if not coalesce((v_gate->>'pode')::boolean,false) then
          update public.nexus_v1550_outbox_logged
             set next_retry_at=clock_timestamp()+interval '10 seconds',
                 updated_at=clock_timestamp()
           where outbox_id=r.outbox_id;
          v_paced:=v_paced+1;
          continue;
        end if;

        v_cred:=extensions.pgp_sym_decrypt(decode(r.secret_enc,'hex'),v_kms);
        if coalesce(btrim(v_cred),'')='' then raise exception 'credencial decifrada vazia'; end if;
        v_hmac:=public.nexus_v360_webhook_sign(r.payload::text,v_kms);
        select net.http_post(
          url:=r.url,
          headers:=jsonb_build_object(
            'apikey',v_cred,'Authorization','Bearer '||v_cred,
            'Content-Type','application/json','Prefer','return=minimal',
            'X-Nexus-Event','v1550_outbox',
            'X-Nexus-Node',r.node_ref,
            'X-Nexus-Idempotency-Key',r.event_hash,
            'X-Nexus-Signature-256','sha256='||v_hmac),
          body:=r.payload,timeout_milliseconds:=1000
        ) into v_req;
        if v_req is null then raise exception 'pg_net sem request_id'; end if;
        update public.nexus_v1550_outbox_logged
           set status='submitted',request_id=v_req,dispatched_at=clock_timestamp(),
               updated_at=clock_timestamp()
         where outbox_id=r.outbox_id;
        insert into public.nexus_v365_fleet_dispatch_log(
          node,evento,request_id,veredito)
        values(r.node_ref,'v1550_outbox',v_req,'despachado v1550; HTTP pendente');
        v_submitted:=v_submitted+1;
      exception when others then
        v_attempt:=r.attempts+1;
        update public.nexus_v1550_outbox_logged
           set attempts=v_attempt,status='retry',request_id=null,last_http=0,
               next_retry_at=public.nexus_v1550_next_retry(
                 v_attempt,r.event_hash,r.node_ref,clock_timestamp()),
               error_log=public.nexus_v1550_error_append(error_log,
                 jsonb_build_object('at',clock_timestamp(),'http',0,
                   'error',sqlstate||': '||left(sqlerrm,260))),
               updated_at=clock_timestamp()
         where outbox_id=r.outbox_id;
        v_retry:=v_retry+1;
      end;
    end loop;
    return jsonb_build_object('ok',true,'submitted',v_submitted,
      'deferred_retry',v_retry,'paced',v_paced,'reconcile',v_reconcile,
      'submission_pacer','3_per_minute_40_per_hour_per_node',
      'executor','bounded_single_pass','durable_executor_provisioned',false);
  exception when others then
    perform public.nexus_v420_sintonizado('v1550-drain','satellite-outbox',
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object('ok',false,'sintonizado',true,
      'reason','Sintonizado em Análise');
  end;
end;
$function$;

-- Existing v1510 callers retain their function signature. Admission is durable;
-- one immediate bounded pg_net pass preserves present behavior, while retries
-- remain dormant until an event or the future executor invokes the drain again.
create or replace function public.nexus_v365_fleet_dispatch(
  p_evento jsonb,p_max_minuto integer default 3,p_max_hora integer default 40
) returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
declare
  v_admission jsonb;
  v_drain jsonb;
begin
  perform set_config('statement_timeout','1000',true);
  perform set_config('lock_timeout','500',true);
  begin
    if p_evento is null or jsonb_typeof(p_evento)<>'object'
       or btrim(coalesce(p_evento->>'keyword',''))=''
       or btrim(coalesce(p_evento->>'link',p_evento->>'source_url',''))='' then
      return jsonb_build_object('ok',false,'motivo','evento_analitico_incompleto');
    end if;
    -- v1510 invokes this with 3/40. v1550 is intentionally fail-closed if a
    -- caller asks for a weaker anti-spam envelope.
    if coalesce(p_max_minuto,3)>3 or coalesce(p_max_hora,40)>40 then
      return jsonb_build_object('ok',false,'motivo','pacer_above_3m_40h_rejected');
    end if;

    v_admission:=public.nexus_v1550_enqueue_event(p_evento);
    if not coalesce((v_admission->>'ok')::boolean,false) then
      return jsonb_build_object('ok',false,'mode','v1550_logged_outbox',
                                'admission',v_admission);
    end if;
    -- One immediate, bounded pass preserves event-driven initial submission.
    -- Later retries remain dormant until a new event or future executor calls.
    v_drain:=public.nexus_v1550_drain(13);
    return jsonb_build_object('ok',true,'mode','v1550_logged_outbox',
      'admission',v_admission,'initial_drain',v_drain,
      'pacer','3_per_minute_40_per_hour_per_node',
      'exactly_once_claimed',false);
  exception when others then
    perform public.nexus_v420_sintonizado('v1550-fleet','13-satellites',
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object('ok',false,'sintonizado',true,
      'reason','Sintonizado em Análise');
  end;
end;
$function$;

-- Compatibility consumer: reconcile only; it does not poll or schedule itself.
create or replace function public.nexus_v365_fleet_consume()
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
begin
  perform set_config('statement_timeout','1000',true);
  perform set_config('lock_timeout','500',true);
  return public.nexus_v1550_reconcile(60);
exception when others then
  perform public.nexus_v420_sintonizado('v1550-fleet-consume','13-satellites',
    sqlstate||': '||left(sqlerrm,220));
  return jsonb_build_object('ok',false,'sintonizado',true,
    'reason','Sintonizado em Análise');
end;
$function$;

revoke all on function public.nexus_v1550_next_retry(integer,text,text,timestamptz),
                       public.nexus_v1550_error_append(jsonb,jsonb),
                       public.nexus_v1550_enqueue_event(jsonb),
                       public.nexus_v1550_reconcile(integer),
                       public.nexus_v1550_drain(integer),
                       public.nexus_v365_fleet_dispatch(jsonb,integer,integer),
                       public.nexus_v365_fleet_consume()
  from public, anon, authenticated, service_role;
grant execute on function public.nexus_v1550_enqueue_event(jsonb),
                          public.nexus_v1550_reconcile(integer),
                          public.nexus_v1550_drain(integer),
                          public.nexus_v365_fleet_dispatch(jsonb,integer,integer)
  to service_role;

-- Catalog assertions abort the entire migration if physical or ACL truth differs.
do $assert$
declare
  v_persistence "char";
  v_anon_acl boolean;
begin
  select c.relpersistence into v_persistence
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname='nexus_v1550_outbox_logged';
  if v_persistence is distinct from 'p'::"char" then
    raise exception 'v1550 outbox is not LOGGED: relpersistence=%',v_persistence;
  end if;
  if not exists(select 1 from pg_indexes where schemaname='public'
                 and tablename='nexus_v1550_outbox_logged'
                 and indexname='idx_v1550_event_node_uniq'
                 and indexdef ilike 'create unique index%') then
    raise exception 'v1550 event/node UNIQUE index missing';
  end if;
  select has_function_privilege('anon',
    'public.nexus_v1510_queue_content_trigger(text,text,text)','EXECUTE')
    or has_function_privilege('authenticated',
    'public.nexus_v1510_queue_content_trigger(text,text,text)','EXECUTE')
    into v_anon_acl;
  if v_anon_acl then raise exception 'v1510 internal content trigger remains public'; end if;
  if not has_function_privilege('anon',
    'public.nexus_v1510_ingest_event(jsonb)','EXECUTE') then
    raise exception 'signed v1510 ingest RPC was not preserved';
  end if;
end;
$assert$;

-- Stream keepalive/ingest polling remains disabled. Job 60 is the explicit
-- operator-requested 10-second Telegram batch exception; route-level 3/minute
-- and 40/hour pacing is enforced by nexus_v1510_flush_event(), not by the older
-- unpaced v420 command. This does not provision the dormant v1550 retry executor.
select cron.alter_job(15,active=>false);
select cron.alter_job(16,active=>false);
select cron.alter_job(64,active=>false);
select cron.alter_job(60,
  command=>'select public.nexus_v1510_flush_event(40);',
  active=>true);

commit;
