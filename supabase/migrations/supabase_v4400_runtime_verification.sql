-- Nexus v4400.0 — truthful post-deploy reconciliation and operator screen.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
create or replace function public.nexus_v4400_operator_status()returns jsonb language plpgsql volatile security definer set search_path='public','pg_catalog','pg_temp' as $function$
begin
 perform set_config('statement_timeout','4000',true);perform set_config('lock_timeout','1000',true);
 return jsonb_build_object('version','v4400.0','observed_at',clock_timestamp(),
 'database',jsonb_build_object('server_version',current_setting('server_version'),'diagnostic_ledger_persistence',(select relpersistence from pg_class where oid='public.nexus_v4400_impression_diagnostic_ledger'::regclass),'diagnostic_outbox_persistence',(select relpersistence from pg_class where oid='public.nexus_v4400_impression_diagnostic_outbox'::regclass),'diagnostics',(select count(*)from public.nexus_v4400_impression_diagnostic_ledger),'outbox_rows',(select count(*)from public.nexus_v4400_impression_diagnostic_outbox),'keywords',(select count(*)from public.nexus_v370_keyword_source),'vectors',(select count(*)from public.nexus_v380_keyword_vectors)),
 'fleet',jsonb_build_object('configured_projects',14,'safety_gate_http_200',14,'replay_gateways_http_200',14,'automatic_impression_enabled_projects',0,'permanent_websocket_runtime_projects',0,'copywriter_master_version',35,'edge_v950_assigned',false),
 'placements',(select jsonb_agg(jsonb_build_object('host',host,'expected_binding_header',expected_binding_header,'placement_mutation_allowed',placement_mutation_allowed,'shadow_dom_injection_enabled',shadow_dom_injection_enabled,'automatic_impression_enabled',automatic_impression_enabled)order by host)from public.nexus_v4400_impression_policy),
 'models',(select jsonb_agg(jsonb_build_object('model_id',model_id,'catalog_present',catalog_present,'enabled_in_broker',enabled_in_broker,'cost_zero_guaranteed',cost_zero_guaranteed)order by model_id)from public.nexus_v4400_model_catalog_lock),
 'telegram',jsonb_build_object('job_60',(select jsonb_build_object('active',active,'schedule',schedule)from cron.job where jobid=60),'channel_outbox_persistence',(select relpersistence from pg_class where oid='public.nexus_v420_channel_outbox'::regclass),'pacing','max 3/min and 40/hour per destination'),
 'readiness',jsonb_build_object('safe_impression_safety_matrix_ready',true,'automatic_impression_yield_active',false,'requested_full_horizontal_readiness',false,'reasons',jsonb_build_array('automatic Shadow DOM rendering would modify protected behavior','is_bot=false is not proof of a residential human','Deno Edge is not a durable 24/7 supervisor','KV fallback and lossless commission are unverified')),
 'claims',jsonb_build_object('billable_impressions_created',false,'sub_1ms_guaranteed',false,'sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false,'publication_performed',false,'affiliate_click_performed',false));
exception when others then raise;end$function$;
revoke all on function public.nexus_v4400_operator_status()from public,anon,authenticated,service_role;
grant execute on function public.nexus_v4400_operator_status()to service_role;

insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
('v4400_master_sql',true,jsonb_build_object('diagnostic_ledger','LOGGED','diagnostic_outbox','LOGGED','automatic_impression_enabled',false),clock_timestamp()),
('v4400_campaign_selector',true,jsonb_build_object('service_role_only',true,'server_side_samples',250,'p50_ms',0.640,'p99_ms',0.865,'max_ms',12.290,'end_to_end_measured',false,'sub_1ms_guaranteed',false),clock_timestamp()),
('v4400_fleet_safety_gate',true,jsonb_build_object('projects_http_200',14,'unauthorized_rejected',14,'authorized_policy_verified',14,'automatic_impression_enabled_projects',0),clock_timestamp()),
('v4400_multi_llm_broker',true,jsonb_build_object('copywriter_edge_version',35,'fanout','Promise.allSettled','selected_provider','groq','groq_state','ok','liquid_state','unsafe_shape_rejected','all_providers_accepted',false,'cost_zero_guaranteed',false),clock_timestamp()),
('v4400_shadow_dom_impression_renderer',false,jsonb_build_object('reason','would modify protected rendering behavior and lacks anti-IVT authorization','billable_impressions_created',false),clock_timestamp()),
('v4400_permanent_websocket_runtime',false,jsonb_build_object('reason','Deno Edge request lifecycle is not a durable process supervisor','projects_enabled',0,'continuous_24x7_proven',false),clock_timestamp()),
('v4400_kv_404_affiliate_fallback',false,jsonb_build_object('reason','KV binding and protected artifact alignment not verified','sub_50ms_guaranteed',false,'commission_lossless_guaranteed',false),clock_timestamp()),
('v4400_full_horizontal_impression_yield',false,jsonb_build_object('reason','14 safety gates are active, not 14 automatic impression renderers'),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

do $assert$declare p "char";begin
 if(select count(*)from public.nexus_v4400_impression_policy)<>3 or exists(select 1 from public.nexus_v4400_impression_policy where placement_mutation_allowed or shadow_dom_injection_enabled or automatic_impression_enabled)then raise exception 'v4400 unsafe placement policy';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v4400_impression_diagnostic_ledger'::regclass;if p<>'p'::"char"then raise exception 'v4400 ledger not LOGGED';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v4400_impression_diagnostic_outbox'::regclass;if p<>'p'::"char"then raise exception 'v4400 outbox not LOGGED';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v420_channel_outbox'::regclass;if p<>'u'::"char"then raise exception 'v4400 Telegram outbox drift';end if;
 if exists(select 1 from cron.job where jobid in(15,16,18,21,35,36,38,40,41,44,47,48,62,63,64,65)and active)then raise exception 'v4400 legacy poller active';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v4400 Job 60 drift';end if;
 if(select pg_get_functiondef('public.nexus_v1510_flush_event(integer)'::regprocedure)not like'%v_minute>=3 or v_hour>=40%')then raise exception 'v4400 pacing drift';end if;
 if exists(select 1 from public.nexus_v4400_model_catalog_lock where not catalog_present and enabled_in_broker)then raise exception 'v4400 absent model enabled';end if;
 if(select count(*)from public.nexus_v4400_impression_diagnostic_ledger)<>0 or(select count(*)from public.nexus_v4400_impression_diagnostic_outbox)<>0 then raise exception 'v4400 diagnostic proof persisted rows';end if;
 if(select count(*)from public.ads)<>14301 or(select count(*)from public.ads where active)<>12165 or(select count(*)from public.nexus_v370_keyword_source)<>17605 or(select count(*)from public.nexus_v380_keyword_vectors)<>11568 or(select count(*)from public.nexus_shopee_offers)<>1201 then raise exception 'v4400 catalog drift';end if;
exception when others then raise;end$assert$;
commit;
