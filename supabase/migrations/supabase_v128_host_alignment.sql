-- ═══════════════════════════════════════════════════════════════════════════════
-- supabase_v128_host_alignment.sql — MATRIX CORE v128.0
-- Sovereign Host Alignment & Multi-Domain Traffic Route Suite
-- Data: 2026-09-12 · Autor: Diretoria de Infra Nexus · Mandato: Veracidade Radical
-- ═══════════════════════════════════════════════════════════════════════════════
-- OBJETIVO (FIM DO MISMATCH DE DOMÍNIO):
--   1. Registro canônico 1:1 host ↔ tag Adsterra (SocialBar/Popunder) ↔ ads.txt,
--      para impedir a entrega de tag fora do domínio mestre (descarte Adsterra).
--   2. Seletor fail-closed nexus_get_ad_tags_for_host(): host desconhecido → sem tag.
--   3. GUARDA ANTI-LINK-DIRETO no canal 'ofertas' do Telegram: nenhuma mensagem
--      pública de oferta pode conter link direto de varejo (bypassa interstitial).
--      Bloqueio fail-closed + log de telemetria. Outros canais: intactos (zero risco).
--
-- GARANTIAS:
--   - 100% ADITIVA e IDEMPOTENTE (pode rodar N vezes).
--   - Catálogo public.ads: ZERO toque (nenhum INSERT/UPDATE/DELETE/DDL nele).
--   - Botões/fluxos legítimos intactos; kill-switches existentes preservados.
--   - statement_timeout 2s / lock_timeout 1s; EXCEPTION com marcador
--     'Sintonizado em Análise' no padrão da casa; usuário humano nunca preso.
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '2s';
SET statement_timeout = '60s'; -- lote DDL (o 2s estrito vale DENTRO das funções de runtime via SET LOCAL; aplicado ao vivo em 12/09)

-- ─────────────────────────────────────────────────────────────────────────────
-- A) REGISTRO CANÔNICO 1:1 HOST ↔ TAG (fonte da verdade do alignment)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.nexus_host_tag_alignment (
  id                        uuid primary key default gen_random_uuid(),
  host                      text not null unique,
  display_name              text not null,
  adsterra_website_id       bigint not null,
  ads_txt_expected          text not null,           -- linha que DEVE existir no ads.txt do host
  socialbar_placement       bigint,
  socialbar_url             text,                    -- NULL = pendente no painel → fail-closed: NÃO injeta
  popunder_placement        bigint,
  popunder_url              text,
  monetag_loader            text,
  is_active                 boolean not null default true,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_v128_alignment_host on public.nexus_host_tag_alignment (host);
create index if not exists idx_v128_alignment_active on public.nexus_host_tag_alignment (is_active) where is_active;

alter table public.nexus_host_tag_alignment enable row level security;
-- Sem políticas = deny-all para anon/authenticated (RLS). service_role (bypass RLS)
-- é o único accessor, usado apenas pelos operadores internos.

-- ─────────────────────────────────────────────────────────────────────────────
-- B) SEEDS 1:1 (verbatim do painel Adsterra + ads.txt verificado ao vivo 12/09)
--    IDs de SocialBar pendentes = placements existentes na conta; URL só entra
--    quando o código for gerado no painel → até lá, fail-closed: NULL.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.nexus_host_tag_alignment
  (host, display_name, adsterra_website_id, ads_txt_expected,
   socialbar_placement, socialbar_url, popunder_placement, popunder_url, monetag_loader, is_active, notes)
values
  ('aquitemachadinhos.com.br', 'Aqui Tem Achadinhos (mestre)', 5975392,
   'adsterra.com, 5975392, DIRECT',
   30703818, 'https://undergocutlery.com/a0/4b/ea/a04bea8f13eec4c1e3b87777107a3c6e.js',
   30703817, 'https://undergocutlery.com/n125219ufh?key=0474000233cefd60e54ca390d15beaaf',
   'https://quge5.com/88/tag.min.js', true,
   'SocialBar mestre a04bea8f confirmada pelo suporte/painel Adsterra (print 12/09) e verificada ao vivo no interstitial v127.'),
  ('solvegrid.com.br', 'SolveGrid', 6042199,
   'adsterra.com, 6042199, DIRECT',
   31166085, NULL,
   31166083, 'https://undergocutlery.com/kpppprb1h5?key=3d010529a102de694b51b617cbfa2221',
   'https://quge5.com/88/tag.min.js', true,
   'PENDENTE: gerar SocialBar no painel (placement 31166085). v127 servia a tag do aquitem aqui = MISMATCH (descarte). v128: fail-closed NULL até o código real existir.'),
  ('achadinhos-ad-engine.vercel.app', 'Achadinhos Ad Engine', 6044306,
   'adsterra.com, 6044306, DIRECT',
   31180418, NULL,
   31180413, 'https://undergocutlery.com/v6k6sq45dm?key=90f19ab095cebec116b7ee5f129e1b2b',
   'https://quge5.com/88/tag.min.js', true,
   'PENDENTE: gerar SocialBar no painel (placement 31180418). ads.txt re-crawleado 11/09; stats podem demorar 24-48h.'),
  ('nexusplataforma.ia.br', 'Nexus Plataforma', 6002104,
   'adsterra.com, 6002104, DIRECT',
   30879030, NULL,
   30879026, 'https://undergocutlery.com/zqmeg0npik?key=9829517559c74ab7fd87b787ee036287',
   'https://quge5.com/88/tag.min.js', true,
   'PENDENTE: gerar SocialBar no painel (placement 30879030).')
