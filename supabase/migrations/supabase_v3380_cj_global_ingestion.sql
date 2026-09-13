-- Nexus v3380.0 — encrypted global CJ backlog vault and fail-closed seal.
-- The backlog is evidence storage only. Country targeting is not city serviceability.
-- No public redirect, click, impression, conversion, availability, EPC, or sale claim is created.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
set local idle_in_transaction_session_timeout='15000ms';

create temporary table nexus_v3380_global_catalog_baseline on commit drop as
select (select count(*) from public.ads) ads_rows,
       (select count(*) from public.ads where active) active_ads_rows,
       (select count(*) from public.nexus_v370_keyword_source) keyword_rows,
       (select count(*) from public.nexus_v380_keyword_vectors) vector_rows;

create table if not exists public.nexus_v3380_cj_global_ingestion(
 ingestion_id text primary key,
 evidence_observed_at timestamptz not null,
 evidence_expires_at timestamptz not null,
 expected_rows integer not null,
 installed_rows integer not null default 0,
 evidence_sha256 text not null,
 sealed boolean not null default false,
 activation_scope text not null default 'encrypted_backlog_only',
 installed_by_release text not null default 'v3380.0',
 created_at timestamptz not null default clock_timestamp(),
 sealed_at timestamptz,
 constraint nexus_v3380_global_ingestion_id_ck check(ingestion_id~'^cj-audit-[a-f0-9]{24}$'),
 constraint nexus_v3380_global_ingestion_expiry_ck check(evidence_expires_at>evidence_observed_at),
 constraint nexus_v3380_global_ingestion_count_ck check(expected_rows>0 and installed_rows between 0 and expected_rows),
 constraint nexus_v3380_global_ingestion_sha_ck check(evidence_sha256~'^[a-f0-9]{64}$'),
 constraint nexus_v3380_global_ingestion_scope_ck check(activation_scope='encrypted_backlog_only'),
 constraint nexus_v3380_global_ingestion_release_ck check(installed_by_release='v3380.0'),
 constraint nexus_v3380_global_ingestion_seal_ck check((not sealed and sealed_at is null) or (sealed and sealed_at is not null and installed_rows=expected_rows))
);

create table if not exists public.nexus_v3380_cj_global_vault(
 ingestion_id text not null references public.nexus_v3380_cj_global_ingestion(ingestion_id) on delete cascade,
 evidence_key text not null,
 country_code text not null,
 category text not null,
 link_language text not null,
 link_type text not null,
 promotion_type text not null,
 promotion_start_at timestamptz,
 promotion_end_at timestamptz,
 mobile_optimized boolean not null,
 relationship_joined boolean not null,
 advertiser_active boolean not null,
 contract_active boolean not null,
 targeted_country_declared boolean not null,
 country_target_is_city_serviceability_proof boolean not null default false,
 tracking_host_sha256 text not null,
 destination_host_sha256 text,
 link_identity_enc bytea not null,
 tracking_url_enc bytea not null,
 destination_url_enc bytea,
 source_record_sha256 text not null,
 evidence_observed_at timestamptz not null,
 evidence_expires_at timestamptz not null,
 backlog_sealed boolean not null default false,
 route_approved boolean not null default false,
 routing_activated boolean not null default false,
 activation_reason text not null default 'backlog_quarantined_not_semantically_selected',
 installed_by_release text not null default 'v3380.0',
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(ingestion_id,evidence_key),
 constraint nexus_v3380_global_key_ck check(evidence_key~'^cj-global-[a-f0-9]{32}$'),
 constraint nexus_v3380_global_cc_ck check(country_code~'^[A-Z]{2}$'),
 constraint nexus_v3380_global_link_type_ck check(lower(link_type)='text link'),
 constraint nexus_v3380_global_relationship_ck check(relationship_joined and advertiser_active and contract_active),
 constraint nexus_v3380_global_country_truth_ck check(not country_target_is_city_serviceability_proof),
 constraint nexus_v3380_global_tracking_host_ck check(tracking_host_sha256~'^[a-f0-9]{64}$'),
 constraint nexus_v3380_global_destination_host_ck check(destination_host_sha256 is null or destination_host_sha256~'^[a-f0-9]{64}$'),
 constraint nexus_v3380_global_source_sha_ck check(source_record_sha256~'^[a-f0-9]{64}$'),
 constraint nexus_v3380_global_expiry_ck check(evidence_expires_at>evidence_observed_at),
 constraint nexus_v3380_global_route_ck check(not route_approved and not routing_activated and activation_reason='backlog_quarantined_not_semantically_selected'),
 constraint nexus_v3380_global_release_ck check(installed_by_release='v3380.0')
);
create index if not exists nexus_v3380_global_country_category_idx on public.nexus_v3380_cj_global_vault(country_code,category,evidence_expires_at);
create index if not exists nexus_v3380_global_ingestion_seal_idx on public.nexus_v3380_cj_global_vault(ingestion_id,backlog_sealed);

