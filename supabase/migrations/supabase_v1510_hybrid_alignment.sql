-- =============================================================================
-- NEXUS v1510.0 — HYBRID ALIGNMENT / SIGNED EVENT-DRIVEN TRAFFIC CORE
-- Master: etbxbaaaspdcoiakifbb
--
-- Facts this release deliberately preserves:
--   * 17,605 measured keyword mappings are the current source universe;
--   * ads remains read-only (this migration never writes public.ads);
--   * /api/ads/go remains the only affiliate gateway (application code);
--   * Jobs 15, 16, 18 and 64 stay OFF. Job 60 is replaced by source-event triggers;
--   * WebSocket connections live in a process worker, never inside PostgreSQL;
--   * no latency, reach, conversion or residential-human claim is manufactured.
--
-- Apply as one transaction. Re-running is idempotent.
-- =============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema net;

-- -----------------------------------------------------------------------------
-- 1. Immutable release ledger and measured source facts
-- -----------------------------------------------------------------------------
create table if not exists public.nexus_traffic_core_releases (
  version       text primary key,
  mode          text not null,
  keyword_count integer not null check (keyword_count >= 0),
  notes         text not null,
  applied_at    timestamptz not null default now()
);

insert into public.nexus_traffic_core_releases(version,mode,keyword_count,notes)
select 'v1510.0','signed_postgrest_event_driven',count(*),
       'Measured from nexus_v370_keyword_source; no polling and no fabricated capacity.'
from public.nexus_v370_keyword_source
on conflict (version) do update
set mode=excluded.mode,
    keyword_count=excluded.keyword_count,
    notes=excluded.notes;

alter table public.nexus_traffic_core_releases enable row level security;
revoke all on public.nexus_traffic_core_releases from public,anon,authenticated,service_role;
grant select on public.nexus_traffic_core_releases to service_role;

-- -----------------------------------------------------------------------------
-- 2. Signed ingress: ephemeral UNLOGGED hand-off + durable, content-minimal receipt
-- -----------------------------------------------------------------------------
create unlogged table if not exists public.nexus_v1510_ingress_buffer (
  event_id        text primary key,
  platform        text not null check (platform in ('bluesky','nostr')),
  relay_url       text not null,
  actor_ref       text not null,
  source_url      text not null,
  texto           text not null,
  keyword         text not null,
  offer_hash      text not null,
  content_sha256  text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  human_score     numeric(4,3) not null check (human_score between 0 and 1),
  classification  text not null check (classification='human_likely'),
  language        text not null check (language in ('pt','en','fr','de')),
  country         text,
  occurred_at_ms  bigint not null,
  signature       text not null check (signature ~ '^[0-9a-f]{64}$'),
  received_at     timestamptz not null default clock_timestamp()
);
create index if not exists nexus_v1510_ingress_received_idx
  on public.nexus_v1510_ingress_buffer(received_at,event_id);

create table if not exists public.nexus_v1510_ingest_receipts (
  event_id             text primary key,
  event_hash           text not null unique check (event_hash ~ '^[0-9a-f]{64}$'),
  platform             text not null check (platform in ('bluesky','nostr')),
  keyword              text not null,
  offer_hash           text not null,
  actor_hash           text not null check (actor_hash ~ '^[0-9a-f]{64}$'),
  canonical_mention_id bigint,
  status               text not null check (status in ('accepted','duplicate','contained')),
  fleet_result         jsonb not null default '{}'::jsonb,
  accepted_at          timestamptz not null default clock_timestamp()
);
create index if not exists nexus_v1510_receipts_time_idx
  on public.nexus_v1510_ingest_receipts(accepted_at desc);

alter table public.nexus_v1510_ingress_buffer enable row level security;
alter table public.nexus_v1510_ingest_receipts enable row level security;
revoke all on public.nexus_v1510_ingress_buffer,
              public.nexus_v1510_ingest_receipts from public,anon,authenticated,service_role;
grant select on public.nexus_v1510_ingest_receipts to service_role;

-- Stable byte material shared by the Node worker and PostgreSQL.
create or replace function public.nexus_v1510_signing_material(p_event jsonb)
returns text
language sql
immutable
strict
set search_path='public','pg_temp'
as $function$
  select concat_ws('|',
    coalesce(p_event->>'event_id',''),
    coalesce(p_event->>'platform',''),
    coalesce(p_event->>'keyword',''),
    coalesce(p_event->>'offer_hash',''),
    coalesce(p_event->>'content_sha256',''),
    coalesce(p_event->>'occurred_at_ms','')
  );
$function$;

-- -----------------------------------------------------------------------------
-- 3. Event-driven Telegram drain. It fires after a source INSERT statement;
--    there is no timer and no scan loop. Pacing is serialized by chat_id.
-- -----------------------------------------------------------------------------
create table if not exists public.nexus_v1510_notification_budget (
  chat_id       bigint primary key,
  touched_at    timestamptz not null default now()
);
insert into public.nexus_v1510_notification_budget(chat_id)
select chat_id from public.nexus_v420_channel_routes where enabled
on conflict (chat_id) do nothing;

