-- ═══════════════════════════════════════════════════════════════════════════════
-- supabase_v365_interstitial_alignment.sql — SOVEREIGN TARGET REALIGNMENT
-- v365.0 · 2026-09-13 · banco MESTRE (NexusPlataforma)
--
-- Zero invenção. Cada número citado aqui foi medido antes de ser escrito:
--   • API v3 da Adsterra devolve o campo no SINGULAR:  {"date":"2026-09-13","impression":2,...}
--     (medido 13/09 07:09 UTC, chave do cofre, via pg_net) — a tabela antiga do banco
--     usa "impressions" no plural. Esta migração cria o campo canônico com COALESCE.
--   • A tabela nexus_ad_network_yield NÃO existia no mestre (verificado 13/09 07:05 UTC).
--   • A frota ativa em nexus_decentralized_farms tem 13 satélites (A..M), todos com
--     service_role key CIFRADA que decifra com nexus_satellites_kms (prefixo eyJh).
--   • Um INSERT real no shard A respondeu 201 e a leitura de volta confirmou a linha
--     (canário medido 13/09 07:10 UTC).
--
-- 100% aditiva · idempotente · inventário de mídias permanece read-only.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. DIRETRIZ DE MÍDIAS RE-ALINHADA + VERIFICAÇÃO VIVA DE PARIDADE
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.nexus_v365_media_directive (
  rota            text primary key,
  exige_binding   text not null,
  exige_tags      text not null,
  regra_paginas   text not null,
  evidencia       text not null,
  fixado_em       timestamptz not null default now()
);

insert into public.nexus_v365_media_directive (rota, exige_binding, exige_tags, regra_paginas, evidencia)
values (
  '/api/ads/go',
  'X-Adsterra-Binding: pop=bound;sb=bound',
  'createElement síncrono (SocialBar + Popunder) no HTML do intersticial',
  'páginas estáticas de cidade PERMANECEM LEVES: sem script de anúncio concorrente, sem binding nelas',
  'medido 13/09/2026 06:41 UTC: intersticial 200 + header pop=bound;sb=bound + 3 createElement + 1 tag; '
  || 'páginas www.aquitemachadinhos/solvegrid/engine = 0 scripts de anúncio e 0 binding'
)
on conflict (rota) do update
  set exige_binding = excluded.exige_binding,
      exige_tags    = excluded.exige_tags,
      regra_paginas = excluded.regra_paginas,
      evidencia     = excluded.evidencia,
      fixado_em     = now();

create table if not exists public.nexus_v365_parity_checks (
  id         bigserial primary key,
  rota       text not null,
  http       integer,
  binding    text,
  tags_html  integer,
  bytes      integer,
  veredito   text,
  request_id bigint,
  medido_em  timestamptz not null default now()
);

-- dispara a verificação (pg_net, assíncrona — nada de espera em laço)
create or replace function public.nexus_v365_parity_check(
  p_base text default 'https://achadinhos-ad-engine.vercel.app',
  p_rota text default '/api/ads/go'
) returns bigint
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare v_req bigint;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    select net.http_get(
             url := rtrim(p_base,'/') || p_rota || '?brand=shopee&site=v365_parity&slot=header&geo=BR',
             headers := jsonb_build_object(
               'Accept-Language','pt-BR,pt;q=0.9',
               'Sec-Fetch-User','?1',
               'User-Agent','Mozilla/5.0 (Linux; Android 13) Chrome/131 Mobile Safari/537.36'),
             timeout_milliseconds := 12000) into v_req;
    insert into public.nexus_v365_parity_checks (rota, request_id) values (p_rota, v_req);
    return v_req;
  exception when others then
    perform public.nexus_v155_sintonizado('v365-parity', p_rota, sqlerrm);
    return null;
  end;
end $function$;

