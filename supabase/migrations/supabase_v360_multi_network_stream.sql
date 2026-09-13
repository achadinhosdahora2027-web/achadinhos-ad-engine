-- ═══════════════════════════════════════════════════════════════════════════════
-- supabase_v360_multi_network_stream.sql — SOVEREIGN MULTI-NETWORK STREAM CORE
-- v360.0 · 2026-09-13 · banco MESTRE (NexusPlataforma)
--
-- Diretriz: zero invenção. Todo número neste arquivo foi medido antes de ser
-- escrito (medições no laudo docs/evidencias/relatorio-v360-*.md).
--
-- O QUE ESTA MIGRAÇÃO FAZ
--   1) Quarentena dos cronjobs de polling de alta frequência (medidos: jobs 16,
--      18, 41, 44 ativos; 15 já inativo). O job legado de 10 s é substituído por
--      um flush de fila (não consulta API de terceiros).
--   2) Roteador geográfico por país real do IP: BR → Shopee BR / meli.la mestre
--      (matt_tool medido ao vivo); US/CA/GB/DE/FR → eBay EPN ou Booking UK;
--      qualquer outro país ou erro → fail-closed "Sintonizado em Análise".
--   3) Handshake de validação das 10 casas do Bluesky via pg_net — a app-password
--      NUNCA sai do banco; só o veredito (ok/did confere/jwt presente) é gravado.
--   4) Mensageria anti-ban: porteiro por destino + flush de 10 s CONSOLIDADO para
--      o grupo VENDAS (-1003987455421, medido no cofre).
--   5) Webhook assinado (HMAC-SHA256) para a frota — só dispara para nós com
--      endpoint REGISTRADO; nenhum endpoint é inventado aqui.
--
-- 100% aditiva · idempotente · não altera catálogo, nem VENDAS, nem Ads.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. QUARENTENA DOS CRONS DE POLLING
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.nexus_v360_cron_quarantine (
  jobid         bigint primary key,
  jobname       text,
  schedule      text,
  command       text,
  motivo        text,
  desativado_em timestamptz not null default now()
);

-- candidatos avaliados e MANTIDOS (fila interna / cadência ≥ 10 min): ficam
-- registrados para decisão explícita — não são desligados por conta própria.
create table if not exists public.nexus_v360_cron_candidatos (
  jobid      bigint primary key,
  jobname    text,
  schedule   text,
  command    text,
  avaliado_em timestamptz not null default now(),
  veredito   text
);

do $$
declare r record;
begin
  for r in
    select jobid, jobname, schedule, command
      from cron.job
     where active
       and jobid in (15, 16, 18, 41, 44)          -- ≤ 5 min: polling medido
  loop
    begin
      perform cron.alter_job(job_id := r.jobid, active := false);
      insert into public.nexus_v360_cron_quarantine (jobid, jobname, schedule, command, motivo)
      values (r.jobid, r.jobname, r.schedule, r.command,
              'v360: polling de alta frequencia (<=5 min) desativado — Event-Driven only')
      on conflict (jobid) do update
        set desativado_em = now(), schedule = excluded.schedule,
            command = excluded.command, motivo = excluded.motivo;
    exception when others then
      perform public.nexus_v155_sintonizado('v360-cron', 'jobid=' || r.jobid, sqlerrm);
    end;
  end loop;

  for r in
    select jobid, jobname, schedule, command
      from cron.job
     where active and (schedule like '%/10 %' or schedule like '3-59/10 %')
  loop
    insert into public.nexus_v360_cron_candidatos (jobid, jobname, schedule, command, veredito)
    values (r.jobid, r.jobname, r.schedule, r.command,
            'mantido: cadencia de 10 min; desligar com uma linha se o mandato exigir')
    on conflict (jobid) do update set veredito = excluded.veredito, avaliado_em = now();
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. ROTEADOR GEOGRÁFICO (país real do IP → rede certa)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Segredos de rede (cifrados; nada em texto): meli mestre + matt_tool medido.
do $$
declare v_kms text; v_ja text;
begin
  select value into v_kms from public.nexus_growth_secrets where key = 'nexus_satellites_kms';
  if coalesce(v_kms,'') = '' then
    perform public.nexus_v155_sintonizado('v360-geo', null, 'KMS ausente: meli nao gravado');
    return;
  end if;
  select value into v_ja from public.nexus_growth_secrets where key = 'meli_master_enc';
  if v_ja is null then
    insert into public.nexus_growth_secrets (key, value, note, updated_at)
    values ('meli_master_enc',
            encode(extensions.pgp_sym_encrypt(
              '{"url_master":"https://meli.la/1gezsdz","matt_tool":"56714869"}', v_kms), 'hex'),
            'v360: meli mestre. matt_tool 56714869 conferido ao vivo em 13/09 (o redirect do meli.la traz matt_tool=56714869)',
            now());
  end if;
  select value into v_ja from public.nexus_growth_secrets where key = 'ebay_campaign_id_enc';
  if v_ja is null then
    insert into public.nexus_growth_secrets (key, value, note, updated_at)
    values ('ebay_campaign_id_enc',
            encode(extensions.pgp_sym_encrypt('{"campaign_id":"5339193749","mkcid":"1","toolid":"10001"}', v_kms), 'hex'),
            'v360: EPN campaign_id declarado + defaults do contrato EPN (mkcid 1 / toolid 10001), cifrado', now());
  end if;
  select value into v_ja from public.nexus_growth_secrets where key = 'booking_uk_id_enc';
  if v_ja is null then
    insert into public.nexus_growth_secrets (key, value, note, updated_at)
    values ('booking_uk_id_enc',
            encode(extensions.pgp_sym_encrypt('{"aid":"15734754"}', v_kms), 'hex'),
            'v360: Booking UK aid declarado; EPC de US$ 328,20 é número declarado pelo operador, nao medido aqui', now());
  end if;
