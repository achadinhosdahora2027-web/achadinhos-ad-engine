-- Nexus v3700.0 — production capability reconciliation after external probes.
-- Records bounded, truthful evidence: X HTTP 402 and DeepSeek HTTP 402 remain blockers.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at) values
 ('v3700_twitter_vault',true,jsonb_build_object('encrypted_rows',7,'kms_key_name','nexus_satellites_kms','ciphertext_roundtrip_verified',true,'plaintext_persisted',false,'hydration_entrypoint_dropped',true),clock_timestamp()),
 ('v3700_bounded_edge_gateways',true,jsonb_build_object('projects_deployed',14,'public_status_verified',14,'custom_secret_verified',14,'unauthorized_rejected',14,'stream_source_sha256','3609a691165be740901d23598e0698319e230021e475d788dec80d2823a164e3','bounded_session_max_seconds',90,'continuous_24x7_proven',false),clock_timestamp()),
 ('v3700_x_rules_installed',true,jsonb_build_object('rules',2,'br_sp_basis','geotagged post/place within 40km point radius','us_ny_basis','geotagged post/place within 40km point radius','city_or_residence_proof',false),clock_timestamp()),
 ('v3700_x_filtered_http_stream',false,jsonb_build_object('transport','persistent HTTP','rfc6455_websocket',false,'last_upstream_http',402,'connection_established',false,'full_firehose',false,'reason','X account/API access tier returned Payment Required'),clock_timestamp()),
 ('v3700_aho_keyword_matcher',true,jsonb_build_object('patterns',17605,'synthetic_samples',2000,'correct',2000,'p50_ms',0.008149,'p99_ms',0.036615,'max_ms',5.96744,'end_to_end_latency_measured',false,'sub_1ms_guaranteed',false),clock_timestamp()),
 ('v3700_atomic_event_outbox',true,jsonb_build_object('transactional_proof',true,'transaction_rolled_back',true,'channel_key','atendimento','external_exactly_once_claimed',false),clock_timestamp()),
 ('v3700_copilot_groq',true,jsonb_build_object('synthetic_scopes_verified',2,'model','openai/gpt-oss-20b','neutral_filter',true,'publication_performed',false),clock_timestamp()),
 ('v3700_copilot_deepseek',false,jsonb_build_object('last_upstream_http',402,'reason','provider returned Payment Required','publication_performed',false),clock_timestamp()),
 ('v3700_copilot_pool_complete',false,jsonb_build_object('fanout','Promise.allSettled','groq',true,'deepseek',false,'reason','one of two requested providers unavailable'),clock_timestamp()),
 ('v3700_continuous_24x7',false,jsonb_build_object('reason','X stream access returned HTTP 402 and Supabase Edge sessions are wall-clock bounded','active_x_stream_connections',0),clock_timestamp()),
 ('v3700_anti404_fallback',false,jsonb_build_object('reason','no verified final merchant URL plus measured fallback behavior','sub_50ms_guaranteed',false),clock_timestamp()),
 ('v3700_job60_preserved',true,jsonb_build_object('jobid',60,'schedule','10 seconds','max_messages_per_minute',3,'channel_separation_preserved',true),clock_timestamp())
on conflict(capability) do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$
declare p "char";
begin
  if (select count(*) from public.nexus_v3700_twitter_vault)<>7 or to_regprocedure('public.nexus_v3700_hydrate_twitter_vault(jsonb)') is not null then raise exception 'v3700 vault verification drift';end if;
  if (select count(*) from public.nexus_v3700_twitter_session_audit where upstream_http=402)<2 or exists(select 1 from public.nexus_v3700_twitter_session_audit where http_stream_proven) then raise exception 'v3700 upstream 402 evidence drift';end if;
  if (select count(*) from public.nexus_v3700_twitter_event_ledger)<>0 or (select count(*) from public.nexus_v3700_twitter_inbound_outbox)<>0 then raise exception 'v3700 unexpected persisted event';end if;
  foreach p in array array[(select relpersistence from pg_class where oid='public.nexus_v3700_twitter_vault'::regclass),(select relpersistence from pg_class where oid='public.nexus_v3700_twitter_event_ledger'::regclass),(select relpersistence from pg_class where oid='public.nexus_v3700_twitter_inbound_outbox'::regclass)] loop if p<>'p'::"char" then raise exception 'v3700 object not LOGGED';end if;end loop;
  if (select count(*) from public.ads)<>14301 or (select count(*) from public.ads where active)<>12165 or (select count(*) from public.nexus_v370_keyword_source)<>17605 or (select count(*) from public.nexus_shopee_offers)<>1201 then raise exception 'v3700 protected catalog drift';end if;
  if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'v3700 Job 60 drift';end if;
  if exists(select 1 from cron.job where active and schedule~*'second' and jobid<>60) then raise exception 'v3700 unexpected sub-minute job';end if;
exception when others then raise;
end
$assert$;
commit;
