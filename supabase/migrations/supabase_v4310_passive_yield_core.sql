-- Nexus v4310.0 — Sovereign Passive Yield Matrix (safe bounded core).
-- PostgreSQL 17.6. Additive, transactional, fail-closed.
-- No placement, Cloudflare Pages asset, affiliate click, publication, durable
-- WebSocket process, guaranteed latency, or guaranteed commission is created.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

create temp table pg_temp.nexus_v4310_baseline on commit drop as
select (select count(*)from public.ads)ads_rows,
       (select count(*)from public.ads where active)active_ads_rows,
       (select count(*)from public.nexus_v370_keyword_source)keyword_rows,
       (select count(*)from public.nexus_v380_keyword_vectors)vector_rows,
       (select count(*)from public.nexus_shopee_offers)shopee_rows;

-- Known legacy high-frequency pollers remain administratively locked inactive.
-- Job 60 is the explicit, pre-existing paced Telegram flush exception.
create table public.nexus_v4310_cron_lock(
  jobid bigint primary key,
  jobname text not null,
  schedule text not null,
  was_active boolean not null,
  locked_inactive boolean not null default true check(locked_inactive),
  technical_permanence_guaranteed boolean not null default false check(not technical_permanence_guaranteed),
  reason text not null,
  locked_at timestamptz not null default clock_timestamp()
);
insert into public.nexus_v4310_cron_lock(jobid,jobname,schedule,was_active,reason)
select jobid,jobname,schedule,active,'v4310 known legacy timed poller; event-trigger path retained instead'
from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65);
do $disable$ declare r record;begin
 for r in select jobid from public.nexus_v4310_cron_lock loop
  perform cron.alter_job(r.jobid,active=>false);
 end loop;
exception when others then raise;end $disable$;
revoke all on public.nexus_v4310_cron_lock from public,anon,authenticated,service_role;

-- Catalog observation is versioned separately from provider availability/cost.
create table public.nexus_v4310_model_catalog_lock(
  provider text not null,
  model_id text not null,
  catalog_present boolean not null,
  catalog_prompt_price_zero boolean not null,
  catalog_completion_price_zero boolean not null,
  enabled_in_broker boolean not null,
  cost_zero_guaranteed boolean not null default false check(not cost_zero_guaranteed),
  availability_guaranteed boolean not null default false check(not availability_guaranteed),
  observed_at timestamptz not null,
  primary key(provider,model_id),
  check(enabled_in_broker=(catalog_present and catalog_prompt_price_zero and catalog_completion_price_zero))
);
insert into public.nexus_v4310_model_catalog_lock values
('openrouter','meta-llama/llama-3-8b-instruct:free',false,false,false,false,false,false,clock_timestamp()),
('openrouter','google/gemma-2-9b-it:free',false,false,false,false,false,false,clock_timestamp()),
('openrouter','liquid/lfm-2.5-2.6b:free',true,true,true,true,false,false,clock_timestamp()),
('openrouter','google/gemma-4-26b-a4b-it:free',true,true,true,true,false,false,clock_timestamp()),
('openrouter','nvidia/nemotron-3.5-lightning:free',true,true,true,true,false,false,clock_timestamp());
revoke all on public.nexus_v4310_model_catalog_lock from public,anon,authenticated,service_role;

