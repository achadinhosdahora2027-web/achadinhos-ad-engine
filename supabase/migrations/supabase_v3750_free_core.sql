-- Nexus v3750.0 — white-hat replay ingestion and current free-model policy.
-- Explicitly excludes X transport, third-party cookies, scraping and human emulation.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

create temp table pg_temp.nexus_v3750_baseline on commit drop as
select (select count(*) from public.ads) ads_rows,
       (select count(*) from public.ads where active) active_ads_rows,
       (select count(*) from public.nexus_v370_keyword_source) keyword_rows,
       (select count(*) from public.nexus_shopee_offers) shopee_rows,
       (select count(*) from public.nexus_v3680_intent_target_matrix) matrix_rows;

create table public.nexus_v3750_provider_policy(
  provider text not null check(provider in('groq','openrouter')),
  model_id text not null,
  enabled boolean not null default true,
  catalog_price_zero_verified boolean not null default false,
  verified_at timestamptz,
  policy_version text not null default 'v3200.0' check(policy_version='v3200.0'),
  publication_allowed boolean not null default false check(not publication_allowed),
  cost_zero_guaranteed boolean not null default false check(not cost_zero_guaranteed),
  primary key(provider,model_id),
  check((catalog_price_zero_verified and verified_at is not null) or (not catalog_price_zero_verified))
);
insert into public.nexus_v3750_provider_policy(provider,model_id,catalog_price_zero_verified,verified_at) values
 ('groq','openai/gpt-oss-20b',false,null),
 ('openrouter','google/gemma-4-26b-a4b-it:free',true,clock_timestamp()),
 ('openrouter','nvidia/nemotron-3.5-lightning:free',true,clock_timestamp());
comment on table public.nexus_v3750_provider_policy is 'Allowlist observed 2026-09-14; zero-price catalog entries remain rate-limited and are not a cost/availability guarantee.';
revoke all on table public.nexus_v3750_provider_policy from public,anon,authenticated,service_role;

create table public.nexus_v3750_replay_batch(
  batch_id uuid primary key default gen_random_uuid(),
  source_type text not null check(source_type in('synthetic_fixture','operator_export','owned_staging')),
  authorization_note text not null check(length(btrim(authorization_note)) between 8 and 240),
  manifest_sha256 text not null check(manifest_sha256~'^[0-9a-f]{64}$'),
  declared_items integer not null check(declared_items between 1 and 1000),
  status text not null default 'open' check(status in('open','completed','failed')),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  x_transport_used boolean not null default false check(not x_transport_used),
  third_party_cookie_used boolean not null default false check(not third_party_cookie_used),
  scraper_used boolean not null default false check(not scraper_used),
  human_emulation_used boolean not null default false check(not human_emulation_used)
);
revoke all on table public.nexus_v3750_replay_batch from public,anon,authenticated,service_role;

create table public.nexus_v3750_replay_event_ledger(
  replay_event_id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.nexus_v3750_replay_batch(batch_id) on delete restrict,
  event_ordinal integer not null check(event_ordinal between 1 and 1000),
  content_sha256 text not null check(content_sha256~'^[0-9a-f]{64}$'),
  locale text not null check(locale~'^[a-z]{2}(-[A-Z]{2})?$'),
  country_hint text check(country_hint is null or country_hint~'^[A-Z]{2}$'),
  country_is_context_hint boolean not null default true check(country_is_context_hint),
  human_or_residential_proven boolean not null default false check(not human_or_residential_proven),
  matched_keyword_hashes text[] not null check(cardinality(matched_keyword_hashes) between 1 and 25),
  matched_offer_refs text[] not null check(cardinality(matched_offer_refs) between 1 and 25),
  provider_status jsonb not null default '{}'::jsonb check(jsonb_typeof(provider_status)='object'),
  received_at timestamptz not null default clock_timestamp(),
  raw_text_persisted boolean not null default false check(not raw_text_persisted),
  affiliate_url_persisted boolean not null default false check(not affiliate_url_persisted),
  publication_performed boolean not null default false check(not publication_performed),
  click_recorded boolean not null default false check(not click_recorded),
  unique(batch_id,event_ordinal)
);
create index nexus_v3750_replay_event_received_idx on public.nexus_v3750_replay_event_ledger(received_at desc,batch_id);
revoke all on table public.nexus_v3750_replay_event_ledger from public,anon,authenticated,service_role;

