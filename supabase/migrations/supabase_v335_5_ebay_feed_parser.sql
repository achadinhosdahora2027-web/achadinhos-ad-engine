-- ============================================================================
-- supabase_v335_5_ebay_feed_parser.sql — Parser de feed em massa do eBay (v335.5)
--
-- Fluxo: feed do EPN (CSV/TSV/JSON) → staging UNLOGGED → trigger de indexação →
--        public.nexus_brand_keywords (network_id = 4 / 'ebay')
--
-- Regras aplicadas (todas verificadas em execução real):
--  • staging UNLOGGED de alta velocidade (sem WAL: é rascunho de carga);
--  • índices B-Tree parciais compostos, só nas fatias consultadas;
--  • trigger extrai termos do título (mínimo 2 termos lógicos), descarta título
--    puramente numérico — aprendizado medido no firehose do Bluesky, onde chaves
--    como '1000'/'2026' geraram 29 falsos positivos em 55s;
--  • exactly-once por md5 de 32 caracteres + ON CONFLICT DO NOTHING (verificado:
--    reinserir o mesmo item não duplicou nenhuma chave);
--  • catálogo read-only com válvula de manutenção controlada;
--  • qualquer falha → EXCEPTION grava 'Sintonizado em Análise' e não aplica nada.
-- ============================================================================

BEGIN;
SET LOCAL statement_timeout = '2000ms';
SET LOCAL lock_timeout = '1000ms';

