-- Nexus v3750.0 — post-deploy truthful capability reconciliation.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
 ('v3750_whitehat_replay_core',true,jsonb_build_object('projects_deployed',14,'status_verified',14,'custom_secret_verified',14,'keyword_mappings',17605,'bounded_dry_run_proven',true,'x_transport_used',false,'third_party_cookie_used',false,'scraper_used',false),clock_timestamp()),
 ('v3750_aho_keyword_matcher',true,jsonb_build_object('patterns',17605,'synthetic_match_observed',true,'edge_build_ms',290.512,'end_to_end_sub_1ms_guaranteed',false),clock_timestamp()),
 ('v3750_groq_copilot',true,jsonb_build_object('synthetic_scopes_verified',2,'model','openai/gpt-oss-20b','publication_performed',false,'cost_zero_guaranteed',false),clock_timestamp()),
 ('v3750_openrouter_free_pool',false,jsonb_build_object('models',jsonb_build_array('google/gemma-4-26b-a4b-it:free','nvidia/nemotron-3.5-lightning:free'),'catalog_price_zero_verified',true,'runtime_results',jsonb_build_array('HTTP 429','timeout'),'http_402_observed',false,'cost_zero_guaranteed',false,'availability_guaranteed',false),clock_timestamp()),
 ('v3750_ai_pool_partial',true,jsonb_build_object('fanout','Promise.allSettled','groq',true,'openrouter_successful',false,'fail_closed',true),clock_timestamp()),
 ('v3750_atomic_replay_outbox',true,jsonb_build_object('transactional_proof',true,'transaction_rolled_back',true,'channel_key','atendimento','external_exactly_once_claimed',false),clock_timestamp()),
 ('v3750_cloudflare_context_route',false,jsonb_build_object('credential_valid',true,'aquitem_present',true,'local_files',39,'exact_matches',8,'mismatches',31,'reason','direct upload blocked to avoid replacing protected live artifact','patch_versioned',true),clock_timestamp()),
 ('v3750_direct_affiliate_fallback',false,jsonb_build_object('reason','no verified final merchant URL and no measured fallback behavior','sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp()),
 ('v3750_continuous_24x7',false,jsonb_build_object('reason','bounded replay adapters; no resident worker required or deployed'),clock_timestamp()),
 ('v3750_job60_preserved',true,jsonb_build_object('jobid',60,'schedule','10 seconds','max_messages_per_minute',3,'channel_separation_preserved',true),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;
do $assert$ declare p "char";begin
 if(select count(*)from public.nexus_v3750_provider_policy)<>3 or(select count(*)from public.nexus_v3750_provider_policy where provider='openrouter'and catalog_price_zero_verified)<>2 then raise exception 'v3750 provider policy drift';end if;
 if(select count(*)from public.nexus_v3750_replay_batch)<>0 or(select count(*)from public.nexus_v3750_replay_event_ledger)<>0 or(select count(*)from public.nexus_v3750_replay_outbox)<>0 then raise exception 'v3750 unexpected persisted replay';end if;
 foreach p in array array[(select relpersistence from pg_class where oid='public.nexus_v3750_replay_batch'::regclass),(select relpersistence from pg_class where oid='public.nexus_v3750_replay_event_ledger'::regclass),(select relpersistence from pg_class where oid='public.nexus_v3750_replay_outbox'::regclass)]loop if p<>'p'::"char"then raise exception 'v3750 object not LOGGED';end if;end loop;
 if(select count(*)from public.ads)<>14301 or(select count(*)from public.ads where active)<>12165 or(select count(*)from public.nexus_v370_keyword_source)<>17605 or(select count(*)from public.nexus_shopee_offers)<>1201 then raise exception 'v3750 catalog drift';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v3750 Job 60 drift';end if;
 if exists(select 1 from cron.job where active and schedule~*'second'and jobid<>60)then raise exception 'v3750 unexpected sub-minute polling job';end if;
exception when others then raise;end $assert$;
commit;
