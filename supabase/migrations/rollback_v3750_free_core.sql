-- Nexus v3750.0 rollback: removes only white-hat replay objects.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
drop function if exists public.nexus_v3750_operator_status();
drop function if exists public.nexus_v3750_finish_replay(uuid,boolean);
drop function if exists public.nexus_v3750_ingest_replay_matches(uuid,jsonb);
drop function if exists public.nexus_v3750_begin_replay(text,text,text,integer);
drop function if exists public.nexus_v3750_provider_snapshot();
drop function if exists public.nexus_v3750_keyword_snapshot();
drop trigger if exists trg_v3750_notify_outbox on public.nexus_v3750_replay_outbox;
drop trigger if exists trg_v3750_event_to_outbox on public.nexus_v3750_replay_event_ledger;
drop function if exists public.nexus_v3750_notify_outbox();
drop function if exists public.nexus_v3750_event_to_outbox();
drop table public.nexus_v3750_replay_outbox;
drop table public.nexus_v3750_replay_event_ledger;
drop table public.nexus_v3750_replay_batch;
drop table public.nexus_v3750_provider_policy;
delete from public.nexus_v3000_capability_registry where capability like'v3750%';
do $assert$ begin
 if to_regclass('public.nexus_v3750_replay_batch')is not null or exists(select 1 from public.nexus_v3000_capability_registry where capability like'v3750%')then raise exception 'v3750 rollback incomplete';end if;
 if(select count(*)from public.ads)<>14301 or(select count(*)from public.nexus_v370_keyword_source)<>17605 or(select count(*)from public.nexus_shopee_offers)<>1201 then raise exception 'v3750 rollback catalog drift';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v3750 rollback Job 60 drift';end if;
exception when others then raise;end $assert$;
commit;
