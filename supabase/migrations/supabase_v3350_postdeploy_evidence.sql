-- Nexus v3340.0 + v3350.0 — sanitized physical postdeployment evidence.
-- Records only observed capabilities after successful PostgreSQL and Supabase
-- Edge checks. It contains no token, ciphertext, KMS material, JWT, internal
-- secret, affiliate/referral URL, provider response content, or runtime claim.
begin;
set local statement_timeout='2000ms';
set local lock_timeout='1000ms';
set local idle_in_transaction_session_timeout='10000ms';

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3340_edge_deployment',true,jsonb_build_object(
   'supabase_edge_deployed',true,
   'supabase_function','nexus-global-travel-v3340',
   'supabase_function_version',1,
   'supabase_function_status','ACTIVE',
   'supabase_verify_jwt',true,
   'copywriter_function','nexus-copywriter-v3200',
   'copywriter_version',12,
   'metadata_http',200,
   'controlled_us_http',200,
   'unverified_es_http',422,
   'missing_internal_secret_http',401,
   'missing_jwt_http',401,
   'embedding_model','gte-small',
   'embedding_dimensions',384,
   'lexicon_rows',92,
   'countries',jsonb_build_object('US',26,'CA',15,'ES',14,'FR',12,'IT',13,'GB',12),
   'affiliate_url_returned',false,
   'redirect_performed',false,
   'click_recorded',false,
   'human_or_residential_proven',false,
   'cloudflare_pages_deployed',false,
   'cloudflare_reason','no verified credential/project binding',
   'shortener_modified',false,
   'go_modified',false,
   'compose_modified',false,
   'protected_go_sha256','e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716',
   'protected_compose_sha256','d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0'
 ),clock_timestamp()),
 ('v3350_ai_edge_deployment',true,jsonb_build_object(
   'supabase_edge_deployed',true,
   'copywriter_function','nexus-copywriter-v3200',
   'copywriter_version',12,
   'copywriter_status','ACTIVE',
   'supabase_verify_jwt',true,
   'activation_profile','v3350.0',
   'key_based',true,
   'keyless_service',false,
   'priority',jsonb_build_array('groq','openrouter','mistral','deepseek'),
   'sequential_bounded_failover_implemented',true,
   'per_provider_timeout_ms',3500,
   'runtime_selected_provider','groq',
   'runtime_selected_provider_http',200,
   'runtime_failover_branch_exercised',false,
   'deterministic_copy_remains_canonical',true,
   'ai_preview_exact_generic_envelope_validated',true,
   'ai_preview_publication_claimed',false,
   'canonical_copy_http',200,
   'ai_preview_http',200,
   'missing_internal_secret_http',401,
   'missing_jwt_http',401,
   'instant_failover_guaranteed',false,
   'zero_ms_connection_release_guaranteed',false,
   'continuous_24x7_proven',false,
   'external_exactly_once',false,
   'cloudflare_pages_deployed',false
 ),clock_timestamp()),
 ('v3350_provider_observation',true,jsonb_build_object(
   'groq',jsonb_build_object('models_http',200,'completion_http',200,'completion_ready_at_preflight',true),
   'openrouter',jsonb_build_object('models_http',200,'completion_http',200,'completion_ready_at_preflight',true),
   'mistral',jsonb_build_object('models_http',200,'completion_http',429,'completion_ready_at_preflight',false),
   'deepseek',jsonb_build_object('models_http',200,'completion_http',402,'completion_ready_at_preflight',false),
   'all_provider_tokens_in_vault_decryptable',true,
   'all_provider_edge_secret_names_present',true,
   'plaintext_returned',false,
   'provider_response_content_recorded',false
 ),clock_timestamp()),
 ('v3350_truthful_claim_boundary',true,jsonb_build_object(
   'cj_token_persisted',false,
   'cj_integration_performed',false,
   'catalog_mutated',false,
   'affiliate_url_followed_by_automation',false,
   'programmatic_affiliate_click_performed',false,
   'price_or_discount_invented',false,
   'human_or_residential_proven',false,
   'city_or_timezone_inferred_from_country',false,
   'conversion_or_commission_claimed',false,
   'instant_or_zero_ms_claimed',false,
   'lossless_or_24x7_claimed',false,
   'fourteen_account_deployment_claimed',false,
   'master_projects_deployed',1,
   'cloudflare_pages_deployed',false
 ),clock_timestamp())
