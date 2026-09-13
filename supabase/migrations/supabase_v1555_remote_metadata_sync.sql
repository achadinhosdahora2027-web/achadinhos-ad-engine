-- Nexus v1555.0 — Remote Metadata Sync & Cron ACL Maintenance
-- PostgreSQL 17.6 / additive and atomic
--
-- Scope:
--   * Preserve the existing cron identifiers 60..63.
--   * Keep the paced Telegram batch and factual yield/vector maintenance active.
--   * Remove public PostgREST execution from internal SECURITY DEFINER workers.
--   * Do not provision or claim a permanent v1550 network executor.
--   * Do not read or write the active-ad catalog.

begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- Abort instead of silently creating replacement identifiers.
do $catalog$
declare
  v_bad text;
begin
  select string_agg(x.expected::text,', ' order by x.expected)
    into v_bad
    from (values
      (60,'v360-tg-flush-10s'),
      (61,'v365-yield-hourly'),
      (62,'v365-yield-consume-2min'),
      (63,'v380-embed-cycle-2min')
    ) as x(expected,expected_name)
   where not exists(
     select 1 from cron.job j
      where j.jobid=x.expected and j.jobname=x.expected_name
   );
  if v_bad is not null then
    raise exception 'v1555 cron catalog mismatch for job id(s): %',v_bad;
  end if;
end;
$catalog$;

-- These jobs run as their database owner. They are not public RPC endpoints.
revoke all on function public.nexus_v365_yield_sync(integer),
                       public.nexus_v365_yield_consume(),
                       public.nexus_v380_cycle(integer),
                       public.nexus_v380_cycle(integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.nexus_v365_yield_sync(integer),
                          public.nexus_v365_yield_consume(),
                          public.nexus_v380_cycle(integer),
                          public.nexus_v380_cycle(integer,integer)
  to service_role;

-- Existing identifiers are altered in place. Job 60 uses the v1510 flush because
-- it enforces the measured per-room ceiling of 3/minute and 40/hour.
select cron.alter_job(60,
  schedule=>'10 seconds',
  command=>'select public.nexus_v1510_flush_event(40);',
  active=>true);
select cron.alter_job(61,
  schedule=>'7 * * * *',
  command=>'select public.nexus_v365_yield_sync(7);',
  active=>true);
select cron.alter_job(62,
  schedule=>'*/2 * * * *',
  command=>'select public.nexus_v365_yield_consume();',
  active=>true);
select cron.alter_job(63,
  schedule=>'*/2 * * * *',
  command=>'SELECT public.nexus_v380_cycle(8, 10);',
  active=>true);

-- Stream/database polling jobs remain disabled. This migration is not the
-- durable v1550 retry executor.
select cron.alter_job(15,active=>false);
select cron.alter_job(16,active=>false);
select cron.alter_job(64,active=>false);

-- Fail closed if the catalog or exposed-function ACL differs after alteration.
do $assert$
declare
  v_bad text;
  v_public boolean;
begin
  select string_agg(j.jobid::text,', ' order by j.jobid)
    into v_bad
    from cron.job j
   where j.jobid in(60,61,62,63) and not j.active;
  if v_bad is not null then
    raise exception 'v1555 expected active cron job(s): %',v_bad;
  end if;
  if exists(select 1 from cron.job where jobid in(15,16,64) and active) then
    raise exception 'v1555 forbidden stream polling job became active';
  end if;
  select has_function_privilege('anon',
           'public.nexus_v365_yield_sync(integer)','EXECUTE')
      or has_function_privilege('authenticated',
           'public.nexus_v365_yield_consume()','EXECUTE')
      or has_function_privilege('anon',
           'public.nexus_v380_cycle(integer,integer)','EXECUTE')
    into v_public;
  if v_public then
    raise exception 'v1555 internal cron function remains exposed';
  end if;
end;
$assert$;

commit;
