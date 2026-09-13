-- Nexus v3320.0 — Amazon Associates encrypted regional vault and resolver.
-- Master: etbxbaaaspdcoiakifbb (PostgreSQL 17.6).
--
-- The operator Tracking ID MUST be supplied only in the deploy session through:
--   nexus.v3320_amazon_tracking_id
-- Its value is intentionally absent from this versioned migration. Only OpenPGP
-- ciphertext is persisted. public.ads and all existing media placements are read-only.
--
-- Boundaries:
-- - Only BR is provisioned because no US/CA/GB/DE/FR Amazon Tracking IDs were supplied.
-- - CDN country is a routing hint, not human/residential or purchase-intent proof.
-- - No unverified price conversion, product equivalence, eBay swap, sub-1ms,
--   sub-50ms fallback, lossless commission, CTR, or conversion claim is created.
-- - api/ads/go.js, compose.ts, Adsterra/Monetag tags, and placements are untouched.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- Ordinary tables are LOGGED by default. The composite key supports future
-- regional IDs without pretending the single BR ID is valid in other programs.
create table if not exists public.nexus_amazon_campaign_vault (
  network_id            smallint not null,
  region_code           text not null,
  network_name          text not null,
  marketplace_host      text not null,
  tracking_id_enc       bytea not null,
  kms_key_name          text not null,
  encryption_profile    text not null,
  installed_by_release  text not null,
  created_at            timestamptz not null default clock_timestamp(),
  updated_at            timestamptz not null default clock_timestamp(),
  primary key(network_id,region_code),
  constraint nexus_amazon_network_id_ck check(network_id=6),
  constraint nexus_amazon_region_ck check(region_code in('BR','US','CA','GB','DE','FR')),
  constraint nexus_amazon_name_ck check(network_name='Amazon Associates'),
  constraint nexus_amazon_marketplace_ck check(
    (region_code='BR' and marketplace_host='amazon.com.br') or
    (region_code='US' and marketplace_host='amazon.com') or
    (region_code='CA' and marketplace_host='amazon.ca') or
    (region_code='GB' and marketplace_host='amazon.co.uk') or
    (region_code='DE' and marketplace_host='amazon.de') or
    (region_code='FR' and marketplace_host='amazon.fr')
  ),
  constraint nexus_amazon_kms_ck check(kms_key_name='nexus_satellites_kms'),
  constraint nexus_amazon_profile_ck check(encryption_profile='OpenPGP AES-256'),
  constraint nexus_amazon_release_ck check(installed_by_release='v3320.0'),
  constraint nexus_amazon_ciphertext_ck check(octet_length(tracking_id_enc)>32)
);

revoke all on table public.nexus_amazon_campaign_vault
  from public,anon,authenticated,service_role;

-- Deploy-only bootstrap: plaintext exists only in the transaction-local setting
-- and PL/pgSQL memory. The setting is cleared immediately after encryption.
do $install$
declare
  v_tracking_id text;
  v_kms text;
  v_cipher bytea;
begin
  begin
    v_tracking_id:=nullif(btrim(current_setting(
      'nexus.v3320_amazon_tracking_id',true)), '');
    if v_tracking_id is null then
      raise exception 'v3320 Amazon Tracking ID was not supplied in the deploy session';
    end if;
    if v_tracking_id!~'^[a-z0-9][a-z0-9-]{1,48}-20$' then
      raise exception 'v3320 BR Tracking ID failed the strict format policy';
    end if;

    select s.value into strict v_kms
      from public.nexus_growth_secrets s
     where s.key='nexus_satellites_kms';
    if length(btrim(v_kms))<16 then
      raise exception 'nexus_satellites_kms is absent or too short';
    end if;

    v_cipher:=extensions.pgp_sym_encrypt(
      v_tracking_id,v_kms,'cipher-algo=aes256,compress-algo=1');
    if v_cipher is null or octet_length(v_cipher)<=32 then
      raise exception 'pgp_sym_encrypt returned invalid Amazon ciphertext';
    end if;

    insert into public.nexus_amazon_campaign_vault(
      network_id,region_code,network_name,marketplace_host,tracking_id_enc,
      kms_key_name,encryption_profile,installed_by_release,updated_at
    ) values (
      6,'BR','Amazon Associates','amazon.com.br',v_cipher,
      'nexus_satellites_kms','OpenPGP AES-256','v3320.0',clock_timestamp()
    )
    on conflict(network_id,region_code) do update set
      network_name=excluded.network_name,
      marketplace_host=excluded.marketplace_host,
      tracking_id_enc=excluded.tracking_id_enc,
      kms_key_name=excluded.kms_key_name,
      encryption_profile=excluded.encryption_profile,
      installed_by_release=excluded.installed_by_release,
      updated_at=excluded.updated_at;

    perform set_config('nexus.v3320_amazon_tracking_id','',true);
    v_tracking_id:=null;
    v_kms:=null;
  exception when others then
    perform set_config('nexus.v3320_amazon_tracking_id','',true);
    v_tracking_id:=null;
    v_kms:=null;
    raise;
  end;