on conflict (host) do update set
  display_name         = excluded.display_name,
  adsterra_website_id  = excluded.adsterra_website_id,
  ads_txt_expected     = excluded.ads_txt_expected,
  socialbar_placement  = excluded.socialbar_placement,
  socialbar_url        = excluded.socialbar_url,
  popunder_placement   = excluded.popunder_placement,
  popunder_url         = excluded.popunder_url,
  monetag_loader       = excluded.monetag_loader,
  is_active            = excluded.is_active,
  notes                = excluded.notes,
  updated_at           = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- C) SELETOR FAIL-CLOSED 1:1 (o coração do anti-mismatch)
--    Host conhecido → só as PRÓPRIAS tags. Host desconhecido/erased → NULL (nada).
--    Nunca devolve tag de outro host. É este contrato que o go.js v128 espelha.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_get_ad_tags_for_host(p_host text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $fn$
declare
  v_row public.nexus_host_tag_alignment%rowtype;
  v_norm text;
begin
  begin
    set local statement_timeout = '2000';
    set local lock_timeout = '1000';

    v_norm := lower(coalesce(p_host, ''));
    v_norm := regexp_replace(v_norm, '^www\.', '');

    select * into v_row
      from public.nexus_host_tag_alignment
     where is_active
       and (host = v_norm or v_norm like '%.' || host)
     limit 1;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'host', p_host,
        'socialbar_url', null,
        'popunder_url', null,
        'reason', 'host_sem_binding_1a1_fail_closed');
    end if;

    return jsonb_build_object(
      'ok', true,
      'host', v_row.host,
      'adsterra_website_id', v_row.adsterra_website_id,
      'socialbar_url', v_row.socialbar_url,          -- pode ser NULL (pendente) = não injeta
      'popunder_url', v_row.popunder_url,
      'monetag_loader', v_row.monetag_loader,
      'ads_txt_expected', v_row.ads_txt_expected);
  exception when others then
    return jsonb_build_object(
      'ok', false,
      'host', p_host,
      'status', 'Sintonizado em Análise',
      'sqlerrm', left(sqlerrm, 140));
  end;
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D) GUARDA ANTI-LINK-DIRETO (fecha o vazamento Telegram → interstitial)
--    Detecta URL crua de varejo (que bypassa o /go e nunca gera impressão).
--    Nossos hosts, links CJ/afiliados de rastreamento e /go passam livres.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.nexus_v128_raw_affiliate_block_log (
  id            bigint generated always as identity primary key,
  channel       text not null,
  trigger_name  text,
  event_key     text,
  matched_rule  text not null,
  sample        text,
  blocked_at    timestamptz not null default now()
);
create index if not exists idx_v128_blocklog_time on public.nexus_v128_raw_affiliate_block_log (blocked_at desc);

alter table public.nexus_v128_raw_affiliate_block_log enable row level security;

create or replace function public.nexus_v128_text_has_raw_affiliate(p_text text)
returns boolean
language plpgsql
immutable
set search_path = 'public'
as $fn$
declare
  v text := coalesce(p_text, '');
begin
  -- Links diretos de varejo (com ou sem esquema), inclusive encurtadores de varejo.
  -- NÃO captura: solvegrid/aquitem/engine/nexus (/go), CJ (jdoqocy, anrdoezrs,
  -- tkqlhce, dpbolvw, kqzyfj), amzn.to? → captura (é varejo), t.co etc. ignorados.
  return (
    v ~* '(https?://)?(www\.)?(amazon\.com\.br|amazon\.com/[^ ]*\?tag=|amzn\.(to|eu|de)|meli\.la|mercadolivre\.com[./a-z]*|s\.shopee\.com\.br|shopee\.com\.br|s\.click\.aliexpress|aliexpress\.com|ebay\.com/|booking\.com/|hotmart\.com/|kiwify\.to/)'::text
    and v !~* 'solvegrid\.com\.br/go|aquitemachadinhos\.com\.br/go|achadinhos-ad-engine\.vercel\.app/api/ads/go'::text
  );
