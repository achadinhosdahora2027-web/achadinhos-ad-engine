-- Version-scoped rollback for Nexus v3600.0 master metadata objects.
-- It does not reactivate any polling job, change Job 60, or modify ad placements.
begin;
set local statement_timeout='4000ms';
set local lock_timeout='1000ms';
drop function if exists public.nexus_v3600_operator_status();
drop function if exists public.nexus_v3600_resolve_travel(jsonb,text,text,text,text,text);
drop table if exists public.nexus_v3600_route_readiness;
drop table if exists public.nexus_v3600_destination_matrix;
delete from public.nexus_v3340_travel_lexicon where installed_by_release='v3600.0';
drop table if exists public.nexus_v3600_bluesky_traffic_snapshot;
drop table if exists public.nexus_v3600_evidence_sources;
delete from public.nexus_v3000_capability_registry where capability in(
 'v3600_destination_matrix','v3600_bluesky_traffic_snapshot','v3600_route_metadata_only',
 'v3600_continuous_runtime','v3600_all_14_accounts_active','v3600_fallback');
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_country_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_country_ck
 check(country_code in('US','CA','ES','FR','IT','GB'));
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_source_scope_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_source_scope_ck
 check(source_claim_scope='operator_reference_not_independently_verified');
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_release_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_release_ck
 check(installed_by_release='v3340.0');
alter table public.nexus_v3340_travel_lexicon drop constraint if exists nexus_v3340_disclosure_ck;
alter table public.nexus_v3340_travel_lexicon add constraint nexus_v3340_disclosure_ck
 check(disclosure_tag='#ad');
commit;