-- Tracking identifiers are compared only inside the database. The repository
-- stores SHA-256 fingerprints, never plaintext tracking URLs, KMS, or keys.
create table public.nexus_v4310_tracking_lock(
  network_key text primary key check(network_key in('amazon','aliexpress','shein','shopee','mercadolivre')),
  expected_identifier_sha256 text check(expected_identifier_sha256 is null or expected_identifier_sha256~'^[0-9a-f]{64}$'),
  credential_or_inventory_verified boolean not null,
  selector_mode text not null,
  protected_go_alignment_verified boolean not null default false,
  checked_at timestamptz not null default clock_timestamp()
);
do $tracking$
declare v_kms text;v_ok boolean;begin
 select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms';
 select encode(extensions.digest(extensions.pgp_sym_decrypt(tracking_id_enc,v_kms),'sha256'),'hex')=
   '5a395cf943ff236eabcc842bb5267a510b77e688e52b01708b2408efef14c972'
 into strict v_ok from public.nexus_amazon_campaign_vault where network_id=6 and region_code='BR';
 if not v_ok then raise exception 'v4310 Amazon tracking fingerprint mismatch';end if;
 insert into public.nexus_v4310_tracking_lock values('amazon','5a395cf943ff236eabcc842bb5267a510b77e688e52b01708b2408efef14c972',true,'service_role_v3320_resolver',false,clock_timestamp());

 select encode(extensions.digest(regexp_replace(extensions.pgp_sym_decrypt(referral_url_enc,v_kms),'^.*/',''),'sha256'),'hex')=
   'ba6717d990f42ff66eb3efcc6888beb2c3279b4f46d13122d9e2c299b90526eb'
 into strict v_ok from public.nexus_aliexpress_campaign_vault where network_id=5;
 if not v_ok then raise exception 'v4310 AliExpress tracking fingerprint mismatch';end if;
 insert into public.nexus_v4310_tracking_lock values('aliexpress','ba6717d990f42ff66eb3efcc6888beb2c3279b4f46d13122d9e2c299b90526eb',true,'service_role_v3310_resolver',false,clock_timestamp());

 select encode(extensions.digest(regexp_replace(extensions.pgp_sym_decrypt(referral_url_enc,v_kms),'^.*/',''),'sha256'),'hex')=
   '8b0a36d40a8bd77d34c551fabdca69a03fc0f96e5ca7b46c4b35b841526e04e8'
 into strict v_ok from public.nexus_shein_campaign_vault where network_id=7;
 if not v_ok then raise exception 'v4310 Shein tracking fingerprint mismatch';end if;
 insert into public.nexus_v4310_tracking_lock values('shein','8b0a36d40a8bd77d34c551fabdca69a03fc0f96e5ca7b46c4b35b841526e04e8',true,'service_role_v3330_resolver',false,clock_timestamp());

 select encode(extensions.digest((extensions.pgp_sym_decrypt(decode(value,'hex'),v_kms)::jsonb->>'matt_tool'),'sha256'),'hex')=
   'c4e9973dc831aefa53caf6d18ca6323e1cbfff75b5dd9eba7925739b7375742f'
 into strict v_ok from public.nexus_growth_secrets where key='meli_master_enc';
 if not v_ok then raise exception 'v4310 Mercado Livre tracking fingerprint mismatch';end if;
 insert into public.nexus_v4310_tracking_lock values('mercadolivre','c4e9973dc831aefa53caf6d18ca6323e1cbfff75b5dd9eba7925739b7375742f',true,'service_role_v360_resolver',false,clock_timestamp());

 select count(*)=1201 and bool_and(affiliate_host='s.shopee.com.br'and affiliate_url_enc is not null)
 into strict v_ok from public.nexus_shopee_offers;
 if not v_ok then raise exception 'v4310 Shopee encrypted inventory mismatch';end if;
 insert into public.nexus_v4310_tracking_lock values('shopee',null,true,'indexed_encrypted_offer_metadata',false,clock_timestamp());
 v_kms:=null;
exception when others then v_kms:=null;raise;end $tracking$;
revoke all on public.nexus_v4310_tracking_lock from public,anon,authenticated,service_role;