create table public.nexus_v3750_replay_outbox(
  outbox_id bigint generated always as identity primary key,
  replay_event_id uuid not null unique references public.nexus_v3750_replay_event_ledger(replay_event_id) on delete restrict,
  channel_key text not null default 'atendimento' check(channel_key='atendimento'),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  status text not null default 'pending' check(status in('pending','leased','delivered','dead_letter')),
  attempts smallint not null default 0 check(attempts between 0 and 20),
  available_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  check(not(payload?'raw_text') and not(payload?'affiliate_url') and not(payload?'click_url'))
);
create index nexus_v3750_replay_outbox_pending_idx on public.nexus_v3750_replay_outbox(status,available_at,outbox_id) where status='pending';
revoke all on table public.nexus_v3750_replay_outbox from public,anon,authenticated,service_role;

create or replace function public.nexus_v3750_event_to_outbox()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $function$
begin
  insert into public.nexus_v3750_replay_outbox(replay_event_id,payload) values(new.replay_event_id,
    jsonb_build_object('version','v3750.0','replay_event_id',new.replay_event_id,'batch_id',new.batch_id,
      'locale',new.locale,'country_hint',new.country_hint,'match_count',cardinality(new.matched_keyword_hashes),
      'estado','Sintonizado em Análise','raw_text_persisted',false,'publication_performed',false));
  return new;
exception when others then raise;
end
$function$;
create trigger trg_v3750_event_to_outbox after insert on public.nexus_v3750_replay_event_ledger
for each row execute function public.nexus_v3750_event_to_outbox();

create or replace function public.nexus_v3750_notify_outbox()
returns trigger language plpgsql security definer set search_path='public','pg_temp' as $function$
begin
  perform pg_notify('nexus_v3750_replay',jsonb_build_object('outbox_id',new.outbox_id,'replay_event_id',new.replay_event_id)::text);
  return null;
exception when others then raise;
end
$function$;
create trigger trg_v3750_notify_outbox after insert on public.nexus_v3750_replay_outbox
for each row execute function public.nexus_v3750_notify_outbox();

create or replace function public.nexus_v3750_keyword_snapshot()
returns jsonb language sql stable security definer set search_path='public','extensions','pg_temp' as $function$
 select jsonb_build_object('version','v3750.0','count',count(*),'patterns',jsonb_agg(jsonb_build_object(
   'kw',kw,'hash',encode(extensions.digest(oferta,'sha256'),'hex')) order by kw))
 from public.nexus_v370_keyword_source;
$function$;
revoke all on function public.nexus_v3750_keyword_snapshot() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3750_keyword_snapshot() to service_role;

create or replace function public.nexus_v3750_provider_snapshot()
returns jsonb language sql stable security definer set search_path='public','pg_temp' as $function$
 select jsonb_build_object('version','v3750.0','providers',jsonb_agg(jsonb_build_object('provider',provider,
  'model_id',model_id,'enabled',enabled,'catalog_price_zero_verified',catalog_price_zero_verified,
  'cost_zero_guaranteed',cost_zero_guaranteed) order by provider,model_id)) from public.nexus_v3750_provider_policy;
$function$;
revoke all on function public.nexus_v3750_provider_snapshot() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3750_provider_snapshot() to service_role;

