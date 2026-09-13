-- Nexus v3005.0 — reconcile final bounded-session evidence after deployment.
-- The observed run processed real public feed frames; it generated no clicks and
-- no conversion/sale claim. All figures below come from function_logs.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';

do $v3005_session$
begin
  update public.nexus_v3000_capability_registry
     set enabled = true,
         evidence = (evidence - 'degraded_observation') || jsonb_build_object(
           'all_three_websockets_open_projects', 13,
           'session_window_ms', 120000,
           'session_complete_observed', 13,
           'frame_cap_per_project', 4000,
           'projects_reaching_frame_cap', 13,
           'matched_events_observed', 0,
           'accepted_events_observed', 0,
           'rpc_errors_observed', 0,
           'projects_with_log_errors', 0,
           'programmatic_clicks_generated', 0,
           'conversions_claimed', 0,
           'permanent_24x7_claimed', false
         ),
         checked_at = clock_timestamp()
   where capability = 'satellite_edge_deploy_13'
     and enabled
     and evidence->>'alcances_verificados' = '13/13';

  if not found then
    raise exception 'v3005 verified deployment evidence is missing';
  end if;
end
$v3005_session$;

commit;
