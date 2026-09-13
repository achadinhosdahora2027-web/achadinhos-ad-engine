-- Nexus v3330.0 — Shein Affiliates encrypted vault and bounded BR resolver.
-- Master: etbxbaaaspdcoiakifbb (PostgreSQL 17.6).
--
-- The operator OneLink MUST be supplied only in the deploy session through:
--   nexus.v3330_shein_referral_url
-- Its value is intentionally absent from this versioned migration. Only OpenPGP
-- ciphertext is persisted. public.ads and media placements remain read-only.
--
-- Boundaries:
-- - One operator-supplied OneLink does not prove Tier-1 regional resolution.
-- - No undocumented deep-link/tracking parameter or product price is fabricated.
-- - CDN country is a routing hint, never human/residential/purchase-intent proof.
-- - No high-frequency traffic, sub-1ms, sub-50ms fallback, lossless commission,
--   CTR, conversion, buyer, or cart guarantee is created.
-- - api/ads/go.js, compose.ts, Adsterra/Monetag tags, and placements are untouched.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

create table if not exists public.nexus_shein_campaign_vault (
  network_id            smallint primary key,
  network_name          text not null,
  referral_url_enc      bytea not null,
  referral_host_hint    text not null,
  provisioned_scope     text not null,
  kms_key_name          text not null,
  encryption_profile    text not null,
  installed_by_release  text not null,
  created_at            timestamptz not null default clock_timestamp(),
  updated_at            timestamptz not null default clock_timestamp(),
  constraint nexus_shein_network_id_ck check(network_id=7),
  constraint nexus_shein_name_ck check(network_name='Shein Affiliates'),
  constraint nexus_shein_host_ck check(referral_host_hint='onelink.shein.com'),
  constraint nexus_shein_scope_ck check(provisioned_scope='BR_ONLY_UNTIL_REGIONAL_VALIDATION'),
  constraint nexus_shein_kms_ck check(kms_key_name='nexus_satellites_kms'),
  constraint nexus_shein_profile_ck check(encryption_profile='OpenPGP AES-256'),
  constraint nexus_shein_release_ck check(installed_by_release='v3330.0'),
  constraint nexus_shein_ciphertext_ck check(octet_length(referral_url_enc)>32)
);

revoke all on table public.nexus_shein_campaign_vault
  from public,anon,authenticated,service_role;

-- Deploy-only bootstrap. The plaintext setting and PL/pgSQL variables are cleared
-- immediately after encryption; no plaintext column or capability evidence exists.
do $install$
declare
  v_referral text;
  v_kms text;
  v_cipher bytea;
begin
  begin
    v_referral:=nullif(btrim(current_setting(
      'nexus.v3330_shein_referral_url',true)), '');
    if v_referral is null then
      raise exception 'v3330 Shein referral URL was not supplied in the deploy session';
    end if;
    if v_referral!~'^https://onelink[.]shein[.]com/[0-9]{1,4}/[A-Za-z0-9]{5,128}$' then
      raise exception 'v3330 Shein OneLink failed strict host/path validation';
    end if;

    select s.value into strict v_kms
      from public.nexus_growth_secrets s
     where s.key='nexus_satellites_kms';
    if length(btrim(v_kms))<16 then
      raise exception 'nexus_satellites_kms is absent or too short';
    end if;

    v_cipher:=extensions.pgp_sym_encrypt(
      v_referral,v_kms,'cipher-algo=aes256,compress-algo=1');
    if v_cipher is null or octet_length(v_cipher)<=32 then
      raise exception 'pgp_sym_encrypt returned invalid Shein ciphertext';
    end if;

    insert into public.nexus_shein_campaign_vault(
      network_id,network_name,referral_url_enc,referral_host_hint,
      provisioned_scope,kms_key_name,encryption_profile,
      installed_by_release,updated_at
    ) values (
      7,'Shein Affiliates',v_cipher,'onelink.shein.com',
      'BR_ONLY_UNTIL_REGIONAL_VALIDATION','nexus_satellites_kms',
      'OpenPGP AES-256','v3330.0',clock_timestamp()
    )
    on conflict(network_id) do update set
      network_name=excluded.network_name,
      referral_url_enc=excluded.referral_url_enc,
      referral_host_hint=excluded.referral_host_hint,
      provisioned_scope=excluded.provisioned_scope,
      kms_key_name=excluded.kms_key_name,
      encryption_profile=excluded.encryption_profile,
      installed_by_release=excluded.installed_by_release,
      updated_at=excluded.updated_at;

    perform set_config('nexus.v3330_shein_referral_url','',true);
    v_referral:=null;
    v_kms:=null;
  exception when others then
    perform set_config('nexus.v3330_shein_referral_url','',true);
    v_referral:=null;
    v_kms:=null;
    raise;
  end;