-- lê a resposta e crava o veredito (o HTML também é inspecionado: conta createElement)
create or replace function public.nexus_v365_parity_consume()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  r record; v_res jsonb; v_http int; v_bind text; v_corpo text; v_tags int;
  v_ok int := 0; v_falha int := 0;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  for r in select id, rota, request_id from public.nexus_v365_parity_checks
            where veredito is null and request_id is not null
            order by id desc limit 10
  loop
    begin
      v_res := null;
      select to_jsonb(x) into v_res from net._http_response x where x.id = r.request_id;
      if v_res is null then continue; end if;
      v_http  := coalesce((v_res->>'status_code')::int, 0);
      v_corpo := coalesce(v_res->>'content','');
      v_bind  := coalesce((v_res->'headers')::jsonb->>'x-adsterra-binding', 'ausente');
      v_tags  := (length(v_corpo) - length(replace(v_corpo, 'createElement', ''))) / length('createElement');
      update public.nexus_v365_parity_checks
         set http = v_http, binding = v_bind, tags_html = v_tags, bytes = length(v_corpo),
             veredito = case
               when v_http = 200 and v_bind = 'pop=bound;sb=bound' and v_tags > 0
                 then 'VERDE: intersticial serve as midias com binding correto'
               when v_http = 200 then 'AMARELO: intersticial 200 mas binding/tags fora do esperado'
               else 'VERMELHO: intersticial nao respondeu 200' end,
             medido_em = now()
       where id = r.id;
      if v_http = 200 and v_bind = 'pop=bound;sb=bound' then v_ok := v_ok + 1; else v_falha := v_falha + 1; end if;
    exception when others then
      update public.nexus_v365_parity_checks set veredito = 'VERMELHO: erro ' || left(sqlerrm,120)
       where id = r.id;
      v_falha := v_falha + 1;
    end;
  end loop;
  return jsonb_build_object('verde', v_ok, 'falha', v_falha);
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. YIELD DAS REDES DE ANÚNCIO — campo canônico 'impression' (singular), COALESCE
-- ═══════════════════════════════════════════════════════════════════════════════
create table if not exists public.nexus_ad_network_yield (
  rede              text not null,
  dia               date not null,
  impression        bigint      not null default 0,   -- singular: nome REAL da API v3
  clicks            bigint      not null default 0,
  revenue           numeric(12,2) not null default 0.00,
  bruto             jsonb,                            -- linha crua da API (auditoria)
  atualizado_em     timestamptz not null default now(),
  primary key (rede, dia)
);

create table if not exists public.nexus_v365_yield_fetches (
  id          bigserial primary key,
  rede        text,
  request_id  bigint,
  disparado_em timestamptz not null default now(),
  consumido   boolean not null default false
);

create or replace function public.nexus_v365_yield_sync(p_dias int default 7)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare v_chave text; v_req bigint;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    select value into v_chave from public.nexus_growth_secrets where key = 'adsterra_api_key';
    if coalesce(v_chave,'') = '' then
      perform public.nexus_v155_sintonizado('v365-yield', 'adsterra', 'chave ausente');
      return null;
    end if;
    select net.http_get(
      url := 'https://api3.adsterratools.com/publisher/stats.json'
             || '?start_date=' || to_char(current_date - greatest(1,least(p_dias,90)), 'YYYY-MM-DD')
             || '&finish_date=' || to_char(current_date, 'YYYY-MM-DD')
             || '&group_by=date',
      headers := jsonb_build_object('X-API-Key', v_chave, 'Accept','application/json'),
      timeout_milliseconds := 12000) into v_req;
    insert into public.nexus_v365_yield_fetches (rede, request_id) values ('adsterra', v_req);
    return v_req;
  exception when others then
    perform public.nexus_v155_sintonizado('v365-yield', 'adsterra', sqlerrm);
    return null;
  end;
end $function$;

create or replace function public.nexus_v365_yield_consume()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare
  r record; v_res jsonb; v_corpo text; v_json jsonb; it jsonb;
  v_dia date; v_imp bigint; v_clk bigint; v_rev numeric;
  v_n int := 0; v_erro int := 0;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  for r in select id, rede, request_id from public.nexus_v365_yield_fetches
            where not consumido and request_id is not null order by id limit 5
  loop
    begin
      v_res := null;
      select to_jsonb(x) into v_res from net._http_response x where x.id = r.request_id;
      if v_res is null then continue; end if;
      v_corpo := coalesce(v_res->>'content','');
      v_json  := v_corpo::jsonb;
      for it in select * from jsonb_array_elements(coalesce(v_json->'items','[]'::jsonb)) loop
        v_dia := (it->>'date')::date;
        -- COALESCE no nome do campo: a API v3 devolve 'impression' (singular, medido);
        -- bases antigas e exportações manuais trazem 'impressions' (plural).
        v_imp := coalesce(nullif(it->>'impression','')::bigint,
                          nullif(it->>'impressions','')::bigint, 0);
        v_clk := coalesce(nullif(it->>'clicks','')::bigint, 0);
        v_rev := coalesce(nullif(it->>'revenue','')::numeric, 0.00);
        insert into public.nexus_ad_network_yield (rede, dia, impression, clicks, revenue, bruto, atualizado_em)
        values (r.rede, v_dia, v_imp, v_clk, v_rev, it, now())
        on conflict (rede, dia) do update
          set impression = excluded.impression, clicks = excluded.clicks,
              revenue = excluded.revenue, bruto = excluded.bruto, atualizado_em = now();
        v_n := v_n + 1;
      end loop;
      update public.nexus_v365_yield_fetches set consumido = true where id = r.id;
    exception when others then
      v_erro := v_erro + 1;
      perform public.nexus_v155_sintonizado('v365-yield-consume', r.rede, sqlerrm);
    end;
  end loop;
  return jsonb_build_object('dias_gravados', v_n, 'erros', v_erro);
