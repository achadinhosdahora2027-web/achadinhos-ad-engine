-- Nexus v3755.0 — truthful post-deploy reconciliation.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)values
('v3755_liquid_lfm_policy',true,jsonb_build_object('model','liquid/lfm-2.5-2.6b:free','catalog_price_zero_verified',true,'runtime_http',200,'output_accepted_by_neutral_policy',false,'cost_zero_guaranteed',false),clock_timestamp()),
('v3755_liquid_output_accepted',false,jsonb_build_object('runtime_http',200,'state','unsafe_shape_rejected','reason','model output differed from the exact deterministic factual envelope; fail-closed'),clock_timestamp()),
('v3755_copywriter_parallel_pool',true,jsonb_build_object('master_deployed',true,'fanout','Promise.allSettled','selected_provider','groq','groq_http',200,'groq_result_preferred',true,'continuous_groq_guaranteed',false),clock_timestamp()),
('v3755_cloudflare_pages_quarantine',true,jsonb_build_object('project','aquitem','config_downloaded',true,'asset_files_downloaded',0,'asset_download_command_exists',false,'mismatches',31,'direct_upload_executed',false,'production_deployed',false,'protected_placements_modified',false),clock_timestamp()),
('v3755_replay_matrix_retained',true,jsonb_build_object('projects_http_200',14,'keyword_mappings',17605,'x_transport_used',false,'third_party_cookie_used',false,'scraper_used',false),clock_timestamp()),
('v3755_cost_zero_guarantee',false,jsonb_build_object('reason','catalog price observation and provider quotas are not a billing guarantee'),clock_timestamp()),
('v3755_continuous_24x7',false,jsonb_build_object('reason','bounded Edge endpoints verified; permanent resident runtime not deployed'),clock_timestamp())
on conflict(capability)do update set enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;
do $assert$ declare p "char";begin
 if not exists(select 1 from public.nexus_v3750_provider_policy where provider='openrouter'and model_id='liquid/lfm-2.5-2.6b:free'and enabled and catalog_price_zero_verified and not cost_zero_guaranteed)then raise exception 'v3755 Liquid policy drift';end if;
 select relpersistence into p from pg_class where oid='public.nexus_v3755_pages_quarantine'::regclass;if p<>'p'::"char"then raise exception 'v3755 quarantine not LOGGED';end if;
 if exists(select 1 from public.nexus_v3755_pages_quarantine where direct_upload_allowed or production_deployed or protected_placements_modified)then raise exception 'v3755 Cloudflare mutation observed';end if;
 if(select count(*)from public.nexus_v3750_replay_batch)<>0 or(select count(*)from public.nexus_v3750_replay_event_ledger)<>0 or(select count(*)from public.nexus_v3750_replay_outbox)<>0 then raise exception 'v3755 unexpected replay rows';end if;
 if(select count(*)from public.ads)<>14301 or(select count(*)from public.ads where active)<>12165 or(select count(*)from public.nexus_v370_keyword_source)<>17605 or(select count(*)from public.nexus_shopee_offers)<>1201 then raise exception 'v3755 catalog drift';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v3755 Job 60 drift';end if;
 if exists(select 1 from cron.job where active and schedule~*'second'and jobid<>60)then raise exception 'v3755 unexpected sub-minute job';end if;
exception when others then raise;end $assert$;
commit;
