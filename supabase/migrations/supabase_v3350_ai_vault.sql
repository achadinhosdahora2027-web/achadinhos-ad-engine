-- Nexus v3350.0 — encrypted multi-provider AI pool vault.
-- The four plaintext API tokens MUST be supplied only through the transaction-
-- local setting nexus.v3350_ai_tokens_json. No token is versioned here.
--
-- This is an authenticated key-based pool, not a keyless service. "Keyless"
-- refers only to the absence of plaintext keys in source/Cloudflare artifacts.
-- The KMS never leaves PostgreSQL. Edge receives provider keys through encrypted
-- Supabase Edge secrets, not through a token-returning database RPC.
begin;
set local statement_timeout='2000ms';
set local lock_timeout='1000ms';
set local idle_in_transaction_session_timeout='10000ms';

create table if not exists public.nexus_v3350_ai_vault (
  provider_key          text primary key,
  provider_name         text not null,
  priority              smallint not null unique,
  api_base              text not null,
  model_id              text not null,
  token_enc             bytea not null,
  token_format          text not null,
  token_chars           integer not null,
  kms_key_name          text not null,
  encryption_profile    text not null,
  installed_by_release  text not null,
  created_at            timestamptz not null default clock_timestamp(),
  updated_at            timestamptz not null default clock_timestamp(),
  constraint nexus_v3350_provider_ck check(provider_key in('groq','openrouter','mistral','deepseek')),
  constraint nexus_v3350_priority_ck check(priority between 1 and 4),
  constraint nexus_v3350_https_ck check(api_base~'^https://'),
  constraint nexus_v3350_cipher_ck check(octet_length(token_enc)>32),
  constraint nexus_v3350_kms_ck check(kms_key_name='nexus_satellites_kms'),
  constraint nexus_v3350_profile_ck check(encryption_profile='OpenPGP AES-256'),
  constraint nexus_v3350_release_ck check(installed_by_release='v3350.0')
);

revoke all on table public.nexus_v3350_ai_vault
  from public,anon,authenticated,service_role;

-- Individual encryption. The setting and all plaintext variables are cleared in
-- both success and exception paths.
do $install$
declare
  v_payload jsonb;
  v_kms text;
  v_token text;
  r record;
begin
  begin
    v_payload:=nullif(current_setting('nexus.v3350_ai_tokens_json',true),'')::jsonb;
    if v_payload is null or jsonb_typeof(v_payload)<>'object'
       or not (v_payload?'groq' and v_payload?'openrouter' and v_payload?'mistral' and v_payload?'deepseek') then
      raise exception 'v3350 provider token payload is absent or incomplete';
    end if;
    select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms';
    if length(btrim(v_kms))<16 then raise exception 'nexus_satellites_kms absent or too short'; end if;

    for r in select * from (values
      ('groq','Groq Cloud',1,'https://api.groq.com/openai/v1','openai/gpt-oss-20b','groq_gsk'),
      ('openrouter','OpenRouter',2,'https://openrouter.ai/api/v1','openai/gpt-4o-mini','openrouter_v1'),
      ('mistral','Mistral AI',3,'https://api.mistral.ai/v1','mistral-small-latest','mistral_alnum'),
      ('deepseek','DeepSeek Core',4,'https://api.deepseek.com','deepseek-flash','deepseek_sk')
    )x(provider_key,provider_name,priority,api_base,model_id,token_format)
    loop
      v_token:=nullif(btrim(v_payload->>r.provider_key),'');
      if v_token is null then raise exception 'v3350 token absent for %',r.provider_key; end if;
      if (r.provider_key='groq' and v_token!~'^gsk_[A-Za-z0-9]{40,}$')
         or (r.provider_key='openrouter' and v_token!~'^sk-or-v1-[a-f0-9]{64}$')
         or (r.provider_key='mistral' and v_token!~'^[A-Za-z0-9]{24,64}$')
         or (r.provider_key='deepseek' and v_token!~'^sk-[a-f0-9]{32,64}$') then
        raise exception 'v3350 token format invalid for %',r.provider_key;
      end if;
      insert into public.nexus_v3350_ai_vault(
        provider_key,provider_name,priority,api_base,model_id,token_enc,
        token_format,token_chars,kms_key_name,encryption_profile,
        installed_by_release,updated_at
      ) values(
        r.provider_key,r.provider_name,r.priority,r.api_base,r.model_id,
        extensions.pgp_sym_encrypt(v_token,v_kms,'cipher-algo=aes256,compress-algo=1'),
        r.token_format,length(v_token),'nexus_satellites_kms','OpenPGP AES-256',
        'v3350.0',clock_timestamp()
      ) on conflict(provider_key) do update set
        provider_name=excluded.provider_name,priority=excluded.priority,
        api_base=excluded.api_base,model_id=excluded.model_id,
        token_enc=excluded.token_enc,token_format=excluded.token_format,
        token_chars=excluded.token_chars,kms_key_name=excluded.kms_key_name,
        encryption_profile=excluded.encryption_profile,
        installed_by_release=excluded.installed_by_release,
        updated_at=excluded.updated_at;
      v_token:=null;
    end loop;
    perform set_config('nexus.v3350_ai_tokens_json','',true);
    v_payload:=null;v_kms:=null;v_token:=null;
  exception when others then
    perform set_config('nexus.v3350_ai_tokens_json','',true);
    v_payload:=null;v_kms:=null;v_token:=null;
    raise;
  end;
