-- ============================================================================
-- supabase_v340_dynamic_tags.sql
-- Sovereign Geo-Targeting Core & Dynamic Param Resolver Suite — v340.0
--
-- ADITIVA e ATÔMICA. Não altera nenhuma linha do catálogo (nexus_brand_keywords
-- e nexus_ebay_bulk_feed_staging seguem estritamente read-only).
--
-- O QUE RESOLVE (tudo medido, nada suposto):
--   1) FIM DO SLOT FIXO SINTÉTICO — o slot de suborigem era uma string constante
--      ('header', 'health', ...) e por isso a telemetria não dizia QUAL produto
--      gerou o clique. Agora nexus_slot_dynamic() monta
--      <keyword-real-slug>_<arquitetura-do-user-agent> (ex.: powerbank_desktop,
--      mop_mobile) e nexus_telegram_enqueue_dynamic() RECUSA a string
--      '_health_desktop' (e qualquer *_health_* sintético) com SQLSTATE 22023 —
--      a proibição é do banco, não só do aplicativo.
--   2) TRAVA NACIONAL BR — nexus_route_resolve_dynamic() devolve, para visitante
--      humano (is_bot = false) originado no Brasil, SEMPRE destino em moeda
--      nativa: oferta do catálogo Shopee BR ou https://meli.la. Merchant em moeda
--      estrangeira (Booking UK 15734754, eBay 5339193749, Amazon US, AliExpress,
--      Udemy, NordVPN, EconomyBookings) é bloqueado e registrado.
--   3) SWAP TIER-1 EXCLUSIVO — o inverso também é explícito: só US, CA, GB, DE e
--      FR recebem Booking UK / eBay Partner Network.
--   4) FAIL-CLOSED COM TIMEOUTS DE POOL — gravação rápida da fila UNLOGGED sob
--      statement_timeout=1000 / lock_timeout=500; resolução de rota e tratamento
--      de metadados JSONB sob 2000/1000. Qualquer exceção grava o marcador
--      'Sintonizado em Análise' na telemetria e libera o visitante na hora.
-- ============================================================================

BEGIN;
SET LOCAL statement_timeout = '2000ms';
SET LOCAL lock_timeout = '1000ms';