end
$install$;

-- Internal resolver. It appends the documented tag parameter only after strict
-- country, regional-vault, and Amazon-host validation. It never follows the URL.
create or replace function public.nexus_v3320_route_amazon(
  p_headers jsonb,
  p_product_url text
) returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  v_country text;
  v_source text;
  v_currency text;
  v_expected_host text;
  v_vault_host text;
  v_kms text;
  v_tracking_id text;
  v_product_url text:=btrim(coalesce(p_product_url,''));
  v_affiliate_url text;
  v_host_regex text;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    if p_headers is null or jsonb_typeof(p_headers)<>'object' then
      return jsonb_build_object(
        'version','v3320.0','estado','Sintonizado em Análise',
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
        'version','v3320.0','estado','Sintonizado em Análise',
        'motivo','cdn_country_unavailable','geo_source',coalesce(v_source,'none'),
        'affiliate_url',null,'cdn_country_is_routing_hint',true,
        'human_or_residential_proven',false);
    end if;

    select x.currency,x.marketplace_host into v_currency,v_expected_host
      from (values
        ('BR','BRL','amazon.com.br'),
        ('US','USD','amazon.com'),
        ('CA','CAD','amazon.ca'),
        ('GB','GBP','amazon.co.uk'),
        ('DE','EUR','amazon.de'),
        ('FR','EUR','amazon.fr')
      ) x(country,currency,marketplace_host)
     where x.country=v_country;
    if v_expected_host is null then
      return jsonb_build_object(
        'version','v3320.0','estado','Sintonizado em Análise',
        'motivo','country_outside_v3320_scope','country',v_country,
        'geo_source',v_source,'affiliate_url',null,
        'human_or_residential_proven',false);
    end if;

    select v.marketplace_host into v_vault_host
      from public.nexus_amazon_campaign_vault v
     where v.network_id=6 and v.region_code=v_country;
    if v_vault_host is null then
      return jsonb_build_object(
        'version','v3320.0','estado','Sintonizado em Análise',
        'motivo','regional_tracking_id_unavailable','country',v_country,
        'currency_context',v_currency,'marketplace_host',v_expected_host,
        'affiliate_url',null,'ebay_swap_applied',false,
        'ebay_swap_reason','no product-level Amazon-to-eBay equivalence supplied',
        'human_or_residential_proven',false);
    end if;
    if v_vault_host<>v_expected_host then
      raise exception 'Amazon regional vault host mismatch';
    end if;
    if v_product_url='' then
      return jsonb_build_object(
        'version','v3320.0','estado','Sintonizado em Análise',
        'motivo','product_url_required','country',v_country,
        'affiliate_url',null,'human_or_residential_proven',false);
    end if;

    v_host_regex:='^https://(www[.])?'||
      replace(v_expected_host,'.','[.]')||'(/[^[:space:]#]*)?$';
    if v_product_url!~*v_host_regex then
      return jsonb_build_object(
        'version','v3320.0','estado','Sintonizado em Análise',
        'motivo','amazon_product_host_not_allowed','country',v_country,
        'expected_host',v_expected_host,'affiliate_url',null,
        'human_or_residential_proven',false);
    end if;
    if v_product_url~*'([?&])tag=' then
      return jsonb_build_object(
        'version','v3320.0','estado','Sintonizado em Análise',
        'motivo','product_url_already_tagged','country',v_country,
        'affiliate_url',null,'human_or_residential_proven',false);
    end if;

    select s.value into strict v_kms
      from public.nexus_growth_secrets s
     where s.key='nexus_satellites_kms';
    select extensions.pgp_sym_decrypt(v.tracking_id_enc,v_kms)
      into strict v_tracking_id
      from public.nexus_amazon_campaign_vault v
     where v.network_id=6 and v.region_code=v_country;
    if v_tracking_id!~'^[A-Za-z0-9][A-Za-z0-9-]{1,48}-[0-9]{2}$' then
      raise exception 'decrypted Amazon Tracking ID failed strict format validation';
    end if;

    v_affiliate_url:=v_product_url||
      case when strpos(v_product_url,'?')>0 then '&' else '?' end||
      'tag='||v_tracking_id;
    v_tracking_id:=null;
    v_kms:=null;

    return jsonb_build_object(
      'version','v3320.0','estado','ok','network_id',6,
      'network','Amazon Associates','country',v_country,
      'geo_source',v_source,'marketplace_host',v_expected_host,
      'currency_context',v_currency,'affiliate_url',v_affiliate_url,
      'tracking_tag_attached',true,'vault_decrypted_in_database',true,
      'plaintext_tracking_id_persisted',false,
      'price_adapted',false,
      'price_reason','no verified product price or FX quote supplied',
      'ebay_swap_applied',false,
      'ebay_swap_reason','no product-level Amazon-to-eBay equivalence supplied',
      'cdn_country_is_routing_hint',true,
      'human_or_residential_proven',false,
      'sub_1ms_guaranteed',false,
      'direct_merchant_fallback_enabled',false,
      'fallback_latency_guaranteed',false,
      'commission_lossless_guaranteed',false);
  exception when others then
    begin
      perform public.nexus_v420_sintonizado(
        'v3320-amazon-route',coalesce(v_country,'unknown'),
        sqlstate||': '||left(sqlerrm,220));
    exception when others then null;
    end;
    return jsonb_build_object(
      'version','v3320.0','estado','Sintonizado em Análise',
      'motivo','vault_or_router_error','country',v_country,
      'affiliate_url',null,'human_or_residential_proven',false);
  end;
