-- v420 transactional assertions. Execute after migration body and before ROLLBACK.
-- Never run standalone in production without an enclosing transaction.

-- 1) human-click gate (one rejected, one accepted).
do $test_click$
begin
  insert into public.ads_clicks(site_slug,slot,ad_id,advertiser,network,country,user_agent,device_type,metadata)
  values('v420-test','rollback','v420-no-catalog','Teste','test','BR','Mozilla/5.0 Human','desktop',
         '{"is_bot":false,"proved_human":false,"proof":"interstitial_beacon"}'::jsonb);
  if (select count(*) from public.nexus_v420_channel_outbox where source_relation='public.ads_clicks') <> 0 then
    raise exception 'clique sem prova entrou na fila';
  end if;

  insert into public.ads_clicks(site_slug,slot,ad_id,advertiser,network,country,user_agent,device_type,metadata)
  values('v420-test','rollback','v420-no-catalog','Loja & Real','test','BR','Mozilla/5.0 Human','mobile',
         '{"is_bot":false,"proved_human":true,"proof":"interstitial_beacon"}'::jsonb);
  if (select count(*) from public.nexus_v420_channel_outbox where source_relation='public.ads_clicks') <> 1 then
    raise exception 'clique humano não entrou exatamente uma vez';
  end if;
end;
$test_click$;

-- 2) raw mention source with real keyword.
do $test_capture$
declare v_key text := 'v420-rollback-capture-' || txid_current()::text;
begin
  insert into public.nexus_v385_nostr_mentions(nostr_id,relay_url,autor,texto,keyword,node_origem,dedupe_hash)
  values(v_key,'wss://relay.test','autor-test','texto cru <real>','keyword-real','T',md5(v_key));
  if (select count(*) from public.nexus_v420_channel_outbox where source_relation='public.nexus_v385_nostr_mentions') <> 1 then
    raise exception 'menção não entrou exatamente uma vez';
  end if;
end;
$test_capture$;

-- 3) confirmed positive commission gate; zero remains silent.
do $test_sales$
declare v_key text := 'v420-rollback-sales-' || txid_current()::text;
begin
  insert into public.affiliate_conversions(network,external_id,status,commission_amount,commission_currency,raw)
  values('test',v_key||'-zero','confirmed',0,'BRL','{}');
  if (select count(*) from public.nexus_v420_channel_outbox where source_relation='public.affiliate_conversions') <> 0 then
    raise exception 'comissão zero rompeu silêncio';
  end if;
  insert into public.affiliate_conversions(network,external_id,advertiser,status,commission_amount,commission_currency,raw)
  values('test',v_key||'-positive','Loja Real','confirmed',12.34,'BRL','{}');
  if (select count(*) from public.nexus_v420_channel_outbox where source_relation='public.affiliate_conversions') <> 1 then
    raise exception 'comissão confirmada positiva não entrou exatamente uma vez';
  end if;
end;
$test_sales$;

-- 4) C2 RPC and corresponding catalog click_url encoded in the action link.
do $test_offer$
declare
  v_key text := 'v420-rollback-offer-' || txid_current()::text;
  v_rpc jsonb;
begin
  v_rpc := public.nexus_v420_offer_enqueue(jsonb_build_object(
    'source_key',v_key,'offer_id','oferta-real','title','Oferta Real','merchant','Loja Real',
    'brand','mercadolivre','price_brl',27.90,'click_url','https://meli.la/1U3rtgV','button_text','Ver oferta'));
  if not coalesce((v_rpc->>'ok')::boolean,false) or not coalesce((v_rpc->>'queued')::boolean,false) then
    raise exception 'RPC C2 válida recusada: %',v_rpc;
  end if;
  if (select count(*) from public.nexus_v420_channel_outbox where source_relation='public.nexus_telegram_c2_ofertas') <> 1 then
    raise exception 'oferta não entrou exatamente uma vez';
  end if;
end;
$test_offer$;

