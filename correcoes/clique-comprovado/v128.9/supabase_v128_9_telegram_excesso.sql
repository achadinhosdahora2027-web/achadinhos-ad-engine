-- ============================================================================
-- v128.9 — FREIO DE EXCESSO NO TELEGRAM (anti-flood / anti-ban)
--
-- Medido em 13/09/2026, antes desta correção:
--   • 119 envios do MESMO termo ("video game") em 6 horas;
--   • 211–225 mensagens por hora enfileiradas e enviadas (100% 'sent');
--   • dedupe de 6 h por produto/termo suprimiria 500 de 796 mensagens (62,8%).
--   Telegram pune flood: mensagem repetida em rajada é o gatilho clássico de
--   banimento de canal/grupo. Este freio atua em DOIS pontos:
--     1) na ENTRADA (trigger): a mesma matéria-prima não entra duas vezes na
--        fila dentro da janela;
--     2) na SAÍDA (função de porteiro): teto por minuto e por hora PARA CADA
--        destino, com registro de entrega — nenhum destino recebe rajada.
-- ============================================================================

-- 1. Registro de entregas (base do teto por destino) -------------------------
create table if not exists public.nexus_telegram_delivery_log (
  id         bigserial primary key,
  destino    text        not null,
  chave      text        not null,
  enviado_em timestamptz not null default now()
);
create index if not exists nexus_tg_delivery_destino_tempo
  on public.nexus_telegram_delivery_log (destino, enviado_em desc);
create index if not exists nexus_tg_delivery_chave
  on public.nexus_telegram_delivery_log (destino, chave, enviado_em desc);

-- 2. Porteiro de saída ------------------------------------------------------
create or replace function public.nexus_telegram_gate(
  p_destino       text,
  p_chave         text,
  p_horas_dedupe  int default 12,
  p_max_minuto    int default 3,
  p_max_hora      int default 40
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_n     int;
  v_ult   timestamptz;
  v_esp   int;
begin
  perform set_config('statement_timeout', '3000', true);

  -- (a) repetição do mesmo conteúdo para o mesmo destino
  select count(*), max(enviado_em) into v_n, v_ult
    from public.nexus_telegram_delivery_log
   where destino = p_destino
     and chave = p_chave
     and enviado_em > now() - make_interval(hours => greatest(1, p_horas_dedupe));
  if v_n > 0 then
    return jsonb_build_object('pode', false, 'motivo', 'duplicado_recente',
                              'ultimo_em', v_ult, 'janela_horas', p_horas_dedupe);
  end if;

  -- (b) teto por minuto (rajada)
  select count(*) into v_n
    from public.nexus_telegram_delivery_log
   where destino = p_destino and enviado_em > now() - interval '1 minute';
  if v_n >= p_max_minuto then
    select 60000 - (extract(epoch from (now() - max(enviado_em))) * 1000)::int into v_esp
      from public.nexus_telegram_delivery_log
     where destino = p_destino and enviado_em > now() - interval '1 minute';
    return jsonb_build_object('pode', false, 'motivo', 'limite_minuto',
                              'enviados_ultimo_minuto', v_n, 'esperar_ms', greatest(1000, coalesce(v_esp, 1000)));
  end if;

  -- (c) teto por hora
  select count(*) into v_n
    from public.nexus_telegram_delivery_log
   where destino = p_destino and enviado_em > now() - interval '1 hour';
  if v_n >= p_max_hora then
    return jsonb_build_object('pode', false, 'motivo', 'limite_hora',
                              'enviados_ultima_hora', v_n, 'esperar_ms', 60000);
  end if;

  insert into public.nexus_telegram_delivery_log (destino, chave) values (p_destino, p_chave);
  return jsonb_build_object('pode', true, 'enviados_ultima_hora', v_n + 1);
end $$;

-- 3. Freio na ENTRADA: mesma matéria-prima não entra duas vezes -------------
create or replace function public.nexus_telegram_dedupe_entrada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_chave   text;
  v_janela  interval;
  v_existe  int;
begin
  -- chave da matéria-prima: oferta > palavra-chave > texto normalizado
  v_chave := coalesce(
    nullif(trim(coalesce(new.payload ->> 'oferta', '')), ''),
    nullif(trim(coalesce(new.payload ->> 'keyword', '')), ''),
    nullif(trim(regexp_replace(coalesce(new.body_text, ''), '\s+', ' ', 'g')), ''),
    'sem_chave'
  );
  v_chave := left(lower(v_chave), 120);

  -- janelas: publicação 6 h · clique 30 min · alerta 1 h
  v_janela := case
    when coalesce(new.payload ->> 'tipo', '') in ('clique') then interval '30 minutes'
    when coalesce(new.payload ->> 'tipo', '') in ('alerta', 'health') then interval '1 hour'
    else interval '6 hours'
  end;

  select count(*) into v_existe
    from public.nexus_telegram_message_buffer b
   where b.created_at > now() - v_janela
     and left(lower(coalesce(
           nullif(trim(coalesce(b.payload ->> 'oferta', '')), ''),
           nullif(trim(coalesce(b.payload ->> 'keyword', '')), ''),
           regexp_replace(coalesce(b.body_text, ''), '\s+', ' ', 'g'),
           'sem_chave')), 120) = v_chave;

  if v_existe > 0 then
    return null;   -- descarta silenciosamente: nada entra, nada é enviado
  end if;
  return new;
end $$;

drop trigger if exists trg_nexus_telegram_dedupe on public.nexus_telegram_message_buffer;
create trigger trg_nexus_telegram_dedupe
  before insert on public.nexus_telegram_message_buffer
  for each row execute function public.nexus_telegram_dedupe_entrada();

-- 4. Varredura do backlog já acumulado (opcional, relatório) -----------------
create or replace view public.nexus_telegram_excesso_v128_9 as
select coalesce(payload ->> 'oferta', payload ->> 'keyword', left(body_text, 60)) as chave,
       count(*) as repeticoes,
       min(created_at) as primeira,
       max(created_at) as ultima
  from public.nexus_telegram_message_buffer
 where created_at > now() - interval '24 hours'
 group by 1
having count(*) > 1
 order by 2 desc;

select 'v128.9 instalado: portao de saida + freio de entrada' as resultado;