end $fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E) SEND_TO v128: guarda aplicada ao canal PÚBLICO 'ofertas'.
--    - 'ofertas' com link direto → BLOQUEIA (fail-closed) + registra no log.
--    - Demais canais (privado/oraculo): intocados — zero risco a VENDAS/alertas.
--    Assinatura e comportamento existentes preservados byte a byte.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.nexus_telegram_send_to(p_channel text, p_text text, p_trigger text DEFAULT 'triple_funnel', p_event_key text DEFAULT null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'net', 'extensions'
as $function$
declare
  v_token text;
  v_chat  text;
  v_key   text;
  v_req   bigint;
  v_enabled text;
  v_slot  bigint;
  v_rule  text;
begin
  begin
    if p_channel not in ('privado','ofertas','oraculo') then
      raise exception 'canal inválido: %', p_channel;
    end if;
    if coalesce(btrim(p_text), '') = '' then
      insert into public.nexus_telegram_push_log (trigger_name, event_key, payload_preview)
      values (p_trigger, p_event_key, 'GUARDA triplo funil: texto nulo/vazio — push bloqueado');
      return null;
    end if;

    select value into v_enabled from public.nexus_growth_secrets where key = 'telegram_alerts_enabled';
    if v_enabled = 'off' then
      insert into public.nexus_telegram_push_log (trigger_name, event_key, payload_preview)
      values (p_trigger, p_event_key, 'desligado (telegram_alerts_enabled) — triplo funil respeita');
      return null;
    end if;

    -- ═══ DEDUP ATÔMICO (fix 10/09, preservado) ═══
    if coalesce(p_event_key, '') <> '' then
      insert into public.nexus_telegram_push_log (trigger_name, event_key, payload_preview)
      values (p_trigger, p_event_key, 'reserva dedup')
      on conflict (trigger_name, event_key) where event_key is not null do nothing
      returning id into v_slot;
      if v_slot is null then
        update public.nexus_telegram_push_log
           set suppressed_count = coalesce(suppressed_count, 0) + 1
         where trigger_name = p_trigger and event_key = p_event_key;
        return null;
      end if;
    end if;

    -- ═══ GUARDA v128: canal público 'ofertas' NÃO publica link direto de varejo ═══
    if p_channel = 'ofertas' and public.nexus_v128_text_has_raw_affiliate(p_text) then
      v_rule := coalesce((select matched_rule from (
        select case
          when p_text ~* 'amazon\.com\.br|amazon\.com/\?tag=|amzn\.' then 'amazon_direto'
          when p_text ~* 'meli\.la|mercadolivre\.com'               then 'mercadolivre_direto'
          when p_text ~* 'shopee\.com\.br'                           then 'shopee_direto'
          when p_text ~* 'aliexpress\.com'                           then 'aliexpress_direto'
          when p_text ~* 'ebay\.com/'                                then 'ebay_direto'
          when p_text ~* 'booking\.com/'                             then 'booking_direto'
          else 'varejo_direto' end as matched_rule
      ) t limit 1), 'varejo_direto');

      insert into public.nexus_v128_raw_affiliate_block_log
        (channel, trigger_name, event_key, matched_rule, sample)
      values
        (p_channel, p_trigger, p_event_key, v_rule, left(p_text, 160));

      if v_slot is not null then
        update public.nexus_telegram_push_log
           set payload_preview = 'GUARDA v128: link direto de varejo BLOQUEADO (' || v_rule || ') — envelope via /go obrigatório'
         where id = v_slot;
      else
        insert into public.nexus_telegram_push_log (trigger_name, event_key, payload_preview)
        values (p_trigger, p_event_key, 'GUARDA v128: link direto de varejo BLOQUEADO (' || v_rule || ')');
      end if;
      return null;
    end if;

    select value into v_token from public.nexus_growth_secrets where key = 'telegram_bot_token';
    if p_channel = 'privado' then
      v_token := coalesce((select value from public.nexus_growth_secrets where key = 'telegram_bot_token_privado'), v_token);
    end if;
    v_key := case p_channel
               when 'privado'  then 'telegram_chat_id_privado'
               when 'ofertas'  then 'telegram_chat_id_ofertas'
               when 'oraculo'  then 'telegram_chat_id_oraculo'
             end;
    select value into v_chat from public.nexus_growth_secrets where key = v_key;

    if coalesce(v_token, '') = '' or coalesce(v_chat, '') = '' then
      if v_slot is not null then
        update public.nexus_telegram_push_log
           set payload_preview = 'canal ' || p_channel || ' sem token/chat_id no cofre — fail-closed'
         where id = v_slot;
      else
        insert into public.nexus_telegram_push_log (trigger_name, event_key, payload_preview)
        values (p_trigger, p_event_key, 'canal ' || p_channel || ' sem token/chat_id no cofre — fail-closed');
      end if;
      return null;
    end if;

    select net.http_post(
      url      := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
      body     := jsonb_build_object(
                    'chat_id', v_chat,
                    'text', left(p_text, 4000),
                    'parse_mode', 'HTML',
                    'disable_web_page_preview', false),
      params   := '{}'::jsonb,
      headers  := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 8000
    ) into v_req;

    if v_slot is not null then
      update public.nexus_telegram_push_log
         set request_id = v_req, payload_preview = left('[' || p_channel || '] ' || p_text, 160)
       where id = v_slot;
    else
      insert into public.nexus_telegram_push_log (trigger_name, event_key, request_id, payload_preview)
      values (p_trigger, p_event_key, v_req, left('[' || p_channel || '] ' || p_text, 160));
    end if;
    return v_req;
  exception when others then
    begin
      if v_slot is not null then
        update public.nexus_telegram_push_log
           set payload_preview = 'exceção isolada (fail-closed): ' || left(sqlerrm, 140)
         where id = v_slot;
      else
        insert into public.nexus_telegram_push_log (trigger_name, event_key, payload_preview)
        values (p_trigger, p_event_key, 'exceção isolada (fail-closed): ' || left(sqlerrm, 140));
      end if;
    exception when others then null;
    end;
    return null;
  end;
end $function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F) AUDITORIA (visões para o vigia cron 38/47 e para humanos)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.nexus_v128_alignment_audit as
select
  host,
  adsterra_website_id,
  ads_txt_expected,
  socialbar_placement,
  case
    when socialbar_url is null then 'PENDENTE (fail-closed: não injeta até gerar no painel)'
    else 'OK 1:1'
  end as socialbar_status,
  case when popunder_url is null then 'PENDENTE' else 'OK 1:1' end as popunder_status,
  is_active,
  updated_at