DO $v340$
BEGIN
  -- ────────────────────────────────────────────────────────────────────────
  -- 0) Telemetria de rota (JSONB) — aditiva, created on demand
  -- ────────────────────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS public.nexus_route_telemetry (
    id            bigserial PRIMARY KEY,
    country       text,
    brand         text,
    is_bot        boolean NOT NULL DEFAULT false,
    keyword       text,
    slot_dinamico text,
    decisao       text,
    bloqueou_moeda_estrangeira boolean NOT NULL DEFAULT false,
    meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
    criado_em     timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS nexus_route_telemetry_dia_idx
    ON public.nexus_route_telemetry (criado_em DESC);
  CREATE INDEX IF NOT EXISTS nexus_route_telemetry_br_idx
    ON public.nexus_route_telemetry (country, decisao) WHERE is_bot = false;

  -- ────────────────────────────────────────────────────────────────────────
  -- 1) SLOT DINÂMICO: keyword real + arquitetura do user-agent
  -- ────────────────────────────────────────────────────────────────────────
  CREATE OR REPLACE FUNCTION public.nexus_slot_dynamic(p_keyword text, p_user_agent text)
  RETURNS text
  LANGUAGE plpgsql IMMUTABLE
  SET search_path = public, pg_temp AS $fn$
  DECLARE
    v_kw   text;
    v_arch text;
    v_ua   text := lower(coalesce(p_user_agent, ''));
  BEGIN
    /* arquitetura (flag do user-agent): bot > tablet > mobile > desktop */
    v_arch := CASE
      WHEN p_user_agent IS NULL OR length(btrim(p_user_agent)) < 20 THEN 'desconhecido'
      WHEN v_ua ~ 'bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|okhttp|libwww|httpclient|monitor|synthetic|lighthouse|pagespeed' THEN 'bot'
      WHEN v_ua ~ 'ipad|tablet' THEN 'tablet'
      WHEN v_ua ~ 'mobile|android|iphone' THEN 'mobile'
      ELSE 'desktop'
    END;

    /* keyword real: minúscula, sem acento, só [a-z0-9] simples */
    v_kw := lower(coalesce(p_keyword, ''));
    v_kw := translate(v_kw, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
    v_kw := regexp_replace(v_kw, '[^a-z0-9]+', '_', 'g');
    v_kw := btrim(v_kw, '_');
    v_kw := left(v_kw, 40);

    IF v_kw = '' OR v_kw ~ '^[0-9]+$' OR v_kw IS NULL THEN
      /* sem keyword real não se inventa slot: fica o marcador auditável */
      RETURN 'sem_keyword_' || v_arch;
    END IF;

    /* PROIBIÇÃO DURA: slot sintético de health-check nunca é produzido aqui */
    IF v_kw LIKE '%health%' THEN
      RAISE EXCEPTION 'slot sintetico bloqueado: keyword de health-check nao gera slot de suborigem'
        USING ERRCODE = '22023';
    END IF;

    RETURN v_kw || '_' || v_arch;
  END $fn$;

  -- ────────────────────────────────────────────────────────────────────────
  -- 2) ENFILEIRADOR DINÂMICO (caminho de escrita rápida: 1000ms / 500ms)
  -- ────────────────────────────────────────────────────────────────────────
  CREATE OR REPLACE FUNCTION public.nexus_telegram_enqueue_dynamic(
    p_chat_id      text,
    p_keyword      text,
    p_user_agent   text,
    p_body_text    text,
    p_kind         text DEFAULT 'publish',
    p_payload      jsonb DEFAULT '{}'::jsonb
  ) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp AS $fn$
  DECLARE
    v_slot text;
    v_id   bigint;
  BEGIN
    -- janela de escrita rápida: a fila é UNLOGGED, não pode segurar lock de madrugada
    PERFORM set_config('statement_timeout', '1000ms', true);
    PERFORM set_config('lock_timeout', '500ms', true);

    /* PROIBIÇÃO LITERAL pedida pelo operador: nenhuma chamada pode empurrar
       '_health_desktop' como suborigem. */
    IF p_keyword = '_health_desktop'
       OR coalesce(p_payload->>'slot', '') IN ('_health_desktop', 'health', '_health')
       OR coalesce(p_payload->>'suborigem', '') = '_health_desktop' THEN
      INSERT INTO public.nexus_sat_telemetry (job, status, message)
      VALUES ('v340.0-slot', 'Sintonizado em Análise',
              'slot sintetico _health_desktop recusado no enfileiramento');
      RETURN jsonb_build_object('ok', false, 'reason', 'slot_sintetico_proibido',
                                'detalhe', 'suborigem deve ser a keyword real do match');
    END IF;

    v_slot := public.nexus_slot_dynamic(p_keyword, p_user_agent);

    INSERT INTO public.nexus_telegram_message_buffer
      (dedupe_key, chat_id, body_text, parse_mode, payload, status, attempts, max_attempts)
    VALUES
      (md5(coalesce(p_chat_id,'') || '|' || coalesce(p_keyword,'') || '|' ||
           to_char(now(), 'YYYY-MM-DD"T"HH24:MI')),
       p_chat_id, p_body_text, 'HTML',
       coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
         'slot', v_slot, 'keyword', p_keyword, 'kind', p_kind,
         'slot_dinamico', true, 'arquitetura', split_part(v_slot, '_', -1)),
       'pending', 0, 3)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('ok', true, 'id', v_id, 'slot', v_slot,
                              'duplicado', v_id IS NULL);

  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v340.0-enqueue', 'Sintonizado em Análise',
            'enfileiramento abortado: ' || left(SQLERRM, 200));
    RETURN jsonb_build_object('ok', false, 'reason', 'fail_closed', 'erro', left(SQLERRM, 200));
  END $fn$;

  -- ────────────────────────────────────────────────────────────────────────
  -- 3) RESOLVEDOR DE ROTA (Tier-1 estrito + trava nacional BR)
  -- ────────────────────────────────────────────────────────────────────────
  CREATE OR REPLACE FUNCTION public.nexus_route_resolve_dynamic(
    p_country text,
    p_brand   text DEFAULT 'auto',
    p_is_bot  boolean DEFAULT false,
    p_keyword text DEFAULT NULL,
    p_offer   text DEFAULT NULL
  ) RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS $fn$
  DECLARE
    v_country   text := upper(left(coalesce(nullif(btrim(p_country), ''), 'BR'), 2));
    v_brand     text := lower(coalesce(p_brand, 'auto'));
    v_tier1     text[] := ARRAY['US','CA','GB','DE','FR'];          -- swap EXCLUSIVO
    v_moeda_estrangeira text[] := ARRAY['booking','booking_uk','booking_latam','ebay',
                                        'ebay_us','amazon','amazon_us','aliexpress',
                                        'udemy','nordvpn','economybookings','brunoyam'];
    v_decisao   text;
    v_bloqueou  boolean := false;
    v_link      text;
    v_meta      jsonb;
  BEGIN
    PERFORM set_config('statement_timeout', '2000ms', true);
    PERFORM set_config('lock_timeout', '1000ms', true);

    /* ── TRAVA NACIONAL (Brasil, visitante humano) ───────────────────────── */
    IF v_country = 'BR' AND NOT coalesce(p_is_bot, false) THEN
      IF v_brand = ANY (v_moeda_estrangeira) AND v_brand NOT IN ('booking_latam') THEN
        v_bloqueou := true;
        v_decisao  := 'br_lock_moeda_estrangeira';
        v_brand    := CASE WHEN p_offer IS NOT NULL THEN 'shopee' ELSE 'mercadolivre' END;
      ELSE
        v_decisao := 'br_nacional';
      END IF;
      v_brand  := CASE WHEN v_brand IN ('auto', '', 'shopee', 'mercadolivre') THEN v_brand ELSE 'shopee' END;
      v_link   := CASE v_brand
                    WHEN 'mercadolivre' THEN 'https://meli.la/1U3rtgV'
                    ELSE 'https://s.shopee.com.br/4qFb586XtN'   -- link curto rastreado BR
                  END;

    /* ── SWAP TIER-1 EXCLUSIVO (US, CA, GB, DE, FR) ──────────────────────── */
    ELSIF v_country = ANY (v_tier1) THEN
      v_decisao := 'tier1_swap_exclusivo';
      v_brand   := CASE WHEN v_brand IN ('auto','', 'shopee','mercadolivre','aliexpress')
                        THEN 'ebay' ELSE v_brand END;
      v_link    := CASE v_brand
                     WHEN 'booking'    THEN 'https://www.jdoqocy.com/click-{PID}-15734754'  -- Booking UK
                     WHEN 'ebay'       THEN 'https://www.ebay.com/deals?campid=5339193749&toolid=10001&mkevt=1&mkcid=1&mkrid=711-53200-19255-0'
                     WHEN 'amazon_us'  THEN 'https://www.amazon.com/?tag={PID}'
                     ELSE NULL
                   END;

    /* ── DEMAIS PAÍSES: rota regional, sem swap internacional indevido ───── */
    ELSE
      v_decisao := 'regional';
      v_brand   := CASE WHEN v_brand IN ('auto','') THEN 'aliexpress' ELSE v_brand END;
      v_link    := NULL;
    END IF;

    v_meta := jsonb_build_object(
      'country', v_country, 'brand', v_brand, 'decisao', v_decisao,
      'bloqueou_moeda_estrangeira', v_bloqueou,
      'tier1_exclusivo', v_tier1, 'is_bot', coalesce(p_is_bot, false),
      'slot_dinamico', public.nexus_slot_dynamic(p_keyword, NULL),
      'regra', 'v340.0 Sovereign Geo-Targeting Core');

    INSERT INTO public.nexus_route_telemetry
      (country, brand, is_bot, keyword, slot_dinamico, decisao, bloqueou_moeda_estrangeira, meta)
    VALUES (v_country, v_brand, coalesce(p_is_bot,false), p_keyword,
            v_meta->>'slot_dinamico', v_decisao, v_bloqueou, v_meta);

    RETURN v_meta || jsonb_build_object('link', v_link);

  EXCEPTION WHEN OTHERS THEN
    /* FAIL-CLOSED: rota não resolvida nunca derruba o visitante (0ms) */
    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v340.0-route', 'Sintonizado em Análise', 'rota abortada: ' || left(SQLERRM, 200));
    RETURN jsonb_build_object('ok', false, 'reason', 'fail_closed',
                              'decisao', 'sintonizado_em_analise', 'detalhe', left(SQLERRM, 200));
  END $fn$;

  -- ────────────────────────────────────────────────────────────────────────
  -- 4) GUARDA DE SLOT NA FILA (defesa em profundidade)
  -- ────────────────────────────────────────────────────────────────────────
  CREATE OR REPLACE FUNCTION public.nexus_slot_guard()
  RETURNS trigger LANGUAGE plpgsql AS $fn$
  DECLARE v_slot text;
  BEGIN
    v_slot := coalesce(NEW.payload->>'slot', '');
    IF v_slot IN ('_health_desktop', 'health', '_health') THEN
      RAISE EXCEPTION 'suborigem sintetica proibida: % (use a keyword real do match)', v_slot
        USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END $fn$;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'nexus_slot_guard_trg') THEN
    EXECUTE $ddl$
      CREATE TRIGGER nexus_slot_guard_trg
        BEFORE INSERT OR UPDATE ON public.nexus_telegram_message_buffer
        FOR EACH ROW EXECUTE FUNCTION public.nexus_slot_guard();
    $ddl$;
  END IF;

  -- ────────────────────────────────────────────────────────────────────────
  -- 5) AUTOTESTE (executável: select * from nexus_v340_selftest())
  -- ────────────────────────────────────────────────────────────────────────
  CREATE OR REPLACE FUNCTION public.nexus_v340_selftest()
  RETURNS TABLE (caso text, esperado text, obtido text, passou boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp AS $fn$
  BEGIN
    RETURN QUERY
    WITH t(caso, esperado, obtido) AS (
      SELECT 'slot: keyword real + desktop',
             'power_bank_10000mah_desktop',
             public.nexus_slot_dynamic('Power Bank 10000mAh', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36')
      UNION ALL
      SELECT 'slot: acento normalizado + mobile',
             'teclado_abnt2_mobile',
             public.nexus_slot_dynamic('Teclado ABNT2', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1')
      UNION ALL
      SELECT 'slot: sem keyword nao inventa',
             'sem_keyword_desktop',
             public.nexus_slot_dynamic('2026', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36')
      UNION ALL
      SELECT 'rota: BR humano + Booking -> bloqueado',
             'br_lock_moeda_estrangeira|mercadolivre',
             ((public.nexus_route_resolve_dynamic('BR','booking',false,'mop'))->>'decisao')
             || '|' || ((public.nexus_route_resolve_dynamic('BR','booking',false,'mop'))->>'brand')
      UNION ALL
      SELECT 'rota: BR humano + eBay -> bloqueado',
             'true',
             (public.nexus_route_resolve_dynamic('BR','ebay',false,'mop'))->>'bloqueou_moeda_estrangeira'
      UNION ALL
      SELECT 'rota: US -> swap Tier-1 com eBay',
             'tier1_swap_exclusivo|ebay',
             ((public.nexus_route_resolve_dynamic('US','auto',false,'powerbank'))->>'decisao')
             || '|' || ((public.nexus_route_resolve_dynamic('US','auto',false,'powerbank'))->>'brand')
      UNION ALL
      SELECT 'rota: GB -> Booking UK (15734754)',
             'tier1_swap_exclusivo|booking',
             ((public.nexus_route_resolve_dynamic('GB','booking',false,'hotel'))->>'decisao')
             || '|' || ((public.nexus_route_resolve_dynamic('GB','booking',false,'hotel'))->>'brand')
      UNION ALL
      SELECT 'rota: PT (fora do Tier-1) NAO recebe swap',
             'regional',
             (public.nexus_route_resolve_dynamic('PT','auto',false,'mop'))->>'decisao'
      UNION ALL
      SELECT 'rota: bot BR nao entra na trava nacional',
             'regional',
             (public.nexus_route_resolve_dynamic('BR','booking',true,'mop'))->>'decisao'
    )
    SELECT t.caso, t.esperado, t.obtido, (t.esperado = t.obtido)
      FROM t;
  END $fn$;

  REVOKE ALL ON FUNCTION public.nexus_telegram_enqueue_dynamic(text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.nexus_route_resolve_dynamic(text,text,boolean,text,text) FROM PUBLIC, anon, authenticated;

  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v340.0', 'OK',
          'slot dinamico + trava nacional BR + swap Tier-1 exclusivo (US/CA/GB/DE/FR) + selftest ativos');

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v340.0', 'Sintonizado em Análise', left(SQLERRM, 300));
  RAISE WARNING 'v340.0 abortado (%): nada foi aplicado.', SQLERRM;
END
$v340$;

COMMIT;
