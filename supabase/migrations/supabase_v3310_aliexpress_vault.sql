-- Nexus v3310.0 — AliExpress campaign vault and trusted multi-country resolver.
-- Master: etbxbaaaspdcoiakifbb (PostgreSQL 17.6).
--
-- The operator referral URL MUST be supplied only in the deploy session through:
--   nexus.v3310_aliexpress_referral_url
-- Its value is intentionally absent from this versioned migration. Only OpenPGP
-- ciphertext is persisted. No active ad-catalog row is changed.
--
-- Deliberate nonclaims:
-- - CDN country is a routing hint, never proof of a human/residential visitor.
-- - No undocumented AliExpress tracking parameter or item/price is fabricated.
-- - No sub-1ms execution, sub-50ms fallback, lossless commission, CTR, or
--   conversion guarantee is created.
-- - api/ads/go.js, compose.ts, Adsterra/Monetag tags, and placements are untouched.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- Explicitly ordinary/LOGGED. network_id=5 is local to this new relation because
-- preflight found no existing network_id catalog/FK to reuse truthfully.
create table if not exists public.nexus_aliexpress_campaign_vault (
  network_id            smallint primary key,
  network_name          text not null,
  referral_url_enc      bytea not null,
  referral_host_hint    text not null,
  kms_key_name          text not null,
  encryption_profile    text not null,
  installed_by_release  text not null,
  created_at            timestamptz not null default clock_timestamp(),
  updated_at            timestamptz not null default clock_timestamp(),
  constraint nexus_aliexpress_network_id_ck check (network_id=5),
  constraint nexus_aliexpress_network_name_ck check (network_name='AliExpress Global'),
  constraint nexus_aliexpress_host_ck check (referral_host_hint='s.click.aliexpress.com'),
  constraint nexus_aliexpress_kms_ck check (kms_key_name='nexus_satellites_kms'),
  constraint nexus_aliexpress_profile_ck check (encryption_profile='OpenPGP AES-256'),
  constraint nexus_aliexpress_release_ck check (installed_by_release='v3310.0'),
  constraint nexus_aliexpress_ciphertext_ck check (octet_length(referral_url_enc)>32)
);

revoke all on table public.nexus_aliexpress_campaign_vault
  from public,anon,authenticated,service_role;

-- Deployment-only bootstrap. Plaintext exists only in transaction memory, is
-- validated before encryption, and is never copied to a text column or registry.
do $install$
declare
  v_referral text;
  v_kms text;
  v_cipher bytea;
begin
  begin
    v_referral:=nullif(btrim(current_setting(
      'nexus.v3310_aliexpress_referral_url',true)), '');
    if v_referral is null then
      raise exception 'v3310 referral URL was not supplied in the deploy session';
    end if;
    if v_referral!~'^https://s[.]click[.]aliexpress[.]com/e/_[A-Za-z0-9]{5,128}$' then
      raise exception 'v3310 referral URL failed the strict AliExpress host/path policy';
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
      raise exception 'pgp_sym_encrypt returned invalid ciphertext';
    end if;

    insert into public.nexus_aliexpress_campaign_vault(
      network_id,network_name,referral_url_enc,referral_host_hint,
      kms_key_name,encryption_profile,installed_by_release,updated_at
    ) values (
      5,'AliExpress Global',v_cipher,'s.click.aliexpress.com',
      'nexus_satellites_kms','OpenPGP AES-256','v3310.0',clock_timestamp()
    )
    on conflict(network_id) do update set
      network_name=excluded.network_name,
      referral_url_enc=excluded.referral_url_enc,
      referral_host_hint=excluded.referral_host_hint,
      kms_key_name=excluded.kms_key_name,
      encryption_profile=excluded.encryption_profile,
      installed_by_release=excluded.installed_by_release,
      updated_at=excluded.updated_at;

    -- Remove the transaction-local plaintext setting as soon as encryption and
    -- persistence have completed.
    perform set_config('nexus.v3310_aliexpress_referral_url','',true);
    v_referral:=null;
    v_kms:=null;
  exception when others then
    perform set_config('nexus.v3310_aliexpress_referral_url','',true);
    v_referral:=null;
    v_kms:=null;
    raise;
  end;