-- Service-role-only selector. Header access is O(1) JSON key lookup; network and
-- offer checks use primary keys. Country is a currency/context hint only.
create or replace function public.nexus_v4310_campaign_select(
 p_headers jsonb,p_network text default 'auto',p_product_url text default null,p_offer_key text default null
)returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
declare v_cf text;v_vercel text;v_country text;v_currency text;v_network text;v_route jsonb;v_url text;v_offer boolean;begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 if p_headers is null or jsonb_typeof(p_headers)<>'object' then return jsonb_build_object('version','v4310.0','estado','Sintonizado em Análise','motivo','headers_invalidos','affiliate_url',null);end if;
 v_cf:=upper(left(btrim(coalesce(p_headers->>'CF-IPCountry',p_headers->>'cf-ipcountry','')),2));
 v_vercel:=upper(left(btrim(coalesce(p_headers->>'x-vercel-ip-country',p_headers->>'X-Vercel-IP-Country','')),2));
 if v_cf<>''and v_vercel<>''and v_cf<>v_vercel then return jsonb_build_object('version','v4310.0','estado','Sintonizado em Análise','motivo','country_headers_conflict','affiliate_url',null);end if;
 v_country:=coalesce(nullif(v_cf,''),nullif(v_vercel,''));
 if v_country is null or v_country!~'^[A-Z]{2}$'or v_country in('XX','T1')then return jsonb_build_object('version','v4310.0','estado','Sintonizado em Análise','motivo','cdn_country_unavailable','affiliate_url',null);end if;
 v_currency:=case when v_country='BR'then'BRL'when v_country='US'then'USD'when v_country='GB'then'GBP'when v_country in('DE','FR')then'EUR'end;
 if v_currency is null then return jsonb_build_object('version','v4310.0','estado','Sintonizado em Análise','motivo','country_outside_verified_currency_scope','country',v_country,'affiliate_url',null);end if;
 v_network:=lower(btrim(coalesce(p_network,'auto')));if v_network='auto'then v_network:=case when v_country='BR'then'mercadolivre'else'aliexpress'end;end if;
 if v_network not in('amazon','aliexpress','shein','shopee','mercadolivre')then return jsonb_build_object('version','v4310.0','estado','Sintonizado em Análise','motivo','network_not_allowed','country',v_country,'affiliate_url',null);end if;
 if not exists(select 1 from public.nexus_v4310_tracking_lock where network_key=v_network and credential_or_inventory_verified)then raise exception 'v4310 tracking lock unavailable for %',v_network;end if;
 if v_network in('shein','shopee','mercadolivre')and v_country<>'BR'then return jsonb_build_object('version','v4310.0','estado','Sintonizado em Análise','motivo','network_country_scope_unverified','country',v_country,'network',v_network,'affiliate_url',null);end if;
 if v_network='amazon'then v_route:=public.nexus_v3320_route_amazon(p_headers,p_product_url);
 elsif v_network='aliexpress'then v_route:=public.nexus_v3310_route_aliexpress(p_headers);
 elsif v_network='shein'then v_route:=public.nexus_v3330_route_shein(p_headers);
 elsif v_network='mercadolivre'then v_route:=public.nexus_v360_geo_route(v_country,'oferta');
 else
  v_offer:=coalesce(p_offer_key~'^[0-9a-f]{64}$',false)and exists(select 1 from public.nexus_shopee_offers where offer_key=p_offer_key and affiliate_url_enc is not null);
  return jsonb_build_object('version','v4310.0','estado',case when v_offer then'ok'else'Sintonizado em Análise'end,'motivo',case when v_offer then'indexed_encrypted_offer_metadata_only'else'valid_offer_key_required'end,'network','shopee','country',v_country,'currency_context',v_currency,'offer_verified',v_offer,'affiliate_url',null,'resolution_surface','protected_go_js','protected_go_alignment_verified',false,'interstitial_path','/api/ads/go','binding_header_expected','pop=bound;sb=bound','cdn_country_is_context_hint',true,'human_or_residential_proven',false,'sub_1ms_guaranteed',false,'direct_redirect_performed',false);
 end if;
 if coalesce(v_route->>'estado','')<>'ok'then return jsonb_build_object('version','v4310.0','estado','Sintonizado em Análise','motivo',coalesce(v_route->>'motivo','upstream_selector_not_ready'),'network',v_network,'country',v_country,'currency_context',v_currency,'affiliate_url',null);end if;
 v_url:=coalesce(v_route->>'affiliate_url',v_route->>'destino');if v_url!~'^https://'then raise exception 'v4310 selector returned invalid route material';end if;
 return jsonb_build_object('version','v4310.0','estado','ok','network',v_network,'country',v_country,'currency_context',v_currency,'affiliate_url',v_url,'route_material_ephemeral',true,'interstitial_path','/api/ads/go','binding_header_expected','pop=bound;sb=bound','protected_go_alignment_verified',false,'cdn_country_is_context_hint',true,'country_proves_residence',false,'human_or_residential_proven',false,'sub_1ms_guaranteed',false,'direct_redirect_performed',false,'fallback_enabled',false,'commission_lossless_guaranteed',false);