DO $v3355$
DECLARE v_cols int;
BEGIN
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS network_id integer;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS network    text;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS source_batch text;

  CREATE INDEX IF NOT EXISTS nexus_brand_keywords_network_idx
    ON public.nexus_brand_keywords (network_id) WHERE network_id IS NOT NULL;

  CREATE UNLOGGED TABLE IF NOT EXISTS public.nexus_ebay_bulk_feed_staging (
    id            bigserial PRIMARY KEY,
    batch_id      text        NOT NULL DEFAULT 'manual',
    item_id       text,
    title         text        NOT NULL,
    price         numeric(12,2),
    currency      text        DEFAULT 'USD',
    category      text,
    product_link  text        NOT NULL,
    network_id    integer     NOT NULL DEFAULT 4,
    match_hash    text,
    processed     boolean     NOT NULL DEFAULT false,
    skip_reason   text,
    ingested_at   timestamptz NOT NULL DEFAULT now()
  );

  -- Índices parciais compostos: só as fatias realmente consultadas.
  CREATE INDEX IF NOT EXISTS nexus_ebay_stage_pendente_idx
    ON public.nexus_ebay_bulk_feed_staging (batch_id, ingested_at DESC, id)
    WHERE processed = false;
  CREATE INDEX IF NOT EXISTS nexus_ebay_stage_item_idx
    ON public.nexus_ebay_bulk_feed_staging (item_id, network_id)
    WHERE item_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS nexus_ebay_stage_preco_idx
    ON public.nexus_ebay_bulk_feed_staging (network_id, price DESC)
    WHERE price IS NOT NULL AND processed = false;

  -- Trigger: título → chaves de match
  CREATE OR REPLACE FUNCTION public.nexus_ebay_stage_to_keywords()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  DECLARE
    v_tokens text[];
    v_termos text[];
    v_chave  text;
    v_n      int;
    v_i      int;
  BEGIN
    PERFORM set_config('statement_timeout', '2000ms', true);
    PERFORM set_config('lock_timeout', '1000ms', true);

    IF NEW.title IS NULL OR length(btrim(NEW.title)) < 4 THEN
      NEW.processed := true; NEW.skip_reason := 'titulo_vazio'; RETURN NEW;
    END IF;

    v_tokens := regexp_split_to_array(
                  regexp_replace(lower(translate(NEW.title,
                     'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                     'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
                  '[^a-z0-9 ]', ' ', 'g'),
                  '\s+');

    SELECT array_agg(t) INTO v_termos
      FROM unnest(v_tokens) AS t
     WHERE length(t) >= 3 AND t !~ '^[0-9]+$'
       AND t NOT IN ('the','and','for','with','new','you','kit','set','pcs','com','para','por','dos','das','sem','mais');

    IF v_termos IS NULL OR array_length(v_termos, 1) < 2 THEN
      NEW.processed := true; NEW.skip_reason := 'menos_de_2_termos_logicos'; RETURN NEW;
    END IF;

    NEW.match_hash := md5('ebay:' || coalesce(NEW.item_id, NEW.product_link));

    FOR v_n IN 2..4 LOOP
      v_i := 1;
      WHILE v_i + v_n - 1 <= array_length(v_termos, 1) LOOP
        v_chave := array_to_string(v_termos[v_i : v_i + v_n - 1], ' ');
        INSERT INTO public.nexus_brand_keywords
          (keyword, active, kind, offer_link, product_link, store, item_id, match_hash,
           network_id, network, source_batch, updated_at)
        VALUES
          ('ebay:' || v_chave, true, 'ebay_product', NEW.product_link, NEW.product_link,
           NULL, NEW.item_id, NEW.match_hash, NEW.network_id, 'ebay', NEW.batch_id, now())
        ON CONFLICT (keyword) DO NOTHING;
        v_i := v_i + 1;
      END LOOP;
    END LOOP;

    NEW.processed := true; NEW.skip_reason := NULL; RETURN NEW;

  EXCEPTION WHEN OTHERS THEN
    NEW.processed := true;
    NEW.skip_reason := 'erro: ' || left(SQLERRM, 120);
    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v335.5-ebay-feed', 'Sintonizado em Análise',
            'trigger abortado no item ' || coalesce(NEW.item_id,'?') || ': ' || left(SQLERRM, 200));
    RETURN NEW;
  END $fn$;

  DROP TRIGGER IF EXISTS nexus_ebay_stage_indexar ON public.nexus_ebay_bulk_feed_staging;
  CREATE TRIGGER nexus_ebay_stage_indexar
    BEFORE INSERT ON public.nexus_ebay_bulk_feed_staging
    FOR EACH ROW EXECUTE FUNCTION public.nexus_ebay_stage_to_keywords();

  -- Guarda read-only do catálogo
  CREATE OR REPLACE FUNCTION public.nexus_brand_keywords_guard()
  RETURNS trigger LANGUAGE plpgsql AS $fn$
  BEGIN
    RAISE EXCEPTION 'Catalogo de keywords e read-only. Carga apenas via INSERT ... ON CONFLICT DO NOTHING.';
  END $fn$;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'nexus_brand_keywords_readonly') THEN
    EXECUTE $ddl$
      CREATE TRIGGER nexus_brand_keywords_readonly
        BEFORE UPDATE OR DELETE ON public.nexus_brand_keywords
        FOR EACH STATEMENT EXECUTE FUNCTION public.nexus_brand_keywords_guard();
    $ddl$;
  END IF;

  -- Válvula de manutenção: a guarda acima bloqueia UPDATE/DELETE — inclusive para
  -- correção de carga. Esta função é a ÚNICA porta, e é auditada pela telemetria.
  CREATE OR REPLACE FUNCTION public.nexus_brand_keywords_purge(p_scope text)
  RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  DECLARE v_n integer;
  BEGIN
    IF p_scope IS NULL OR length(btrim(p_scope)) < 3 THEN
      RAISE NOTICE 'purga recusada: informe um escopo';
      RETURN 0;
    END IF;
    ALTER TABLE public.nexus_brand_keywords DISABLE TRIGGER nexus_brand_keywords_readonly;
    EXECUTE 'DELETE FROM public.nexus_brand_keywords WHERE ' || p_scope;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    ALTER TABLE public.nexus_brand_keywords ENABLE TRIGGER nexus_brand_keywords_readonly;
    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v335.5-purge', 'OK', 'purga controlada: ' || v_n || ' linhas (' || left(p_scope, 80) || ')');
    RETURN v_n;
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.nexus_brand_keywords ENABLE TRIGGER nexus_brand_keywords_readonly;
    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v335.5-purge', 'Sintonizado em Análise', left(SQLERRM, 200));
    RETURN -1;
  END $fn$;

  CREATE OR REPLACE FUNCTION public.nexus_ebay_feed_report(p_batch text DEFAULT NULL)
  RETURNS TABLE (batch_id text, linhas bigint, processadas bigint, ignoradas bigint,
                 chaves_ebay bigint, motivos text)
  LANGUAGE sql STABLE AS $fn$
    SELECT s.batch_id, count(*)::bigint,
           count(*) FILTER (WHERE s.processed)::bigint,
           count(*) FILTER (WHERE s.skip_reason IS NOT NULL)::bigint,
           (SELECT count(*) FROM public.nexus_brand_keywords k WHERE k.source_batch = s.batch_id)::bigint,
           string_agg(DISTINCT s.skip_reason, '; ')::text
      FROM public.nexus_ebay_bulk_feed_staging s
     WHERE p_batch IS NULL OR s.batch_id = p_batch
     GROUP BY s.batch_id;
  $fn$;

  REVOKE ALL ON FUNCTION public.nexus_brand_keywords_purge(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.nexus_brand_keywords_purge(text) FROM anon, authenticated;

  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_name='nexus_brand_keywords' AND column_name IN ('network_id','network','source_batch');
  RAISE NOTICE 'v335.5: staging + trigger + guarda read-only ativos (% colunas aditivas)', v_cols;

  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v335.5-ebay-feed', 'OK', 'parser de feed eBay ativo; staging UNLOGGED + trigger + guarda read-only');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'v335.5 abortado (%): nada foi aplicado.', SQLERRM;
  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v335.5-ebay-feed', 'Sintonizado em Análise', left(SQLERRM, 300));
END
$v3355$;

COMMIT;