end
$install$;

-- Service-role-only resolver. The supplied OneLink is returned only for BR.
-- Tier-1 is fail-closed until distinct regional evidence/links are supplied.
create or replace function public.nexus_v3330_route_shein(p_headers jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  v_country text;
  v_source text;
  v_currency text;
  v_kms text;
  v_referral text;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    if p_headers is null or jsonb_typeof(p_headers)<>'object' then
      return jsonb_build_object(
        'version','v3330.0','estado','Sintonizado em Análise',
        'motivo','headers_invalidos','affiliate_url',null,
        'human_or_residential_proven',false);
    end if;

    select upper(btrim(e.value)),lower(e.key)
      into v_country,v_source
      from jsonb_each_text(p_headers) e
     where lower(e.key) in('cf-ipcountry','x-vercel-ip-country')
       and btrim(e.value)<>''
     order by case lower(e.key) when 'cf-ipcountry' then 0 else 1 end,
              lower(e.key),e.key,e.value
     limit 1;

    if v_country is null or v_country!~'^[A-Z]{2}$' or v_country in('XX','T1') then
      return jsonb_build_object(
        'version','v3330.0','estado','Sintonizado em Análise',
        'motivo','cdn_country_unavailable','geo_source',coalesce(v_source,'none'),
        'affiliate_url',null,'cdn_country_is_routing_hint',true,
        'human_or_residential_proven',false);
    end if;

    v_currency:=case v_country
      when 'BR' then 'BRL'
      when 'US' then 'USD'
      when 'CA' then 'CAD'
      when 'GB' then 'GBP'
      when 'DE' then 'EUR'
      when 'FR' then 'EUR'
      else null end;
    if v_currency is null then
      return jsonb_build_object(
        'version','v3330.0','estado','Sintonizado em Análise',
        'motivo','country_outside_v3330_scope','country',v_country,
        'geo_source',v_source,'affiliate_url',null,
        'human_or_residential_proven',false);
    end if;
    if v_country<>'BR' then
      return jsonb_build_object(
        'version','v3330.0','estado','Sintonizado em Análise',
        'motivo','regional_link_unverified','country',v_country,
        'geo_source',v_source,'currency_context',v_currency,
        'affiliate_url',null,'regional_swap_applied',false,
        'regional_swap_reason','no distinct verified Shein regional link supplied',
        'human_or_residential_proven',false);
    end if;

    select s.value into strict v_kms
      from public.nexus_growth_secrets s
     where s.key='nexus_satellites_kms';
    select extensions.pgp_sym_decrypt(v.referral_url_enc,v_kms)
      into strict v_referral
      from public.nexus_shein_campaign_vault v
     where v.network_id=7 and v.network_name='Shein Affiliates';
    if v_referral!~'^https://onelink[.]shein[.]com/[0-9]{1,4}/[A-Za-z0-9]{5,128}$' then
      raise exception 'decrypted Shein OneLink failed strict validation';
    end if;

    return jsonb_build_object(
      'version','v3330.0','estado','ok','network_id',7,
      'network','Shein Affiliates','country',v_country,
      'geo_source',v_source,'currency_context','BRL',
      'affiliate_url',v_referral,
      'vault_decrypted_in_database',true,'plaintext_persisted',false,
      'tracking_identifiers_appended',false,
      'tracking_reason','no documented deep-link parameter contract supplied',
      'price_adapted',false,
      'price_reason','no verified product price or FX quote supplied',
      'cdn_country_is_routing_hint',true,
      'human_or_residential_proven',false,
      'high_frequency_traffic_proven',false,
      'sub_1ms_guaranteed',false,
      'direct_merchant_fallback_enabled',false,
      'fallback_latency_guaranteed',false,
      'commission_lossless_guaranteed',false);
  exception when others then
    begin
      perform public.nexus_v420_sintonizado(
        'v3330-shein-route',coalesce(v_country,'unknown'),
        sqlstate||': '||left(sqlerrm,220));
    exception when others then null;
    end;
    return jsonb_build_object(
      'version','v3330.0','estado','Sintonizado em Análise',
      'motivo','vault_or_router_error','country',v_country,
      'affiliate_url',null,'human_or_residential_proven',false);
  end;
end
$function$;

revoke all on function public.nexus_v3330_route_shein(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3330_route_shein(jsonb) to service_role;

-- On-demand integrity/status function. It never returns or hashes the plaintext URL.
create or replace function public.nexus_v3330_operator_status()
returns jsonb
language plpgsql
security definer
set search_path='public','cron','extensions','pg_temp'
as $function$
declare
  v_logged boolean:=false;
  v_decryptable boolean:=false;
  v_host_valid boolean:=false;
  v_cipher_octets integer:=0;
  v_kms text;
  v_plain text;
  v_result jsonb;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    select c.relpersistence='p' into v_logged
      from pg_class c where c.oid='public.nexus_shein_campaign_vault'::regclass;
    select octet_length(v.referral_url_enc) into v_cipher_octets
      from public.nexus_shein_campaign_vault v where v.network_id=7;
    begin
      select s.value into strict v_kms from public.nexus_growth_secrets s
       where s.key='nexus_satellites_kms';
      select extensions.pgp_sym_decrypt(v.referral_url_enc,v_kms)
        into strict v_plain from public.nexus_shein_campaign_vault v
       where v.network_id=7;
      v_decryptable:=v_plain is not null;
      v_host_valid:=v_plain~'^https://onelink[.]shein[.]com/[0-9]{1,4}/[A-Za-z0-9]{5,128}$';
      v_plain:=null;
      v_kms:=null;
    exception when others then
      v_decryptable:=false;
      v_host_valid:=false;
      v_plain:=null;
      v_kms:=null;
    end;

    select jsonb_build_object(
      'version','v3330.0','observed_at',clock_timestamp(),
      'vault',jsonb_build_object(
        'network_id',7,'network','Shein Affiliates',
        'installed',exists(select 1 from public.nexus_shein_campaign_vault where network_id=7),
        'provisioned_scope','BR_ONLY_UNTIL_REGIONAL_VALIDATION',
        'relation_logged',v_logged,'ciphertext_octets',v_cipher_octets,
        'ciphertext_decryptable',v_decryptable,'strict_host_valid',v_host_valid,
        'plaintext_persisted',false,'kms_key_name','nexus_satellites_kms'),
      'regional_readiness',jsonb_build_object(
        'BR',v_decryptable and v_host_valid,
        'US',false,'CA',false,'GB',false,'DE',false,'FR',false),
      'catalogs',jsonb_build_object(
        'ads_read_only_count',(select count(*) from public.ads),
        'active_ads_read_only_count',(select count(*) from public.ads where active),
        'database_shein_ads_count',(select count(*) from public.ads where advertiser ilike '%shein%'),
        'database_active_shein_ads_count',(select count(*) from public.ads where active and advertiser ilike '%shein%'),
        'canonical_keyword_count',(select count(*) from public.nexus_v370_keyword_source),
        'local_vector_count',(select count(*) from public.nexus_v380_keyword_vectors)),
      'cumulative',jsonb_build_object(
        'aliexpress_v3310_preserved',coalesce((public.nexus_v3310_operator_status()#>>'{vault,installed}')::boolean,false),
        'amazon_v3320_br_preserved',coalesce((public.nexus_v3320_operator_status()#>>'{regional_readiness,BR}')::boolean,false)),
      'job_60',(select jsonb_build_object('active',active,'schedule',schedule,'command',command)
        from cron.job where jobid=60),
      'telegram',jsonb_build_object(
        'outbox_persistence',(select case relpersistence when 'u' then 'UNLOGGED' else 'NOT_UNLOGGED' end
          from pg_class where oid='public.nexus_v420_channel_outbox'::regclass),
        'pacing_per_destination','3/min and 40/hour',
        'channels',(select jsonb_agg(jsonb_build_object(
          'channel_key',channel_key,'chat_id',chat_id,
          'source_relation',source_relation,'enabled',enabled) order by channel_key)
          from public.nexus_v420_channel_routes
         where channel_key in('grupo_cliques','atendimento'))),
      'routing',jsonb_build_object(
        'br_database_resolver_ready',v_decryptable and v_host_valid,
        'tier1_regional_links_ready',false,
        'cf_ipcountry_precedence',true,'vercel_country_supported',true,
        'cdn_country_is_human_proof',false,
        'cloudflare_pages_deployed',false,'shortener_modified',false,
        'compose_modified',false,'tracking_identifiers_appended',false,
        'price_adapted',false,'high_frequency_traffic_proven',false,
        'sub_1ms_guaranteed',false,'fallback_anti_404_deployed',false,
        'sub_50ms_fallback_guaranteed',false,
        'commission_lossless_guaranteed',false),
      'policy',jsonb_build_object(
        'copy_policy_version','v3200.0','activation_profile','v3330.0',
        'disclosure_own_line_before_link',true),
      'claims',jsonb_build_object(
        'human_traffic_proven',false,'ctr_guaranteed',false,
        'conversion_guaranteed',false,'active_buyer_traffic_proven',false,
        'cart_preservation_guaranteed',false)
    ) into v_result;
    return v_result;
  exception when others then
    begin
      perform public.nexus_v420_sintonizado(
        'v3330-operator-status',null,sqlstate||': '||left(sqlerrm,220));
    exception when others then null;
    end;
    return jsonb_build_object(
      'version','v3330.0','state','Sintonizado em Análise',
      'observed_at',clock_timestamp());
  end;
end
$function$;

revoke all on function public.nexus_v3330_operator_status()
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3330_operator_status() to service_role;

update public.nexus_v3200_copy_policies
   set active=true,
       directives=directives||jsonb_build_object(
         'activation_profile','v3330.0',
         'shein_network_id',7,
         'shein_br_onelink_ready',true,
         'shein_tier1_regional_links_ready',false,
         'shein_product_price_adapted',false,
         'shein_undocumented_tracking_parameters_added',false,
         'cdn_country_is_human_proof',false,
         'fallback_anti_404_deployed',false,
         'sub_50ms_fallback_guaranteed',false,
         'commission_lossless_guaranteed',false
       ),checked_at=clock_timestamp()
 where policy_version='v3200.0';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3330_shein_encrypted_vault',true,jsonb_build_object(
    'network_id',7,'network','Shein Affiliates','relation_logged',true,
    'provisioned_scope','BR_ONLY_UNTIL_REGIONAL_VALIDATION',
    'cipher','OpenPGP AES-256','kms_key_name','nexus_satellites_kms',
    'plaintext_in_repository',false,'plaintext_persisted',false),clock_timestamp()),
 ('v3330_shein_database_router',true,jsonb_build_object(
    'br_ready',true,'tier1_ready',false,
    'tier1_reason','no distinct verified Shein regional links supplied',
    'cdn_country_is_human_proof',false,'price_adapted',false,
    'tracking_identifiers_appended',false),clock_timestamp()),
 ('v3330_shein_inventory',false,jsonb_build_object(
    'database_shein_ads',0,'database_active_shein_ads',0,
    'repository_cj_feed_rows_observed_preflight',20,
    'catalog_mutated',false,
    'reason','active catalog required read-only; repository feed is not a database ingestion receipt'),clock_timestamp()),
 ('v3330_edge_deployment',false,jsonb_build_object(
    'cloudflare_pages_deployed',false,'supabase_edge_deployed',false,
    'shortener_modified',false,'compose_modified',false,
    'reason','pending physical postdeploy evidence'),clock_timestamp()),
 ('v3330_fallback_anti_404',false,jsonb_build_object(
    'reason','no verified Cloudflare project/KV binding or deployed fallback path',
    'sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp()),
 ('v3330_operator_status',true,jsonb_build_object(
    'mode','on_demand','polling_job_created',false,
    'service_role_only',true,'plaintext_url_returned',false),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

-- Atomic catalog, crypto, ACL, cumulative, Job 60, and room assertions.
do $assert$
declare
  v_persistence "char";
  v_kms text;
  v_plain text;
begin
  if (select count(*) from public.ads)<>14301
     or (select count(*) from public.ads where active)<>12165
     or (select count(*) from public.nexus_v370_keyword_source)<>17605
     or (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then
    raise exception 'read-only catalog cardinality drifted';
  end if;
  if (select count(*) from public.ads where advertiser ilike '%shein%')<>0 then
    raise exception 'unexpected Shein rows appeared in read-only ads catalog';
  end if;
  if not exists(select 1 from public.nexus_aliexpress_campaign_vault
                 where network_id=5 and network_name='AliExpress Global')
     or not exists(select 1 from public.nexus_amazon_campaign_vault
                 where network_id=6 and region_code='BR'
                   and network_name='Amazon Associates') then
    raise exception 'cumulative v3310/v3320 vault invariant drifted';
  end if;

  select c.relpersistence into v_persistence from pg_class c
   where c.oid='public.nexus_shein_campaign_vault'::regclass;
  if v_persistence<>'p'::"char" then
    raise exception 'Shein campaign vault is not LOGGED';
  end if;
  if exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='nexus_shein_campaign_vault'
              and column_name='referral_url' and data_type<>'bytea') then
    raise exception 'plaintext referral_url column detected';
  end if;
  if (select count(*) from public.nexus_shein_campaign_vault
       where network_id=7 and network_name='Shein Affiliates'
         and referral_host_hint='onelink.shein.com'
         and octet_length(referral_url_enc)>32)<>1 then
    raise exception 'network_id=7 encrypted campaign invariant failed';
  end if;

  select s.value into strict v_kms from public.nexus_growth_secrets s
   where s.key='nexus_satellites_kms';
  select extensions.pgp_sym_decrypt(v.referral_url_enc,v_kms)
    into strict v_plain from public.nexus_shein_campaign_vault v
   where v.network_id=7;
  if v_plain!~'^https://onelink[.]shein[.]com/[0-9]{1,4}/[A-Za-z0-9]{5,128}$' then
    raise exception 'Shein ciphertext decrypt/host invariant failed';
  end if;
  v_plain:=null;
  v_kms:=null;

  if has_table_privilege('anon','public.nexus_shein_campaign_vault','SELECT')
     or has_table_privilege('authenticated','public.nexus_shein_campaign_vault','SELECT')
     or has_table_privilege('service_role','public.nexus_shein_campaign_vault','SELECT') then
    raise exception 'Shein vault table exposed to application roles';
  end if;
  if has_function_privilege('anon','public.nexus_v3330_route_shein(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3330_route_shein(jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.nexus_v3330_route_shein(jsonb)','EXECUTE') then
    raise exception 'Shein resolver ACL invariant failed';
  end if;
  if has_function_privilege('anon','public.nexus_v3330_operator_status()','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3330_operator_status()','EXECUTE')
     or not has_function_privilege('service_role','public.nexus_v3330_operator_status()','EXECUTE') then
    raise exception 'v3330 operator status ACL invariant failed';
  end if;

  select c.relpersistence into v_persistence from pg_class c
   where c.oid='public.nexus_v420_channel_outbox'::regclass;
  if v_persistence<>'u'::"char" then
    raise exception 'active Telegram outbox is not UNLOGGED';
  end if;
  if not exists(select 1 from cron.job where jobid=60 and active
                 and jobname='v360-tg-flush-10s' and schedule='10 seconds'
                 and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'Job 60 identity, cadence, or command drifted';
  end if;
  if not exists(select 1 from public.nexus_v420_channel_routes
                 where channel_key='grupo_cliques' and enabled
                   and chat_id=-1004417007577 and source_relation='public.ads_clicks')
     or not exists(select 1 from public.nexus_v420_channel_routes
                 where channel_key='atendimento' and enabled
                   and chat_id=-1003951454560
                   and source_relation='public.nexus_v385_nostr_mentions') then
    raise exception 'CLIQUES/ATENDIMENTO channel separation drifted';
  end if;
  if not exists(select 1 from public.nexus_v3200_copy_policies
                 where policy_version='v3200.0' and active
                   and directives->>'activation_profile'='v3330.0'
                   and directives->>'disclosure_own_line_before_link'='true') then
    raise exception 'v3200 factual policy / v3330 profile pin failed';
  end if;
end
$assert$;

commit;