alter table public.nexus_v1510_notification_budget enable row level security;
revoke all on public.nexus_v1510_notification_budget from public,anon,authenticated,service_role;

create or replace function public.nexus_v1510_flush_event(p_block integer default 40)
returns jsonb
language plpgsql
security definer
set search_path='public','extensions','net','pg_temp'
as $function$
declare
  r_route record;
  v_token text;
  v_enabled text;
  v_ids bigint[];
  v_registry_ids bigint[];
  v_pks text[];
  v_rows jsonb;
  v_n integer;
  v_limit integer;
  v_text text;
  v_body jsonb;
  v_req bigint;
  v_deleted integer;
  v_minute integer;
  v_hour integer;
  v_results jsonb := '[]'::jsonb;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);

  if current_setting('nexus.v1510.test_mode',true)='on' then
    return jsonb_build_object('idle',true,'motivo','test_mode');
  end if;

  begin
    -- Reconciliation is demand-driven: it only runs because a new source event arrived.
    perform public.nexus_v420_reconcile(40);

    -- Expiry is also demand-driven. It cannot wake the database by itself.
    with stale as (
      select id,registry_id from public.nexus_v420_channel_outbox
       where enqueued_at < now()-interval '24 hours'
       order by id limit 200 for update skip locked
    ), marked as (
      update public.nexus_v420_event_registry e
         set state='dropped',finalized_at=now()
        from stale s where e.registry_id=s.registry_id
      returning e.registry_id
    )
    delete from public.nexus_v420_channel_outbox q
     using stale s where q.id=s.id;

    select value into v_enabled from public.nexus_growth_secrets
     where key='telegram_alerts_enabled';
    if coalesce(v_enabled,'false')<>'true' then
      return jsonb_build_object('idle',true,'motivo','kill-switch telegram_alerts_enabled=false');
    end if;
    select value into v_token from public.nexus_growth_secrets
     where key='telegram_bot_token';
    if coalesce(btrim(v_token),'')='' then
      perform public.nexus_v420_sintonizado('v1510-flush',null,'telegram_bot_token ausente');
      return jsonb_build_object('sintonizado',true,'motivo','Sintonizado em Análise');
    end if;

    for r_route in
      select * from public.nexus_v420_channel_routes where enabled order by channel_key
    loop
      begin
        insert into public.nexus_v1510_notification_budget(chat_id)
        values(r_route.chat_id) on conflict(chat_id) do nothing;
        perform 1 from public.nexus_v1510_notification_budget
         where chat_id=r_route.chat_id for update;
        update public.nexus_v1510_notification_budget
           set touched_at=now() where chat_id=r_route.chat_id;

        select count(*) into v_minute from public.nexus_v420_dispatch_log
         where chat_id=r_route.chat_id and submitted_at>now()-interval '1 minute';
        select count(*) into v_hour from public.nexus_v420_dispatch_log
         where chat_id=r_route.chat_id and submitted_at>now()-interval '1 hour';
        if v_minute>=3 or v_hour>=40 then
          v_results:=v_results||jsonb_build_array(jsonb_build_object(
            'canal',r_route.channel_key,'enviado',false,'motivo','pacing_3m_40h',
            'ultimo_minuto',v_minute,'ultima_hora',v_hour));
          continue;
        end if;

        v_limit:=case r_route.channel_key
          when 'atendimento' then 6 when 'ofertas' then 8
          when 'vendas_real' then 12 else least(greatest(coalesce(p_block,40),1),40) end;

        select array_agg(id order by id),array_agg(registry_id order by id),
               array_agg(source_pk order by id),jsonb_agg(payload order by id)
          into v_ids,v_registry_ids,v_pks,v_rows
          from (
            select id,registry_id,source_pk,payload
              from public.nexus_v420_channel_outbox
             where channel_key=r_route.channel_key
               and source_relation=r_route.source_relation
             order by id limit v_limit
             for update skip locked
          ) q;
        v_n:=coalesce(array_length(v_ids,1),0);
        if v_n=0 then continue; end if;

        v_text:=case r_route.layout_key
          when 'clicks_ledger' then public.nexus_v420_layout_clicks(v_rows)
          when 'sentinel_capture' then public.nexus_v420_layout_capture(v_rows)
          when 'cash_close' then public.nexus_v420_layout_sales(v_rows)
          when 'offer_buttons' then public.nexus_v420_layout_offers(v_rows)
          else null end;

        if v_text is null or btrim(v_text)='' then
          update public.nexus_v420_event_registry
             set state='dropped',finalized_at=now()
           where registry_id=any(v_registry_ids);
          delete from public.nexus_v420_channel_outbox where id=any(v_ids);
          v_results:=v_results||jsonb_build_array(jsonb_build_object(
            'canal',r_route.channel_key,'eventos',v_n,'enviado',false,
            'motivo','delta_zero_ou_layout_fechado'));
          continue;
        end if;

        v_body:=jsonb_build_object(
          'chat_id',r_route.chat_id,'text',left(v_text,4000),
          'parse_mode','HTML','link_preview_options',jsonb_build_object('is_disabled',true));
        if r_route.layout_key='offer_buttons' then
          v_body:=v_body||jsonb_build_object('reply_markup',public.nexus_v420_offer_buttons(v_rows));
        end if;

        select net.http_post(
          url:='https://api.telegram.org/bot'||v_token||'/sendMessage',
          headers:='{"Content-Type":"application/json"}'::jsonb,
          body:=v_body,timeout_milliseconds:=1000
        ) into v_req;
        if v_req is null then raise exception 'pg_net não devolveu request_id'; end if;

        insert into public.nexus_v420_dispatch_log
          (request_id,channel_key,chat_id,source_relation,source_pks,event_count,body_sha256)
        values(v_req,r_route.channel_key,r_route.chat_id,r_route.source_relation,v_pks,v_n,
          encode(extensions.digest(v_text,'sha256'),'hex'));

        update public.nexus_v420_event_registry
           set state='submitted',request_id=v_req,submitted_at=now()
         where registry_id=any(v_registry_ids);
        delete from public.nexus_v420_channel_outbox where id=any(v_ids);
        get diagnostics v_deleted=row_count;
        if v_deleted<>v_n then
          raise exception 'flush parcial: esperado %, apagado %',v_n,v_deleted;
        end if;

        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'canal',r_route.channel_key,'chat_id',r_route.chat_id,'eventos',v_n,
          'enviado',true,'request_id',v_req,'fila_limpa',v_deleted));
      exception when others then
        perform public.nexus_v420_sintonizado('v1510-flush',r_route.channel_key,
          sqlstate||': '||left(sqlerrm,260));
        v_results:=v_results||jsonb_build_array(jsonb_build_object(
          'canal',r_route.channel_key,'enviado',false,
          'motivo','Sintonizado em Análise'));
      end;
    end loop;
    return jsonb_build_object('modo','event_driven','resultados',v_results);
  exception when others then
    perform public.nexus_v420_sintonizado('v1510-flush',null,
      sqlstate||': '||left(sqlerrm,260));
    return jsonb_build_object('sintonizado',true,'motivo','Sintonizado em Análise');
  end;
