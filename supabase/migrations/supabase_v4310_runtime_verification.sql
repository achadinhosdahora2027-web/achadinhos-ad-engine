-- Nexus v4310.0 — truthful post-deploy reconciliation.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
create or replace function public.nexus_v4310_operator_status()returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 return jsonb_build_object('version','v4310.0','observed_at',clock_timestamp(),
  'database',jsonb_build_object('server_version',current_setting('server_version'),'signal_ledger_persistence',(select relpersistence from pg_class where oid='public.nexus_v4310_edge_signal_ledger'::regclass),'signal_outbox_persistence',(select relpersistence from pg_class where oid='public.nexus_v4310_signal_outbox'::regclass),'signals',(select count(*)from public.nexus_v4310_edge_signal_ledger),'outbox_rows',(select count(*)from public.nexus_v4310_signal_outbox),'keywords',(select count(*)from public.nexus_v370_keyword_source),'vectors',(select count(*)from public.nexus_v380_keyword_vectors)),
  'models',(select jsonb_agg(jsonb_build_object('provider',provider,'model_id',model_id,'catalog_present',catalog_present,'enabled_in_broker',enabled_in_broker,'cost_zero_guaranteed',cost_zero_guaranteed)order by model_id)from public.nexus_v4310_model_catalog_lock),
  'tracking',(select jsonb_agg(jsonb_build_object('network',network_key,'verified',credential_or_inventory_verified,'selector_mode',selector_mode,'protected_go_alignment_verified',protected_go_alignment_verified)order by network_key)from public.nexus_v4310_tracking_lock),
  'edge',jsonb_build_object('copywriter_version',33,'bounded_signal_ingress_version',3,'fanout','Promise.allSettled','selected_provider','groq','permanent_websocket_runtime',false,'continuous_24x7_proven',false),
  'telegram',jsonb_build_object('job_60',(select jsonb_build_object('active',active,'schedule',schedule)from cron.job where jobid=60),'channel_outbox_persistence',(select relpersistence from pg_class where oid='public.nexus_v420_channel_outbox'::regclass),'pacing','max 3/min and 40/hour per destination'),
  'readiness',jsonb_build_object('safe_bounded_core_ready',true,'requested_full_global_readiness',false,'reasons',jsonb_build_array('no durable WebSocket supervisor','no verified KV fallback','immutable go.js tracking alignment not proven')),
  'claims',jsonb_build_object('sub_1ms_guaranteed',false,'sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false,'publication_performed',false,'affiliate_click_performed',false));
exception when others then raise;end $function$;
revoke all on function public.nexus_v4310_operator_status()from public,anon,authenticated,service_role;
grant execute on function public.nexus_v4310_operator_status()to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
('v4310_master_sql',true,jsonb_build_object('event_signal_ledger','LOGGED','signal_outbox','LOGGED','trigger_to_outbox',true,'pg_notify',true,'polling_executor_installed',false),clock_timestamp()),
('v4310_campaign_selector',true,jsonb_build_object('service_role_only',true,'tracking_locks',5,'header_lookup','direct JSON key','currencies',jsonb_build_array('BRL','USD','GBP','EUR'),'server_side_samples',250,'p50_ms',0.599,'p99_ms',0.916,'max_ms',20.753,'sub_1ms_guaranteed',false,'end_to_end_measured',false),clock_timestamp()),
('v4310_multi_llm_broker',true,jsonb_build_object('copywriter_edge_version',33,'fanout','Promise.allSettled','selected_provider','groq','groq_state','ok','liquid_state','unsafe_shape_rejected','gemma4_state','http_429_rejected','nemotron_state','unsafe_shape_rejected','all_providers_accepted',false,'cost_zero_guaranteed',false),clock_timestamp()),
('v4310_bounded_signal_ingress',true,jsonb_build_object('edge_version',3,'aho_keyword_mappings',17605,'synthetic_dryrun_matches',1,'database_writes',false,'atomic_database_batch',true),clock_timestamp()),
('v4310_replay_matrix_retained',true,jsonb_build_object('gateways_http_200',14,'keyword_mappings',17605,'production_replay_executed',false),clock_timestamp()),
('v4310_permanent_websocket_runtime',false,jsonb_build_object('reason','Deno Edge request lifecycle is not a durable process supervisor','background_reconnect_loop_deployed',false,'continuous_24x7_proven',false),clock_timestamp()),
('v4310_kv_404_fallback',false,jsonb_build_object('reason','KV binding and exact protected Pages artifact are not verified','sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp()),
('v4310_protected_go_tracking_alignment',false,jsonb_build_object('reason','tracking vaults verified but their alignment to immutable go.js was not independently proven','go_js_modified',false,'direct_redirect_enabled',false),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;
do $assert$ declare p "char";begin
 select relpersistence into p from pg_class where oid='public.nexus_v4310_edge_signal_ledger'::regclass;if p<>'p'::"char"then raise exception 'v4310 ledger not LOGGED';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v4310_signal_outbox'::regclass;if p<>'p'::"char"then raise exception 'v4310 signal outbox not LOGGED';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v420_channel_outbox'::regclass;if p<>'u'::"char"then raise exception 'v4310 Telegram outbox drift';end if;
 if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)and active)then raise exception 'v4310 legacy poller active';end if;
 if not exists(select 1 from cron.job where jobid=60 and jobname='v360-tg-flush-10s'and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v4310 Job 60 drift';end if;
 if(select pg_get_functiondef('public.nexus_v1510_flush_event(integer)'::regprocedure)not like'%v_minute>=3 or v_hour>=40%')then raise exception 'v4310 pacing drift';end if;
 if(select count(*)from public.nexus_v4310_tracking_lock where credential_or_inventory_verified)<>5 then raise exception 'v4310 tracking verification drift';end if;
 if exists(select 1 from public.nexus_v4310_model_catalog_lock where not catalog_present and enabled_in_broker)then raise exception 'v4310 absent model enabled';end if;
 if(select count(*)from public.nexus_v4310_edge_signal_ledger)<>0 or(select count(*)from public.nexus_v4310_signal_outbox)<>0 then raise exception 'v4310 synthetic dry-run persisted rows';end if;
 if(select count(*)from public.ads)<>14301 or(select count(*)from public.ads where active)<>12165 or(select count(*)from public.nexus_v370_keyword_source)<>17605 or(select count(*)from public.nexus_v380_keyword_vectors)<>11568 or(select count(*)from public.nexus_shopee_offers)<>1201 then raise exception 'v4310 catalog drift';end if;
exception when others then raise;end $assert$;
commit;