revoke all on table public.nexus_v3380_cj_global_ingestion from public,anon,authenticated,service_role;
revoke all on table public.nexus_v3380_cj_global_vault from public,anon,authenticated,service_role;

create or replace function public.nexus_v3380_hydrate_cj_global(
 p_ingestion_id text,
 p_evidence_observed_at timestamptz,
 p_expected_rows integer,
 p_evidence_sha256 text,
 p_payload jsonb
) returns integer
language plpgsql security definer set search_path='public','extensions','pg_temp'
as $function$
declare
 v_kms text;v_count integer:=0;v_tracking text;v_destination text;v_tracking_host text;v_destination_host text;
 r record;
begin
 if p_ingestion_id!~'^cj-audit-[a-f0-9]{24}$' or p_evidence_sha256!~'^[a-f0-9]{64}$'
    or p_expected_rows<=0 or p_evidence_observed_at<clock_timestamp()-interval '24 hours'
    or p_evidence_observed_at>clock_timestamp()+interval '5 minutes'
    or jsonb_typeof(p_payload)<>'array' or jsonb_array_length(p_payload) not between 1 and 250 then
  raise exception 'v3380 invalid global hydration envelope';
 end if;
 select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms';
 if length(btrim(v_kms))<16 then raise exception 'v3380 global KMS unavailable';end if;
 insert into public.nexus_v3380_cj_global_ingestion(
  ingestion_id,evidence_observed_at,evidence_expires_at,expected_rows,evidence_sha256
 ) values(p_ingestion_id,p_evidence_observed_at,p_evidence_observed_at+interval '24 hours',p_expected_rows,p_evidence_sha256)
 on conflict(ingestion_id) do nothing;
 if not exists(select 1 from public.nexus_v3380_cj_global_ingestion
  where ingestion_id=p_ingestion_id and evidence_observed_at=p_evidence_observed_at
  and expected_rows=p_expected_rows and evidence_sha256=p_evidence_sha256 and not sealed) then
  raise exception 'v3380 global ingestion envelope mismatch or already sealed';
 end if;
 for r in select * from jsonb_to_recordset(p_payload) as x(
  evidence_key text,country_code text,category text,link_language text,link_type text,promotion_type text,
  promotion_start_at timestamptz,promotion_end_at timestamptz,mobile_optimized boolean,
  relationship_joined boolean,advertiser_active boolean,contract_active boolean,targeted_countries text,
  advertiser_id text,advertiser_name text,link_id text,link_name text,description text,
  tracking_url text,destination_url text,source_record_sha256 text
 ) loop
  v_tracking:=nullif(btrim(r.tracking_url),'');v_destination:=nullif(btrim(r.destination_url),'');
  if r.evidence_key!~'^cj-global-[a-f0-9]{32}$' or r.country_code!~'^[A-Z]{2}$'
     or lower(coalesce(r.link_type,''))<>'text link' or not coalesce(r.relationship_joined,false)
     or not coalesce(r.advertiser_active,false) or not coalesce(r.contract_active,false)
     or r.source_record_sha256!~'^[a-f0-9]{64}$'
     or v_tracking is null or length(v_tracking)>4096
     or v_tracking!~'^https://www\.(anrdoezrs\.net|dpbolvw\.net|jdoqocy\.com|kqzyfj\.com|tkqlhce\.com)/click-[0-9]+-[0-9]+'
     or (v_destination is not null and length(v_destination)>4096) then
   raise exception 'v3380 global hydration row rejected';
  end if;
  v_tracking_host:=lower(substring(v_tracking from '^https://([^/:?#]+)'));
  v_destination_host:=case when v_destination~'^https://[^/?#[:space:]@]+' then lower(substring(v_destination from '^https://([^/:?#]+)')) else null end;
  insert into public.nexus_v3380_cj_global_vault(
   ingestion_id,evidence_key,country_code,category,link_language,link_type,promotion_type,
   promotion_start_at,promotion_end_at,mobile_optimized,relationship_joined,advertiser_active,contract_active,
   targeted_country_declared,country_target_is_city_serviceability_proof,tracking_host_sha256,destination_host_sha256,
   link_identity_enc,tracking_url_enc,destination_url_enc,source_record_sha256,evidence_observed_at,evidence_expires_at
  ) values(
   p_ingestion_id,r.evidence_key,r.country_code,coalesce(nullif(r.category,''),'unspecified'),coalesce(nullif(r.link_language,''),'unspecified'),
   r.link_type,coalesce(nullif(r.promotion_type,''),'N/A'),r.promotion_start_at,r.promotion_end_at,coalesce(r.mobile_optimized,false),true,true,true,
   r.country_code=any(regexp_split_to_array(upper(coalesce(r.targeted_countries,'')),'\s*,\s*')),false,
   encode(extensions.digest(v_tracking_host,'sha256'),'hex'),case when v_destination_host is null then null else encode(extensions.digest(v_destination_host,'sha256'),'hex') end,
   extensions.pgp_sym_encrypt(jsonb_build_object('advertiser_id',r.advertiser_id,'advertiser_name',r.advertiser_name,'link_id',r.link_id,'link_name',r.link_name,'description',r.description)::text,v_kms,'cipher-algo=aes256,compress-algo=1'),
   extensions.pgp_sym_encrypt(v_tracking,v_kms,'cipher-algo=aes256,compress-algo=1'),
   case when v_destination is null then null else extensions.pgp_sym_encrypt(v_destination,v_kms,'cipher-algo=aes256,compress-algo=1') end,
   r.source_record_sha256,p_evidence_observed_at,p_evidence_observed_at+interval '24 hours'
  ) on conflict(ingestion_id,evidence_key) do update set
   category=excluded.category,link_language=excluded.link_language,link_type=excluded.link_type,promotion_type=excluded.promotion_type,
   promotion_start_at=excluded.promotion_start_at,promotion_end_at=excluded.promotion_end_at,mobile_optimized=excluded.mobile_optimized,
   targeted_country_declared=excluded.targeted_country_declared,tracking_host_sha256=excluded.tracking_host_sha256,
   destination_host_sha256=excluded.destination_host_sha256,link_identity_enc=excluded.link_identity_enc,
   tracking_url_enc=excluded.tracking_url_enc,destination_url_enc=excluded.destination_url_enc,
   source_record_sha256=excluded.source_record_sha256,evidence_observed_at=excluded.evidence_observed_at,
   evidence_expires_at=excluded.evidence_expires_at,updated_at=clock_timestamp();
  v_count:=v_count+1;v_tracking:=null;v_destination:=null;v_tracking_host:=null;v_destination_host:=null;
 end loop;
 update public.nexus_v3380_cj_global_ingestion set installed_rows=(select count(*) from public.nexus_v3380_cj_global_vault where ingestion_id=p_ingestion_id)
 where ingestion_id=p_ingestion_id;
 v_kms:=null;p_payload:=null;
 return v_count;
