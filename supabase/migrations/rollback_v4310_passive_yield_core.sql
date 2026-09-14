-- Nexus v4310.0 database rollback. Edge rollback is a separate redeploy.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
do $restore$ declare r record;begin
 for r in select jobid,was_active from public.nexus_v4310_cron_lock loop
  perform cron.alter_job(r.jobid,active=>r.was_active);
 end loop;
exception when others then raise;end $restore$;
drop trigger if exists trg_v4310_notify_outbox on public.nexus_v4310_signal_outbox;
drop trigger if exists trg_v4310_signal_to_outbox on public.nexus_v4310_edge_signal_ledger;
drop function if exists public.nexus_v4310_notify_outbox();
drop function if exists public.nexus_v4310_signal_to_outbox();
drop function if exists public.nexus_v4310_ingest_signal_batch(jsonb);
drop function if exists public.nexus_v4310_ingest_signal(jsonb);
drop function if exists public.nexus_v4310_operator_status();
drop function if exists public.nexus_v4310_campaign_select(jsonb,text,text,text);
drop table if exists public.nexus_v4310_signal_outbox;
drop table if exists public.nexus_v4310_edge_signal_ledger;
drop function if exists public.nexus_v4310_sha256_array_valid(text[]);
drop table if exists public.nexus_v4310_tracking_lock;
drop table if exists public.nexus_v4310_model_catalog_lock;
drop table if exists public.nexus_v4310_cron_lock;
delete from public.nexus_v3000_capability_registry where capability like'v4310%';
do $assert$ begin
 if to_regclass('public.nexus_v4310_edge_signal_ledger')is not null or to_regclass('public.nexus_v4310_signal_outbox')is not null then raise exception 'v4310 rollback incomplete';end if;
 if(select count(*)from public.ads)<>14301 or(select count(*)from public.ads where active)<>12165 or(select count(*)from public.nexus_v370_keyword_source)<>17605 or(select count(*)from public.nexus_v380_keyword_vectors)<>11568 or(select count(*)from public.nexus_shopee_offers)<>1201 then raise exception 'v4310 rollback catalog drift';end if;
 if not exists(select 1 from cron.job where jobid=60 and active and schedule='10 seconds'and command='select public.nexus_v1510_flush_event(40);')then raise exception 'v4310 rollback Job 60 drift';end if;
exception when others then raise;end $assert$;
commit;
