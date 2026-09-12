-- ═══════════════════════════════════════════════════════════════════════════════
-- supabase_v128_6_bluesky_cluster_expansion.sql — MATRIX CORE v128.6
-- Expansão do cluster Bluesky: +3 casas (digitalofferss, feverforer, gnewsyou)
-- Data: 2026-09-12 · Mandato: Veracidade Radical · ToS White-Hat estrito
-- ═══════════════════════════════════════════════════════════════════════════════
-- CREDENCIAIS: handle/DID públicos abaixo e no cofre. As app-passwords foram
-- injetadas CIFRADAS (pgp_sym_encrypt + KMS) em nexus_growth_secrets por canal
-- seguro em 12/09 — NUNCA versionadas em texto (repos públicos).
-- Padrão idêntico ao das 7 casas existentes (contrato: nexus_v165_5_bluesky_cred).
-- IDEMPOTENTE · 100% aditiva · catálogo/VENDAS/Telegram intocados.
-- ═══════════════════════════════════════════════════════════════════════════════

-- A) TELEMETRIA DE POSTS (trigger do outbox): reconhece os 3 novos DIDs
CREATE OR REPLACE FUNCTION public.nexus_bluesky_cluster_post_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  begin
    perform public.nexus_cron_telemetry_log('bluesky-cluster', 'ok', 'edge', null, 0, 1,
      'post publicado casa=' || case
        when new.external_post_id like '%wdt6qgqimvipdwviha6cxtqg%' then 'aquiitem'
        when new.external_post_id like '%5lgcxtmtdg2xmzyqdcierdcl%' then 'offersnow'
        when new.external_post_id like '%sbhs3t46ainlzlkl5rzhvweg%' then 'getsave'
        when new.external_post_id like '%ggcjfeyu2felsj2wealtpwq5%' then 'gettingeasy'
        when new.external_post_id like '%5yw6x5etmabfiuxs65uwigfi%' then 'bestforya'
        when new.external_post_id like '%kuyrehojsw7ypnrxswg3cvxd%' then 'thebestones'
        when new.external_post_id like '%q3uscebnqlvhzbdgjl5rgvzc%' then 'justbuying'
        when new.external_post_id like '%4bhp3qn6bmrkrfzprppfpt72%' then 'digitalofferss'
        when new.external_post_id like '%2xuggxgnj5x25up6rknzylg6%' then 'feverforer'
        when new.external_post_id like '%uf3qyd2kzvbbhpbzyhatwhny%' then 'gnewsyou'
        else '?' end, null);
  exception when others then null; -- log isolado — NUNCA quebra o UPDATE do outbox
  end;
  return new;
end $function$;