exception when others then raise;end $function$;
revoke all on function public.nexus_v4310_campaign_select(jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.nexus_v4310_campaign_select(jsonb,text,text,text) to service_role;

-- Durable edge-signal ledger and outbox. Raw text and affiliate URLs are never
-- persisted. Both inserts and NOTIFY happen in the caller's atomic transaction.
create or replace function public.nexus_v4310_sha256_array_valid(p_values text[])
returns boolean language sql immutable strict set search_path='pg_catalog','pg_temp' as $function$
 select cardinality(p_values)between 1 and 25 and not exists(select 1 from unnest(p_values)x where x!~'^[0-9a-f]{64}$');
$function$;
revoke all on function public.nexus_v4310_sha256_array_valid(text[])from public,anon,authenticated,service_role;

create table public.nexus_v4310_edge_signal_ledger(
 signal_id uuid primary key default gen_random_uuid(),
 source_type text not null check(source_type in('synthetic_fixture','operator_export','owned_staging','public_bluesky_event','public_nostr_event')),
 source_event_sha256 text not null unique check(source_event_sha256~'^[0-9a-f]{64}$'),
 locale text not null check(locale~'^[a-z]{2}(-[A-Z]{2})?$'),
 country_hint text check(country_hint is null or country_hint~'^[A-Z]{2}$'),
 country_is_context_hint boolean not null default true check(country_is_context_hint),
 matched_keyword_hashes text[] not null check(cardinality(matched_keyword_hashes)between 1 and 25),
 matched_offer_refs text[] not null check(cardinality(matched_offer_refs)between 1 and 25),
 provider_states jsonb not null default'{}'::jsonb check(jsonb_typeof(provider_states)='object'),
 raw_text_persisted boolean not null default false check(not raw_text_persisted),
 affiliate_url_persisted boolean not null default false check(not affiliate_url_persisted),
 publication_performed boolean not null default false check(not publication_performed),
 click_recorded boolean not null default false check(not click_recorded),
 received_at timestamptz not null default clock_timestamp(),
 check(public.nexus_v4310_sha256_array_valid(matched_keyword_hashes)),
 check(public.nexus_v4310_sha256_array_valid(matched_offer_refs))
);
create index nexus_v4310_signal_received_idx on public.nexus_v4310_edge_signal_ledger(received_at desc,signal_id);
create table public.nexus_v4310_signal_outbox(
 outbox_id bigint generated always as identity primary key,
 signal_id uuid not null unique references public.nexus_v4310_edge_signal_ledger(signal_id)on delete restrict,
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 state text not null default'pending'check(state in('pending','leased','delivered','dead_letter')),
 attempts smallint not null default 0 check(attempts between 0 and 20),
 available_at timestamptz not null default clock_timestamp(),created_at timestamptz not null default clock_timestamp(),delivered_at timestamptz,
 check(not(payload?'raw_text')and not(payload?'affiliate_url')and not(payload?'click_url'))
);
create index nexus_v4310_signal_pending_idx on public.nexus_v4310_signal_outbox(state,available_at,outbox_id)where state='pending';
revoke all on public.nexus_v4310_edge_signal_ledger,public.nexus_v4310_signal_outbox from public,anon,authenticated,service_role;
revoke all on sequence public.nexus_v4310_signal_outbox_outbox_id_seq from public,anon,authenticated,service_role;

create or replace function public.nexus_v4310_signal_to_outbox()returns trigger language plpgsql security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 insert into public.nexus_v4310_signal_outbox(signal_id,payload)values(new.signal_id,jsonb_build_object('version','v4310.0','signal_id',new.signal_id,'source_type',new.source_type,'locale',new.locale,'country_hint',new.country_hint,'match_count',cardinality(new.matched_keyword_hashes),'estado','Sintonizado em Análise','raw_text_persisted',false,'publication_performed',false));return new;
exception when others then raise;end $function$;
create trigger trg_v4310_signal_to_outbox after insert on public.nexus_v4310_edge_signal_ledger for each row execute function public.nexus_v4310_signal_to_outbox();
create or replace function public.nexus_v4310_notify_outbox()returns trigger language plpgsql security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);perform pg_notify('nexus_v4310_signal',jsonb_build_object('outbox_id',new.outbox_id,'signal_id',new.signal_id)::text);return null;
exception when others then raise;end $function$;
create trigger trg_v4310_notify_outbox after insert on public.nexus_v4310_signal_outbox for each row execute function public.nexus_v4310_notify_outbox();

