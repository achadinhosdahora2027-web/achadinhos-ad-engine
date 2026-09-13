-- Nexus v3200.0 — factual contextual copy policy and signed intent queue.
-- Master project: etbxbaaaspdcoiakifbb.
--
-- This migration does not make an organic-persona endorsement, publish content,
-- modify programmatic placements, reopen the legacy Telegram buffer, or claim
-- that CDN headers / is_bot=false prove a human or residential visitor.
begin;
set local statement_timeout = '2000ms';
set local lock_timeout = '1000ms';
set local idle_in_transaction_session_timeout = '10000ms';

-- ---------------------------------------------------------------------------
-- 1. Versioned, LOGGED copy policy. Publisher implementations can read it but
-- cannot mutate it through service_role.
-- ---------------------------------------------------------------------------
create table if not exists public.nexus_v3200_copy_policies(
  policy_version text primary key,
  active boolean not null default false,
  directives jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  checked_at timestamptz not null default clock_timestamp(),
  constraint nexus_v3200_copy_policy_json_ck
    check(jsonb_typeof(directives)='object')
);
alter table public.nexus_v3200_copy_policies set logged;
alter table public.nexus_v3200_copy_policies enable row level security;
revoke all on table public.nexus_v3200_copy_policies
  from public,anon,authenticated,service_role;
grant select on table public.nexus_v3200_copy_policies to service_role;

insert into public.nexus_v3200_copy_policies(
  policy_version,active,directives,checked_at
) values (
  'v3200.0',true,
  jsonb_build_object(
    'mode','factual_product_assistance',
    'use_only_verified_payload_facts',true,
    'resolve_stated_technical_question',true,
    'short_sentences',true,
    'punctuation_required',true,
    'languages',jsonb_build_array('pt','en','fr','de'),
    'disclosure_pt','#publi',
    'disclosure_tier1','#ad',
    'disclosure_own_line_before_link',true,
    'personal_experience_claimed',false,
    'organic_consumer_impersonation',false,
    'false_endorsement_allowed',false,
    'unverified_price_or_discount_allowed',false,
    'human_or_residential_claim_allowed',false,
    'publication_claimed',false
  ),clock_timestamp()
)
on conflict(policy_version) do update set
  active=excluded.active,
  directives=excluded.directives,
  checked_at=excluded.checked_at;

alter table public.nexus_v1510_content_triggers
  add column if not exists copy_policy_version text
    references public.nexus_v3200_copy_policies(policy_version),
  add column if not exists copy_directives jsonb not null default '{}'::jsonb;
alter table public.nexus_v1510_content_triggers set logged;

-- ---------------------------------------------------------------------------
-- 2. Preserve signed receipts, channel isolation, pacing and queue cap while
-- attaching a policy only to newly requested or idempotently retried intents.
-- ---------------------------------------------------------------------------
create or replace function public.nexus_v1510_queue_content_trigger(
  p_event_id text,p_channel text,p_signature text
) returns jsonb
language plpgsql
security definer
set search_path='public','extensions','pg_temp'
as $function$
declare
  r public.nexus_v1510_ingest_receipts%rowtype;
  v_secret text;
  v_expected text;
  v_id bigint;
  v_minute integer;
  v_hour integer;
  v_total integer;
  v_directives jsonb;