-- B) RÓTULO DE PERFIL (sid → casa legível)
CREATE OR REPLACE FUNCTION public.nexus_clean_profile_label(p_sid text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_parts text[]; v_house text; v_channel text;
begin
  if p_sid is null or btrim(p_sid) = '' then return null; end if;
  v_parts := string_to_array(lower(btrim(p_sid)), '_');
  v_channel := case
    when p_sid ~* 'mention|care' then 'resposta de atendimento'
    when p_sid ~* 'oferta' then 'oferta publicada'
    when p_sid ~* 'reply|resposta' then 'resposta da casa'
    when p_sid ~* 'header' then 'anúncio do site'
    when p_sid ~* 'sticky' then 'anúncio fixo do site'
    when p_sid ~* 'city|flight|hotel|rental' then 'página de cidade do site'
    when p_sid ~* 'test|bateria|audit' then 'teste interno'
    else null
  end;
  if v_parts[1] = 'mastodon' and array_length(v_parts, 1) >= 2 then
    v_house := 'Mastodon · conta ' || initcap(v_parts[2]);
  elsif v_parts[1] = 'reddit' and array_length(v_parts, 1) >= 2 then
    v_house := 'Reddit · conta ' || case v_parts[2]
      when 'aquitembot' then 'AquitemBot' when 'aquitemoffers' then 'AquitemOffers'
      else initcap(v_parts[2]) end;
  elsif v_parts[1] = 'bluesky' and array_length(v_parts, 1) >= 2 then
    v_house := case v_parts[2]
      when 'offersnow' then 'OffersNow' when 'getsave' then 'GetSave'
      when 'gettingeasy' then 'GettingEasy' when 'bestforya' then 'BestForYa'
      when 'thebestones' then 'TheBestOnes' when 'justbuying' then 'JustBuying'
      when 'digitalofferss' then 'DigitalOffers' when 'feverforer' then 'FeverForer'
      when 'gnewsyou' then 'GNewsYou'
      when 'aquiitem' then 'Aquiitem' else initcap(v_parts[2]) end;
  else
    v_house := case v_parts[1]
      when 'aquitemachadinhos' then 'Aqui Tem Achadinhos'
      when 'solvegrid' then 'SolveGrid'
      when 'public' then 'Menção pública capturada'
      else null
    end;
  end if;
  if v_house is null then
    return initcap(replace(left(btrim(p_sid), 44), '_', ' '));
  end if;
  return v_house || case when v_channel is not null then ' — ' || v_channel else '' end;
exception when others then return left(coalesce(p_sid, 'Processando no Banco'), 44);
end $function$;


-- C) FORENSE DE CLIQUES (sid → suborigem por casa)
CREATE OR REPLACE FUNCTION public.nexus_click_forensics_suborigin(p_sid text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_sid like 'bluesky_aquiitem%'    then 'bluesky_aquiitem'
    when p_sid like 'bluesky_offersnow%'   then 'bluesky_offersnow'
    when p_sid like 'bluesky_getsave%'     then 'bluesky_getsave'
    when p_sid like 'bluesky_gettingeasy%' then 'bluesky_gettingeasy'
    when p_sid like 'bluesky_bestforya%'   then 'bluesky_bestforya'
    when p_sid like 'bluesky_thebestones%' then 'bluesky_thebestones'
    when p_sid like 'bluesky_justbuying%'  then 'bluesky_justbuying'
    when p_sid like 'bluesky_digitalofferss%' then 'bluesky_digitalofferss'
    when p_sid like 'bluesky_feverforer%' then 'bluesky_feverforer'
    when p_sid like 'bluesky_gnewsyou%' then 'bluesky_gnewsyou'
    when p_sid like 'reddit_aquitembot%'    then 'reddit_aquitembot'
    when p_sid like 'reddit_aquitemoffers%' then 'reddit_aquitemoffers'
    when p_sid like 'mastodon_gettingeasy%' then 'mastodon_gettingeasy'
    when p_sid like 'mastodon_savegrid%'    then 'mastodon_savegrid'
    when p_sid like 'mastodon_orderingfor%'  then 'mastodon_orderingfor'
    when p_sid like 'mastodon_offers%'  then 'mastodon_offers'
    when p_sid like 'public_mention_care%'  then 'mention_care_global'
    when p_sid like 'zernio_instagram%'  then 'zernio_instagram'
    when p_sid like 'zernio_pinterest%'  then 'zernio_pinterest'
    when p_sid like 'zernio_threads%'    then 'zernio_threads'
    when p_sid like 'socialapi_official%' then 'socialapi_oficial'
    when p_sid like 'telegram_ofertas_c2%' then 'telegram_c2_ofertas'
    when p_sid like 'telegram_oraculo_c3%' then 'telegram_c3_oraculo'
    when p_sid like 'solvegrid_reply%'   then 'engajamento_reply'
    when p_sid like 'solvegrid_blast%'   then 'blast_social'
    when p_sid like 'aquitemachadinhos%' then 'anuncios_aquitem'
    when p_sid like 'solvegrid_oferta%'  then 'go_direto_sites'
    when coalesce(p_sid, '') = ''        then 'direto_sem_sid'
    else 'outros'
  end;
$function$;


-- D) YIELD POR CONTA (janela de cliques/receita por casa)
CREATE OR REPLACE FUNCTION public.nexus_v165_5_bluesky_yield(p_desde timestamp with time zone DEFAULT (now() - '7 days'::interval), p_ate timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  perform set_config('statement_timeout','4000', true);
  perform set_config('lock_timeout','1000', true);

  with base as (
    select * from public.ads_clicks
     where created_at >= p_desde and created_at < p_ate
       and click_ref ilike 'blue%'
  ),
  por_conta as (
    select c.h as conta,
           count(*) filter (where b.click_ref ilike '%'||c.h||'%') as cliques
      from (values ('gettingeasy'),('bestforya'),('thebestones'),('justbuying'),
                   ('aquiitem'),('getsave'),('offersnow'),('digitalofferss'),('feverforer'),('gnewsyou')) c(h)
      left join base b on b.click_ref ilike '%'||c.h||'%'
     group by c.h
  )
  select jsonb_build_object(
    'janela', jsonb_build_object('desde', p_desde, 'ate', p_ate),
    'cliques_total',  (select count(*) from base),
    'ips_unicos',     (select count(distinct ip_hash) from base),
    'humanos',        (select count(*) from base
                        where user_agent !~* 'bot|crawl|spider|preview|headless|curl|python|lexicore|skytab'),
    'paises',         (select count(distinct country) from base),
    'por_conta',      (select jsonb_object_agg(conta, cliques) from por_conta),
    -- cruzamento com receita: a razão de existir deste módulo
    'conversoes',     (select count(*) from public.affiliate_conversions
                        where created_at >= p_desde and created_at < p_ate),
    'comissao_usd',   (select coalesce(sum(commission_usd),0)::numeric(12,4)
                         from public.affiliate_conversions
                        where created_at >= p_desde and created_at < p_ate),
    'aferido_em',     now()
  ) into v;

  return v;
exception when others then
  perform public.nexus_v155_sintonizado('v165_5-yield', null, sqlerrm);
  return jsonb_build_object('veredito','Sintonizado em Analise','erro',left(sqlerrm,200));
end;
$function$;


-- E) SELF-CHECK DA EXPANSÃO (roda sempre)
do $$
declare
  r jsonb; v_falhas int := 0; v_old int; v_def text;
  v_esperado jsonb := '[{"slug":"digitalofferss","did":"did:plc:4bhp3qn6bmrkrfzprppfpt72"},{"slug":"feverforer","did":"did:plc:2xuggxgnj5x25up6rknzylg6"},{"slug":"gnewsyou","did":"did:plc:uf3qyd2kzvbbhpbzyhatwhny"}]'::jsonb;
  rec record;