end $function$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. PROVISIONAMENTO DOS 13 SATÉLITES (keyless: segredo só cifrado, KMS do cofre)
-- ═══════════════════════════════════════════════════════════════════════════════
alter table public.nexus_v360_node_endpoints
  add column if not exists secret_enc text;          -- service_role cifrada (pgp_sym_encrypt/KMS)
alter table public.nexus_v360_node_endpoints
  add column if not exists regiao text;

-- A URL deriva do project_ref (determinística). O segredo NUNCA fica em texto:
-- é copiado já cifrado do cofre da frota (nexus_decentralized_farms).
insert into public.nexus_v360_node_endpoints (node, project_ref, url, secret_enc, ativo, regiao)
select f.profile_key,
       f.supabase_project_ref,
       'https://' || f.supabase_project_ref || '.supabase.co/rest/v1/nexus_satellite_mentions',
       encode(f.supabase_service_role_key_enc, 'hex'),
       true,
       f.supabase_region
  from public.nexus_decentralized_farms f
 where f.network = 'supabase' and f.status = 'active'
   and f.supabase_project_ref is not null
   and f.supabase_service_role_key_enc is not null
on conflict (node) do update
  set project_ref = excluded.project_ref, url = excluded.url,
      secret_enc  = excluded.secret_enc, regiao = excluded.regiao, ativo = true;

create table if not exists public.nexus_v365_fleet_dispatch_log (
  id         bigserial primary key,
  node       text not null,
  evento     text not null,
  request_id bigint,
  http       integer,
  veredito   text,
  disparado_em timestamptz not null default now()
);