create or replace function public.nexus_v4310_ingest_signal(p_signal jsonb)returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
declare v_id uuid;v_inserted boolean;v_states jsonb;begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 if p_signal is null or jsonb_typeof(p_signal)<>'object'then raise exception 'v4310 signal must be object';end if;
 v_states:=jsonb_strip_nulls(jsonb_build_object('groq',left(p_signal#>>'{provider_states,groq}',32),'openrouter_liquid',left(p_signal#>>'{provider_states,openrouter_liquid}',32),'openrouter_gemma4',left(p_signal#>>'{provider_states,openrouter_gemma4}',32),'openrouter_nemotron',left(p_signal#>>'{provider_states,openrouter_nemotron}',32)));
 insert into public.nexus_v4310_edge_signal_ledger(source_type,source_event_sha256,locale,country_hint,matched_keyword_hashes,matched_offer_refs,provider_states)
 values(p_signal->>'source_type',p_signal->>'source_event_sha256',p_signal->>'locale',nullif(p_signal->>'country_hint',''),array(select jsonb_array_elements_text(p_signal->'matched_keyword_hashes')),array(select jsonb_array_elements_text(p_signal->'matched_offer_refs')),v_states)
 on conflict(source_event_sha256)do nothing returning signal_id into v_id;v_inserted:=found;
 if not v_inserted then select signal_id into strict v_id from public.nexus_v4310_edge_signal_ledger where source_event_sha256=p_signal->>'source_event_sha256';end if;
 return jsonb_build_object('ok',true,'signal_id',v_id,'inserted',v_inserted,'outbox_created',v_inserted,'raw_text_persisted',false,'publication_performed',false);
exception when others then raise;end $function$;
revoke all on function public.nexus_v4310_ingest_signal(jsonb)from public,anon,authenticated,service_role;
-- The batch wrapper is the only Edge grant: all matched signals commit or roll
-- back together. The scalar function remains callable only by its definer.
create or replace function public.nexus_v4310_ingest_signal_batch(p_signals jsonb)returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
declare x jsonb;r jsonb;v_inserted integer:=0;v_existing integer:=0;begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 if p_signals is null or jsonb_typeof(p_signals)<>'array'or jsonb_array_length(p_signals)not between 1 and 50 then raise exception 'v4310 bounded signal array required';end if;
 for x in select value from jsonb_array_elements(p_signals)loop
  r:=public.nexus_v4310_ingest_signal(x);if coalesce((r->>'inserted')::boolean,false)then v_inserted:=v_inserted+1;else v_existing:=v_existing+1;end if;
 end loop;
 return jsonb_build_object('ok',true,'inserted',v_inserted,'already_present',v_existing,'atomic_batch',true,'raw_text_persisted',false,'publication_performed',false);
exception when others then raise;end $function$;
revoke all on function public.nexus_v4310_ingest_signal_batch(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.nexus_v4310_ingest_signal_batch(jsonb)to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
('v4310_master_sql',true,jsonb_build_object('event_signal_ledger','LOGGED','outbox','LOGGED','polling_executor_installed',false),clock_timestamp()),
('v4310_campaign_selector',false,jsonb_build_object('reason','awaiting runtime benchmark and route proof','sub_1ms_guaranteed',false),clock_timestamp()),
('v4310_multi_llm_broker',false,jsonb_build_object('reason','awaiting Edge deployment and provider proof'),clock_timestamp()),
('v4310_bounded_signal_ingress',false,jsonb_build_object('reason','awaiting Edge deployment'),clock_timestamp()),
('v4310_permanent_websocket_runtime',false,jsonb_build_object('reason','Deno Edge request lifecycle is not a durable process supervisor','continuous_24x7_proven',false),clock_timestamp()),
('v4310_kv_404_fallback',false,jsonb_build_object('reason','KV binding and exact protected Pages artifact are not verified','sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$ declare b record;p "char";begin
 select*into b from pg_temp.nexus_v4310_baseline;
 if b.ads_rows<>14301 or b.active_ads_rows<>12165 or b.keyword_rows<>17605 or b.vector_rows<>11568 or b.shopee_rows<>1201 then raise exception 'v4310 protected baseline drift';end if;
 if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)and active)then raise exception 'v4310 legacy poller active';end if;
 if not exists(select 1 from cron.job where jobid=60 and jobname='v360-tg-flush-10s'and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v4310 Job 60 drift';end if;
 if(select pg_get_functiondef('public.nexus_v1510_flush_event(integer)'::regprocedure)not like'%v_minute>=3 or v_hour>=40%')then raise exception 'v4310 pacer drift';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v4310_edge_signal_ledger'::regclass;if p<>'p'::"char"then raise exception 'v4310 signal ledger not LOGGED';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v4310_signal_outbox'::regclass;if p<>'p'::"char"then raise exception 'v4310 signal outbox not LOGGED';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v420_channel_outbox'::regclass;if p<>'u'::"char"then raise exception 'v4310 Telegram outbox drift';end if;
 if(select count(*)from public.nexus_v4310_tracking_lock where credential_or_inventory_verified)<>5 then raise exception 'v4310 tracking lock incomplete';end if;
 if exists(select 1 from public.nexus_v4310_model_catalog_lock where model_id in('meta-llama/llama-3-8b-instruct:free','google/gemma-2-9b-it:free')and enabled_in_broker)then raise exception 'v4310 absent model enabled';end if;
 if has_function_privilege('anon','public.nexus_v4310_campaign_select(jsonb,text,text,text)','EXECUTE')or has_function_privilege('authenticated','public.nexus_v4310_ingest_signal(jsonb)','EXECUTE')or has_function_privilege('authenticated','public.nexus_v4310_ingest_signal_batch(jsonb)','EXECUTE')then raise exception 'v4310 internal RPC exposed';end if;
 if(select count(*)from public.ads)<>b.ads_rows or(select count(*)from public.nexus_v370_keyword_source)<>b.keyword_rows then raise exception 'v4310 protected catalog changed';end if;
exception when others then raise;end $assert$;
commit;