-- 5) consolidated layouts, quarantine, ACLs, Job 60 and immutable counts.
do $test_final$
declare
  v_payload jsonb;
  v_txt text;
  v_total bigint;
  v_active bigint;
begin
  if exists(
    select 1 from public.nexus_v420_channel_routes r
    left join (select source_relation,channel_key,count(*) n from public.nexus_v420_channel_outbox group by 1,2) q
      using(source_relation,channel_key)
    where coalesce(q.n,0) <> 1
  ) then raise exception 'fontes não produziram exatamente um evento por rota'; end if;

  select jsonb_agg(payload order by id) into v_payload
    from public.nexus_v420_channel_outbox where channel_key='atendimento';
  v_txt := public.nexus_v420_layout_capture(v_payload);
  if position('keyword-real' in v_txt)=0 or position('texto cru &lt;real&gt;' in v_txt)=0 then
    raise exception 'layout SENTINEL perdeu keyword/texto cru escapado';
  end if;

  select jsonb_agg(payload order by id) into v_payload
    from public.nexus_v420_channel_outbox where channel_key='grupo_cliques';
  v_txt := public.nexus_v420_layout_clicks(v_payload);
  if position('NEXUS LEDGER — LOTE DE CLIQUES HUMANOS CONSOLIDADO' in v_txt)=0
     or position('Bindings ativos:' in v_txt)=0 then
    raise exception 'ledger de cliques incompleto';
  end if;

  if public.nexus_v420_layout_sales('[{"commission_amount":0,"commission_currency":"BRL"}]'::jsonb) is not null then
    raise exception 'layout de vendas não silenciou delta zero';
  end if;
  select jsonb_agg(payload order by id) into v_payload
    from public.nexus_v420_channel_outbox where channel_key='ofertas';
  if coalesce(jsonb_array_length(public.nexus_v420_offer_buttons(v_payload)->'inline_keyboard'),0) <> 1 then
    raise exception 'botão C2 visível não foi criado';
  end if;
  if position('dest64=' in coalesce(v_payload->0->>'action_url',''))=0 then
    raise exception 'action_url não preserva fallback específico';
  end if;

  insert into public.nexus_telegram_message_buffer(dedupe_hash,payload)
  values(md5('v420-legacy-'||txid_current()::text),'{"kind":"publish"}');
  if (select count(*) from public.nexus_telegram_message_buffer) <> 0 then
    raise exception 'buffer legado aceitou inserção';
  end if;

  if has_table_privilege('service_role','public.ads','INSERT')
     or not has_table_privilege('service_role','public.ads','SELECT') then
    raise exception 'catálogo não está read-only para service_role';
  end if;
  if has_function_privilege('service_role','public.nexus_v420_flush_10s(integer)','EXECUTE')
     or has_function_privilege('anon','public.nexus_v360_flush_10s(integer)','EXECUTE')
     or not has_function_privilege('service_role','public.nexus_v420_offer_enqueue(jsonb)','EXECUTE') then
    raise exception 'ACLs das portas v420 incorretas';
  end if;
  if (select command from cron.job where jobname='v360-tg-flush-10s' limit 1) <> 'select public.nexus_v420_flush_10s();' then
    raise exception 'Job 60 não aponta exclusivamente para v420';
  end if;
  if (select count(*) from public.nexus_v360_node_endpoints where ativo)<>13
     or (select count(distinct project_ref) from public.nexus_v360_node_endpoints where ativo)<>13 then
    raise exception 'frota não contém 13 PostgRESTs distintos';
  end if;
  if position('timeout_milliseconds:=1000' in replace(pg_get_functiondef('public.nexus_v365_fleet_dispatch(jsonb,integer,integer)'::regprocedure),' ',''))=0 then
    raise exception 'frota v420 sem timeout pg_net de 1000ms';
  end if;
  select count(*),count(*) filter(where active is true) into v_total,v_active from public.ads;
  if v_total<>14301 or v_active<>12165 then
    raise exception 'catálogo mudou durante teste: %/%',v_total,v_active;
  end if;
end;
$test_final$;