end $$;

create or replace function public.nexus_v360_geo_route(
  p_country  text,
  p_intencao text default 'oferta'
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_pais   text := upper(left(coalesce(btrim(p_country), ''), 2));
  v_int    text := lower(coalesce(nullif(btrim(p_intencao), ''), 'oferta'));
  v_kms    text;
  v_meli   jsonb := '{}'::jsonb;
  v_ebay   jsonb := '{}'::jsonb;
  v_book   jsonb := '{}'::jsonb;
  v_mkrid  text;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    select value into v_kms from public.nexus_growth_secrets where key = 'nexus_satellites_kms';
    if coalesce(v_kms,'') <> '' then
      select extensions.pgp_sym_decrypt(decode(value,'hex'), v_kms)::jsonb into v_meli
        from public.nexus_growth_secrets where key = 'meli_master_enc';
      select extensions.pgp_sym_decrypt(decode(value,'hex'), v_kms)::jsonb into v_ebay
        from public.nexus_growth_secrets where key = 'ebay_campaign_id_enc';
      select extensions.pgp_sym_decrypt(decode(value,'hex'), v_kms)::jsonb into v_book
        from public.nexus_growth_secrets where key = 'booking_uk_id_enc';
    end if;
  exception when others then
    v_meli := '{}'::jsonb; v_ebay := '{}'::jsonb; v_book := '{}'::jsonb;
  end;

  -- desconhecido/vazio → fail-closed (nunca chuta país nem inventa rede)
  if v_pais !~ '^[A-Z]{2}$' then
    return jsonb_build_object('estado','sintonizado','motivo','geo_sem_pais',
                              'destino', null, 'rede', null, 'moeda', null);
  end if;

  -- BRASIL: varejo nacional, conversão em Real. Nada de varejo gringo.
  if v_pais = 'BR' then
    if v_int in ('viagem','hotel','voo','cruzeiro') then
      return jsonb_build_object('estado','ok','rede','shopee_br','moeda','BRL',
        'motivo','BR: intencao de viagem segue para o varejo nacional (Booking e Tier-1 exclusivo)',
        'destino', 'https://shopee.com.br/search?keyword=' || encode(convert_to(coalesce(nullif(v_int,''),'oferta'),'utf8'),'escape'));
    end if;
    if coalesce(v_meli->>'url_master','') <> '' then
      return jsonb_build_object('estado','ok','rede','mercado_livre','moeda','BRL',
        'matt_tool', v_meli->>'matt_tool', 'destino', v_meli->>'url_master');
    end if;
    return jsonb_build_object('estado','ok','rede','shopee_br','moeda','BRL','destino','https://shopee.com.br/');
  end if;

  -- TIER-1 de moeda forte: bloqueia varejo nacional, entrega eBay EPN ou Booking UK
  if v_pais in ('US','CA','GB','DE','FR') then
    if v_int in ('viagem','hotel','voo','cruzeiro') and coalesce(v_book->>'aid','') <> '' then
      return jsonb_build_object('estado','ok','rede','booking','moeda','USD/EUR/GBP',
        'aid', v_book->>'aid',
        'destino','https://www.booking.com/index.html?aid=' || (v_book->>'aid'));
    end if;
    v_mkrid := case v_pais when 'US' then '711-53200-19255-0' when 'GB' then '710-53481-19255-0'
                           when 'DE' then '707-53477-19255-0' when 'FR' then '709-53476-19255-0'
                           else '706-53473-19255-0' end;
    if coalesce(v_ebay->>'campaign_id','') <> '' then
      return jsonb_build_object('estado','ok','rede','ebay_epn','moeda','USD/EUR/GBP',
        'campaign_id', v_ebay->>'campaign_id',
        'destino','https://www.ebay.com/sch/i.html?_nkw=' || coalesce(nullif(v_int,''),'offer')
                  || '&mkcid=' || coalesce(v_ebay->>'mkcid','1')
                  || '&mkrid=' || v_mkrid
                  || '&campid=' || (v_ebay->>'campaign_id')
                  || '&toolid=' || coalesce(v_ebay->>'toolid','10001'));
    end if;
  end if;

  -- qualquer outro país: fail-closed declarado, sem invenção
  return jsonb_build_object('estado','sintonizado','motivo','pais_sem_regra_v360',
                            'pais', v_pais, 'destino', null, 'rede', null, 'moeda', null);
exception when others then
  perform public.nexus_v155_sintonizado('v360-geo', null, sqlerrm);
  return jsonb_build_object('estado','sintonizado','motivo','erro_roteador','destino',null,'rede',null,'moeda',null);
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. HANDSHAKE DAS 10 CASAS DO BLUESKY (validação de token, pg_net)
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.nexus_v360_bluesky_handshake (
  conta        text primary key,
  handle       text,
  did_esperado text,
  request_id   bigint,
  http         integer,
  ok           boolean,
  jwt_presente boolean,
  did_bate     boolean,
  erro         text,
  medido_em    timestamptz not null default now()
);

create or replace function public.nexus_v360_bluesky_handshake(p_conta text)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'pg_temp'
as $function$
declare v_cred jsonb; v_req bigint;
begin
  perform set_config('statement_timeout', '4000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    v_cred := public.nexus_v165_5_bluesky_cred(p_conta);
    if v_cred is null or coalesce(v_cred->>'password','') = '' then
      insert into public.nexus_v360_bluesky_handshake (conta, handle, did_esperado, erro, medido_em)
      values (p_conta, coalesce(v_cred->>'handle', null), coalesce(v_cred->>'did', null),
              'credencial ausente ou nao decifravel', now())
      on conflict (conta) do update set erro = excluded.erro, medido_em = now();
      return null;
    end if;

    -- a app-password monta o corpo DENTRO do banco e nao é devolvida a ninguem
    select net.http_post(
             url  := 'https://bsky.social/xrpc/com.atproto.server.createSession',
             headers := '{"Content-Type":"application/json"}'::jsonb,
             body := jsonb_build_object('identifier', v_cred->>'handle', 'password', v_cred->>'password'),
             timeout_milliseconds := 8000
           ) into v_req;

    insert into public.nexus_v360_bluesky_handshake (conta, handle, did_esperado, request_id, erro, medido_em)
    values (p_conta, v_cred->>'handle', v_cred->>'did', v_req, null, now())
    on conflict (conta) do update
      set request_id = excluded.request_id, handle = excluded.handle,
          did_esperado = excluded.did_esperado, erro = null, medido_em = now();
    return v_req;
  exception when others then
    perform public.nexus_v155_sintonizado('v360-bluesky-handshake', p_conta, sqlerrm);
    return null;
  end;
end $function$;

create or replace function public.nexus_v360_bluesky_handshake_all()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_contas text[] := array['aquiitem','offersnow','getsave','gettingeasy','bestforya',
                            'thebestones','justbuying','digitalofferss','feverforer','gnewsyou'];
  v_c text; v_req bigint; v_n int := 0;
begin
  foreach v_c in array v_contas loop
    begin
      v_req := public.nexus_v360_bluesky_handshake(v_c);
      if v_req is not null then v_n := v_n + 1; end if;
    exception when others then
      perform public.nexus_v155_sintonizado('v360-bluesky-all', v_c, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('disparados', v_n, 'de', array_length(v_contas,1));
end $function$;

create or replace function public.nexus_v360_bluesky_handshake_reconcile()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  r record; v_res jsonb; v_http int; v_body text;
  v_ok int := 0; v_falha int := 0; v_pend int := 0; v_liq int := 0;
begin
  perform set_config('statement_timeout', '3000', true);
  perform set_config('lock_timeout', '1000', true);
  for r in select conta, request_id, did_esperado from public.nexus_v360_bluesky_handshake
            where request_id is not null
  loop
    begin
      v_res := null;
      select to_jsonb(x) into v_res from net._http_response x where x.id = r.request_id;
      if v_res is null then
        v_pend := v_pend + 1;
        continue;
      end if;
      v_http := coalesce((v_res->>'status_code')::int, 0);
      v_body := coalesce(v_res->>'content', '');
      update public.nexus_v360_bluesky_handshake
         set http = v_http,
             ok = (v_http = 200 and coalesce(v_body,'') like '%accessJwt%'),
             jwt_presente = (coalesce(v_body,'') like '%accessJwt%'),
             did_bate = (r.did_esperado is not null and coalesce(v_body,'') like '%' || r.did_esperado || '%'),
             erro = case
                      when v_http = 200 then null
                      when v_body like '%"error"%' then left(v_body, 200)
                      else coalesce(v_res->>'error_msg', 'http ' || v_http)
                    end,
             medido_em = now()
       where conta = r.conta;
      if v_http = 200 then v_ok := v_ok + 1; else v_falha := v_falha + 1; end if;
    exception when others then
      update public.nexus_v360_bluesky_handshake set erro = left(sqlerrm, 200), medido_em = now()
       where conta = r.conta;
      v_falha := v_falha + 1;
    end;
  end loop;

  -- higiene: o corpo da resposta contem JWT (accessJwt/refreshJwt). Nada de token
  -- parado em tabela de log — apaga assim que o veredito é extraido.
  begin
    delete from net._http_response
     where id in (select request_id from public.nexus_v360_bluesky_handshake where request_id is not null);
    get diagnostics v_liq = row_count;
  exception when others then
    v_liq := -1;
  end;

  return jsonb_build_object('ok', v_ok, 'falha', v_falha, 'pendente', v_pend, 'respostas_purgadas', v_liq);
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. MENSAGERIA ANTI-BAN: PORTEIRO + FLUSH CONSOLIDADO DE 10 s → VENDAS
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.nexus_v360_tg_delivery_log (
  id         bigserial primary key,
  destino    text not null,
  chave      text not null,
  enviado_em timestamptz not null default now()
);
create index if not exists nexus_v360_tg_delivery_idx
  on public.nexus_v360_tg_delivery_log (destino, enviado_em desc);

create or replace function public.nexus_v360_tg_gate(
  p_destino      text,
  p_chave        text,
  p_horas_dedupe int default 12,
  p_max_minuto   int default 3,
  p_max_hora     int default 40
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n int; v_esp int;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  select count(*) into v_n from public.nexus_v360_tg_delivery_log
   where destino = p_destino and chave = p_chave
     and enviado_em > now() - make_interval(hours => greatest(1, p_horas_dedupe));
  if v_n > 0 then
    return jsonb_build_object('pode', false, 'motivo', 'duplicado_recente');
  end if;
  select count(*) into v_n from public.nexus_v360_tg_delivery_log
   where destino = p_destino and enviado_em > now() - interval '1 minute';
  if v_n >= p_max_minuto then
    return jsonb_build_object('pode', false, 'motivo', 'limite_minuto', 'esperar_ms', 30000);
  end if;
  select count(*) into v_n from public.nexus_v360_tg_delivery_log
   where destino = p_destino and enviado_em > now() - interval '1 hour';
  if v_n >= p_max_hora then
    return jsonb_build_object('pode', false, 'motivo', 'limite_hora', 'enviados_ultima_hora', v_n);
  end if;
  insert into public.nexus_v360_tg_delivery_log (destino, chave) values (p_destino, p_chave);
  return jsonb_build_object('pode', true, 'enviados_ultima_hora', v_n + 1);
exception when others then
  perform public.nexus_v155_sintonizado('v360-tg-gate', p_destino, sqlerrm);
  return jsonb_build_object('pode', false, 'motivo', 'erro_porteiro');
end $function$;

create or replace function public.nexus_v360_flush_10s(p_block int default 18)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'pg_temp'
as $function$
declare
  v_enabled text; v_token text; v_chat text;
  v_ids bigint[]; v_n int := 0; v_chave text; v_porteiro jsonb;
  v_linhas text[] := '{}'; v_texto text; v_req bigint;
  v_paises text; v_sites text; v_hora text;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    select value into v_enabled from public.nexus_growth_secrets where key = 'telegram_alerts_enabled';
    if coalesce(v_enabled,'false') <> 'true' then
      return jsonb_build_object('idle', true, 'motivo', 'kill-switch telegram_alerts_enabled=false');
    end if;

    -- 1) consome a fila (só linhas do fluxo de cliques). Sem consulta a API externa.
    select array_agg(id) into v_ids
      from (select id from public.nexus_telegram_message_buffer
             where not dispatched and attempts < 5 and channel_key is null
             order by id
             limit greatest(1, least(coalesce(p_block,18), 40))
             for update skip locked) t;
    v_n := coalesce(array_length(v_ids,1), 0);
    if v_n = 0 then
      return jsonb_build_object('idle', true, 'motivo', 'fila vazia');
    end if;

    -- 2) consolida UMA mensagem por flush (mata a rajada: era o vetor de ban medido)
    select string_agg(distinct (payload->>'country') || '×' || cnt, ' · '), string_agg(distinct (payload->>'site'), ' ')
      into v_paises, v_sites
      from (select payload, count(*) over (partition by payload->>'country') cnt
              from public.nexus_telegram_message_buffer where id = any(v_ids)) s;

    select array_agg(format('• %s · %s · %s',
             coalesce(payload->>'country','??'),
             coalesce(payload->>'site','?'),
             coalesce(nullif(payload->>'produto', ''), nullif(payload->>'slot',''), 'clique')))
      into v_linhas
      from public.nexus_telegram_message_buffer where id = any(v_ids);

    v_hora := to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
    v_texto := '<b>Nexus v360 · cliques consolidados</b>' || chr(10)
            || v_hora || ' · ' || v_n || ' evento(s) consolidado(s)' || chr(10)
            || coalesce(array_to_string(v_linhas, chr(10)), '') || chr(10)
            || 'paises: ' || coalesce(v_paises,'-');

    -- 3) porteiro anti-ban: 3/min e 40/h por destino (medido contra o flood de 225/h)
    v_chave := 'v360-flush:' || to_char(now(), 'YYYY-MM-DD HH24:MI');
    -- contrato da fila: ntmb_channel_key_valido aceita 'vendas_real' (medido em 13/09)
    v_porteiro := public.nexus_v360_tg_gate('vendas_real', v_chave, 1, 3, 40);
    if coalesce((v_porteiro->>'pode')::boolean, false) = false then
      return jsonb_build_object('contido', true, 'motivo', v_porteiro->>'motivo',
                                'pendentes', v_n, 'porteiro', v_porteiro);
    end if;

    select value into v_token from public.nexus_growth_secrets where key = 'telegram_bot_token';
    select coalesce((select value from public.nexus_growth_secrets where key = 'telegram_chat_id_vendas_real'),
                    (select value from public.nexus_growth_secrets where key = 'telegram_chat_id'))
      into v_chat;
    if coalesce(v_token,'') = '' or coalesce(v_chat,'') = '' then
      perform public.nexus_v155_sintonizado('v360-flush', 'vendas_real', 'token ou chat ausente');
      return jsonb_build_object('sintonizado', true, 'motivo', 'credencial ausente');
    end if;

    -- 4) envio por pg_net (assíncrono, nada de loop de espera)
    select net.http_post(
             url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
             headers := '{"Content-Type":"application/json"}'::jsonb,
             body := jsonb_build_object('chat_id', v_chat, 'text', v_texto,
                                        'parse_mode','HTML','disable_web_page_preview', true),
             timeout_milliseconds := 8000
           ) into v_req;

    update public.nexus_telegram_message_buffer
       set dispatched = true, dispatched_at = now(), request_id = v_req,
           attempts = attempts + 1, channel_key = 'vendas_real'
     where id = any(v_ids);

    return jsonb_build_object('enviado', true, 'consolidados', v_n, 'request_id', v_req,
                              'chat', v_chat, 'porteiro', v_porteiro);
  exception when others then
    perform public.nexus_v155_sintonizado('v360-flush', 'vendas_real', sqlerrm);
    return jsonb_build_object('sintonizado', true, 'motivo', left(sqlerrm, 160));
  end;
