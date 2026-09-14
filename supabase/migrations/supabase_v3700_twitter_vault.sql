-- Nexus v3700.0 — private X/Twitter vault and bounded HTTP-stream ingest core.
-- X Filtered Stream is persistent HTTP streaming, not RFC 6455 WebSocket.
-- No credential plaintext is present in this migration.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

create temp table pg_temp.nexus_v3700_baseline on commit drop as
select (select count(*) from public.ads) ads_rows,
       (select count(*) from public.ads where active) active_ads_rows,
       (select count(*) from public.nexus_v370_keyword_source) keyword_rows,
       (select count(*) from public.nexus_shopee_offers) shopee_rows,
       (select count(*) from public.nexus_v3680_intent_target_matrix) matrix_rows;

create table public.nexus_v3700_twitter_vault(
  credential_key text primary key check(credential_key in(
    'consumer_key','consumer_secret','oauth2_client_id','oauth2_client_secret',
    'oauth2_access_token','oauth2_refresh_token','bearer_token_v2')),
  credential_enc bytea not null check(octet_length(credential_enc)>32),
  kms_key_name text not null default 'nexus_satellites_kms' check(kms_key_name='nexus_satellites_kms'),
  encryption_profile text not null default 'OpenPGP AES-256' check(encryption_profile='OpenPGP AES-256'),
  validation_scope text not null check(validation_scope in(
    'operator_supplied_not_individually_validated','readonly_rules_http_200','readonly_users_me_http_200')),
  last_validated_at timestamptz,
  installed_at timestamptz not null default clock_timestamp(),
  installed_by_release text not null default 'v3700.0' check(installed_by_release='v3700.0'),
  check((validation_scope='operator_supplied_not_individually_validated')=(last_validated_at is null))
);
comment on table public.nexus_v3700_twitter_vault is 'Private individually encrypted X credential vault; no plaintext token columns.';
revoke all on table public.nexus_v3700_twitter_vault from public,anon,authenticated,service_role;
alter table public.nexus_v3700_twitter_vault enable row level security;
alter table public.nexus_v3700_twitter_vault force row level security;

create or replace function public.nexus_v3700_vault_mutation_guard()
returns trigger language plpgsql set search_path='public','pg_temp' as $function$
begin
  if coalesce(current_setting('nexus.v3700_hydrating',true),'')<>'on' then
    raise exception 'v3700 Twitter vault rejects direct %',tg_op using errcode='55000';
  end if;
  return null;
end
$function$;
revoke all on function public.nexus_v3700_vault_mutation_guard() from public,anon,authenticated,service_role;
create trigger trg_v3700_twitter_vault_guard before insert or update or delete or truncate
on public.nexus_v3700_twitter_vault for each statement execute function public.nexus_v3700_vault_mutation_guard();