begin
  set local statement_timeout = '8000';
  set local lock_timeout = '1000';

  -- E1. cred() resolve as 3 novas (senha cifrada decifrável + did/handle batem)
  for rec in select e->>'slug' AS slug, e->>'did' AS did from jsonb_array_elements(v_esperado) e loop
    r := public.nexus_v165_5_bluesky_cred(rec.slug);
    if r is null or coalesce(r->>'password','') = '' or r->>'did' <> rec.did then
      v_falhas := v_falhas + 1;
      raise notice 'v128.6 · FALHA cred(%) → %', rec.slug, coalesce(r::text,'null');
    else
      raise notice 'v128.6 · cred(%) OK (handle=%, did ok, senha decifrada)', rec.slug, r->>'handle';
    end if;
  end loop;

  -- E2. REGRESSÃO: as 7 casas originais mantêm credencial no cofre (existência,
  -- sem PGP em lote) + 1 canário de decifragem (aquiitem)
  select count(*) into v_old from (values ('aquiitem'),('getsave'),('offersnow'),
    ('gettingeasy'),('bestforya'),('thebestones'),('justbuying')) s(h)
   where not exists (select 1 from public.nexus_growth_secrets g
                      where g.key = 'bluesky_' || s.h || '_password_enc'
                        and coalesce(g.value,'') <> '');
  if public.nexus_v165_5_bluesky_cred('aquiitem') ->> 'password' is null then
    v_old := v_old + 1;
  end if;
  raise notice 'v128.6 · regressão 7 casas originais: % problema(s)', v_old;
  v_falhas := v_falhas + v_old;

  -- E3. funções de atribuição reconhecem as novas
  if public.nexus_clean_profile_label('bluesky_gnewsyou_oferta') not like 'GNewsYou%' then
    v_falhas := v_falhas + 1; raise notice 'v128.6 · FALHA label gnewsyou';
  end if;
  if public.nexus_click_forensics_suborigin('bluesky_feverforer_care_1') <> 'bluesky_feverforer' then
    v_falhas := v_falhas + 1; raise notice 'v128.6 · FALHA forensics feverforer';
  end if;
  select pg_get_functiondef('public.nexus_bluesky_cluster_post_log'::regproc) into v_def;
  if v_def not like '%4bhp3qn6bmrkrfzprppfpt72%' or v_def not like '%2xuggxgnj5x25up6rknzylg6%' or v_def not like '%uf3qyd2kzvbbhpbzyhatwhny%' then
    v_falhas := v_falhas + 1; raise notice 'v128.6 · FALHA DIDs no post_log';
  end if;
  select pg_get_functiondef('public.nexus_v165_5_bluesky_yield(timestamptz,timestamptz)'::regprocedure) into v_def;
  if v_def not like '%digitalofferss%' then
    v_falhas := v_falhas + 1; raise notice 'v128.6 · FALHA yield sem as novas contas';
  end if;

  raise notice 'v128.6 · SELF-CHECK %', case when v_falhas = 0 then 'OK — cluster Bluesky com 10 casas integradas' else 'COM ' || v_falhas || ' FALHA(S)' end;
  if v_falhas > 0 then raise exception 'v128.6 self-check falhou'; end if;
exception when others then
  raise notice 'v128.6 · exceção no self-check: %', sqlerrm;
  raise;
end $$;
