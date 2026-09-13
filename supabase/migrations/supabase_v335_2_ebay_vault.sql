-- ============================================================================
-- supabase_v335_2_ebay_vault.sql — Cofre do eBay Partner Network (v335.2)
--
-- O QUE ESTE ARQUIVO NÃO CONTÉM: a chave KMS. Nenhuma chave é escrita em texto
-- plano aqui, no GitHub Actions ou no Cloudflare Pages. A chave chega em tempo de
-- execução como PARÂMETRO da função nexus_ebay_vault_bootstrap(), chamada em uma
-- única sentença — necessidade descoberta na prática: o pool de conexões da API
-- do Supabase troca a sessão entre statements, então set_config() em statement
-- separado se perde e a carga falhava (a migração registrou 'Sintonizado em
-- Análise' na telemetria em vez de gravar segredo com chave errada).
--
-- Valores conhecidos: Campaign ID 5339193749 (confirmado na interface do EPN pelo
-- operador e já em uso nos links do gateway). Account ID 7649512 fica marcado
-- como NÃO VERIFICADO por API (coluna de verificação em nexus_ebay_api_status).
--
-- Aditivo e idempotente. Não toca em nenhuma tabela existente.
-- ============================================================================

BEGIN;
SET LOCAL statement_timeout = '2000ms';
SET LOCAL lock_timeout = '1000ms';

DO $v3352$
DECLARE
  v_linhas int;
BEGIN
  CREATE TABLE IF NOT EXISTS public.nexus_ebay_campaign_vault (
    id                bigserial PRIMARY KEY,
    key_id            text NOT NULL UNIQUE DEFAULT 'epn_primary',
    network           text NOT NULL DEFAULT 'epn',
    site_id           text NOT NULL DEFAULT 'EBAY_US',
    campaign_id_enc   bytea NOT NULL,
    account_id_enc    bytea,
    campaign_id_hint  text,
    kms_key_id        text NOT NULL,
    rotated_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
  );

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'nexus_ebay_vault_guard') THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.nexus_ebay_vault_block_write()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'Cofre eBay e imutavel por escrita direta. Use as funcoes de bootstrap/rotacao.';
      END $fn$;
      CREATE TRIGGER nexus_ebay_vault_guard
        BEFORE UPDATE OR DELETE ON public.nexus_ebay_campaign_vault
        FOR EACH ROW EXECUTE FUNCTION public.nexus_ebay_vault_block_write();
    $ddl$;
  END IF;

  -- Resolvedor do Campaign ID: só devolve com a chave correta.
  CREATE OR REPLACE FUNCTION public.nexus_ebay_campaign(p_kms text)
  RETURNS TABLE (campaign_id text, account_id text, site_id text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
  BEGIN
    IF p_kms IS NULL OR length(p_kms) < 16 THEN
      RETURN;
    END IF;
    -- Colunas qualificadas: os nomes de saída (campaign_id/site_id) colidiriam
    -- com as colunas da tabela (erro 42702 'column reference is ambiguous').
    RETURN QUERY
      SELECT pgp_sym_decrypt(v.campaign_id_enc, p_kms)::text,
             CASE WHEN v.account_id_enc IS NOT NULL
                  THEN pgp_sym_decrypt(v.account_id_enc, p_kms)::text END,
             v.site_id
        FROM public.nexus_ebay_campaign_vault v
       WHERE v.key_id = 'epn_primary';
  END $fn$;

  -- Rotação de chave KMS
  CREATE OR REPLACE FUNCTION public.nexus_ebay_vault_rotate(p_kms_antiga text, p_kms_nova text, p_campaign_id text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
  DECLARE v_ok boolean;
  BEGIN
    IF p_kms_nova IS NULL OR length(p_kms_nova) < 16 THEN RETURN 'chave_nova_invalida'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.nexus_ebay_campaign_vault v
                    WHERE v.key_id='epn_primary'
                      AND pgp_sym_decrypt(v.campaign_id_enc, p_kms_antiga)::text = p_campaign_id) INTO v_ok;
    IF NOT v_ok THEN RETURN 'campaign_id_nao_confere'; END IF;
    ALTER TABLE public.nexus_ebay_campaign_vault DISABLE TRIGGER nexus_ebay_vault_guard;
    UPDATE public.nexus_ebay_campaign_vault
       SET campaign_id_enc = pgp_sym_encrypt(p_campaign_id, p_kms_nova),
           kms_key_id = 'epn_kms_' || left(encode(extensions.digest(p_kms_nova,'sha256'),'hex'), 8),
           rotated_at = now(), updated_at = now()
     WHERE key_id = 'epn_primary';
    ALTER TABLE public.nexus_ebay_campaign_vault ENABLE TRIGGER nexus_ebay_vault_guard;
    RETURN 'rotacionado';
  END $fn$;

  -- Carga do segredo: a chave viaja como PARÂMETRO (imune ao pooling de conexões).
  CREATE OR REPLACE FUNCTION public.nexus_ebay_vault_bootstrap(
    p_kms text,
    p_campaign_id text DEFAULT '5339193749',
    p_account_id  text DEFAULT '7649512'
  ) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
  DECLARE v_id bigint;
  BEGIN
    IF p_kms IS NULL OR length(p_kms) < 16 THEN
      INSERT INTO public.nexus_sat_telemetry (job, status, message)
      VALUES ('v335.2-ebay-vault', 'Sintonizado em Análise', 'bootstrap sem chave KMS valida');
      RETURN 'kms_invalida';
    END IF;
    IF EXISTS (SELECT 1 FROM public.nexus_ebay_campaign_vault WHERE key_id='epn_primary') THEN
      RETURN 'ja_existe';
    END IF;
    INSERT INTO public.nexus_ebay_campaign_vault
      (key_id, site_id, campaign_id_enc, account_id_enc, campaign_id_hint, kms_key_id)
    VALUES ('epn_primary', 'EBAY_US',
            pgp_sym_encrypt(p_campaign_id, p_kms),
            pgp_sym_encrypt(p_account_id,  p_kms),
            right(p_campaign_id, 4),
            'epn_kms_' || left(encode(extensions.digest(p_kms,'sha256'),'hex'), 8))
    RETURNING id INTO v_id;
    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v335.2-ebay-vault', 'OK', 'campaign_id cifrado com pgp_sym_encrypt (id=' || v_id || ')');
    RETURN 'gravado';
  END $fn$;

  REVOKE ALL ON FUNCTION public.nexus_ebay_campaign(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.nexus_ebay_campaign(text) FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.nexus_ebay_vault_rotate(text,text,text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.nexus_ebay_vault_rotate(text,text,text) FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.nexus_ebay_vault_bootstrap(text,text,text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.nexus_ebay_vault_bootstrap(text,text,text) FROM anon, authenticated;

  SELECT count(*) INTO v_linhas FROM public.nexus_ebay_campaign_vault;
  RAISE NOTICE 'v335.2: estrutura pronta; registros no cofre: %', v_linhas;

  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v335.2-ebay-vault', 'OK', 'cofre epn_primary pronto; campaign_id cifrado; kms nunca versionado');

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'v335.2 abortado (%): nada foi aplicado.', SQLERRM;
  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v335.2-ebay-vault', 'Sintonizado em Análise', left(SQLERRM, 300));
END
$v3352$;

COMMIT;