exception when others then
 v_kms:=null;v_tracking:=null;v_destination:=null;p_payload:=null;raise;
end $function$;

create or replace function public.nexus_v3380_finalize_cj_global(p_ingestion_id text,p_expected_rows integer,p_evidence_sha256 text)
returns jsonb language plpgsql security definer set search_path='public','extensions','pg_temp'
as $function$
declare v_rows integer;v_countries integer;
begin
 select count(*),count(distinct country_code) into v_rows,v_countries from public.nexus_v3380_cj_global_vault where ingestion_id=p_ingestion_id;
 if v_rows<>p_expected_rows or exists(select 1 from public.nexus_v3380_cj_global_vault where ingestion_id=p_ingestion_id and (link_identity_enc is null or tracking_url_enc is null or route_approved or routing_activated or country_target_is_city_serviceability_proof)) then
  raise exception 'v3380 global seal validation failed';
 end if;
 update public.nexus_v3380_cj_global_ingestion set installed_rows=v_rows,sealed=true,sealed_at=clock_timestamp()
 where ingestion_id=p_ingestion_id and expected_rows=p_expected_rows and evidence_sha256=p_evidence_sha256 and not sealed;
 if not found then raise exception 'v3380 global seal envelope mismatch';end if;
 update public.nexus_v3380_cj_global_vault set backlog_sealed=true,updated_at=clock_timestamp() where ingestion_id=p_ingestion_id;
 insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3380_cj_global_encrypted_backlog',true,jsonb_build_object('ingestion_id',p_ingestion_id,'rows',v_rows,'countries_with_candidates',v_countries,'urls_plaintext',false,'route_activation',false,'country_target_is_city_serviceability_proof',false),clock_timestamp()),
 ('v3380_cj_global_bulk_routing',false,jsonb_build_object('reason','backlog is not semantic route approval','country_target_is_city_serviceability_proof',false),clock_timestamp())
 on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;
 return jsonb_build_object('version','v3380.0','sealed',true,'encrypted_backlog_rows',v_rows,'countries_with_candidates',v_countries,'bulk_routes_activated',0,'affiliate_url_returned',false,'clicks_performed',false,'impressions_created',false,'sales_claimed',false,'country_target_is_city_serviceability_proof',false);