end
$install$;

-- Trusted resolver. A service caller receives the decrypted operator-supplied
-- campaign URL only for BR or the explicitly requested Tier-1 set. No network
-- substitution is made without product-level equivalence evidence.
create or replace function public.nexus_v3310_route_aliexpress(p_headers jsonb)
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
        'version','v3310.0','estado','Sintonizado em Análise',
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
        'version','v3310.0','estado','Sintonizado em Análise',
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
        'version','v3310.0','estado','Sintonizado em Análise',
        'motivo','country_outside_v3310_scope','country',v_country,
        'geo_source',v_source,'affiliate_url',null,
        'cdn_country_is_routing_hint',true,
        'human_or_residential_proven',false);
    end if;

    select s.value into strict v_kms
      from public.nexus_growth_secrets s
     where s.key='nexus_satellites_kms';
    select extensions.pgp_sym_decrypt(v.referral_url_enc,v_kms)
      into strict v_referral
      from public.nexus_aliexpress_campaign_vault v
     where v.network_id=5 and v.network_name='AliExpress Global';
    if v_referral!~'^https://s[.]click[.]aliexpress[.]com/e/_[A-Za-z0-9]{5,128}$' then
      raise exception 'decrypted AliExpress URL failed strict host/path validation';
    end if;

    return jsonb_build_object(
      'version','v3310.0','estado','ok','network_id',5,
      'network','AliExpress Global','country',v_country,
      'geo_source',v_source,'currency_context',v_currency,
      'affiliate_url',v_referral,
      'vault_decrypted_in_database',true,'plaintext_persisted',false,
      'tracking_identifiers_appended',false,
      'tracking_reason','no additional AliExpress parameter contract supplied',
      'price_adapted',false,
      'price_reason','no verified item price or FX quote supplied',
      'ebay_swap_applied',false,
      'ebay_swap_reason','no product-level AliExpress-to-eBay equivalence supplied',
      'cdn_country_is_routing_hint',true,
      'human_or_residential_proven',false,
      'sub_1ms_guaranteed',false,
      'direct_merchant_fallback_enabled',false,
      'fallback_latency_guaranteed',false,
      'commission_lossless_guaranteed',false);
  exception when others then
    begin
      perform public.nexus_v420_sintonizado(
        'v3310-aliexpress-route',coalesce(v_country,'unknown'),
        sqlstate||': '||left(sqlerrm,220));
    exception when others then null;
    end;
    return jsonb_build_object(
      'version','v3310.0','estado','Sintonizado em Análise',
      'motivo','vault_or_router_error','country',v_country,
      'affiliate_url',null,'human_or_residential_proven',false);
  end;
end
$function$;