begin
  perform set_config('statement_timeout','2000',true);
  perform set_config('lock_timeout','1000',true);
  begin
    if p_channel not in ('instagram_story','bluesky_reply','c2_channel')
       or coalesce(length(p_event_id),0)<12 then
      return jsonb_build_object('ok',false,'reason','invalid_trigger');
    end if;

    select * into r
      from public.nexus_v1510_ingest_receipts
     where event_id=p_event_id;
    if not found then
      return jsonb_build_object('ok',false,'reason','receipt_not_found');
    end if;

    select value into v_secret
      from public.nexus_growth_secrets
     where key='stream_listener_token';
    if coalesce(length(v_secret),0)<32 then
      perform public.nexus_v420_sintonizado(
        'v3200-content-trigger',p_channel,'signing secret unavailable');
      return jsonb_build_object(
        'ok',false,'sintonizado',true,'reason','Sintonizado em Análise');
    end if;

    v_expected:=encode(extensions.hmac(
      convert_to(p_event_id||'|'||p_channel||'|'||r.event_hash,'utf8'),
      convert_to(v_secret,'utf8'),'sha256'),'hex');
    if coalesce(length(p_signature),0)<>64
       or encode(extensions.digest(lower(p_signature),'sha256'),'hex')
          <>encode(extensions.digest(v_expected,'sha256'),'hex') then
      return jsonb_build_object('ok',false,'reason','signature_mismatch');
    end if;

    select directives into v_directives
      from public.nexus_v3200_copy_policies
     where policy_version='v3200.0' and active;
    if v_directives is null then
      perform public.nexus_v420_sintonizado(
        'v3200-content-trigger',p_channel,'copy policy unavailable');
      return jsonb_build_object(
        'ok',false,'sintonizado',true,'reason','Sintonizado em Análise');
    end if;

    -- On-demand expiry + strict per-destination pacing. No timer wakes this queue.
    if not pg_try_advisory_xact_lock(hashtext('v1510-content:'||p_channel)) then
      return jsonb_build_object('ok',false,'contained',true,'reason','channel_busy');
    end if;
    update public.nexus_v1510_content_triggers
       set state='contained',finished_at=clock_timestamp(),
           error_code='expired_unclaimed'
     where channel=p_channel and state='queued'
       and queued_at<clock_timestamp()-interval '24 hours';

    select count(*) into v_minute
      from public.nexus_v1510_content_triggers
     where channel=p_channel
       and queued_at>clock_timestamp()-interval '1 minute';
    select count(*) into v_hour
      from public.nexus_v1510_content_triggers
     where channel=p_channel
       and queued_at>clock_timestamp()-interval '1 hour';
    select count(*) into v_total
      from public.nexus_v1510_content_triggers
     where channel=p_channel and state='queued';
    if v_minute>=3 or v_hour>=40 or v_total>=500 then
      return jsonb_build_object(
        'ok',false,'contained',true,
        'reason','pacing_3m_40h_or_queue_cap');
    end if;

    insert into public.nexus_v1510_content_triggers(
      event_id,channel,keyword,offer_hash,copy_policy_version,copy_directives
    ) values(
      p_event_id,p_channel,r.keyword,r.offer_hash,'v3200.0',v_directives
    )
    on conflict(event_id,channel) do update set
      copy_policy_version=coalesce(
        public.nexus_v1510_content_triggers.copy_policy_version,
        excluded.copy_policy_version),
      copy_directives=case
        when public.nexus_v1510_content_triggers.copy_directives='{}'::jsonb
          then excluded.copy_directives
        else public.nexus_v1510_content_triggers.copy_directives
      end
    returning id into v_id;

    return jsonb_build_object(
      'ok',true,'queued',true,'id',v_id,'channel',p_channel,
      'copy_policy_version','v3200.0',
      'publication_claimed',false,
      'organic_persona_claimed',false,
      'human_or_residential_proven',false);
  exception when others then
    perform public.nexus_v420_sintonizado(
      'v3200-content-trigger',p_channel,
      sqlstate||': '||left(sqlerrm,220));
    return jsonb_build_object(
      'ok',false,'sintonizado',true,'reason','Sintonizado em Análise');
  end;
end;
$function$;