on conflict(capability) do update set
 enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

update public.nexus_v3200_copy_policies
   set active=true,
       directives=directives||jsonb_build_object(
         'activation_profile','v3350.0',
         'travel_edge_deployed',true,
         'ai_pool_edge_deployed',true,
         'ai_pool_key_based',true,
         'ai_pool_keyless_service',false,
         'ai_pool_priority',jsonb_build_array('groq','openrouter','mistral','deepseek'),
         'deterministic_copy_remains_canonical',true,
         'ai_preview_exact_generic_envelope_validated',true,
         'ai_preview_publication_claimed',false,
         'instant_failover_guaranteed',false,
         'continuous_24x7_proven',false,
         'cloudflare_pages_deployed',false
       ),
       checked_at=clock_timestamp()
 where policy_version='v3200.0';

do $assert$
declare
  v3340 jsonb;
  v3350 jsonb;
  v_master_persistence "char";
  v_satellite_persistence "char";
begin
  v3340:=public.nexus_v3340_operator_status();
  v3350:=public.nexus_v3350_ai_pool_status();
  if v3340->>'version'<>'v3340.0'
     or (v3340#>>'{lexicon,rows}')::integer<>92
     or (v3340#>>'{lexicon,all_vectors_valid}')::boolean is not true
     or (v3340#>>'{runtime,supabase_edge_deployed}')::boolean is not true
     or (v3340#>>'{runtime,cloudflare_pages_deployed}')::boolean is not false then
    raise exception 'v3340 physical readiness assertion failed';
  end if;
  if v3350->>'version'<>'v3350.0'
     or (v3350#>>'{vault,rows}')::integer<>4
     or (v3350#>>'{vault,providers_valid}')::integer<>4
     or (v3350#>>'{vault,relation_logged}')::boolean is not true
     or (v3350#>>'{vault,plaintext_columns}')::integer<>0
     or (v3350#>>'{pool,key_based}')::boolean is not true
     or (v3350#>>'{pool,keyless_service}')::boolean is not false
     or (v3350#>>'{pool,edge_failover_deployed}')::boolean is not true then
    raise exception 'v3350 physical readiness assertion failed';
  end if;
  if (v3350#>>'{catalogs,ads_read_only_count}')::integer<>14301
     or (v3350#>>'{catalogs,active_ads_read_only_count}')::integer<>12165
     or (v3350#>>'{catalogs,canonical_keyword_count}')::integer<>17605
     or (v3350#>>'{catalogs,local_vector_count}')::integer<>11568
     or (v3350#>>'{cumulative,travel_v3340_rows}')::integer<>92 then
    raise exception 'v3350 cumulative catalog assertion failed';
  end if;
  select relpersistence into v_master_persistence from pg_class
   where oid='public.nexus_v420_channel_outbox'::regclass;
  select relpersistence into v_satellite_persistence from pg_class
   where oid='public.nexus_v1550_outbox_logged'::regclass;
  if v_master_persistence<>'u'::"char" or v_satellite_persistence<>'p'::"char"
     or not exists(select 1 from cron.job where jobid=60 and active
       and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);')
     or exists(select 1 from cron.job where jobid in(15,16,64) and active) then
    raise exception 'v3350 outbox/job invariant failed';
  end if;
  if not exists(select 1 from public.nexus_v3000_capability_registry
       where capability='v3350_ai_edge_deployment' and enabled
         and evidence->>'runtime_selected_provider'='groq'
         and evidence->>'deterministic_copy_remains_canonical'='true'
         and evidence->>'instant_failover_guaranteed'='false')
     or not exists(select 1 from public.nexus_v3000_capability_registry
       where capability='v3350_truthful_claim_boundary' and enabled
         and evidence->>'cj_token_persisted'='false'
         and evidence->>'catalog_mutated'='false'
         and evidence->>'cloudflare_pages_deployed'='false') then
    raise exception 'v3350 truthful evidence assertion failed';
  end if;
end
$assert$;

insert into public.nexus_v3000_capability_registry(
  capability,enabled,evidence,checked_at
) values
 ('v3340_measured_operator_status',true,public.nexus_v3340_operator_status(),clock_timestamp()),
 ('v3350_measured_operator_status',true,public.nexus_v3350_ai_pool_status(),clock_timestamp())
on conflict(capability) do update set
 enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

commit;