-- Temporary protected hydration entrypoint. It is dropped immediately after the
-- seven operator-supplied values are encrypted and independently verified.
create or replace function public.nexus_v3700_hydrate_twitter_vault(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path='public','extensions','pg_temp'
as $function$
declare
  v_expected constant text[]:=array['consumer_key','consumer_secret','oauth2_client_id','oauth2_client_secret','oauth2_access_token','oauth2_refresh_token','bearer_token_v2'];
  v_kms text;v_key text;v_value text;v_count integer:=0;
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or (select count(*) from jsonb_object_keys(p_payload))<>7
     or exists(select 1 from jsonb_object_keys(p_payload) as k(key) where key<>all(v_expected))
     or exists(select 1 from unnest(v_expected) as k(key) where not p_payload?key) then
    raise exception 'v3700 hydration payload keys invalid';
  end if;
  if exists(select 1 from public.nexus_v3700_twitter_vault) then raise exception 'v3700 vault already hydrated';end if;
  select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms' and length(btrim(value))>=16;
  perform set_config('nexus.v3700_hydrating','on',true);
  foreach v_key in array v_expected loop
    v_value:=p_payload->>v_key;
    if v_value is null or length(v_value) not between 10 and 4096 then raise exception 'v3700 invalid credential length for %',v_key;end if;
    insert into public.nexus_v3700_twitter_vault(credential_key,credential_enc,validation_scope,last_validated_at)
    values(v_key,extensions.pgp_sym_encrypt(v_value,v_kms,'cipher-algo=aes256,compress-algo=1'),
      case v_key when 'bearer_token_v2' then 'readonly_rules_http_200' when 'oauth2_access_token' then 'readonly_users_me_http_200' else 'operator_supplied_not_individually_validated' end,
      case when v_key in('bearer_token_v2','oauth2_access_token') then clock_timestamp() else null end);
    v_count:=v_count+1;
  end loop;
  v_value:=null;v_kms:=null;v_key:=null;
  return jsonb_build_object('version','v3700.0','encrypted_rows',v_count,'plaintext_persisted',false);
exception when others then v_value:=null;v_kms:=null;v_key:=null;raise;
end
$function$;
revoke all on function public.nexus_v3700_hydrate_twitter_vault(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3700_hydrate_twitter_vault(jsonb) to service_role;

-- OAuth 2.0 refresh tokens rotate. This controlled entrypoint updates only the
-- access/refresh pair and never returns either plaintext value.
create or replace function public.nexus_v3700_rotate_oauth2_tokens(p_access text,p_refresh text)
returns jsonb language plpgsql volatile security definer set search_path='public','extensions','pg_temp'
as $function$
declare v_kms text;
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  if length(coalesce(p_access,'')) not between 40 and 4096 or length(coalesce(p_refresh,'')) not between 40 and 4096 then raise exception 'v3700 OAuth token length invalid';end if;
  select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms' and length(btrim(value))>=16;
  perform set_config('nexus.v3700_hydrating','on',true);
  update public.nexus_v3700_twitter_vault set credential_enc=extensions.pgp_sym_encrypt(case credential_key when 'oauth2_access_token' then p_access else p_refresh end,v_kms,'cipher-algo=aes256,compress-algo=1'),validation_scope=case when credential_key='oauth2_access_token' then 'readonly_users_me_http_200' else 'operator_supplied_not_individually_validated' end,last_validated_at=case when credential_key='oauth2_access_token' then clock_timestamp() else null end,installed_at=clock_timestamp() where credential_key in('oauth2_access_token','oauth2_refresh_token');
  if not found or (select count(*) from public.nexus_v3700_twitter_vault where credential_key in('oauth2_access_token','oauth2_refresh_token'))<>2 then raise exception 'v3700 OAuth pair unavailable';end if;
  v_kms:=null;p_access:=null;p_refresh:=null;
  return jsonb_build_object('version','v3700.0','rotated_rows',2,'plaintext_persisted',false);
exception when others then v_kms:=null;p_access:=null;p_refresh:=null;raise;
end
$function$;
revoke all on function public.nexus_v3700_rotate_oauth2_tokens(text,text) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3700_rotate_oauth2_tokens(text,text) to service_role;

create table public.nexus_v3700_twitter_stream_lease(
  lease_id smallint primary key check(lease_id=1),
  session_id uuid,
  lease_token uuid,
  holder text,
  acquired_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check((lease_token is null and session_id is null and holder is null and acquired_at is null and expires_at is null)
     or (lease_token is not null and session_id is not null and holder is not null and acquired_at is not null and expires_at is not null))
);
insert into public.nexus_v3700_twitter_stream_lease(lease_id) values(1);
revoke all on table public.nexus_v3700_twitter_stream_lease from public,anon,authenticated,service_role;

create table public.nexus_v3700_twitter_session_audit(
  session_id uuid primary key,
  holder text not null,
  requested_seconds smallint not null check(requested_seconds between 5 and 90),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  upstream_http smallint check(upstream_http between 100 and 599),
  posts_seen integer not null default 0 check(posts_seen>=0),
  matched_posts integer not null default 0 check(matched_posts>=0),
  outbox_rows integer not null default 0 check(outbox_rows>=0),
  keepalives integer not null default 0 check(keepalives>=0),
  finish_reason text,
  http_stream_proven boolean not null default false,
  websocket_used boolean not null default false check(not websocket_used),
  continuous_24x7_proven boolean not null default false check(not continuous_24x7_proven)
);
revoke all on table public.nexus_v3700_twitter_session_audit from public,anon,authenticated,service_role;

create table public.nexus_v3700_twitter_event_ledger(
  event_id uuid primary key default gen_random_uuid(),
  source_platform text not null default 'x_filtered_stream' check(source_platform='x_filtered_stream'),
  source_post_id text not null check(source_post_id~'^[0-9]{1,32}$'),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  rule_scope text not null check(rule_scope in('br_sp_msa','us_ny_msa')),
  locale text not null check(locale~'^[a-z]{2}(-[A-Z]{2})?$'),
  matched_keyword_hashes text[] not null check(cardinality(matched_keyword_hashes) between 1 and 25),
  matched_offer_refs text[] not null check(cardinality(matched_offer_refs) between 1 and 25),
  source_created_at timestamptz,
  received_at timestamptz not null default clock_timestamp(),
  copilot_attempted boolean not null default false,
  copilot_provider_status jsonb not null default '{}'::jsonb check(jsonb_typeof(copilot_provider_status)='object'),
  raw_text_persisted boolean not null default false check(not raw_text_persisted),
  affiliate_url_persisted boolean not null default false check(not affiliate_url_persisted),
  publication_performed boolean not null default false check(not publication_performed),
  click_recorded boolean not null default false check(not click_recorded),
  unique(source_platform,source_post_id)
);
create index nexus_v3700_twitter_event_received_idx on public.nexus_v3700_twitter_event_ledger(received_at desc,rule_scope);
revoke all on table public.nexus_v3700_twitter_event_ledger from public,anon,authenticated,service_role;

create table public.nexus_v3700_twitter_inbound_outbox(
  outbox_id bigint generated always as identity primary key,
  event_id uuid not null unique references public.nexus_v3700_twitter_event_ledger(event_id) on delete restrict,
  channel_key text not null default 'atendimento' check(channel_key='atendimento'),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  status text not null default 'pending' check(status in('pending','leased','delivered','dead_letter')),
  attempts smallint not null default 0 check(attempts between 0 and 20),
  available_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  check(not (payload?'affiliate_url') and not (payload?'click_url') and not (payload?'raw_text'))
);
create index nexus_v3700_twitter_outbox_pending_idx on public.nexus_v3700_twitter_inbound_outbox(status,available_at,outbox_id) where status='pending';
revoke all on table public.nexus_v3700_twitter_inbound_outbox from public,anon,authenticated,service_role;

create or replace function public.nexus_v3700_event_to_outbox()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $function$
begin
  insert into public.nexus_v3700_twitter_inbound_outbox(event_id,payload)
  values(new.event_id,jsonb_build_object('version','v3700.0','event_id',new.event_id,'source_platform',new.source_platform,
    'rule_scope',new.rule_scope,'locale',new.locale,'match_count',cardinality(new.matched_keyword_hashes),
    'estado','Sintonizado em Análise','raw_text_persisted',false,'publication_performed',false));
  return new;
exception when others then raise;
end
$function$;
create trigger trg_v3700_event_to_outbox after insert on public.nexus_v3700_twitter_event_ledger
for each row execute function public.nexus_v3700_event_to_outbox();

create or replace function public.nexus_v3700_notify_outbox()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $function$
begin
  perform pg_notify('nexus_v3700_twitter_inbound',jsonb_build_object('outbox_id',new.outbox_id,'event_id',new.event_id)::text);
  return null;
exception when others then raise;
end
$function$;
create trigger trg_v3700_notify_outbox after insert on public.nexus_v3700_twitter_inbound_outbox
for each row execute function public.nexus_v3700_notify_outbox();

create or replace function public.nexus_v3700_keyword_snapshot()
returns jsonb language sql stable security definer set search_path='public','extensions','pg_temp'
as $function$
  select jsonb_build_object('version','v3700.0','count',count(*),'patterns',jsonb_agg(jsonb_build_object(
    'kw',kw,'hash',encode(extensions.digest(oferta,'sha256'),'hex')) order by kw)) from public.nexus_v370_keyword_source;
$function$;
revoke all on function public.nexus_v3700_keyword_snapshot() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3700_keyword_snapshot() to service_role;

create or replace function public.nexus_v3700_acquire_stream_lease(p_holder text,p_seconds integer default 60)
returns jsonb language plpgsql volatile security definer set search_path='public','extensions','pg_temp'
as $function$
declare r public.nexus_v3700_twitter_stream_lease%rowtype;v_token uuid;v_session uuid;v_kms text;v_bearer text;v_seconds integer;
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  if p_holder is null or p_holder!~'^[a-z0-9_-]{2,40}$' then raise exception 'v3700 holder invalid';end if;
  v_seconds:=greatest(5,least(coalesce(p_seconds,60),90));
  select * into strict r from public.nexus_v3700_twitter_stream_lease where lease_id=1 for update;
  if r.lease_token is not null and r.expires_at>clock_timestamp() then
    return jsonb_build_object('version','v3700.0','acquired',false,'reason','single_x_stream_lease_busy','retry_after_seconds',greatest(1,ceil(extract(epoch from(r.expires_at-clock_timestamp())))::int));
  end if;
  select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms';
  select extensions.pgp_sym_decrypt(credential_enc,v_kms) into strict v_bearer from public.nexus_v3700_twitter_vault where credential_key='bearer_token_v2';
  v_token:=gen_random_uuid();v_session:=gen_random_uuid();
  update public.nexus_v3700_twitter_stream_lease set session_id=v_session,lease_token=v_token,holder=p_holder,acquired_at=clock_timestamp(),expires_at=clock_timestamp()+make_interval(secs=>v_seconds+15),updated_at=clock_timestamp() where lease_id=1;
  insert into public.nexus_v3700_twitter_session_audit(session_id,holder,requested_seconds) values(v_session,p_holder,v_seconds);
  v_kms:=null;
  return jsonb_build_object('version','v3700.0','acquired',true,'session_id',v_session,'lease_token',v_token,'bearer_token',v_bearer,'duration_seconds',v_seconds,'transport','persistent_http_stream','websocket',false);
exception when others then v_kms:=null;v_bearer:=null;raise;
end
$function$;
revoke all on function public.nexus_v3700_acquire_stream_lease(text,integer) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3700_acquire_stream_lease(text,integer) to service_role;

create or replace function public.nexus_v3700_ingest_matches(p_session_id uuid,p_lease_token uuid,p_events jsonb)
returns jsonb language plpgsql volatile security definer set search_path='public','pg_temp'
as $function$
declare x jsonb;v_event uuid;v_inserted integer:=0;v_duplicates integer:=0;v_kw text[];v_refs text[];v_created timestamptz;
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events) not between 1 and 50 then raise exception 'v3700 event batch invalid';end if;
  if not exists(select 1 from public.nexus_v3700_twitter_stream_lease where lease_id=1 and session_id=p_session_id and lease_token=p_lease_token and expires_at>clock_timestamp()) then raise exception 'v3700 stream lease invalid or expired';end if;
  for x in select value from jsonb_array_elements(p_events) loop
    if jsonb_typeof(x)<>'object' or x?'text' or x?'raw' or x?'content' or coalesce(x->>'source_post_id','')!~'^[0-9]{1,32}$' or coalesce(x->>'payload_sha256','')!~'^[0-9a-f]{64}$' or coalesce(x->>'rule_scope','') not in('br_sp_msa','us_ny_msa') or coalesce(x->>'locale','')!~'^[a-z]{2}(-[A-Z]{2})?$' or jsonb_typeof(x->'matched_keyword_hashes')<>'array' or jsonb_array_length(x->'matched_keyword_hashes') not between 1 and 25 or jsonb_typeof(x->'matched_offer_refs')<>'array' or jsonb_array_length(x->'matched_offer_refs') not between 1 and 25 then raise exception 'v3700 event object invalid';end if;
    select array_agg(value) into v_kw from jsonb_array_elements_text(x->'matched_keyword_hashes');
    select array_agg(value) into v_refs from jsonb_array_elements_text(x->'matched_offer_refs');
    if exists(select 1 from unnest(v_kw||v_refs)y where y!~'^[0-9a-f]{64}$') then raise exception 'v3700 event hash invalid';end if;
    begin v_created:=nullif(x->>'source_created_at','')::timestamptz;exception when others then raise exception 'v3700 source timestamp invalid';end;
    insert into public.nexus_v3700_twitter_event_ledger(source_post_id,payload_sha256,rule_scope,locale,matched_keyword_hashes,matched_offer_refs,source_created_at,copilot_attempted,copilot_provider_status)
    values(x->>'source_post_id',x->>'payload_sha256',x->>'rule_scope',x->>'locale',v_kw,v_refs,v_created,coalesce((x->>'copilot_attempted')::boolean,false),case when jsonb_typeof(x->'copilot_provider_status')='object' then x->'copilot_provider_status' else '{}'::jsonb end)
    on conflict(source_platform,source_post_id) do nothing returning event_id into v_event;
    if v_event is null then v_duplicates:=v_duplicates+1;else v_inserted:=v_inserted+1;end if;v_event:=null;
  end loop;
  return jsonb_build_object('version','v3700.0','inserted',v_inserted,'duplicates',v_duplicates,'raw_text_persisted',false,'outbox_rows_created',v_inserted);
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3700_ingest_matches(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3700_ingest_matches(uuid,uuid,jsonb) to service_role;

create or replace function public.nexus_v3700_finish_stream_session(p_session_id uuid,p_lease_token uuid,p_stats jsonb)
returns jsonb language plpgsql volatile security definer set search_path='public','pg_temp'
as $function$
declare v_updated integer;
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  if p_stats is null or jsonb_typeof(p_stats)<>'object' then raise exception 'v3700 stats invalid';end if;
  if not exists(select 1 from public.nexus_v3700_twitter_stream_lease where lease_id=1 and session_id=p_session_id and lease_token=p_lease_token) then raise exception 'v3700 finish lease invalid';end if;
  update public.nexus_v3700_twitter_session_audit set finished_at=clock_timestamp(),upstream_http=nullif(p_stats->>'upstream_http','')::smallint,posts_seen=greatest(0,coalesce((p_stats->>'posts_seen')::integer,0)),matched_posts=greatest(0,coalesce((p_stats->>'matched_posts')::integer,0)),outbox_rows=greatest(0,coalesce((p_stats->>'outbox_rows')::integer,0)),keepalives=greatest(0,coalesce((p_stats->>'keepalives')::integer,0)),finish_reason=left(coalesce(p_stats->>'finish_reason','unspecified'),80),http_stream_proven=coalesce((p_stats->>'upstream_http')::integer,0)=200 where session_id=p_session_id;
  get diagnostics v_updated=row_count;if v_updated<>1 then raise exception 'v3700 session audit absent';end if;
  update public.nexus_v3700_twitter_stream_lease set session_id=null,lease_token=null,holder=null,acquired_at=null,expires_at=null,updated_at=clock_timestamp() where lease_id=1;
  return jsonb_build_object('version','v3700.0','released',true,'session_id',p_session_id,'continuous_24x7_proven',false);
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3700_finish_stream_session(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3700_finish_stream_session(uuid,uuid,jsonb) to service_role;

create or replace function public.nexus_v3700_operator_status()
returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp'
as $function$
begin
  perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
  return jsonb_build_object('version','v3700.0','observed_at',clock_timestamp(),
    'vault_rows',(select count(*) from public.nexus_v3700_twitter_vault),
    'keyword_mappings',(select count(*) from public.nexus_v370_keyword_source),
    'stream',jsonb_build_object('transport','persistent HTTP stream','rfc6455_websocket',false,'filtered_stream_is_full_firehose',false,'single_connection_lease',true,'bounded_edge_session_max_seconds',90,'continuous_24x7_proven',false,
      'sessions',(select count(*) from public.nexus_v3700_twitter_session_audit),'http_200_sessions',(select count(*) from public.nexus_v3700_twitter_session_audit where http_stream_proven)),
    'events',jsonb_build_object('ledger_rows',(select count(*) from public.nexus_v3700_twitter_event_ledger),'outbox_rows',(select count(*) from public.nexus_v3700_twitter_inbound_outbox),'pending',(select count(*) from public.nexus_v3700_twitter_inbound_outbox where status='pending'),'raw_text_persisted',false,'publication_performed',false),
    'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command) from cron.job where jobid=60),
    'claims',jsonb_build_object('go_js_modified',false,'compose_ts_modified',false,'placements_modified',false,'sub_1ms_guaranteed',false,'fallback_deployed',false,'sub_50ms_fallback_guaranteed',false,'human_or_residential_proven',false,'sales_claimed',false));
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3700_operator_status() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3700_operator_status() to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3700_twitter_vault',false,jsonb_build_object('reason','awaiting protected hydration','expected_encrypted_rows',7,'plaintext_in_migration',false),clock_timestamp()),
 ('v3700_x_filtered_http_stream',false,jsonb_build_object('reason','bounded stream session not yet observed','transport','persistent HTTP','rfc6455_websocket',false,'full_firehose',false),clock_timestamp()),
 ('v3700_continuous_24x7',false,jsonb_build_object('reason','Supabase Edge wall-clock is bounded; no resident worker proven'),clock_timestamp()),
 ('v3700_anti404_fallback',false,jsonb_build_object('reason','no verified final merchant URL plus measured fallback behavior','sub_50ms_guaranteed',false),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare b record;v_p "char";
begin
  select * into b from pg_temp.nexus_v3700_baseline;
  if b.ads_rows<>14301 or b.active_ads_rows<>12165 or b.keyword_rows<>17605 or b.shopee_rows<>1201 or b.matrix_rows<>27 then raise exception 'v3700 production baseline drift';end if;
  if (select count(*) from public.ads)<>b.ads_rows or (select count(*) from public.ads where active)<>b.active_ads_rows or (select count(*) from public.nexus_v370_keyword_source)<>b.keyword_rows then raise exception 'v3700 protected catalog changed';end if;
  if exists(select 1 from cron.job where active and schedule~*'second' and jobid<>60) then raise exception 'v3700 unexpected sub-minute polling job';end if;
  if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65) and active) then raise exception 'v3700 legacy poller active';end if;
  if not exists(select 1 from cron.job where jobid=60 and jobname='v360-tg-flush-10s' and active and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'v3700 Job 60 changed';end if;
  select relpersistence into v_p from pg_class where oid='public.nexus_v3700_twitter_vault'::regclass;if v_p<>'p'::"char" then raise exception 'v3700 vault not LOGGED';end if;
  select relpersistence into v_p from pg_class where oid='public.nexus_v3700_twitter_inbound_outbox'::regclass;if v_p<>'p'::"char" then raise exception 'v3700 outbox not LOGGED';end if;
  if has_table_privilege('service_role','public.nexus_v3700_twitter_vault','select') or has_table_privilege('anon','public.nexus_v3700_twitter_vault','select') then raise exception 'v3700 vault exposed';end if;
  if has_function_privilege('anon','public.nexus_v3700_acquire_stream_lease(text,integer)','execute') or not has_function_privilege('service_role','public.nexus_v3700_acquire_stream_lease(text,integer)','execute') then raise exception 'v3700 lease ACL';end if;
exception when others then raise;
end
$assert$;
commit;