create or replace function public.nexus_v3750_begin_replay(p_source_type text,p_authorization_note text,p_manifest_sha256 text,p_declared_items integer)
returns jsonb language plpgsql volatile security definer set search_path='public','pg_temp' as $function$
declare v_id uuid;
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 if p_source_type not in('synthetic_fixture','operator_export','owned_staging') or length(btrim(coalesce(p_authorization_note,'')))not between 8 and 240 or coalesce(p_manifest_sha256,'')!~'^[0-9a-f]{64}$' or p_declared_items not between 1 and 1000 then raise exception 'v3750 replay declaration invalid';end if;
 insert into public.nexus_v3750_replay_batch(source_type,authorization_note,manifest_sha256,declared_items)
 values(p_source_type,btrim(p_authorization_note),p_manifest_sha256,p_declared_items) returning batch_id into v_id;
 return jsonb_build_object('version','v3750.0','batch_id',v_id,'accepted',true,'x_transport_used',false,'third_party_cookie_used',false,'scraper_used',false);
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3750_begin_replay(text,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3750_begin_replay(text,text,text,integer) to service_role;

create or replace function public.nexus_v3750_ingest_replay_matches(p_batch_id uuid,p_events jsonb)
returns jsonb language plpgsql volatile security definer set search_path='public','pg_temp' as $function$
declare x jsonb;v_event uuid;v_inserted int:=0;v_duplicates int:=0;v_kw text[];v_refs text[];
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 if not exists(select 1 from public.nexus_v3750_replay_batch where batch_id=p_batch_id and status='open') then raise exception 'v3750 replay batch unavailable';end if;
 if p_events is null or jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)not between 1 and 50 then raise exception 'v3750 replay event batch invalid';end if;
 for x in select value from jsonb_array_elements(p_events) loop
  if jsonb_typeof(x)<>'object' or x?'text' or x?'raw_text' or x?'url' or x?'cookie' or x?'auth_token' or coalesce(x->>'event_ordinal','')!~'^[0-9]{1,4}$' or (x->>'event_ordinal')::int not between 1 and 1000 or coalesce(x->>'content_sha256','')!~'^[0-9a-f]{64}$' or coalesce(x->>'locale','')!~'^[a-z]{2}(-[A-Z]{2})?$' or (x->>'country_hint' is not null and x->>'country_hint'!~'^[A-Z]{2}$') or jsonb_typeof(x->'matched_keyword_hashes')<>'array' or jsonb_array_length(x->'matched_keyword_hashes')not between 1 and 25 or jsonb_typeof(x->'matched_offer_refs')<>'array' or jsonb_array_length(x->'matched_offer_refs')not between 1 and 25 then raise exception 'v3750 replay event invalid';end if;
  select array_agg(value)into v_kw from jsonb_array_elements_text(x->'matched_keyword_hashes');select array_agg(value)into v_refs from jsonb_array_elements_text(x->'matched_offer_refs');
  if exists(select 1 from unnest(v_kw||v_refs)y where y!~'^[0-9a-f]{64}$')then raise exception 'v3750 replay hash invalid';end if;
  insert into public.nexus_v3750_replay_event_ledger(batch_id,event_ordinal,content_sha256,locale,country_hint,matched_keyword_hashes,matched_offer_refs,provider_status)
  values(p_batch_id,(x->>'event_ordinal')::int,x->>'content_sha256',x->>'locale',nullif(x->>'country_hint',''),v_kw,v_refs,case when jsonb_typeof(x->'provider_status')='object'then x->'provider_status'else'{}'::jsonb end)
  on conflict(batch_id,event_ordinal)do nothing returning replay_event_id into v_event;
  if v_event is null then v_duplicates:=v_duplicates+1;else v_inserted:=v_inserted+1;end if;v_event:=null;
 end loop;
 return jsonb_build_object('version','v3750.0','inserted',v_inserted,'duplicates',v_duplicates,'outbox_rows_created',v_inserted,'raw_text_persisted',false,'publication_performed',false);
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3750_ingest_replay_matches(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3750_ingest_replay_matches(uuid,jsonb) to service_role;

create or replace function public.nexus_v3750_finish_replay(p_batch_id uuid,p_success boolean)
returns jsonb language plpgsql volatile security definer set search_path='public','pg_temp' as $function$
declare v_rows int;
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 update public.nexus_v3750_replay_batch set status=case when p_success then'completed'else'failed'end,completed_at=clock_timestamp()where batch_id=p_batch_id and status='open';
 if not found then raise exception 'v3750 replay finish unavailable';end if;
 select count(*)into v_rows from public.nexus_v3750_replay_event_ledger where batch_id=p_batch_id;
 return jsonb_build_object('version','v3750.0','batch_id',p_batch_id,'status',case when p_success then'completed'else'failed'end,'event_rows',v_rows);
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3750_finish_replay(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3750_finish_replay(uuid,boolean) to service_role;

create or replace function public.nexus_v3750_operator_status()
returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 return jsonb_build_object('version','v3750.0','observed_at',clock_timestamp(),'keyword_mappings',(select count(*)from public.nexus_v370_keyword_source),
 'providers',(select public.nexus_v3750_provider_snapshot()),'replay',jsonb_build_object('batches',(select count(*)from public.nexus_v3750_replay_batch),'events',(select count(*)from public.nexus_v3750_replay_event_ledger),'outbox',(select count(*)from public.nexus_v3750_replay_outbox),'x_transport_used',false,'third_party_cookie_used',false,'scraper_used',false,'human_emulation_used',false),
 'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command)from cron.job where jobid=60),
 'claims',jsonb_build_object('country_is_context_hint',true,'human_or_residential_proven',false,'sub_1ms_end_to_end_guaranteed',false,'sub_50ms_fallback_guaranteed',false,'commission_lossless_guaranteed',false,'continuous_24x7_proven',false,'go_js_modified',false,'compose_ts_modified',false));
exception when others then raise;
end
$function$;
revoke all on function public.nexus_v3750_operator_status() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3750_operator_status() to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
 ('v3750_whitehat_replay_core',true,jsonb_build_object('source_types',jsonb_build_array('synthetic_fixture','operator_export','owned_staging'),'x_transport_used',false,'third_party_cookie_used',false,'scraper_used',false),clock_timestamp()),
 ('v3750_openrouter_free_pool',false,jsonb_build_object('reason','awaiting authenticated runtime proof','allowlist',jsonb_build_array('google/gemma-4-26b-a4b-it:free','nvidia/nemotron-3.5-lightning:free'),'cost_zero_guaranteed',false),clock_timestamp()),
 ('v3750_cloudflare_context_route',false,jsonb_build_object('reason','aquitem live static artifact differs from repository; replacement deployment blocked fail-closed'),clock_timestamp()),
 ('v3750_direct_affiliate_fallback',false,jsonb_build_object('reason','no verified final merchant URL and no measured fallback behavior','sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp()),
 ('v3750_continuous_24x7',false,jsonb_build_object('reason','bounded Edge execution; no resident external worker required for replay staging'),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare b record;p "char";
begin
 select * into b from pg_temp.nexus_v3750_baseline;
 if b.ads_rows<>14301 or b.active_ads_rows<>12165 or b.keyword_rows<>17605 or b.shopee_rows<>1201 or b.matrix_rows<>27 then raise exception 'v3750 production baseline drift';end if;
 if (select count(*)from public.ads)<>b.ads_rows or(select count(*)from public.nexus_v370_keyword_source)<>b.keyword_rows then raise exception 'v3750 protected catalog changed';end if;
 if exists(select 1 from cron.job where active and schedule~*'second'and jobid<>60)then raise exception 'v3750 unexpected sub-minute polling job';end if;
 if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)and active)then raise exception 'v3750 legacy poller active';end if;
 if not exists(select 1 from cron.job where jobid=60 and jobname='v360-tg-flush-10s'and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v3750 Job 60 changed';end if;
 foreach p in array array[(select relpersistence from pg_class where oid='public.nexus_v3750_provider_policy'::regclass),(select relpersistence from pg_class where oid='public.nexus_v3750_replay_batch'::regclass),(select relpersistence from pg_class where oid='public.nexus_v3750_replay_event_ledger'::regclass),(select relpersistence from pg_class where oid='public.nexus_v3750_replay_outbox'::regclass)]loop if p<>'p'::"char"then raise exception 'v3750 object not LOGGED';end if;end loop;
 if has_table_privilege('anon','public.nexus_v3750_replay_event_ledger','select')or has_table_privilege('authenticated','public.nexus_v3750_replay_event_ledger','select')then raise exception 'v3750 ledger exposed';end if;
exception when others then raise;
end
$assert$;
commit;