end;
$function$;

create or replace function public.nexus_v1510_source_event_flush()
returns trigger
language plpgsql
security definer
set search_path='public','pg_temp'
as $function$
begin
  perform public.nexus_v1510_flush_event(40);
  return null;
exception when others then
  perform public.nexus_v420_sintonizado('v1510-source-trigger',tg_table_schema||'.'||tg_table_name,
    sqlstate||': '||left(sqlerrm,220));
  return null;
end;
$function$;

-- Statement triggers preserve batching and run only when a source actually inserts.
drop trigger if exists trg_v1510_click_source_flush on public.ads_clicks;
create trigger trg_v1510_click_source_flush
  after insert on public.ads_clicks
  for each statement execute function public.nexus_v1510_source_event_flush();

drop trigger if exists trg_v1510_capture_source_flush on public.nexus_v385_nostr_mentions;
create trigger trg_v1510_capture_source_flush
  after insert on public.nexus_v385_nostr_mentions
  for each statement execute function public.nexus_v1510_source_event_flush();

drop trigger if exists trg_v1510_sales_source_flush on public.affiliate_conversions;
create trigger trg_v1510_sales_source_flush
  after insert on public.affiliate_conversions
  for each statement execute function public.nexus_v1510_source_event_flush();

drop trigger if exists trg_v1510_offer_source_flush on public.nexus_telegram_c2_ofertas;
create trigger trg_v1510_offer_source_flush
  after insert on public.nexus_telegram_c2_ofertas
  for each statement execute function public.nexus_v1510_source_event_flush();