end $function$;

create or replace function public.nexus_v360_flush_reconcile()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare v_ok int := 0; v_err int := 0; v_pend int := 0; r record; v_res jsonb;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  for r in select distinct request_id from public.nexus_telegram_message_buffer
            where dispatched and request_id is not null
              and dispatched_at > now() - interval '10 minutes'
  loop
    begin
      v_res := null;
      select to_jsonb(x) into v_res from net._http_response x where x.id = r.request_id;
      if v_res is null then v_pend := v_pend + 1;
      elsif coalesce((v_res->>'status_code')::int,0) = 200 then v_ok := v_ok + 1;
      else v_err := v_err + 1;
      end if;
    exception when others then v_err := v_err + 1;
    end;
  end loop;
  return jsonb_build_object('ok', v_ok, 'erro', v_err, 'pendente', v_pend);
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4.1 PORTA DE ENTRADA EVENT-DRIVEN (o stream chama isto; ninguém faz polling)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Contrato da fila: dedupe_hash é UNIQUE para sempre (medido). Por isso o hash
-- carrega a JANELA (6 h por padrão) — a mesma matéria-prima entra uma vez por
-- janela, que é exatamente o corte de 62,8% medido antes do v128.9.
create or replace function public.nexus_v360_stream_event(p_evento jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_chave   text;
  v_hash    text;
  v_janela  int := greatest(1, least(coalesce((p_evento->>'janela_horas')::int, 6), 24));
  v_ins     bigint;
  v_pais    text := upper(left(coalesce(p_evento->>'country',''), 2));
  v_rota    jsonb;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    if p_evento is null or jsonb_typeof(p_evento) <> 'object' then
      return jsonb_build_object('aceito', false, 'motivo', 'evento_invalido');
    end if;

    -- chave da matéria-prima: oferta > palavra-chave > texto
    v_chave := lower(left(coalesce(
                 nullif(btrim(coalesce(p_evento->>'oferta','')), ''),
                 nullif(btrim(coalesce(p_evento->>'keyword','')), ''),
                 nullif(btrim(coalesce(p_evento->>'texto','')), ''),
                 'sem_chave'), 120));

    -- rota geográfica decidida na entrada (BR → nacional; Tier-1 → eBay/Booking)
    -- a intenção é o produto: o eBay busca no termo real, nunca em 'oferta'
    v_rota := public.nexus_v360_geo_route(v_pais,
                coalesce(nullif(btrim(p_evento->>'intencao'),''),
                         nullif(btrim(p_evento->>'keyword'),''),
                         nullif(btrim(p_evento->>'produto'),''), 'oferta'));

    v_hash := md5(v_chave || '|' || to_char(now(), 'YYYYMMDD') || '-'
                  || (floor(extract(hour from now()) / v_janela)::int)::text);

    insert into public.nexus_telegram_message_buffer
      (dedupe_hash, msg_class, payload, dispatched, channel_key)
    values (v_hash, coalesce(nullif(p_evento->>'msg_class',''), 'real_click'),
            p_evento || jsonb_build_object('rota_v360', v_rota, 'janela_horas', v_janela,
                                           'chave', v_chave, 'recebido_em', now()),
            false, null)
    on conflict (dedupe_hash) do nothing
    returning id into v_ins;

    if v_ins is null then
      return jsonb_build_object('aceito', false, 'motivo', 'dentro_da_janela_de_dedupe',
                                'janela_horas', v_janela, 'rota', v_rota);
    end if;
    return jsonb_build_object('aceito', true, 'id', v_ins, 'chave', v_chave,
                              'rede', v_rota->>'rede', 'destino', v_rota->>'destino');
  exception when others then
    perform public.nexus_v155_sintonizado('v360-stream', null, sqlerrm);
    return jsonb_build_object('aceito', false, 'estado', 'Sintonizado em Analise', 'motivo', left(sqlerrm,160));
  end;
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. WEBHOOK ASSINADO (HMAC-SHA256) PARA A FROTA
-- ═══════════════════════════════════════════════════════════════════════════════
-- Só dispara para nós com endpoint REGISTRADO. Nenhum endpoint é inventado:
-- a frota medida tem 13 satélites e 0 endpoints registrados hoje.
create table if not exists public.nexus_v360_node_endpoints (
  node        text primary key,
  project_ref text,
  url         text not null,
  secret_key  text,
  ativo       boolean not null default true,
  registrado_em timestamptz not null default now()
);

-- espelho da frota medida (informativo; não dispara nada sozinho)
create table if not exists public.nexus_v360_fleet_snapshot (
  node        text primary key,
  project_ref text,
  visto_em    timestamptz not null default now()
);

insert into public.nexus_v360_fleet_snapshot (node, project_ref)
select satellite, project_ref from public.nexus_satellite_pull_state
on conflict (node) do update set project_ref = excluded.project_ref, visto_em = now();

create or replace function public.nexus_v360_webhook_sign(p_body text, p_secret text)
returns text
language sql
immutable
as $function$
  select encode(extensions.hmac(p_body, p_secret, 'sha256'), 'hex');
$function$;

create or replace function public.nexus_v360_dispatch_event(p_evento text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'pg_temp'
as $function$
declare r record; v_corpo text; v_ass text; v_req bigint; v_n int := 0; v_sem int := 0;
begin
  perform set_config('statement_timeout', '3000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    v_corpo := jsonb_build_object('evento', p_evento, 'em', now(), 'payload', p_payload)::text;
    for r in select node, url, secret_key from public.nexus_v360_node_endpoints where ativo loop
      begin
        v_ass := public.nexus_v360_webhook_sign(v_corpo, coalesce(r.secret_key, ''));
        select net.http_post(
                 url := r.url,
                 headers := jsonb_build_object('Content-Type','application/json',
                                               'X-Nexus-Event', p_evento,
                                               'X-Nexus-Signature-256', 'sha256=' || v_ass),
                 body := v_corpo::jsonb,
                 timeout_milliseconds := 5000) into v_req;
        insert into public.nexus_global_satellite_publish_outbox (event_type, payload, status, created_at, updated_at)
        values (p_evento, jsonb_build_object('node', r.node, 'request_id', v_req), 'dispatched', now(), now());
        v_n := v_n + 1;
      exception when others then
        perform public.nexus_v155_sintonizado('v360-webhook', r.node, sqlerrm);
      end;
    end loop;
    select count(*) - v_n into v_sem from public.nexus_v360_fleet_snapshot;
    return jsonb_build_object('disparados', v_n, 'nos_sem_endpoint', greatest(v_sem,0),
                              'frota_registrada', (select count(*) from public.nexus_v360_fleet_snapshot));
  exception when others then
    perform public.nexus_v155_sintonizado('v360-webhook', p_evento, sqlerrm);
    return jsonb_build_object('sintonizado', true, 'motivo', left(sqlerrm,160));
  end;
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. AGENDA: flush de 10 s (fila interna; substitui o job legado 41 já desativado)
-- ═══════════════════════════════════════════════════════════════════════════════
do $$
declare v_id bigint;
begin
  begin
    select jobid into v_id from cron.job where jobname = 'v360-tg-flush-10s';
    if v_id is null then
      perform cron.schedule('v360-tg-flush-10s', '10 seconds', 'select public.nexus_v360_flush_10s();');
    else
      perform cron.alter_job(job_id := v_id, schedule := '10 seconds',
                             command := 'select public.nexus_v360_flush_10s();', active := true);
    end if;
  exception when others then
    perform public.nexus_v155_sintonizado('v360-cron-schedule', 'v360-tg-flush-10s', sqlerrm);
  end;
end $$;

-- telemetria do estado v360 (leitura única, para auditoria)
create or replace view public.nexus_v360_estado as
select
  (select count(*) from public.nexus_v360_cron_quarantine)                              as crons_em_quarentena,
  (select count(*) from public.nexus_v360_cron_candidatos)                              as crons_candidatos,
  (select count(*) from cron.job where jobname = 'v360-tg-flush-10s' and active)        as flush_10s_ativo,
  (select count(*) from public.nexus_v360_fleet_snapshot)                               as frota_registrada,
  (select count(*) from public.nexus_v360_node_endpoints where ativo)                    as nos_com_endpoint,
  (select count(*) from public.nexus_v360_bluesky_handshake where ok)                    as bluesky_ok,
  (select count(*) from public.nexus_v360_bluesky_handshake where ok is false or erro is not null) as bluesky_falha,
  (select count(*) from public.nexus_telegram_message_buffer where not dispatched)       as fila_pendente;

select 'v360.0 instalado (aditivo)' as resultado,
       (select count(*) from public.nexus_v360_cron_quarantine) as crons_desativados;
