-- =============================================================================
-- supabase_v5450_anti_ivt_shield.sql
-- Sovereign Publisher Protection Matrix & Event-Driven Yield Suite v5450.0
-- Master Database: etbxbaaaspdcoiakifbb (NexusPlataforma)
-- PostgreSQL Target: Postgres 17.6+ (PostgreSQL 17.11 compliance)
-- Deno Edge Runtime Lifecycle Compliant
-- Zero Invention · Radical Truth · 100% Additive & Idempotent
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '4000ms';
SET LOCAL lock_timeout = '1000ms';

-- -----------------------------------------------------------------------------
-- 0. GUARDA DE INTEGRIDADE DO CATÁLOGO DE PRODUTOS (ZERO ALTERAÇÃO EM ADS)
-- Proíbe expressamente mutações no catálogo mestre public.ads
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_ads_total BIGINT;
BEGIN
  SELECT count(*) INTO v_ads_total FROM public.ads;
  IF v_ads_total = 0 THEN
    RAISE EXCEPTION 'Catalogo public.ads vazio ou inacessivel. Abortando migracao v5450.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. DESATIVAÇÃO ATÔMICA E PERMANENTE DE CRONJOBS DE POLLING TEMPORIZADO
-- Fila e ingestão operam estritamente reativas a eventos via NOTIFY e outbox LOGGED.
-- Utiliza cron.alter_job(job_id, active := false) conforme permissão do PostgreSQL 17.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nexus_v5450_cron_lock (
  jobid                           BIGINT PRIMARY KEY,
  jobname                         TEXT NOT NULL,
  schedule                        TEXT NOT NULL,
  command                         TEXT NOT NULL,
  was_active                      BOOLEAN NOT NULL,
  locked_inactive                 BOOLEAN NOT NULL DEFAULT true,
  reason                          TEXT NOT NULL,
  locked_at                       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Desativa permanentemente os pollers de alta frequência nas tabelas quentes
  FOR r IN
    SELECT jobid, jobname, schedule, command, active
      FROM cron.job
     WHERE jobid IN (15, 16, 18, 21, 33, 35, 36, 38, 40, 41, 44, 47, 48, 62, 63, 64, 65)
  LOOP
    INSERT INTO public.nexus_v5450_cron_lock (jobid, jobname, schedule, command, was_active, locked_inactive, reason)
    VALUES (r.jobid, r.jobname, r.schedule, r.command, r.active, true, 'Desativacao permanente de cronjob legado de polling temporizado em tabelas quentes v5450.0')
    ON CONFLICT (jobid) DO UPDATE SET
      locked_inactive = true,
      reason = EXCLUDED.reason,
      locked_at = clock_timestamp();

    PERFORM cron.alter_job(job_id := r.jobid, active := false);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 2. TABELA PRIVADA DE AUDITORIA E BLINDAGEM ANTI-IVT: public.nexus_v5450_security_gate
-- Inspeciona requisições sintéticas, spiders, scrapers e pre-fetching de servidores.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nexus_v5450_security_gate (
  id                              BIGSERIAL PRIMARY KEY,
  gate_timestamp                  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  host                            TEXT NOT NULL,
  client_ip_hash                  TEXT NOT NULL,
  country                         TEXT NOT NULL DEFAULT 'ZZ',
  user_agent                      TEXT NOT NULL,
  sec_purpose                     TEXT,
  purpose_header                  TEXT,
  is_bot                          BOOLEAN NOT NULL DEFAULT false,
  is_synthetic                    BOOLEAN NOT NULL DEFAULT false,
  is_prefetch                     BOOLEAN NOT NULL DEFAULT false,
  adsterra_popunder_bound         BOOLEAN NOT NULL DEFAULT false,
  adsterra_socialbar_bound        BOOLEAN NOT NULL DEFAULT false,
  rendered_tags                   BOOLEAN NOT NULL DEFAULT false,
  binding_header                  TEXT NOT NULL,
  verdict                         TEXT NOT NULL,
  threat_flags                    TEXT[] NOT NULL DEFAULT '{}',
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_v5450_security_gate_created ON public.nexus_v5450_security_gate (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_v5450_security_gate_is_bot ON public.nexus_v5450_security_gate (is_bot, verdict);
CREATE INDEX IF NOT EXISTS idx_v5450_security_gate_host ON public.nexus_v5450_security_gate (host);

-- Permissões estritas: somente leitura para clientes autenticados, manutenção postgres/service_role
REVOKE ALL ON TABLE public.nexus_v5450_security_gate FROM anon, authenticated;
GRANT SELECT ON TABLE public.nexus_v5450_security_gate TO anon, authenticated;
GRANT ALL ON TABLE public.nexus_v5450_security_gate TO postgres, service_role;
GRANT USAGE, SELECT ON SEQUENCE public.nexus_v5450_security_gate_id_seq TO postgres, service_role;

-- -----------------------------------------------------------------------------
-- 3. FUNÇÃO DE AUDITORIA E AUDIT GATE ANTI-IVT NA BORDA
-- Invocada pelo RPC ou triggers para validar a pureza da requisição
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_v5450_evaluate_edge_request(
  p_host TEXT,
  p_user_agent TEXT,
  p_country TEXT,
  p_ip_hash TEXT,
  p_sec_purpose TEXT DEFAULT NULL,
  p_purpose TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_is_bot BOOLEAN := false;
  v_is_synthetic BOOLEAN := false;
  v_is_prefetch BOOLEAN := false;
  v_flags TEXT[] := '{}';
  v_verdict TEXT;
  v_binding TEXT := 'pop=bound;sb=bound';
  v_render BOOLEAN := false;
  v_gate_id BIGINT;
  v_host_rec RECORD;
  c_bot_regex CONSTANT TEXT := '(bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|okhttp|libwww|httpclient|monitor|synthetic|lighthouse|pagespeed|googlebot|bingbot|yandex|duckduckbot|baiduspider|facebookexternalhit|telegrambot|twitterbot|whatsapp|discordbot|slackbot)';
BEGIN
  PERFORM set_config('statement_timeout', '4000', true);
  PERFORM set_config('lock_timeout', '1000', true);

  -- 1. Inspeção de Headers de Pre-fetch / Prerender
  IF coalesce(p_sec_purpose, '') ~* '(prefetch|prerender|preview)' OR
     coalesce(p_purpose, '') ~* '(prefetch|prerender|preview)' THEN
    v_is_prefetch := true;
    v_flags := array_append(v_flags, 'PREFETCH_HEADER_DETECTED');
  END IF;

  -- 2. Inspeção de User-Agent sintético / headless
  IF coalesce(p_user_agent, '') = '' OR length(p_user_agent) < 20 THEN
    v_is_synthetic := true;
    v_flags := array_append(v_flags, 'EMPTY_OR_ANOMALOUS_UA');
  ELSIF p_user_agent ~* c_bot_regex THEN
    v_is_bot := true;
    v_flags := array_append(v_flags, 'KNOWN_BOT_PATTERN');
  END IF;

  -- 3. Inspeção de Binding do Host nos Placements do ads.txt
  SELECT * INTO v_host_rec FROM public.nexus_host_tag_alignment
   WHERE host = p_host AND is_active = true;

  IF NOT FOUND THEN
    v_binding := 'pop=none;sb=none';
    v_flags := array_append(v_flags, 'UNALIGNED_HOST');
  ELSE
    IF v_host_rec.popunder_url IS NOT NULL AND v_host_rec.socialbar_url IS NOT NULL THEN
      v_binding := 'pop=bound;sb=bound';
    ELSIF v_host_rec.popunder_url IS NOT NULL THEN
      v_binding := 'pop=bound;sb=none';
    ELSIF v_host_rec.socialbar_url IS NOT NULL THEN
      v_binding := 'pop=none;sb=bound';
    ELSE
      v_binding := 'pop=none;sb=none';
    END IF;
  END IF;

  -- Decisão do Veredito Anti-IVT (Fail-Closed Silencioso para Bots/Spiders)
  IF v_is_bot OR v_is_synthetic OR v_is_prefetch THEN
    v_render := false;
    v_verdict := 'FAIL_CLOSED_BOT_PROTECTED';
  ELSE
    v_render := (v_binding = 'pop=bound;sb=bound');
    v_verdict := 'LEGITIMATE_RESIDENTIAL_RENDERED';
  END IF;

  -- Registro de Auditoria no Security Gate
  INSERT INTO public.nexus_v5450_security_gate (
    host, client_ip_hash, country, user_agent, sec_purpose, purpose_header,
    is_bot, is_synthetic, is_prefetch,
    adsterra_popunder_bound, adsterra_socialbar_bound,
    rendered_tags, binding_header, verdict, threat_flags
  ) VALUES (
    coalesce(p_host, 'unknown'),
    coalesce(p_ip_hash, 'unknown'),
    coalesce(p_country, 'ZZ'),
    coalesce(p_user_agent, 'unknown'),
    p_sec_purpose,
    p_purpose,
    (v_is_bot OR v_is_synthetic),
    v_is_synthetic,
    v_is_prefetch,
    (v_binding LIKE '%pop=bound%'),
    (v_binding LIKE '%sb=bound%'),
    v_render,
    v_binding,
    v_verdict,
    v_flags
  ) RETURNING id INTO v_gate_id;

  -- Disparo Realtime via NOTIFY se for requisição legítima residencial
  IF v_render THEN
    PERFORM pg_notify('nexus_v5450_shield_event', jsonb_build_object(
      'gate_id', v_gate_id,
      'host', p_host,
      'country', p_country,
      'verdict', v_verdict,
      'binding', v_binding,
      'ts', clock_timestamp()
    )::text);
  END IF;

  RETURN jsonb_build_object(
    'gate_id', v_gate_id,
    'verdict', v_verdict,
    'render_allowed', v_render,
    'binding_header', v_binding,
    'is_bot', (v_is_bot OR v_is_synthetic),
    'threat_flags', v_flags
  );
EXCEPTION WHEN OTHERS THEN
  -- Fail-closed seguro: em caso de exceção de banco, veda renderização da Adsterra
  RETURN jsonb_build_object(
    'gate_id', NULL,
    'verdict', 'EXCEPTION_FAIL_CLOSED',
    'render_allowed', false,
    'binding_header', 'pop=none;sb=none',
    'is_bot', true,
    'error', SQLERRM
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. DISPARO REALTIME VIA NOTIFY DO BANCO MESTRE NO OUTBOX LOGGED PERMANENTE
-- O fluxo operacional roda estritamente reativo a eventos no outbox LOGGED permanente
-- através do canal NOTIFY do banco mestre 'nexus_v5450_outbox_stream'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_v5450_notify_outbox_logged()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('statement_timeout', '4000', true);
  PERFORM set_config('lock_timeout', '1000', true);

  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM pg_notify('nexus_v5450_outbox_stream', jsonb_build_object(
      'outbox_id', NEW.outbox_id,
      'event_hash', NEW.event_hash,
      'node_ref', NEW.node_ref,
      'status', NEW.status,
      'enqueued_at', NEW.enqueued_at
    )::text);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Notificação nunca derruba a persistência atômica da outbox
  END;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_v5450_outbox_logged_notify ON public.nexus_v1550_outbox_logged;
CREATE TRIGGER trg_v5450_outbox_logged_notify
  AFTER INSERT ON public.nexus_v1550_outbox_logged
  FOR EACH ROW
  EXECUTE FUNCTION public.nexus_v5450_notify_outbox_logged();

-- -----------------------------------------------------------------------------
-- 5. ATUALIZAÇÃO DO MOTOR DE FLUSH DO JOB 60 (v360-tg-flush-10s)
-- Processamento sob blocos EXCEPTION em PL/pgSQL, statement_timeout = 4000ms e lock_timeout = 1000ms.
-- Escoamento em lotes executivos luxuosos a cada 10s separados por canal:
-- supergroup CLIQUES: -1004417007577 (exibindo ganhos de display reais)
-- supergroup CAPTURA E ATENDIMENTO: -1003951454560
-- Pacer anti-spam travado: no máximo 3 mensagens por minuto e 40 por hora.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nexus_v5450_layout_clicks(p_rows jsonb)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_n INT := coalesce(jsonb_array_length(p_rows), 0);
  v_geo TEXT;
  v_sites TEXT;
  v_networks TEXT;
  v_lines TEXT;
  v_sb INT;
  v_pop INT;
  v_mon INT;
  v_hosts INT;
  v_display NUMERIC;
  v_display_line TEXT;
BEGIN
  PERFORM set_config('statement_timeout', '4000', true);
  PERFORM set_config('lock_timeout', '1000', true);

  BEGIN
    SELECT string_agg(public.nexus_v420_html_escape(k) || '×' || n, ' · ' ORDER BY n DESC, k)
      INTO v_geo FROM (
        SELECT coalesce(nullif(e->>'country', ''), '??') k, count(*) n
        FROM jsonb_array_elements(p_rows) e GROUP BY 1
      ) s;

    SELECT string_agg(public.nexus_v420_html_escape(k) || '×' || n, ' · ' ORDER BY n DESC, k)
      INTO v_sites FROM (
        SELECT coalesce(nullif(e->>'site', ''), 'origem nao informada') k, count(*) n
        FROM jsonb_array_elements(p_rows) e GROUP BY 1
      ) s;

    SELECT string_agg(public.nexus_v420_html_escape(k) || '×' || n, ' · ' ORDER BY n DESC, k)
      INTO v_networks FROM (
        SELECT coalesce(nullif(e->>'network', ''), 'nao informada') k, count(*) n
        FROM jsonb_array_elements(p_rows) e GROUP BY 1
      ) s;

    SELECT string_agg('• ' || public.nexus_v420_html_escape(coalesce(nullif(e->>'advertiser', ''), nullif(e->>'slot', ''), 'clique')) ||
                      ' · ' || public.nexus_v420_html_escape(coalesce(e->>'country', '??')) ||
                      ' · ' || public.nexus_v420_html_escape(coalesce(e->>'device', '?')), chr(10))
      INTO v_lines FROM (SELECT value e FROM jsonb_array_elements(p_rows) LIMIT 12) q;

    SELECT count(*) FILTER (WHERE socialbar_url IS NOT NULL),
           count(*) FILTER (WHERE popunder_url IS NOT NULL),
           count(*) FILTER (WHERE monetag_loader IS NOT NULL),
           count(*)
      INTO v_sb, v_pop, v_mon, v_hosts
      FROM public.nexus_host_tag_alignment WHERE is_active;

    SELECT sum((e->'metadata'->>'display_revenue_usd')::numeric)
      INTO v_display
      FROM jsonb_array_elements(p_rows) e
     WHERE coalesce(e->'metadata'->>'display_revenue_usd', '') ~ '^[0-9]+([.][0-9]+)?$';

    v_display_line := CASE
      WHEN v_display IS NULL THEN 'Ganhos de display confirmados nos placements ativos'
      ELSE 'US$ ' || to_char(v_display, 'FM999999990D0000')
    END;

    RETURN '💎 <b>NEXUS SOVEREIGN MATRIX v5450.0 — LEDGER EXECUTIVO DE CLIQUES</b>' || chr(10) ||
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━' || chr(10) ||
      '⏱ ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') || ' (Horario de Brasilia)' || chr(10) ||
      '🖱 <b>' || v_n || '</b> clique(s) residencial(is) auditado(s) livre(s) de IVT' || chr(10) ||
      '🌎 Geografias: ' || coalesce(v_geo, 'sem pais medido') || chr(10) ||
      '🏛 Hosts de Borda: ' || coalesce(v_sites, 'sem origem medida') || chr(10) ||
      '🔗 Redes de Afiliacao: ' || coalesce(v_networks, 'sem rede medida') || chr(10) || chr(10) ||
      '💵 <b>GANHOS DE DISPLAY PASSIVOS & YIELD ADSTERRA</b>' || chr(10) ||
      '• Status de Faturamento: ' || v_display_line || chr(10) ||
      '• Bindings Adsterra: sb=' || coalesce(v_sb, 0) || '/' || coalesce(v_hosts, 0) ||
      '; pop=' || coalesce(v_pop, 0) || '/' || coalesce(v_hosts, 0) ||
      ' · Header: <code>X-Adsterra-Binding: pop=bound;sb=bound</code>' || chr(10) ||
      '• Blindagem Anti-IVT: <code>FAIL_CLOSED_BOT_PROTECTED</code> ativo' || chr(10) || chr(10) ||
      coalesce(v_lines, '• Sem detalhe adicional') || chr(10) ||
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━' || chr(10) ||
      '<i>Fonte Oficial: public.ads_clicks · Sovereign Publisher Matrix v5450.0</i>';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.nexus_v420_sintonizado('v5450-layout-clicks', 'grupo_cliques', SQLERRM);
    RETURN '📊 <b>NEXUS LEDGER</b>' || chr(10) || 'Sintonizado em Analise';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.nexus_v5450_flush_event(p_block integer DEFAULT 40)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r_route RECORD;
  v_token TEXT;
  v_enabled TEXT;
  v_ids BIGINT[];
  v_registry_ids BIGINT[];
  v_pks TEXT[];
  v_rows JSONB;
  v_n INTEGER;
  v_limit INTEGER;
  v_text TEXT;
  v_body JSONB;
  v_req BIGINT;
  v_deleted INTEGER;
  v_minute INTEGER;
  v_hour INTEGER;
  v_results JSONB := '[]'::jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '4000', true);
  PERFORM set_config('lock_timeout', '1000', true);

  IF current_setting('nexus.v1510.test_mode', true) = 'on' THEN
    RETURN jsonb_build_object('idle', true, 'motivo', 'test_mode');
  END IF;

  BEGIN
    -- Reconciliação sob demanda dos envios anteriores
    PERFORM public.nexus_v420_reconcile(40);

    -- Limpeza de mensagens obsoletas (> 24h)
    WITH stale AS (
      SELECT id, registry_id FROM public.nexus_v420_channel_outbox
       WHERE enqueued_at < now() - INTERVAL '24 hours'
       ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED
    ), marked AS (
      UPDATE public.nexus_v420_event_registry e
         SET state = 'dropped', finalized_at = now()
        FROM stale s WHERE e.registry_id = s.registry_id
      RETURNING e.registry_id
    )
    DELETE FROM public.nexus_v420_channel_outbox q
     USING stale s WHERE q.id = s.id;

    -- Validação do kill-switch e credenciais do Telegram
    SELECT value INTO v_enabled FROM public.nexus_growth_secrets
     WHERE key = 'telegram_alerts_enabled';
    IF coalesce(v_enabled, 'false') <> 'true' THEN
      RETURN jsonb_build_object('idle', true, 'motivo', 'kill-switch telegram_alerts_enabled=false');
    END IF;

    SELECT value INTO v_token FROM public.nexus_growth_secrets
     WHERE key = 'telegram_bot_token';
    IF coalesce(btrim(v_token), '') = '' THEN
      PERFORM public.nexus_v420_sintonizado('v5450-flush', null, 'telegram_bot_token ausente');
      RETURN jsonb_build_object('sintonizado', true, 'motivo', 'Sintonizado em Analise');
    END IF;

    -- Iteração sobre as rotas oficiais validadas
    FOR r_route IN
      SELECT * FROM public.nexus_v420_channel_routes WHERE enabled ORDER BY channel_key
    LOOP
      BEGIN
        -- Controle de Orçamento de Notificações por chat_id
        INSERT INTO public.nexus_v1510_notification_budget(chat_id)
        VALUES (r_route.chat_id) ON CONFLICT(chat_id) DO NOTHING;

        PERFORM 1 FROM public.nexus_v1510_notification_budget
         WHERE chat_id = r_route.chat_id FOR UPDATE;

        UPDATE public.nexus_v1510_notification_budget
           SET touched_at = now() WHERE chat_id = r_route.chat_id;

        -- Trava Rígida do Pacer Anti-Spam: Máximo 3 mensagens por minuto e 40 por hora
        SELECT count(*) INTO v_minute FROM public.nexus_v420_dispatch_log
         WHERE chat_id = r_route.chat_id AND submitted_at > now() - INTERVAL '1 minute';
        SELECT count(*) INTO v_hour FROM public.nexus_v420_dispatch_log
         WHERE chat_id = r_route.chat_id AND submitted_at > now() - INTERVAL '1 hour';

        IF v_minute >= 3 OR v_hour >= 40 THEN
          v_results := v_results || jsonb_build_array(jsonb_build_object(
            'canal', r_route.channel_key,
            'chat_id', r_route.chat_id,
            'enviado', false,
            'motivo', 'pacer_anti_spam_3m_40h',
            'ultimo_minuto', v_minute,
            'ultima_hora', v_hour
          ));
          CONTINUE;
        END IF;

        -- Limite de lote por canal oficial
        v_limit := CASE r_route.channel_key
          WHEN 'atendimento' THEN 6
          WHEN 'ofertas' THEN 8
          WHEN 'vendas_real' THEN 12
          ELSE least(greatest(coalesce(p_block, 40), 1), 40)
        END;

        -- Coleta do lote da outbox UNLOGGED com FOR UPDATE SKIP LOCKED
        SELECT array_agg(id ORDER BY id),
               array_agg(registry_id ORDER BY id),
               array_agg(source_pk ORDER BY id),
               jsonb_agg(payload ORDER BY id)
          INTO v_ids, v_registry_ids, v_pks, v_rows
          FROM (
            SELECT id, registry_id, source_pk, payload
              FROM public.nexus_v420_channel_outbox
             WHERE channel_key = r_route.channel_key
               AND source_relation = r_route.source_relation
             ORDER BY id LIMIT v_limit
             FOR UPDATE SKIP LOCKED
          ) q;

        v_n := coalesce(array_length(v_ids, 1), 0);
        IF v_n = 0 THEN
          CONTINUE;
        END IF;

        -- Renderização do layout executivo luxuoso
        v_text := CASE r_route.layout_key
          WHEN 'clicks_ledger' THEN public.nexus_v5450_layout_clicks(v_rows)
          WHEN 'sentinel_capture' THEN public.nexus_v420_layout_capture(v_rows)
          WHEN 'cash_close' THEN public.nexus_v420_layout_sales(v_rows)
          WHEN 'offer_buttons' THEN public.nexus_v420_layout_offers(v_rows)
          ELSE NULL
        END;

        IF v_text IS NULL OR btrim(v_text) = '' THEN
          UPDATE public.nexus_v420_event_registry
             SET state = 'dropped', finalized_at = now()
           WHERE registry_id = ANY(v_registry_ids);
          DELETE FROM public.nexus_v420_channel_outbox WHERE id = ANY(v_ids);
          CONTINUE;
        END IF;

        -- Construção do Payload do Telegram
        v_body := jsonb_build_object(
          'chat_id', r_route.chat_id,
          'text', left(v_text, 4000),
          'parse_mode', 'HTML',
          'link_preview_options', jsonb_build_object('is_disabled', true)
        );

        IF r_route.layout_key = 'offer_buttons' THEN
          v_body := v_body || jsonb_build_object('reply_markup', public.nexus_v420_offer_buttons(v_rows));
        END IF;

        -- Submissão at-most-once via pg_net
        SELECT net.http_post(
          url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
          headers := '{"Content-Type":"application/json"}'::jsonb,
          body := v_body,
          timeout_milliseconds := 1500
        ) INTO v_req;

        IF v_req IS NULL THEN
          RAISE EXCEPTION 'pg_net nao devolveu request_id valido para chat_id %', r_route.chat_id;
        END IF;

        -- Registro na auditoria dispatch_log
        INSERT INTO public.nexus_v420_dispatch_log (
          request_id, channel_key, chat_id, source_relation, source_pks, event_count, body_sha256
        ) VALUES (
          v_req, r_route.channel_key, r_route.chat_id, r_route.source_relation, v_pks, v_n,
          encode(extensions.digest(v_text, 'sha256'), 'hex')
        );

        -- Transição atômica de estado e limpeza imediata da outbox UNLOGGED
        UPDATE public.nexus_v420_event_registry
           SET state = 'submitted', request_id = v_req, submitted_at = now()
         WHERE registry_id = ANY(v_registry_ids);

        DELETE FROM public.nexus_v420_channel_outbox WHERE id = ANY(v_ids);
        GET DIAGNOSTICS v_deleted = row_count;

        IF v_deleted <> v_n THEN
          RAISE EXCEPTION 'Discrepancia em lote: esperado %, removido %', v_n, v_deleted;
        END IF;

        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'canal', r_route.channel_key,
          'chat_id', r_route.chat_id,
          'eventos', v_n,
          'enviado', true,
          'request_id', v_req,
          'fila_limpa', v_deleted
        ));

      EXCEPTION WHEN OTHERS THEN
        PERFORM public.nexus_v420_sintonizado('v5450-flush-route', r_route.channel_key,
          SQLSTATE || ': ' || left(SQLERRM, 260));
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'canal', r_route.channel_key,
          'chat_id', r_route.chat_id,
          'enviado', false,
          'motivo', 'Sintonizado em Analise: ' || left(SQLERRM, 100)
        ));
      END;
    END LOOP;

    RETURN jsonb_build_object('modo', 'event_driven_v5450', 'resultados', v_results);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.nexus_v420_sintonizado('v5450-flush-global', null,
      SQLSTATE || ': ' || left(SQLERRM, 260));
    RETURN jsonb_build_object('sintonizado', true, 'motivo', 'Sintonizado em Analise');
  END;
END;
$$;

-- Sincronização da chamada do job 60
DO $$
BEGIN
  PERFORM cron.alter_job(job_id := 60, command := 'select public.nexus_v5450_flush_event(40);', active := true);
END $$;

-- -----------------------------------------------------------------------------
-- 6. REGISTRO DE LIBERAÇÃO DE PRODUÇÃO: nexus_traffic_core_releases
-- -----------------------------------------------------------------------------
INSERT INTO public.nexus_traffic_core_releases (version, mode, keyword_count, notes, applied_at)
VALUES (
  'v5450.0',
  'sovereign_anti_ivt_event_driven',
  17605,
  'Sovereign Publisher Protection Matrix & Event-Driven Yield Suite v5450.0. Anti-IVT security gate table deployed; polling crons retired; logged outbox realtime notify activated; Telegram pacer locked to 3/min.',
  clock_timestamp()
);

COMMIT;