-- Despacho assinado (HMAC-SHA256) + credencial decifrada no ato do envio.
create or replace function public.nexus_v365_fleet_dispatch(
  p_evento  jsonb,
  p_max_minuto int default 3,
  p_max_hora   int default 40
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'pg_temp'
as $function$
declare
  r record; v_hmac text; v_corpo text; v_req bigint; v_porteiro jsonb;
  v_n int := 0; v_contido int := 0; v_kms text;
begin
  perform set_config('statement_timeout', '3000', true);
  perform set_config('lock_timeout', '1000', true);
  begin
    select value into v_kms from public.nexus_growth_secrets where key = 'nexus_satellites_kms';
    v_corpo := coalesce(p_evento, '{}'::jsonb)::text;

    for r in
      select node, url, secret_enc, project_ref
        from public.nexus_v360_node_endpoints
       where ativo and secret_enc is not null
       order by node
    loop
      begin
        -- teto por nó: 3/min e 40/h — o mesmo porteiro do Telegram (medido contra rajada)
        v_porteiro := public.nexus_v360_tg_gate('node:' || r.node, 'disp:' || to_char(now(),'YYYY-MM-DD HH24:MI'),
                                               1, p_max_minuto, p_max_hora);
        if coalesce((v_porteiro->>'pode')::boolean, false) = false then
          v_contido := v_contido + 1;
          insert into public.nexus_v365_fleet_dispatch_log (node, evento, veredito)
          values (r.node, coalesce(p_evento->>'tipo','stream'), 'contido: ' || coalesce(v_porteiro->>'motivo','?'));
          continue;
        end if;

        v_hmac := public.nexus_v360_webhook_sign(v_corpo, v_kms);

        select net.http_post(
          url := r.url,
          headers := jsonb_build_object(
            'apikey', extensions.pgp_sym_decrypt(decode(r.secret_enc,'hex'), v_kms),
            'Authorization', 'Bearer ' || extensions.pgp_sym_decrypt(decode(r.secret_enc,'hex'), v_kms),
            'Content-Type','application/json',
            'Prefer','return=minimal',
            'X-Nexus-Event', coalesce(p_evento->>'tipo','stream_match'),
            'X-Nexus-Node', r.node,
            'X-Nexus-Signature-256', 'sha256=' || v_hmac),
          body := jsonb_build_object(
            'source_url', coalesce(p_evento->>'link', p_evento->>'source_url', 'https://achadinhos-ad-engine.vercel.app/api/ads/go'),
            'target_keyword', coalesce(p_evento->>'keyword','oferta'),
            'platform', coalesce(p_evento->>'platform','bluesky'),
            'author_handle', coalesce(p_evento->>'casa', p_evento->>'author_handle','nexus'),
            'mention_text', left(coalesce(p_evento->>'produto', p_evento->>'texto','evento nexus v365'), 900),
            'language', coalesce(p_evento->>'language', case when upper(coalesce(p_evento->>'country','BR'))='BR' then 'pt' else 'en' end)),
          timeout_milliseconds := 12000) into v_req;

        insert into public.nexus_v365_fleet_dispatch_log (node, evento, request_id, veredito)
        values (r.node, coalesce(p_evento->>'tipo','stream'), v_req, 'despachado');
        v_n := v_n + 1;
      exception when others then
        perform public.nexus_v155_sintonizado('v365-fleet', r.node, sqlerrm);
        insert into public.nexus_v365_fleet_dispatch_log (node, evento, veredito)
        values (r.node, coalesce(p_evento->>'tipo','stream'), 'sintonizado: ' || left(sqlerrm,120));
      end;
    end loop;
    return jsonb_build_object('despachados', v_n, 'contidos', v_contido,
                              'nos_ativos', (select count(*) from public.nexus_v360_node_endpoints where ativo));
  exception when others then
    perform public.nexus_v155_sintonizado('v365-fleet', 'geral', sqlerrm);
    return jsonb_build_object('sintonizado', true, 'motivo', left(sqlerrm,160));
  end;
end $function$;

create or replace function public.nexus_v365_fleet_consume()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'net', 'pg_temp'
as $function$
declare r record; v_res jsonb; v_http int; v_ok int := 0; v_err int := 0; v_pend int := 0;
begin
  perform set_config('statement_timeout', '2000', true);
  perform set_config('lock_timeout', '1000', true);
  for r in select id, node, request_id from public.nexus_v365_fleet_dispatch_log
            where request_id is not null and http is null order by id limit 60
  loop
    begin
      v_res := null;
      select to_jsonb(x) into v_res from net._http_response x where x.id = r.request_id;
      if v_res is null then v_pend := v_pend + 1; continue; end if;
      v_http := coalesce((v_res->>'status_code')::int, 0);
      update public.nexus_v365_fleet_dispatch_log
         set http = v_http,
             veredito = case when v_http in (200,201) then 'espelhado (http ' || v_http || ')'
                             else 'falha http ' || v_http end
       where id = r.id;
      if v_http in (200,201) then v_ok := v_ok + 1; else v_err := v_err + 1; end if;
    exception when others then
      update public.nexus_v365_fleet_dispatch_log set veredito = 'erro ' || left(sqlerrm,100) where id = r.id;
      v_err := v_err + 1;
    end;
  end loop;
  return jsonb_build_object('espelhados', v_ok, 'falhas', v_err, 'pendentes', v_pend);
end $function$;

create or replace view public.nexus_v365_estado as
select
  (select count(*) from public.nexus_v360_node_endpoints where ativo)                    as nos_endpointados,
  (select count(*) from public.nexus_v365_fleet_dispatch_log where http in (200,201))    as espelhamentos_ok,
  (select count(*) from public.nexus_v365_fleet_dispatch_log where http is not null and http not in (200,201)) as espelhamentos_falha,
  (select coalesce(sum(impression),0) from public.nexus_ad_network_yield)                as impression_total,
  (select coalesce(sum(revenue),0) from public.nexus_ad_network_yield)                   as receita_total,
  (select veredito from public.nexus_v365_parity_checks order by id desc limit 1)        as ultimo_veredito_paridade,
  (select count(*) from public.nexus_v365_media_directive)                               as diretrizes_fixadas;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. AGENDA HORÁRIA (nada de polling sub-hora): yield + paridade
-- ═══════════════════════════════════════════════════════════════════════════════
do $$
declare v_id bigint;
begin
  begin
    select jobid into v_id from cron.job where jobname = 'v365-yield-hourly';
    if v_id is null then
      perform cron.schedule('v365-yield-hourly', '7 * * * *',
        'select public.nexus_v365_yield_sync(7);');
    else
      perform cron.alter_job(job_id := v_id, schedule := '7 * * * *',
        command := 'select public.nexus_v365_yield_sync(7);', active := true);
    end if;

    select jobid into v_id from cron.job where jobname = 'v365-yield-consume-2min';
    if v_id is null then
      perform cron.schedule('v365-yield-consume-2min', '*/2 * * * *',
        'select public.nexus_v365_yield_consume();');
    else
      perform cron.alter_job(job_id := v_id, schedule := '*/2 * * * *',
        command := 'select public.nexus_v365_yield_consume();', active := true);
    end if;
  exception when others then
    perform public.nexus_v155_sintonizado('v365-cron', 'agenda', sqlerrm);
  end;
end $$;

select 'v365.0 instalado (aditivo)' as resultado,
       (select count(*) from public.nexus_v360_node_endpoints where ativo) as nos_endpointados,
       (select count(*) from public.nexus_v365_media_directive) as diretrizes;
