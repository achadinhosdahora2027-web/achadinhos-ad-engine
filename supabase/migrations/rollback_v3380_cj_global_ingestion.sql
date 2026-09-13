-- Version-scoped rollback for the v3380 global CJ backlog vault only.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
drop function if exists public.nexus_v3380_cj_global_status();
drop function if exists public.nexus_v3380_finalize_cj_global(text,integer,text);
drop function if exists public.nexus_v3380_hydrate_cj_global(text,timestamptz,integer,text,jsonb);
drop table if exists public.nexus_v3380_cj_global_vault;
drop table if exists public.nexus_v3380_cj_global_ingestion;
delete from public.nexus_v3000_capability_registry where capability in('v3380_cj_global_schema','v3380_cj_global_encrypted_backlog','v3380_cj_global_bulk_routing');
commit;
