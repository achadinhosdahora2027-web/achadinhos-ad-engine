-- ============================================================================
-- supabase_v336_ebay_api_auth.sql — Credenciais da API do eBay no cofre (v336.0)
--
-- BLINDAGEM KEYLESS (regra do operador, aplicada à risca):
--  • Este arquivo NÃO contém Client ID nem Client Secret. Eles chegam como
--    PARÂMETROS de nexus_ebay_api_bootstrap(), numa única sentença: a credencial
--    viaja no corpo da consulta autenticada, nunca em texto plano no GitHub
--    Actions, no Cloudflare Pages ou no repositório.
--  • No banco só existem colunas bytea cifradas com pgp_sym_encrypt() e o KMS
--    (nexus_satellites_kms) fornecido em runtime.
--  • Leitura apenas por funções SECURITY DEFINER com EXECUTE revogado de
--    PUBLIC/anon/authenticated.
--  • STATUS HONESTO: as credenciais recebidas NÃO autenticaram em teste real
--    (OAuth client_credentials → HTTP 401 invalid_client, produção E sandbox, em
--    13/09/2026; o Client ID também não segue o formato do eBay Developer
--    Program, que contém 'PRD'). Ficam gravadas como PENDENTES e o orquestrador
--    RECUSA usá-las até uma verificação bem-sucedida.
-- ============================================================================

BEGIN;
SET LOCAL statement_timeout = '2000ms';
SET LOCAL lock_timeout = '1000ms';