-- -----------------------------------------------------------------------------
-- 4. Signed public RPC. All validation is server-side and fail-closed.
--    It consumes its own UNLOGGED row with FOR UPDATE SKIP LOCKED, writes one
--    canonical mention, creates a minimal receipt, queues fleet HTTP work and
--    deletes the ephemeral row before the transaction closes.
-- -----------------------------------------------------------------------------
create or replace function public.nexus_v1510_ingest_event(p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','extensions','net','pg_temp'
as $function$
declare
  v_started timestamptz:=clock_timestamp();
  v_secret text;
  v_expected text;
  v_event_id text;
  v_platform text;
  v_relay text;
  v_actor text;
  v_source_url text;
  v_text text;
  v_keyword text;
  v_offer text;
  v_content_hash text;
  v_signature text;
  v_language text;
  v_country text;
  v_classification text;
  v_human numeric;
  v_occurred_ms bigint;
  v_existing bigint;
  v_mention bigint;
  v_fleet jsonb:='{}'::jsonb;
  v_row public.nexus_v1510_ingress_buffer%rowtype;
begin
  perform set_config('statement_timeout','1000',true);
  perform set_config('lock_timeout','500',true);

  begin
    if p_event is null or jsonb_typeof(p_event)<>'object' then
      return jsonb_build_object('ok',false,'reason','invalid_object');
    end if;

    v_event_id:=btrim(coalesce(p_event->>'event_id',''));
    v_platform:=lower(btrim(coalesce(p_event->>'platform','')));
    v_relay:=btrim(coalesce(p_event->>'relay_url',''));
    v_actor:=btrim(coalesce(p_event->>'actor_ref',''));
    v_source_url:=btrim(coalesce(p_event->>'source_url',''));
    v_text:=btrim(coalesce(p_event->>'text',''));
    v_keyword:=lower(btrim(coalesce(p_event->>'keyword','')));
    v_offer:=btrim(coalesce(p_event->>'offer_hash',''));
    v_content_hash:=lower(btrim(coalesce(p_event->>'content_sha256','')));
    v_signature:=lower(btrim(coalesce(p_event->>'signature','')));
    v_language:=lower(btrim(coalesce(p_event->>'language','')));
    v_country:=nullif(upper(btrim(coalesce(p_event->>'country',''))),'');
    v_classification:=lower(btrim(coalesce(p_event->>'classification','')));

    begin v_human:=(p_event->>'human_score')::numeric;
    exception when others then return jsonb_build_object('ok',false,'reason','invalid_human_score'); end;
    begin v_occurred_ms:=(p_event->>'occurred_at_ms')::bigint;
    exception when others then return jsonb_build_object('ok',false,'reason','invalid_occurred_at'); end;

    if length(v_event_id)<12 or length(v_event_id)>220
       or v_event_id !~ '^[a-zA-Z0-9:_-]+$' then
      return jsonb_build_object('ok',false,'reason','invalid_event_id');
    end if;
    if v_platform not in ('bluesky','nostr') then
      return jsonb_build_object('ok',false,'reason','unsupported_platform');
    end if;
    if v_relay !~ '^wss://[a-zA-Z0-9.-]+(?::[0-9]+)?(?:/.*)?$'
       or v_source_url !~ '^https://[a-zA-Z0-9.-]+(?::[0-9]+)?(?:/.*)?$' then
      return jsonb_build_object('ok',false,'reason','invalid_source');
    end if;
    if length(v_actor)<8 or length(v_actor)>220 or length(v_text)<20 or length(v_text)>1200 then
      return jsonb_build_object('ok',false,'reason','invalid_actor_or_text');
    end if;
    if v_keyword='' or length(v_keyword)>160 or v_offer='' or length(v_offer)>180 then
      return jsonb_build_object('ok',false,'reason','invalid_keyword_or_offer');
    end if;
    -- Numeric-only, dosage and generic unit matches caused measured false positives.
    if v_keyword !~ '[[:alpha:]]{3}'
       or v_keyword ~ '^\s*[0-9]+([.,][0-9]+)?\s*(ml|mg|g|kg|cm|mm|m|gb|tb|hz|w)?\s*$' then
      return jsonb_build_object('ok',false,'reason','low_quality_keyword');
    end if;
    if v_language not in ('pt','en','fr','de') or (v_country is not null and v_country!~'^[A-Z]{2}$') then
      return jsonb_build_object('ok',false,'reason','invalid_locale');
    end if;
    if coalesce((p_event->>'is_bot')::boolean,true)
       or v_classification<>'human_likely' or v_human<0.800 then
      return jsonb_build_object('ok',false,'reason','human_gate_closed');
    end if;
    if not coalesce((p_event->>'commerce_intent')::boolean,false)
       or lower(v_text) !~ '(buy|buying|purchase|price|prices|deal|discount|coupon|shop|shopping|order|recommend|looking for|compar|worth buying|in stock|comprar|comprei|preço|precos|preços|oferta|promoção|promocao|cupom|desconto|procurando|recomendam|vale a pena|acheter|prix|promo|réduction|kaufen|preis|angebot|rabatt)' then
      return jsonb_build_object('ok',false,'reason','no_commerce_intent');
    end if;
    -- Contain obvious unsafe/illegal solicitation before it can reach CAPTURA.
    if lower(v_text) ~ '(date[ -]?rape|rape drug|flunitrazepam|rohypnol|fentanyl|methamphetamine|child porn|buy cocaine|comprar coca[ií]na|arma ilegal)' then
      return jsonb_build_object('ok',false,'reason','unsafe_content');
    end if;
    if v_content_hash!~'^[0-9a-f]{64}$'
       or v_content_hash<>encode(extensions.digest(v_text,'sha256'),'hex') then
      return jsonb_build_object('ok',false,'reason','content_hash_mismatch');
    end if;
    if abs((extract(epoch from clock_timestamp())*1000)::bigint-v_occurred_ms)>300000 then
      return jsonb_build_object('ok',false,'reason','stale_or_future_event');
    end if;

    if not exists(
      select 1 from public.nexus_v370_keyword_source
       where lower(kw)=v_keyword and oferta=v_offer
    ) then
      return jsonb_build_object('ok',false,'reason','keyword_offer_not_in_measured_inventory');
    end if;

    select value into v_secret from public.nexus_growth_secrets
     where key='stream_listener_token';
    if coalesce(length(v_secret),0)<32 then
      perform public.nexus_v420_sintonizado('v1510-ingest',v_platform,'stream_listener_token ausente');
      return jsonb_build_object('ok',false,'reason','ingest_secret_unavailable');
    end if;
    v_expected:=encode(extensions.hmac(
      convert_to(public.nexus_v1510_signing_material(p_event),'utf8'),
      convert_to(v_secret,'utf8'),'sha256'),'hex');
    if length(v_signature)<>64
       or encode(extensions.digest(v_signature,'sha256'),'hex')
          <>encode(extensions.digest(v_expected,'sha256'),'hex') then
      return jsonb_build_object('ok',false,'reason','signature_mismatch');
    end if;

    select canonical_mention_id into v_existing
      from public.nexus_v1510_ingest_receipts where event_id=v_event_id;
    if found then
      return jsonb_build_object('ok',true,'duplicate',true,'event_id',v_event_id,
        'canonical_mention_id',v_existing,
        'db_elapsed_ms',round(extract(epoch from(clock_timestamp()-v_started))*1000,3));
    end if;

    insert into public.nexus_v1510_ingress_buffer(
      event_id,platform,relay_url,actor_ref,source_url,texto,keyword,offer_hash,
      content_sha256,human_score,classification,language,country,occurred_at_ms,signature)
    values(v_event_id,v_platform,v_relay,v_actor,v_source_url,v_text,v_keyword,v_offer,
      v_content_hash,v_human,v_classification,v_language,v_country,v_occurred_ms,v_signature)
    on conflict(event_id) do nothing;

    select * into v_row from public.nexus_v1510_ingress_buffer
     where event_id=v_event_id for update skip locked;
    if not found then
      return jsonb_build_object('ok',true,'duplicate',true,'in_flight',true,
        'event_id',v_event_id,
        'db_elapsed_ms',round(extract(epoch from(clock_timestamp()-v_started))*1000,3));
    end if;

    insert into public.nexus_v385_nostr_mentions(
      nostr_id,relay_url,autor,texto,keyword,node_origem,dedupe_hash)
    values(v_event_id,v_relay,left(v_actor,220),left(v_text,1200),v_keyword,
      'v1510:'||v_platform,md5(v_event_id))
    on conflict(dedupe_hash) do nothing returning id into v_mention;
    if v_mention is null then
      select id into v_mention from public.nexus_v385_nostr_mentions
       where dedupe_hash=md5(v_event_id);
    end if;

    if coalesce(current_setting('nexus.v1510.test_mode',true),'off')<>'on' then
      -- Master write + 13 asynchronous pg_net submissions. The returned object is
      -- scheduling evidence, not an HTTP-201 claim; reconciliation happens on demand.
      perform public.nexus_v365_fleet_consume();
      v_fleet:=public.nexus_v365_fleet_dispatch(jsonb_build_object(
        'tipo','v1510_stream_match','platform',v_platform,'keyword',v_keyword,
        'link',v_source_url,'source_url',v_source_url,'produto',left(v_text,900),
        'language',v_language,'country',v_country,'casa',left(v_actor,120)),3,40);
    else
      v_fleet:='{"suppressed":"test_mode"}'::jsonb;
    end if;

    insert into public.nexus_v1510_ingest_receipts(
      event_id,event_hash,platform,keyword,offer_hash,actor_hash,
      canonical_mention_id,status,fleet_result)
    values(v_event_id,encode(extensions.digest(public.nexus_v1510_signing_material(p_event),'sha256'),'hex'),
      v_platform,v_keyword,v_offer,encode(extensions.digest(v_actor,'sha256'),'hex'),
      v_mention,'accepted',v_fleet)
    on conflict(event_id) do nothing;

    delete from public.nexus_v1510_ingress_buffer where event_id=v_event_id;
    perform pg_notify('nexus_v1510_event',jsonb_build_object(
      'event_id',v_event_id,'platform',v_platform,'keyword',left(v_keyword,80))::text);

    return jsonb_build_object('ok',true,'accepted',true,'event_id',v_event_id,
      'canonical_mention_id',v_mention,'ephemeral_buffer_empty',true,
      'fleet',v_fleet,
      'db_elapsed_ms',round(extract(epoch from(clock_timestamp()-v_started))*1000,3));
  exception when others then
    -- Any partially inserted buffer/canonical rows in this subtransaction roll back.
    perform public.nexus_v420_sintonizado('v1510-ingest',coalesce(v_platform,'unknown'),
      sqlstate||': '||left(sqlerrm,260));
    return jsonb_build_object('ok',false,'sintonizado',true,
      'reason','Sintonizado em Análise',
      'db_elapsed_ms',round(extract(epoch from(clock_timestamp()-v_started))*1000,3));
  end;
end;
$function$;

revoke all on function public.nexus_v1510_signing_material(jsonb),
                       public.nexus_v1510_flush_event(integer),
                       public.nexus_v1510_source_event_flush(),
                       public.nexus_v1510_ingest_event(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v1510_ingest_event(jsonb) to anon,authenticated,service_role;
grant execute on function public.nexus_v1510_flush_event(integer) to service_role;

-- Content triggers are durable intents, not fabricated publication receipts. The
-- process worker queues all three concurrently with Promise.allSettled(); each
-- downstream publisher must later replace `queued` with its real platform result.
create table if not exists public.nexus_v1510_content_triggers (
  id             bigint generated always as identity primary key,
  event_id       text not null references public.nexus_v1510_ingest_receipts(event_id) on delete cascade,
  channel        text not null check (channel in ('instagram_story','bluesky_reply','c2_channel')),
  keyword        text not null,
  offer_hash     text not null,
  state          text not null default 'queued' check (state in ('queued','claimed','published','failed','contained')),
  queued_at      timestamptz not null default clock_timestamp(),
  claimed_at     timestamptz,
  finished_at    timestamptz,
  external_id    text,
  error_code     text,
  unique(event_id,channel)
);
create index if not exists nexus_v1510_content_triggers_queue_idx
  on public.nexus_v1510_content_triggers(state,queued_at,id) where state='queued';
alter table public.nexus_v1510_content_triggers enable row level security;
revoke all on public.nexus_v1510_content_triggers from public,anon,authenticated,service_role;
revoke all on sequence public.nexus_v1510_content_triggers_id_seq from public,anon,authenticated,service_role;
grant select on public.nexus_v1510_content_triggers to service_role;

create or replace function public.nexus_v1510_queue_content_trigger(
  p_event_id text,p_channel text,p_signature text
) returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  r public.nexus_v1510_ingest_receipts%rowtype;
  v_secret text;
  v_expected text;
  v_id bigint;
  v_minute integer;
  v_hour integer;
  v_total integer;
begin
  perform set_config('statement_timeout','500',true);
  perform set_config('lock_timeout','250',true);
  if p_channel not in ('instagram_story','bluesky_reply','c2_channel')
     or coalesce(length(p_event_id),0)<12 then
    return jsonb_build_object('ok',false,'reason','invalid_trigger');
  end if;
  select * into r from public.nexus_v1510_ingest_receipts where event_id=p_event_id;
  if not found then return jsonb_build_object('ok',false,'reason','receipt_not_found'); end if;
  select value into v_secret from public.nexus_growth_secrets where key='stream_listener_token';
  v_expected:=encode(extensions.hmac(
    convert_to(p_event_id||'|'||p_channel||'|'||r.event_hash,'utf8'),
    convert_to(v_secret,'utf8'),'sha256'),'hex');
  if coalesce(length(p_signature),0)<>64
     or encode(extensions.digest(lower(p_signature),'sha256'),'hex')
        <>encode(extensions.digest(v_expected,'sha256'),'hex') then
    return jsonb_build_object('ok',false,'reason','signature_mismatch');
  end if;

  -- On-demand expiry + strict per-destination pacing. No timer wakes this queue.
  perform pg_advisory_xact_lock(hashtext('v1510-content:'||p_channel));
  update public.nexus_v1510_content_triggers
     set state='contained',finished_at=now(),error_code='expired_unclaimed'
   where channel=p_channel and state='queued' and queued_at<now()-interval '24 hours';
  select count(*) into v_minute from public.nexus_v1510_content_triggers
   where channel=p_channel and queued_at>now()-interval '1 minute';
  select count(*) into v_hour from public.nexus_v1510_content_triggers
   where channel=p_channel and queued_at>now()-interval '1 hour';
  select count(*) into v_total from public.nexus_v1510_content_triggers
   where channel=p_channel and state='queued';
  if v_minute>=3 or v_hour>=40 or v_total>=500 then
    return jsonb_build_object('ok',false,'contained',true,'reason','pacing_3m_40h_or_queue_cap');
  end if;

  insert into public.nexus_v1510_content_triggers(event_id,channel,keyword,offer_hash)
  values(p_event_id,p_channel,r.keyword,r.offer_hash)
  on conflict(event_id,channel) do update set event_id=excluded.event_id
  returning id into v_id;
  return jsonb_build_object('ok',true,'queued',true,'id',v_id,'channel',p_channel,
    'publication_claimed',false);
exception when others then
  perform public.nexus_v420_sintonizado('v1510-content-trigger',p_channel,
    sqlstate||': '||left(sqlerrm,220));
  return jsonb_build_object('ok',false,'sintonizado',true,'reason','Sintonizado em Análise');
end;
$function$;
revoke all on function public.nexus_v1510_queue_content_trigger(text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v1510_queue_content_trigger(text,text,text)
  to anon,authenticated,service_role;

-- One-time/idempotent containment for receipts accepted before the commerce-intent
-- gate existed. The immutable source mention and real Telegram receipt remain;
-- only unexecuted content intents are prevented from publishing.
with non_commercial as (
  select r.event_id
    from public.nexus_v1510_ingest_receipts r
    join public.nexus_v385_nostr_mentions m on m.id=r.canonical_mention_id
   where r.status='accepted'
     and lower(m.texto) !~ '(buy|buying|purchase|price|prices|deal|discount|coupon|shop|shopping|order|recommend|looking for|compar|worth buying|in stock|comprar|comprei|preço|precos|preços|oferta|promoção|promocao|cupom|desconto|procurando|recomendam|vale a pena|acheter|prix|promo|réduction|kaufen|preis|angebot|rabatt)'
), stopped as (
  update public.nexus_v1510_content_triggers c
     set state='contained',finished_at=coalesce(finished_at,now()),
         error_code=coalesce(error_code,'pre_commerce_gate')
    from non_commercial n
   where c.event_id=n.event_id and c.state in ('queued','claimed')
  returning c.event_id
)
update public.nexus_v1510_ingest_receipts r set status='contained'
 from non_commercial n where r.event_id=n.event_id;

-- -----------------------------------------------------------------------------
-- 5. Immutable ad binding for the three COMPLETE 1:1 host bindings.
--    A blocked DML row returns NULL, persists an audit row and queues a private
--    alert asynchronously if the caller commits. No placement is rewritten.
-- -----------------------------------------------------------------------------
create table if not exists public.nexus_v1510_protected_bindings (
  host                 text primary key,
  row_fingerprint      text not null,
  baseline             jsonb not null,
  protected_at         timestamptz not null default now()
);
insert into public.nexus_v1510_protected_bindings(host,row_fingerprint,baseline)
select host,encode(extensions.digest(to_jsonb(h)::text,'sha256'),'hex'),to_jsonb(h)
from public.nexus_host_tag_alignment h
where h.is_active and h.socialbar_url is not null and h.popunder_url is not null
on conflict(host) do nothing;

create table if not exists public.nexus_v1510_binding_violations (
  id             bigint generated always as identity primary key,
  host           text not null,
  operation      text not null,
  database_role  text not null,
  attempted_at   timestamptz not null default clock_timestamp()
);
create index if not exists nexus_v1510_binding_violations_time_idx
  on public.nexus_v1510_binding_violations(attempted_at desc);

alter table public.nexus_v1510_protected_bindings enable row level security;
alter table public.nexus_v1510_binding_violations enable row level security;
revoke all on public.nexus_v1510_protected_bindings,
              public.nexus_v1510_binding_violations from public,anon,authenticated,service_role;
revoke all on sequence public.nexus_v1510_binding_violations_id_seq from public,anon,authenticated,service_role;
grant select on public.nexus_v1510_protected_bindings,
                public.nexus_v1510_binding_violations to service_role;

create or replace function public.nexus_v1510_immutability_guard()
returns trigger
language plpgsql
security definer
set search_path='public','net','pg_temp'
as $function$
declare
  v_host text:=case when tg_op='DELETE' then old.host else new.host end;
  v_token text;
  v_chat text;
  v_recent_minute integer;
  v_recent_hour integer;
begin
  if current_setting('nexus.v1510.binding_maintenance',true)='authorized' then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if not exists(select 1 from public.nexus_v1510_protected_bindings where host=v_host) then
    return case when tg_op='DELETE' then old else new end;
  end if;

  insert into public.nexus_v1510_binding_violations(host,operation,database_role)
  values(v_host,tg_op,session_user);
  select count(*) into v_recent_minute from public.nexus_v1510_binding_violations
   where host=v_host and attempted_at>now()-interval '1 minute';
  select count(*) into v_recent_hour from public.nexus_v1510_binding_violations
   where host=v_host and attempted_at>now()-interval '1 hour';

  if v_recent_minute<=3 and v_recent_hour<=40 then
    select value into v_token from public.nexus_growth_secrets where key='telegram_bot_token_privado';
    select value into v_chat from public.nexus_growth_secrets where key='telegram_chat_id_privado';
    if coalesce(v_token,'')<>'' and coalesce(v_chat,'')~'^-[0-9]+$|^[0-9]+$' then
      perform net.http_post(
        url:='https://api.telegram.org/bot'||v_token||'/sendMessage',
        headers:='{"Content-Type":"application/json"}'::jsonb,
        body:=jsonb_build_object('chat_id',v_chat,
          'text','🛡️ v1510 bloqueou alteração não autorizada do binding 1:1. Host: '||v_host||' · operação: '||tg_op),
        timeout_milliseconds:=1000);
    end if;
  end if;
  -- Cancel the row while allowing the alert/audit to commit asynchronously.
  return null;
exception when others then
  raise log 'v1510 immutability guard contained: % %',sqlstate,left(sqlerrm,180);
  return null;
end;
$function$;

drop trigger if exists trg_v1510_immutability_guard on public.nexus_host_tag_alignment;
create trigger trg_v1510_immutability_guard
  before insert or update or delete on public.nexus_host_tag_alignment
  for each row execute function public.nexus_v1510_immutability_guard();

revoke all on function public.nexus_v1510_immutability_guard()
  from public,anon,authenticated,service_role;

-- -----------------------------------------------------------------------------
-- 6. No-polling cut-over. pg_cron remains available for unrelated low-frequency
--    housekeeping, but these data-plane scan jobs are explicitly inactive.
-- -----------------------------------------------------------------------------
select cron.alter_job(15,active:=false) where exists(select 1 from cron.job where jobid=15);
select cron.alter_job(16,active:=false) where exists(select 1 from cron.job where jobid=16);
select cron.alter_job(18,active:=false) where exists(select 1 from cron.job where jobid=18);
select cron.alter_job(60,active:=false) where exists(select 1 from cron.job where jobid=60);
select cron.alter_job(64,active:=false) where exists(select 1 from cron.job where jobid=64);

-- -----------------------------------------------------------------------------
-- 7. Evidence view: reports measured state and refuses unmeasured claims.
-- -----------------------------------------------------------------------------
create or replace view public.nexus_v1510_status_v
with (security_invoker=false)
as
select
  'v1510.0'::text as version,
  'signed_postgrest_event_driven'::text as ingestion_mode,
  (select count(*) from public.nexus_v370_keyword_source) as keyword_mappings_measured,
  (select count(*) from public.nexus_v380_keyword_vectors where modelo='gte-small-local') as local_vectors_measured,
  round(100.0*(select count(*) from public.nexus_v380_keyword_vectors where modelo='gte-small-local')
        /nullif((select count(*) from public.nexus_v370_keyword_source),0),2) as vector_coverage_pct,
  (select count(*) from public.ads where active is true) as active_ads_read_only,
  (select count(*) from public.nexus_v360_node_endpoints where ativo) as satellite_endpoints_configured,
  (select count(*) from public.nexus_v1510_protected_bindings) as complete_bindings_protected,
  (select count(*) from public.nexus_v1510_ingress_buffer) as ingress_buffer_depth,
  (select count(*) from public.nexus_v420_channel_outbox) as telegram_outbox_depth,
  (select count(*) from public.nexus_telegram_message_buffer) as legacy_buffer_depth,
  not exists(select 1 from cron.job where jobid in(15,16,18,60,64) and active) as prohibited_polling_jobs_off,
  (select count(*) from pg_trigger where tgname like 'trg_v1510_%_source_flush' and tgenabled='O') as source_event_triggers,
  'not_claimed_without_external_runtime_measurement'::text as persistent_websocket_sla,
  'not_claimed_without_network_measurement'::text as ttfb_sla;

revoke all on public.nexus_v1510_status_v from public,anon,authenticated;
grant select on public.nexus_v1510_status_v to service_role;

comment on view public.nexus_v1510_status_v is
'Verifiable v1510 state. Counts are live; persistence and latency SLAs are intentionally not inferred.';

-- The catalog is explicitly untouched. Fail if its measured active count drifted
-- before this release; the transaction then rolls back rather than normalizing it.
do $guard$
declare v_ads bigint; v_kw bigint; v_bind bigint;
begin
  select count(*) into v_ads from public.ads where active is true;
  select count(*) into v_kw from public.nexus_v370_keyword_source;
  select count(*) into v_bind from public.nexus_v1510_protected_bindings;
  if v_ads<>12165 then raise exception 'v1510 refused: active ads drifted (%)',v_ads; end if;
  if v_kw<>17605 then raise exception 'v1510 refused: keyword source drifted (%)',v_kw; end if;
  if v_bind<>3 then raise exception 'v1510 refused: complete 1:1 bindings expected 3, got %',v_bind; end if;
end;
$guard$;

notify pgrst,'reload schema';
notify pgrst,'reload config';

commit;
