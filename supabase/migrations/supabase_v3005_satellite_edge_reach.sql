-- Nexus v3005.0 — record physically verified satellite Edge deployment.
-- Evidence collected through the Supabase Management API and function logs.
-- This does not claim a permanent 24x7 WebSocket runtime.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';

do $v3005$
begin
  update public.nexus_v3000_capability_registry
     set enabled = true,
         evidence = jsonb_build_object(
           'release', 'v3005.0',
           'configured', 13,
           'deployed', 13,
           'active_management_api', 13,
           'runtime_get_http_200', 13,
           'session_start_http_202', 13,
           'websocket_open_projects', 13,
           'all_three_websockets_open_projects', 12,
           'alcances_verificados', '13/13',
           'bounded_runtime', true,
           'permanent_24x7_claimed', false,
           'degraded_observation', jsonb_build_object(
             'project_ref', 'duipcjiiytrfxzyktswk',
             'source', 'relay.damus.io',
             'state', 'reconnecting_with_backoff',
             'other_sources_open', jsonb_build_array('jetstream', 'nos.lol')
           )
         ),
         checked_at = clock_timestamp()
   where capability = 'satellite_edge_deploy_13';

  if not found then
    raise exception 'v3005 capability row satellite_edge_deploy_13 is missing';
  end if;
end
$v3005$;

commit;