revoke all on function public.nexus_v3310_route_aliexpress(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3310_route_aliexpress(jsonb)
  to service_role;

-- On-demand status never returns or hashes the plaintext URL. A successful
-- decrypt/strict-host check is reported only as booleans.
create or replace function public.nexus_v3310_operator_status()
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
      from pg_class c
     where c.oid='public.nexus_aliexpress_campaign_vault'::regclass;
    select octet_length(v.referral_url_enc) into v_cipher_octets
      from public.nexus_aliexpress_campaign_vault v where v.network_id=5;
    begin
      select s.value into strict v_kms from public.nexus_growth_secrets s
       where s.key='nexus_satellites_kms';
      select extensions.pgp_sym_decrypt(v.referral_url_enc,v_kms)
        into strict v_plain
        from public.nexus_aliexpress_campaign_vault v where v.network_id=5;
      v_decryptable:=v_plain is not null;
      v_host_valid:=v_plain~'^https://s[.]click[.]aliexpress[.]com/e/_[A-Za-z0-9]{5,128}$';
      v_plain:=null;
      v_kms:=null;
    exception when others then
      v_decryptable:=false;
      v_host_valid:=false;
      v_plain:=null;
      v_kms:=null;
    end;

    select jsonb_build_object(
      'version','v3310.0','observed_at',clock_timestamp(),
      'vault',jsonb_build_object(
        'network_id',5,'network','AliExpress Global','installed',exists(
          select 1 from public.nexus_aliexpress_campaign_vault where network_id=5),
        'relation_logged',v_logged,'ciphertext_octets',v_cipher_octets,
        'ciphertext_decryptable',v_decryptable,'strict_host_valid',v_host_valid,
        'plaintext_persisted',false,'kms_key_name','nexus_satellites_kms'),
      'catalogs',jsonb_build_object(
        'ads_read_only_count',(select count(*) from public.ads),
        'canonical_keyword_count',(select count(*) from public.nexus_v370_keyword_source),
        'local_vector_count',(select count(*) from public.nexus_v380_keyword_vectors)),
      'job_60',(select jsonb_build_object(
        'active',active,'schedule',schedule,'command',command)
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
        'database_resolver_ready',v_decryptable and v_host_valid,
        'country_scope',jsonb_build_array('BR','US','CA','GB','DE','FR'),
        'cf_ipcountry_precedence',true,'vercel_country_supported',true,
        'cdn_country_is_human_proof',false,
        'cloudflare_pages_deployed',false,'shortener_modified',false,
        'compose_modified',false,'price_adapted',false,
        'sub_1ms_guaranteed',false,'fallback_anti_404_deployed',false,
        'sub_50ms_fallback_guaranteed',false,
        'commission_lossless_guaranteed',false),
      'policy',jsonb_build_object(
        'copy_policy_version','v3200.0','activation_profile','v3310.0',
        'disclosure_own_line_before_link',true),
      'claims',jsonb_build_object(
        'human_traffic_proven',false,'ctr_guaranteed',false,
        'conversion_guaranteed',false,'active_buyer_traffic_proven',false)
    ) into v_result;
    return v_result;
  exception when others then
    begin
      perform public.nexus_v420_sintonizado(
        'v3310-operator-status',null,sqlstate||': '||left(sqlerrm,220));
    exception when others then null;
    end;
    return jsonb_build_object(
      'version','v3310.0','state','Sintonizado em Análise',
      'observed_at',clock_timestamp());
  end;
end
$function$;

revoke all on function public.nexus_v3310_operator_status()
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3310_operator_status() to service_role;

-- Keep the factual v3200 copy policy while advancing only its activation profile.
update public.nexus_v3200_copy_policies
   set active=true,
       directives=directives||jsonb_build_object(
         'activation_profile','v3310.0',
         'aliexpress_network_id',5,
         'aliexpress_item_price_adapted',false,
         'aliexpress_undocumented_tracking_parameters_added',false,
         'aliexpress_to_ebay_item_equivalence_proven',false,
         'cdn_country_is_human_proof',false,
         'fallback_anti_404_deployed',false,
         'sub_50ms_fallback_guaranteed',false,
         'commission_lossless_guaranteed',false
       ),checked_at=clock_timestamp()
 where policy_version='v3200.0';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3310_aliexpress_encrypted_vault',true,jsonb_build_object(
    'network_id',5,'network','AliExpress Global','relation_logged',true,
    'cipher','OpenPGP AES-256','kms_key_name','nexus_satellites_kms',
    'plaintext_in_repository',false,'plaintext_persisted',false),clock_timestamp()),
 ('v3310_aliexpress_database_router',true,jsonb_build_object(
    'scope',jsonb_build_array('BR','US','CA','GB','DE','FR'),
    'cdn_country_is_human_proof',false,'price_adapted',false,
    'undocumented_tracking_parameters_added',false,
    'ebay_item_equivalence_proven',false),clock_timestamp()),
 ('v3310_edge_deployment',false,jsonb_build_object(
    'cloudflare_pages_deployed',false,'supabase_edge_deployed',false,
    'shortener_modified',false,'compose_modified',false,
    'reason','pending physical deployment evidence'),clock_timestamp()),
 ('v3310_fallback_anti_404',false,jsonb_build_object(
    'reason','no verified Cloudflare project/KV binding or deployed fallback path',
    'sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp()),
 ('v3310_operator_status',true,jsonb_build_object(
    'mode','on_demand','polling_job_created',false,
    'service_role_only',true,'plaintext_url_returned',false),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

-- Atomic catalog, crypto, ACL, media, Job 60, and channel assertions.
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

  select c.relpersistence into v_persistence from pg_class c
   where c.oid='public.nexus_aliexpress_campaign_vault'::regclass;
  if v_persistence<>'p'::"char" then
    raise exception 'AliExpress campaign vault is not LOGGED';
  end if;
  if exists(select 1 from information_schema.columns
            where table_schema='public'
              and table_name='nexus_aliexpress_campaign_vault'
              and column_name='referral_url' and data_type<>'bytea') then
    raise exception 'plaintext referral_url column detected';
  end if;
  if (select count(*) from public.nexus_aliexpress_campaign_vault
       where network_id=5 and network_name='AliExpress Global'
         and octet_length(referral_url_enc)>32)<>1 then
    raise exception 'network_id=5 encrypted campaign row invariant failed';
  end if;

  select s.value into strict v_kms from public.nexus_growth_secrets s
   where s.key='nexus_satellites_kms';
  select extensions.pgp_sym_decrypt(v.referral_url_enc,v_kms)
    into strict v_plain from public.nexus_aliexpress_campaign_vault v
   where v.network_id=5;
  if v_plain!~'^https://s[.]click[.]aliexpress[.]com/e/_[A-Za-z0-9]{5,128}$' then
    raise exception 'AliExpress ciphertext decrypt/host invariant failed';
  end if;
  v_plain:=null;
  v_kms:=null;

  if has_table_privilege('anon','public.nexus_aliexpress_campaign_vault','SELECT')
     or has_table_privilege('authenticated','public.nexus_aliexpress_campaign_vault','SELECT')
     or has_table_privilege('service_role','public.nexus_aliexpress_campaign_vault','SELECT') then
    raise exception 'AliExpress vault table exposed to application roles';
  end if;
  if has_function_privilege('anon','public.nexus_v3310_route_aliexpress(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3310_route_aliexpress(jsonb)','EXECUTE')
     or not has_function_privilege('service_role','public.nexus_v3310_route_aliexpress(jsonb)','EXECUTE') then
    raise exception 'AliExpress resolver ACL invariant failed';
  end if;
  if has_function_privilege('anon','public.nexus_v3310_operator_status()','EXECUTE')
     or has_function_privilege('authenticated','public.nexus_v3310_operator_status()','EXECUTE')
     or not has_function_privilege('service_role','public.nexus_v3310_operator_status()','EXECUTE') then
    raise exception 'v3310 operator status ACL invariant failed';
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
                   and chat_id=-1004417007577
                   and source_relation='public.ads_clicks')
     or not exists(select 1 from public.nexus_v420_channel_routes
                 where channel_key='atendimento' and enabled
                   and chat_id=-1003951454560
                   and source_relation='public.nexus_v385_nostr_mentions') then
    raise exception 'CLIQUES/ATENDIMENTO channel separation drifted';
  end if;
  if not exists(select 1 from public.nexus_v3200_copy_policies
                 where policy_version='v3200.0' and active
                   and directives->>'activation_profile'='v3310.0'
                   and directives->>'disclosure_own_line_before_link'='true') then
    raise exception 'v3200 factual policy / v3310 profile pin failed';
  end if;
end
$assert$;

commit;
