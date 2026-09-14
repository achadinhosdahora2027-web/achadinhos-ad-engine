-- Version-scoped rollback for Nexus v3500 metadata selector and wake-up trigger.
-- It does not reactivate legacy polling jobs.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
drop trigger if exists trg_v3500_outbox_signal on public.nexus_v1550_outbox_logged;
drop function if exists public.nexus_v3500_signal_outbox();
drop function if exists public.nexus_v3500_operator_status();
drop function if exists public.nexus_v3500_route_readiness(jsonb,text,text,text);
drop function if exists public.nexus_v3500_currency(text);
drop index if exists public.nexus_v3500_cj_route_lookup_idx;
drop table if exists public.nexus_v3500_cron_audit;
delete from public.nexus_v3000_capability_registry where capability in(
 'v3500_reactive_logged_outbox','v3500_indexed_route_readiness','v3500_legacy_pollers_inactive',
 'v3500_satellite_bounded_reach','v3500_continuous_runtime','v3500_direct_merchant_fallback');
commit;
