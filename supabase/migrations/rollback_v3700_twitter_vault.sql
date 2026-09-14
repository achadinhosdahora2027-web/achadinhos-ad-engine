-- Nexus v3700.0 database rollback. External X rules and deployed Edge
-- functions require separate explicit rollback and are not claimed here.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';

do $guard$
begin
  if to_regclass('public.nexus_v3700_twitter_vault') is null then raise exception 'v3700 rollback guard: vault absent';end if;
  if exists(select 1 from public.nexus_v3700_twitter_vault where installed_by_release<>'v3700.0') then raise exception 'v3700 rollback guard: foreign vault release';end if;
exception when others then raise;
end
$guard$;

drop function if exists public.nexus_v3700_operator_status();
drop function if exists public.nexus_v3700_finish_stream_session(uuid,uuid,jsonb);
drop function if exists public.nexus_v3700_ingest_matches(uuid,uuid,jsonb);
drop function if exists public.nexus_v3700_acquire_stream_lease(text,integer);
drop function if exists public.nexus_v3700_keyword_snapshot();
drop trigger if exists trg_v3700_notify_outbox on public.nexus_v3700_twitter_inbound_outbox;
drop trigger if exists trg_v3700_event_to_outbox on public.nexus_v3700_twitter_event_ledger;
drop function if exists public.nexus_v3700_notify_outbox();
drop function if exists public.nexus_v3700_event_to_outbox();
drop table public.nexus_v3700_twitter_inbound_outbox;
drop table public.nexus_v3700_twitter_event_ledger;
drop table public.nexus_v3700_twitter_session_audit;
drop table public.nexus_v3700_twitter_stream_lease;
drop function if exists public.nexus_v3700_rotate_oauth2_tokens(text,text);
drop function if exists public.nexus_v3700_hydrate_twitter_vault(jsonb);
drop trigger if exists trg_v3700_twitter_vault_guard on public.nexus_v3700_twitter_vault;
drop function if exists public.nexus_v3700_vault_mutation_guard();
drop table public.nexus_v3700_twitter_vault;
delete from public.nexus_v3000_capability_registry where capability like 'v3700%';

do $assert$
begin
  if to_regclass('public.nexus_v3700_twitter_vault') is not null or to_regclass('public.nexus_v3700_twitter_inbound_outbox') is not null or exists(select 1 from public.nexus_v3000_capability_registry where capability like 'v3700%') then raise exception 'v3700 rollback incomplete';end if;
  if (select count(*) from public.ads)<>14301 or (select count(*) from public.ads where active)<>12165 or (select count(*) from public.nexus_v370_keyword_source)<>17605 or (select count(*) from public.nexus_shopee_offers)<>1201 then raise exception 'v3700 rollback protected catalog drift';end if;
  if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds' and command='select public.nexus_v1510_flush_event(40);') then raise exception 'v3700 rollback Job 60 drift';end if;
exception when others then raise;
end
$assert$;
commit;