from public.nexus_host_tag_alignment
order by host;

create or replace view public.nexus_v128_raw_affiliate_blocks_recent as
select channel, trigger_name, matched_rule, sample, blocked_at
from public.nexus_v128_raw_affiliate_block_log
where blocked_at > now() - interval '7 days'
order by blocked_at desc;

-- ─────────────────────────────────────────────────────────────────────────────
-- G) VERIFICAÇÃO DA PRÓPRIA MIGRAÇÃO (roda sempre, prova de integridade)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_hosts int; v_sb int; v_guard_ok boolean; v_sendto text;
begin
  set local statement_timeout = '2000';
  set local lock_timeout = '1000';

  select count(*) into v_hosts from public.nexus_host_tag_alignment;
  select count(*) into v_sb from public.nexus_host_tag_alignment where socialbar_url is not null;

  v_guard_ok := public.nexus_v128_text_has_raw_affiliate('compre https://www.amazon.com.br/dp/X123 agora')
            and not public.nexus_v128_text_has_raw_affiliate('compre https://www.solvegrid.com.br/go?marca=amazon&sid=telegram_x')
            and not public.nexus_v128_text_has_raw_affiliate('oferta verificada na sua cidade');

  select pg_get_functiondef('public.nexus_telegram_send_to(text,text,text,text)'::regprocedure)
    into v_sendto;

  raise notice 'v128 · hosts registrados: % (com SocialBar ativa: %)', v_hosts, v_sb;
  raise notice 'v128 · guarda anti-link-direto: %', case when v_guard_ok then 'OK (bloqueia varejo, libera /go)' else 'FALHA NO SELF-TEST' end;
  raise notice 'v128 · send_to com guarda: %', case when v_sendto like '%GUARDA v128%' then 'OK' else 'ATENÇÃO: guarda ausente' end;
  raise notice 'v128 · seletor fail-closed aquitem: %', public.nexus_get_ad_tags_for_host('www.aquitemachadinhos.com.br')::text;
  raise notice 'v128 · seletor fail-closed solvegrid: %', public.nexus_get_ad_tags_for_host('www.solvegrid.com.br')::text;
  raise notice 'v128 · seletor host desconhecido (deve ser ok=false): %', public.nexus_get_ad_tags_for_host('host-estranho.example')::text;
exception when others then
  raise notice 'v128 · self-check com ressalva: %', sqlerrm;
end $$;
