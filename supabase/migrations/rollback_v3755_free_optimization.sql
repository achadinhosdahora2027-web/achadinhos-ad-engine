-- Nexus v3755.0 database rollback. Edge source rollback is separate.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
drop function if exists public.nexus_v3755_operator_status();
drop table public.nexus_v3755_pages_quarantine;
delete from public.nexus_v3750_provider_policy where provider='openrouter'and model_id='liquid/lfm-2.5-2.6b:free';
delete from public.nexus_v3000_capability_registry where capability like'v3755%';
do $assert$ begin
 if to_regclass('public.nexus_v3755_pages_quarantine')is not null or exists(select 1 from public.nexus_v3750_provider_policy where model_id='liquid/lfm-2.5-2.6b:free')then raise exception 'v3755 rollback incomplete';end if;
 if(select count(*)from public.ads)<>14301 or(select count(*)from public.nexus_v370_keyword_source)<>17605 or(select count(*)from public.nexus_shopee_offers)<>1201 then raise exception 'v3755 rollback catalog drift';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v3755 rollback Job 60 drift';end if;
exception when others then raise;end $assert$;
commit;