revoke all on function public.nexus_v1510_queue_content_trigger(text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.nexus_v1510_queue_content_trigger(text,text,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Truthful registry. Runtime and satellite deployment remain false until
-- physically deployed and observed; policy availability is a database fact.
-- ---------------------------------------------------------------------------
insert into public.nexus_v3000_capability_registry(capability,enabled,evidence,checked_at)
values
 ('v3200_copy_policy',true,jsonb_build_object(
    'policy_version','v3200.0',
    'factual_assistance',true,
    'organic_consumer_impersonation',false,
    'false_endorsement_allowed',false,
    'verified_facts_only',true,
    'disclosure_own_line_before_link',true),clock_timestamp()),
 ('v3200_signed_content_intents',true,jsonb_build_object(
    'service_role_only',true,
    'hmac_required',true,
    'pacing_per_channel','3/min and 40/hour',
    'publication_receipt_required_separately',true),clock_timestamp()),
 ('v3200_edge_copywriter_deployment',false,jsonb_build_object(
    'master_deployed',false,'satellites_deployed',0,
    'reason','not yet physically deployed'),clock_timestamp()),
 ('v3200_telegram_legacy_buffer_reopened',false,jsonb_build_object(
    'reason','v420 legacy buffer remains fail-closed; current channel routing preserved'),clock_timestamp()),
 ('v3200_continuous_24x7',false,jsonb_build_object(
    'reason','no permanently resident runtime proven'),clock_timestamp())
on conflict(capability) do update set
  enabled=excluded.enabled,evidence=excluded.evidence,checked_at=excluded.checked_at;

-- ---------------------------------------------------------------------------
-- 4. Atomic invariants.
-- ---------------------------------------------------------------------------
do $assert$
declare v_persistence "char";
begin
  if (select count(*) from public.ads)<>14301 then
    raise exception 'public.ads cardinality drifted from read-only 14301';
  end if;
  if (select count(*) from public.nexus_v370_keyword_source)<>17605 then
    raise exception 'canonical keyword cardinality drifted from 17605';
  end if;
  select relpersistence into v_persistence
    from pg_class where oid='public.nexus_v3200_copy_policies'::regclass;
  if v_persistence<>'p'::"char" then
    raise exception 'v3200 policy table is not LOGGED';
  end if;
  select relpersistence into v_persistence
    from pg_class where oid='public.nexus_v1510_content_triggers'::regclass;
  if v_persistence<>'p'::"char" then
    raise exception 'content trigger queue is not LOGGED';
  end if;
  select relpersistence into v_persistence
    from pg_class where oid='public.nexus_telegram_message_buffer'::regclass;
  if v_persistence<>'u'::"char" then
    raise exception 'closed legacy Telegram buffer persistence drifted';
  end if;
  if not exists(
    select 1 from pg_trigger
     where tgrelid='public.nexus_telegram_message_buffer'::regclass
       and tgname='trg_v420_legacy_buffer_closed'
       and not tgisinternal and tgenabled<>'D'
  ) then
    raise exception 'legacy Telegram buffer is not fail-closed';
  end if;
  if has_function_privilege(
       'anon','public.nexus_v1510_queue_content_trigger(text,text,text)','EXECUTE')
     or has_function_privilege(
       'authenticated','public.nexus_v1510_queue_content_trigger(text,text,text)','EXECUTE') then
    raise exception 'signed content trigger exposed to public roles';
  end if;
  if not exists(select 1 from cron.job
                 where jobid=60 and active and schedule='10 seconds'
                   and command='select public.nexus_v1510_flush_event(40);') then
    raise exception 'Job 60 pacing or command drifted';
  end if;
  if not exists(select 1 from public.nexus_v420_channel_routes
                 where channel_key='grupo_cliques' and enabled
                   and chat_id=-1004417007577)
     or not exists(select 1 from public.nexus_v420_channel_routes
                    where channel_key='atendimento' and enabled
                      and chat_id=-1003951454560)
     or (select chat_id from public.nexus_v420_channel_routes
          where channel_key='grupo_cliques')
        is not distinct from
        (select chat_id from public.nexus_v420_channel_routes
          where channel_key='atendimento') then
    raise exception 'CLIQUES/CAPTURA room separation drifted';
  end if;
end
$assert$;

commit;