end
$function$;

revoke all on function public.nexus_v3320_route_amazon(jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3320_route_amazon(jsonb,text)
  to service_role;

-- Status decrypts only for boolean integrity checks and never returns/hashes a tag.
create or replace function public.nexus_v3320_operator_status()
returns jsonb
language plpgsql
security definer
set search_path='public','cron','extensions','pg_temp'
as $function$
declare
  v_logged boolean:=false;
  v_decryptable boolean:=false;
  v_format_valid boolean:=false;
  v_cipher_octets integer:=0;
  v_kms text;
  v_plain text;
  v_result jsonb;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    select c.relpersistence='p' into v_logged
      from pg_class c where c.oid='public.nexus_amazon_campaign_vault'::regclass;
    select octet_length(v.tracking_id_enc) into v_cipher_octets
      from public.nexus_amazon_campaign_vault v
     where v.network_id=6 and v.region_code='BR';
    begin
      select s.value into strict v_kms from public.nexus_growth_secrets s
       where s.key='nexus_satellites_kms';
      select extensions.pgp_sym_decrypt(v.tracking_id_enc,v_kms)
        into strict v_plain from public.nexus_amazon_campaign_vault v
       where v.network_id=6 and v.region_code='BR';
      v_decryptable:=v_plain is not null;
      v_format_valid:=v_plain~'^[a-z0-9][a-z0-9-]{1,48}-20$';
      v_plain:=null;
      v_kms:=null;
    exception when others then
      v_decryptable:=false;
      v_format_valid:=false;
      v_plain:=null;
      v_kms:=null;
    end;

    select jsonb_build_object(
      'version','v3320.0','observed_at',clock_timestamp(),
      'vault',jsonb_build_object(
        'network_id',6,'network','Amazon Associates',
        'installed_regions',(select coalesce(jsonb_agg(region_code order by region_code),'[]'::jsonb)
          from public.nexus_amazon_campaign_vault where network_id=6),
        'relation_logged',v_logged,'br_ciphertext_octets',v_cipher_octets,
        'br_ciphertext_decryptable',v_decryptable,
        'br_tracking_id_format_valid',v_format_valid,
        'plaintext_tracking_id_persisted',false,
        'kms_key_name','nexus_satellites_kms'),
      'regional_readiness',jsonb_build_object(
        'BR',exists(select 1 from public.nexus_amazon_campaign_vault where network_id=6 and region_code='BR'),
        'US',exists(select 1 from public.nexus_amazon_campaign_vault where network_id=6 and region_code='US'),
        'CA',exists(select 1 from public.nexus_amazon_campaign_vault where network_id=6 and region_code='CA'),
        'GB',exists(select 1 from public.nexus_amazon_campaign_vault where network_id=6 and region_code='GB'),
        'DE',exists(select 1 from public.nexus_amazon_campaign_vault where network_id=6 and region_code='DE'),
        'FR',exists(select 1 from public.nexus_amazon_campaign_vault where network_id=6 and region_code='FR')),
      'catalogs',jsonb_build_object(
        'ads_read_only_count',(select count(*) from public.ads),
        'canonical_keyword_count',(select count(*) from public.nexus_v370_keyword_source),
        'local_vector_count',(select count(*) from public.nexus_v380_keyword_vectors)),
      'cumulative',jsonb_build_object(
        'aliexpress_v3310_preserved',coalesce((public.nexus_v3310_operator_status()#>>'{vault,installed}')::boolean,false)),
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
        'br_database_resolver_ready',v_decryptable and v_format_valid,
        'tier1_tracking_ids_ready',false,
        'cf_ipcountry_precedence',true,'vercel_country_supported',true,
        'cdn_country_is_human_proof',false,
        'cloudflare_pages_deployed',false,'shortener_modified',false,
        'compose_modified',false,'price_adapted',false,
        'sub_1ms_guaranteed',false,'fallback_anti_404_deployed',false,
        'sub_50ms_fallback_guaranteed',false,
        'commission_lossless_guaranteed',false),
      'policy',jsonb_build_object(
        'copy_policy_version','v3200.0','activation_profile','v3320.0',
        'disclosure_own_line_before_link',true),
      'claims',jsonb_build_object(
        'human_traffic_proven',false,'ctr_guaranteed',false,
        'conversion_guaranteed',false,'active_buyer_traffic_proven',false,
        'vector_latency_2_87ms_independently_verified',false)
    ) into v_result;
    return v_result;
  exception when others then
    begin
      perform public.nexus_v420_sintonizado(
        'v3320-operator-status',null,sqlstate||': '||left(sqlerrm,220));
    exception when others then null;
    end;
    return jsonb_build_object(
      'version','v3320.0','state','Sintonizado em Análise',
      'observed_at',clock_timestamp());
  end;
end
$function$;

revoke all on function public.nexus_v3320_operator_status()
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3320_operator_status() to service_role;

-- Preserve factual policy v3200 while advancing only the cumulative profile.
update public.nexus_v3200_copy_policies
   set active=true,
       directives=directives||jsonb_build_object(
         'activation_profile','v3320.0',
         'amazon_network_id',6,
         'amazon_br_tracking_id_ready',true,
         'amazon_tier1_tracking_ids_ready',false,
         'amazon_product_price_adapted',false,
         'amazon_to_ebay_item_equivalence_proven',false,
         'cdn_country_is_human_proof',false,
         'fallback_anti_404_deployed',false,
         'sub_50ms_fallback_guaranteed',false,
         'commission_lossless_guaranteed',false
       ),checked_at=clock_timestamp()
 where policy_version='v3200.0';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3320_amazon_encrypted_vault',true,jsonb_build_object(
    'network_id',6,'network','Amazon Associates','relation_logged',true,
    'installed_regions',jsonb_build_array('BR'),
    'cipher','OpenPGP AES-256','kms_key_name','nexus_satellites_kms',
    'plaintext_in_repository',false,'plaintext_persisted',false),clock_timestamp()),
 ('v3320_amazon_database_router',true,jsonb_build_object(
    'br_ready',true,'tier1_ready',false,
    'tier1_reason','no regional Amazon Tracking IDs supplied',
    'cdn_country_is_human_proof',false,'price_adapted',false,
    'ebay_item_equivalence_proven',false),clock_timestamp()),
 ('v3320_edge_deployment',false,jsonb_build_object(
    'cloudflare_pages_deployed',false,'supabase_edge_deployed',false,
    'shortener_modified',false,'compose_modified',false,
    'reason','pending physical postdeploy evidence'),clock_timestamp()),
 ('v3320_fallback_anti_404',false,jsonb_build_object(
    'reason','no verified Cloudflare project/KV binding or deployed fallback path',
    'sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp()),
 ('v3320_operator_status',true,jsonb_build_object(
    'mode','on_demand','polling_job_created',false,
    'service_role_only',true,'plaintext_tracking_id_returned',false),clock_timestamp())
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
     or (select count(*) from public.nexus_v370_keyword_source)<>17605
     or (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then
    raise exception 'read-only catalog cardinality drifted';
  end if;
  if not exists(select 1 from public.nexus_aliexpress_campaign_vault
                 where network_id=5 and network_name='AliExpress Global') then
    raise exception 'cumulative AliExpress v3310 vault drifted';
  end if;

  select c.relpersistence into v_persistence from pg_class c
   where c.oid='public.nexus_amazon_campaign_vault'::regclass;
  if v_persistence<>'p'::"char" then
    raise exception 'Amazon campaign vault is not LOGGED';
  end if;
  if exists(select 1 from information_schema.columns
            where table_schema='public' and table_name='nexus_amazon_campaign_vault'
              and column_name='tracking_id' and data_type<>'bytea') then
    raise exception 'plaintext tracking_id column detected';
  end if;
  if (select count(*) from public.nexus_amazon_campaign_vault
       where network_id=6 and region_code='BR'
         and network_name='Amazon Associates'
         and marketplace_host='amazon.com.br'
         and octet_length(tracking_id_enc)>32)<>1 then
    raise exception 'network_id=6 BR encrypted campaign invariant failed';
  end if;
  if exists(select 1 from public.nexus_amazon_campaign_vault
            where network_id=6 and region_code<>'BR') then
    raise exception 'unprovided Amazon regional Tracking ID detected';
  end if;

  select s.value into strict v_kms from public.nexus_growth_secrets s
   where s.key='nexus_satellites_kms';
  select extensions.pgp_sym_decrypt(v.tracking_id_enc,v_kms)
    into strict v_plain from public.nexus_amazon_campaign_vault v
   where v.network_id=6 and v.region_code='BR';
  if v_plain!~'^[a-z0-9][a-z0-9-]{1,48}-20$' then
    raise exception 'Amazon ciphertext decrypt/format invariant failed';
  end if;
  v_plain:=null;
  v_kms:=null;

  if has_table_privilege('anon','public.nexus_amazon_campaign_vault','SELECT')
     or has_table_privilege('authenticated','public.nexus_amazon_campaign_vault','SELECT')
     or has_table_privilege('service_role','public.nexus_amazon_campaign_vault','SELECT') then
    raise exception 'Amazon vault table exposed to application roles';
  end if;
  if has_function_privilege('anon','public.nexus_v3320_route_amazon(jsonb,text)','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3320_route_amazon(jsonb,text)','EXECUTE')
     or not has_function_privilege('service_role','public.nexus_v3320_route_amazon(jsonb,text)','EXECUTE') then
    raise exception 'Amazon resolver ACL invariant failed';
  end if;
  if has_function_privilege('anon','public.nexus_v3320_operator_status()','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3320_operator_status()','EXECUTE')
     or not has_function_privilege('service_role','public.nexus_v3320_operator_status()','EXECUTE') then
    raise exception 'v3320 operator status ACL invariant failed';
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
                   and directives->>'activation_profile'='v3320.0'
                   and directives->>'disclosure_own_line_before_link'='true') then
    raise exception 'v3200 factual policy / v3320 profile pin failed';
  end if;
end
$assert$;

commit;