DO $v336$
BEGIN
  ALTER TABLE public.nexus_ebay_campaign_vault ADD COLUMN IF NOT EXISTS client_id_enc      bytea;
  ALTER TABLE public.nexus_ebay_campaign_vault ADD COLUMN IF NOT EXISTS client_secret_enc  bytea;
  ALTER TABLE public.nexus_ebay_campaign_vault ADD COLUMN IF NOT EXISTS client_id_hint     text;
  ALTER TABLE public.nexus_ebay_campaign_vault ADD COLUMN IF NOT EXISTS verified_at        timestamptz;
  ALTER TABLE public.nexus_ebay_campaign_vault ADD COLUMN IF NOT EXISTS verification_note  text;
  ALTER TABLE public.nexus_ebay_campaign_vault ADD COLUMN IF NOT EXISTS verification_tries integer NOT NULL DEFAULT 0;

  CREATE OR REPLACE FUNCTION public.nexus_ebay_api_bootstrap(
    p_kms text, p_client_id text, p_client_secret text, p_account_id text DEFAULT '7649512'
  ) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
  BEGIN
    IF p_kms IS NULL OR length(p_kms) < 16 THEN
      INSERT INTO public.nexus_sat_telemetry (job, status, message)
      VALUES ('v336.0-ebay-api', 'Sintonizado em Análise', 'bootstrap sem KMS valido');
      RETURN 'kms_invalida';
    END IF;
    IF coalesce(length(p_client_id),0) < 10 OR coalesce(length(p_client_secret),0) < 10 THEN
      INSERT INTO public.nexus_sat_telemetry (job, status, message)
      VALUES ('v336.0-ebay-api', 'Sintonizado em Análise', 'credenciais ausentes ou curtas demais');
      RETURN 'credenciais_invalidas';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.nexus_ebay_campaign_vault WHERE key_id = 'epn_primary') THEN
      RETURN 'cofre_ausente';
    END IF;

    ALTER TABLE public.nexus_ebay_campaign_vault DISABLE TRIGGER nexus_ebay_vault_guard;
    UPDATE public.nexus_ebay_campaign_vault v
       SET client_id_enc     = pgp_sym_encrypt(p_client_id,     p_kms),
           client_secret_enc = pgp_sym_encrypt(p_client_secret, p_kms),
           client_id_hint    = left(p_client_id, 4) || '…' || right(p_client_id, 4),
           verified_at       = NULL,   -- só um handshake real habilita o uso
           verification_note = 'aguardando handshake OAuth bem-sucedido',
           updated_at        = now()
     WHERE v.key_id = 'epn_primary';
    ALTER TABLE public.nexus_ebay_campaign_vault ENABLE TRIGGER nexus_ebay_vault_guard;

    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v336.0-ebay-api', 'OK', 'credenciais cifradas; verificacao pendente');
    RETURN 'gravado';
  END $fn$;

  CREATE OR REPLACE FUNCTION public.nexus_ebay_api_credentials(p_kms text)
  RETURNS TABLE (client_id text, client_secret text, verified boolean, campaign_id text, account_id text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
  BEGIN
    IF p_kms IS NULL OR length(p_kms) < 16 THEN RETURN; END IF;  -- fail-closed
    RETURN QUERY
      SELECT pgp_sym_decrypt(v.client_id_enc, p_kms)::text,
             pgp_sym_decrypt(v.client_secret_enc, p_kms)::text,
             (v.verified_at IS NOT NULL) AS verified,
             pgp_sym_decrypt(v.campaign_id_enc, p_kms)::text,
             CASE WHEN v.account_id_enc IS NOT NULL THEN pgp_sym_decrypt(v.account_id_enc, p_kms)::text END
        FROM public.nexus_ebay_campaign_vault v
       WHERE v.key_id = 'epn_primary' AND v.client_id_enc IS NOT NULL;
  END $fn$;

  -- Registro da verificação: só marca verificado com handshake 200 de verdade.
  CREATE OR REPLACE FUNCTION public.nexus_ebay_api_mark_verification(p_ok boolean, p_note text)
  RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  BEGIN
    ALTER TABLE public.nexus_ebay_campaign_vault DISABLE TRIGGER nexus_ebay_vault_guard;
    UPDATE public.nexus_ebay_campaign_vault v
       SET verified_at        = CASE WHEN p_ok THEN now() ELSE NULL END,
           verification_note  = left(coalesce(p_note,''), 400),
           verification_tries = v.verification_tries + 1,
           updated_at         = now()
     WHERE v.key_id = 'epn_primary';
    ALTER TABLE public.nexus_ebay_campaign_vault ENABLE TRIGGER nexus_ebay_vault_guard;

    INSERT INTO public.nexus_sat_telemetry (job, status, message)
    VALUES ('v336.0-ebay-api', CASE WHEN p_ok THEN 'OK' ELSE 'Sintonizado em Análise' END,
            left(coalesce(p_note,''), 300));
    RETURN CASE WHEN p_ok THEN 'verificado' ELSE 'mantido_pendente' END;
  END $fn$;

  -- Visão de status SEM segredo e SEM ciphertext
  DROP VIEW IF EXISTS public.nexus_ebay_api_status;
  CREATE VIEW public.nexus_ebay_api_status AS
    SELECT v.key_id, v.site_id, v.campaign_id_hint, v.client_id_hint,
           (v.verified_at IS NOT NULL) AS credencial_verificada,
           v.verified_at, v.verification_note, v.verification_tries,
           (v.client_id_enc IS NOT NULL) AS tem_client_id,
           (v.client_secret_enc IS NOT NULL) AS tem_client_secret,
           v.updated_at
      FROM public.nexus_ebay_campaign_vault v;

  REVOKE ALL ON FUNCTION public.nexus_ebay_api_bootstrap(text,text,text,text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.nexus_ebay_api_bootstrap(text,text,text,text) FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.nexus_ebay_api_credentials(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.nexus_ebay_api_credentials(text) FROM anon, authenticated;
  REVOKE ALL ON FUNCTION public.nexus_ebay_api_mark_verification(boolean,text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.nexus_ebay_api_mark_verification(boolean,text) FROM anon, authenticated;

  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v336.0-ebay-api', 'OK', 'cofre de API pronto: colunas cifradas + leitura security definer + status publico');

EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.nexus_sat_telemetry (job, status, message)
  VALUES ('v336.0-ebay-api', 'Sintonizado em Análise', left(SQLERRM, 300));
  RAISE WARNING 'v336.0 abortado (%): nada aplicado.', SQLERRM;
END
$v336$;

COMMIT;