exception when others then raise;
end $function$;

create or replace function public.nexus_v3380_cj_global_status()
returns jsonb language plpgsql stable security definer set search_path='public','extensions','pg_temp'
as $function$
declare v_selected integer:=0;
begin
 if to_regclass('public.nexus_v3380_cj_placement_policy') is not null then
  execute 'select count(*) from public.nexus_v3380_cj_placement_policy where route_enabled and affiliate_url_enc is not null and evidence_expires_at>clock_timestamp()' into v_selected;
 end if;
 return jsonb_build_object(
  'version','v3380.0',
  'sealed_ingestions',(select count(*) from public.nexus_v3380_cj_global_ingestion where sealed),
  'encrypted_backlog_rows',(select count(*) from public.nexus_v3380_cj_global_vault where backlog_sealed),
  'fresh_backlog_rows',(select count(*) from public.nexus_v3380_cj_global_vault where backlog_sealed and evidence_expires_at>clock_timestamp()),
  'countries_with_candidates',(select count(distinct country_code) from public.nexus_v3380_cj_global_vault where backlog_sealed),
  'bulk_routes_activated',(select count(*) from public.nexus_v3380_cj_global_vault where routing_activated),
  'selected_policy_routes',v_selected,
  'affiliate_url_returned',false,'country_target_is_city_serviceability_proof',false,
  'publication',jsonb_build_object('public_redirect_deployed',false,'geo_swap_deployed',false,'sub_1ms_guaranteed',false,'sub_50ms_fallback_guaranteed',false),
  'effects',jsonb_build_object('clicks_performed',false,'impressions_created',false,'sales_claimed',false)
 );
end $function$;

revoke all on function public.nexus_v3380_hydrate_cj_global(text,timestamptz,integer,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.nexus_v3380_finalize_cj_global(text,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.nexus_v3380_cj_global_status() from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3380_hydrate_cj_global(text,timestamptz,integer,text,jsonb) to service_role;
grant execute on function public.nexus_v3380_finalize_cj_global(text,integer,text) to service_role;
grant execute on function public.nexus_v3380_cj_global_status() to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3380_cj_global_schema',true,jsonb_build_object('logged',true,'encrypted_columns',3,'plaintext_identifiers',false),clock_timestamp()),
 ('v3380_cj_global_encrypted_backlog',false,jsonb_build_object('reason','awaiting protected hydration and seal'),clock_timestamp()),
 ('v3380_cj_global_bulk_routing',false,jsonb_build_object('reason','semantic country-locale-intent selection required'),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare b record;a record;persistence "char";
begin
 select * into b from nexus_v3380_global_catalog_baseline;
 select (select count(*) from public.ads) ads_rows,(select count(*) from public.ads where active) active_ads_rows,
        (select count(*) from public.nexus_v370_keyword_source) keyword_rows,(select count(*) from public.nexus_v380_keyword_vectors) vector_rows into a;
 if row(b.ads_rows,b.active_ads_rows,b.keyword_rows,b.vector_rows) is distinct from row(a.ads_rows,a.active_ads_rows,a.keyword_rows,a.vector_rows) then raise exception 'v3380 global protected catalogs changed';end if;
 if a.keyword_rows<>17605 then raise exception 'v3380 global canonical keyword count';end if;
 select relpersistence into persistence from pg_class where oid='public.nexus_v3380_cj_global_ingestion'::regclass;if persistence<>'p'::"char" then raise exception 'v3380 global ingestion not LOGGED';end if;
 select relpersistence into persistence from pg_class where oid='public.nexus_v3380_cj_global_vault'::regclass;if persistence<>'p'::"char" then raise exception 'v3380 global vault not LOGGED';end if;
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='nexus_v3380_cj_global_vault' and column_name in('tracking_url','destination_url','advertiser_id','advertiser_name','link_id','link_name','description','token','pid')) then raise exception 'v3380 global plaintext sensitive column';end if;
 if has_table_privilege('anon','public.nexus_v3380_cj_global_vault','select') or has_table_privilege('authenticated','public.nexus_v3380_cj_global_vault','select') or has_table_privilege('service_role','public.nexus_v3380_cj_global_vault','select') then raise exception 'v3380 global vault ACL';end if;
 if has_function_privilege('anon','public.nexus_v3380_cj_global_status()','execute') or not has_function_privilege('service_role','public.nexus_v3380_cj_global_status()','execute') then raise exception 'v3380 global status ACL';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds') or exists(select 1 from cron.job where jobid in(15,16,64) and active) then raise exception 'v3380 global protected jobs drift';end if;
end $assert$;
commit;