end
$install$;

create or replace function public.nexus_v3350_ai_pool_status()
returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  v_kms text;
  v_token text;
  v_items jsonb:='[]'::jsonb;
  v_ok integer:=0;
  v_logged boolean:=false;
  v_format boolean;
  r record;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    select relpersistence='p' into v_logged from pg_class where oid='public.nexus_v3350_ai_vault'::regclass;
    select value into strict v_kms from public.nexus_growth_secrets where key='nexus_satellites_kms';
    for r in select provider_key,provider_name,priority,model_id,token_enc,token_chars from public.nexus_v3350_ai_vault order by priority loop
      begin
        v_token:=extensions.pgp_sym_decrypt(r.token_enc,v_kms);
        v_format:=case r.provider_key
          when 'groq' then v_token~'^gsk_[A-Za-z0-9]{40,}$'
          when 'openrouter' then v_token~'^sk-or-v1-[a-f0-9]{64}$'
          when 'mistral' then v_token~'^[A-Za-z0-9]{24,64}$'
          when 'deepseek' then v_token~'^sk-[a-f0-9]{32,64}$'
          else false end;
        if v_format and length(v_token)=r.token_chars then v_ok:=v_ok+1; end if;
        v_items:=v_items||jsonb_build_array(jsonb_build_object(
          'provider',r.provider_key,'name',r.provider_name,'priority',r.priority,
          'model',r.model_id,'ciphertext_octets',octet_length(r.token_enc),
          'decryptable',v_token is not null,'format_valid',v_format,
          'plaintext_returned',false));
        v_token:=null;
      exception when others then
        v_items:=v_items||jsonb_build_array(jsonb_build_object(
          'provider',r.provider_key,'name',r.provider_name,'priority',r.priority,
          'model',r.model_id,'ciphertext_octets',octet_length(r.token_enc),
          'decryptable',false,'format_valid',false,'plaintext_returned',false));
        v_token:=null;
      end;
    end loop;
    v_kms:=null;
    return jsonb_build_object(
      'version','v3350.0','observed_at',clock_timestamp(),
      'vault',jsonb_build_object('relation_logged',v_logged,'rows',(select count(*) from public.nexus_v3350_ai_vault),'providers_valid',v_ok,'plaintext_columns',0,'kms_key_name','nexus_satellites_kms','encryption_profile','OpenPGP AES-256'),
      'providers',v_items,
      'pool',jsonb_build_object(
        'priority',jsonb_build_array('groq','openrouter','mistral','deepseek'),
        'key_based',true,
        'keyless_service',false,
        'edge_failover_deployed',exists(
          select 1 from public.nexus_v3000_capability_registry
           where capability='v3350_ai_edge_deployment' and enabled
             and evidence->>'supabase_edge_deployed'='true'
        ),
        'external_exactly_once',false
      ),
      'preflight',jsonb_build_object(
        'groq',jsonb_build_object('models_http',200,'completion_http',200),
        'openrouter',jsonb_build_object('models_http',200,'completion_http',200),
        'mistral',jsonb_build_object('models_http',200,'completion_http',429),
        'deepseek',jsonb_build_object('models_http',200,'completion_http',402)),
      'catalogs',jsonb_build_object('ads_read_only_count',(select count(*) from public.ads),'active_ads_read_only_count',(select count(*) from public.ads where active),'canonical_keyword_count',(select count(*) from public.nexus_v370_keyword_source),'local_vector_count',(select count(*) from public.nexus_v380_keyword_vectors)),
      'cumulative',jsonb_build_object('travel_v3340_rows',(select count(*) from public.nexus_v3340_travel_lexicon),'shein_v3330_preserved',exists(select 1 from public.nexus_shein_campaign_vault where network_id=7),'amazon_v3320_preserved',exists(select 1 from public.nexus_amazon_campaign_vault where network_id=6 and region_code='BR'),'aliexpress_v3310_preserved',exists(select 1 from public.nexus_aliexpress_campaign_vault where network_id=5)),
      'telegram',jsonb_build_object('job_60_active',exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'),'master_outbox_persistence',(select case relpersistence when 'u' then 'UNLOGGED' else 'NOT_UNLOGGED' end from pg_class where oid='public.nexus_v420_channel_outbox'::regclass),'pacing_per_destination','3/min and 40/hour'),
      'protected_surfaces',jsonb_build_object('go_modified',false,'compose_modified',false,'cloudflare_pages_deployed',false,'placements_modified',false),
      'claims',jsonb_build_object('zero_ms_connection_release_guaranteed',false,'instant_failover_guaranteed',false,'high_frequency_throughput_proven',false,'human_or_residential_proven',false,'commission_lossless_guaranteed',false));
  exception when others then
    begin perform public.nexus_v420_sintonizado('v3350-ai-status',null,sqlstate||': '||left(sqlerrm,220)); exception when others then null; end;
    v_kms:=null;v_token:=null;
    return jsonb_build_object('version','v3350.0','state','Sintonizado em Análise','observed_at',clock_timestamp());
  end;
end
$function$;

revoke all on function public.nexus_v3350_ai_pool_status()
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v3350_ai_pool_status() to service_role;

update public.nexus_v3200_copy_policies
   set active=true,directives=directives||jsonb_build_object(
     'activation_profile','v3350.0','ai_pool_key_based',true,
     'ai_pool_priority',jsonb_build_array('groq','openrouter','mistral','deepseek'),
     'ai_output_is_preview_only',true,'deterministic_copy_remains_canonical',true,
     'provider_error_state','Sintonizado em Análise','cloudflare_pages_deployed',false,
     'compose_modified',false,'go_modified',false,'placements_modified',false,
     'cdn_country_is_human_proof',false,'instant_failover_guaranteed',false,
     'zero_ms_connection_release_guaranteed',false),checked_at=clock_timestamp()
 where policy_version='v3200.0';

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3350_ai_encrypted_vault',true,jsonb_build_object('providers',4,'relation_logged',true,'cipher','OpenPGP AES-256','kms_key_name','nexus_satellites_kms','plaintext_in_repository',false,'plaintext_columns',0),clock_timestamp()),
 ('v3350_ai_pool_preflight',true,jsonb_build_object('groq',jsonb_build_object('auth',true,'completion_http',200),'openrouter',jsonb_build_object('auth',true,'completion_http',200),'mistral',jsonb_build_object('auth',true,'completion_http',429),'deepseek',jsonb_build_object('auth',true,'completion_http',402),'pool_key_based',true,'keyless_service',false),clock_timestamp()),
 ('v3350_ai_edge_deployment',false,jsonb_build_object('supabase_edge_deployed',false,'cloudflare_pages_deployed',false,'compose_modified',false,'go_modified',false,'reason','pending physical postdeploy evidence; Cloudflare credential invalid'),clock_timestamp()),
 ('v3350_cj_token',false,jsonb_build_object('token_persisted',false,'token_tested',false,'reason','operator supplied token without a defined CJ operation; excluded from v3350 scope'),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare v_persistence "char";v_status jsonb;
begin
  if (select count(*) from public.nexus_v3350_ai_vault)<>4 then raise exception 'v3350 provider count failed'; end if;
  if (select array_agg(provider_key order by priority) from public.nexus_v3350_ai_vault)<>array['groq','openrouter','mistral','deepseek'] then raise exception 'v3350 provider priority failed'; end if;
  select relpersistence into v_persistence from pg_class where oid='public.nexus_v3350_ai_vault'::regclass;
  if v_persistence<>'p'::"char" then raise exception 'v3350 AI vault is not LOGGED'; end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='nexus_v3350_ai_vault' and column_name in('token','api_key','plaintext')) then raise exception 'v3350 plaintext column detected'; end if;
  if has_table_privilege('anon','public.nexus_v3350_ai_vault','select') or has_table_privilege('authenticated','public.nexus_v3350_ai_vault','select') or has_table_privilege('service_role','public.nexus_v3350_ai_vault','select') then raise exception 'v3350 vault table exposed'; end if;
  if has_function_privilege('anon','public.nexus_v3350_ai_pool_status()','execute') or has_function_privilege('authenticated','public.nexus_v3350_ai_pool_status()','execute') or not has_function_privilege('service_role','public.nexus_v3350_ai_pool_status()','execute') then raise exception 'v3350 status ACL failed'; end if;
  if (select count(*) from public.ads)<>14301 or (select count(*) from public.ads where active)<>12165 or (select count(*) from public.nexus_v370_keyword_source)<>17605 or (select count(*) from public.nexus_v380_keyword_vectors)<>11568 then raise exception 'v3350 read-only catalogs drifted'; end if;
  if (select count(*) from public.nexus_v3340_travel_lexicon)<>92 then raise exception 'v3340 cumulative travel matrix absent'; end if;
  if not exists(select 1 from cron.job where jobid=60 and active and jobname='v360-tg-flush-10s' and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'Job 60 drifted'; end if;
  if exists(select 1 from cron.job where jobid in(15,16,64) and active) then raise exception 'protected jobs reactivated'; end if;
  select relpersistence into v_persistence from pg_class where oid='public.nexus_v420_channel_outbox'::regclass;
  if v_persistence<>'u'::"char" then raise exception 'master outbox not UNLOGGED'; end if;
  if not exists(select 1 from public.nexus_v420_channel_routes where channel_key='grupo_cliques' and enabled and chat_id=-1004417007577 and source_relation='public.ads_clicks') or not exists(select 1 from public.nexus_v420_channel_routes where channel_key='atendimento' and enabled and chat_id=-1003951454560 and source_relation='public.nexus_v385_nostr_mentions') then raise exception 'channel separation drifted'; end if;
  v_status:=public.nexus_v3350_ai_pool_status();
  if (v_status#>>'{vault,providers_valid}')::integer<>4 or coalesce((v_status#>>'{vault,relation_logged}')::boolean,false) is not true then raise exception 'v3350 decryptability status failed'; end if;
end
$assert$;

commit;
