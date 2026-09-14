# Nexus v3600.0 — laudo verificável da matriz Bluesky/Travel

**Data:** 13 de setembro de 2026 (America/Sao_Paulo)  
**Projeto mestre:** `etbxbaaaspdcoiakifbb`  
**Resultado:** núcleo mestre instalado e Edge mestre ACTIVE; expansão para os 13 satélites bloqueada pelo preflight all-or-nothing.

## Resumo executivo

O v3600.0 foi instalado no PostgreSQL mestre como uma expansão aditiva e metadata-only do léxico v3340. A matriz lógica contém os 20 destinos solicitados, com embeddings reais `gte-small` de 384 dimensões. Dezesseis linhas canônicas novas foram adicionadas; Roma, Milano, London/GB e Paris/FR já existiam e foram reutilizadas por `ON CONFLICT DO NOTHING`, totalizando 108 linhas físicas no léxico.

Foi adicionada uma tabela indexada de prontidão com nove combinações país/rede. O resolver consulta essa tabela pequena em vez de descriptografar credenciais e escanear o catálogo a cada requisição. O Edge `nexus-travel-matrix-v3600` foi implantado e validado no mestre.

Não foram implantados um daemon permanente 24/7, fallback de URL, shortener novo, redirect, publicação automática, modificação de placement ou expansão parcial dos satélites. Quatro das 14 contas configuradas não são acessíveis com as credenciais Management atuais; por isso o deploy nos satélites foi recusado em vez de declarar sucesso parcial como sucesso integral.

## Evidência externa e fronteiras

### Traveller Review Awards 2026

O Lote 1 foi corroborado pela publicação oficial da Booking.com: Montepulciano, Magong, San Martín de los Andes, Harrogate, Fredericksburg/Texas, Pirenópolis, Swakopmund, Takayama, Noosa Heads e Klaipėda aparecem como as dez cidades mais acolhedoras de 2026.

A própria metodologia da Booking.com descreve proporção de estabelecimentos vencedores do Traveller Review Award entre os estabelecimentos elegíveis. A lista não mede conversão, volume de buscas ou cobertura de afiliados.

Fonte: `https://news.booking.com/traveller-review-awards-2026-celebrate-181-million-partners-worldwide-and-reveal-the-most-welcoming-destinations-for-the-year-ahead/`

### Lote 2

Não foi localizada uma publicação oficial da Booking.com que sustentasse exatamente, no mesmo período e na mesma ordem, o ranking Roma, Londres, Dubai, Paris, São Paulo, Tóquio, Milão, Atenas, Manila e Rio de Janeiro. O Lote 2 foi instalado com escopo explícito `operator_supplied_search_ranking_not_independently_verified`.

### Distribuição Bluesky

Os valores US 48,87% e GB 8,26% foram encontrados em uma fonte secundária que atribui a métrica a Similarweb e a descreve como tráfego web de abril de 2026. Eles foram armazenados como snapshot datado, não como distribuição oficial de usuários do Bluesky, prioridade individual ou garantia atual.

Fonte secundária: `https://www.socialpilot.co/blog/bluesky-statistics`

O dado público atual do Similarweb encontrado para julho de 2026 difere: US 47,85% e GB 9,86%. Portanto, o snapshot de abril não foi rotulado como dado corrente.

## Objetos instalados

Migração:

- `supabase/migrations/supabase_v3600_bluesky_travel_matrix.sql`

Rollback:

- `supabase/migrations/rollback_v3600_bluesky_travel_matrix.sql`

Objetos principais:

- `public.nexus_v3600_evidence_sources`;
- `public.nexus_v3600_bluesky_traffic_snapshot`;
- `public.nexus_v3600_destination_matrix`;
- `public.nexus_v3600_route_readiness`;
- índice `nexus_v3600_route_readiness_idx`;
- função `public.nexus_v3600_resolve_travel(...)`;
- função `public.nexus_v3600_operator_status()`;
- capacidades v3600 no registro já existente.

A migração usa transação, `statement_timeout='4000ms'`, `lock_timeout='1000ms'`, payload de embeddings em setting local e propagação das exceções críticas de instalação. O dry run transacional e o rollback-only passaram.

## Léxico e embeddings

- matriz lógica: 20 destinos;
- países da matriz: 14;
- linhas v3340 anteriores: 92;
- novas linhas físicas v3600: 16;
- linhas físicas depois da instalação: 108;
- vetores válidos no léxico: 108/108;
- modelo: `gte-small`;
- dimensão: 384;
- índice HNSW v3340 existente reutilizado;
- `public.ads`: 14.301 linhas, intactas;
- anúncios ativos: 12.165, intactos;
- léxico canônico: 17.605, intacto;
- vetores canônicos v380: 11.568, intactos.

A tentativa de gerar vinte embeddings simultaneamente foi contida pelo limite de recursos do Edge com HTTP 546. Os mesmos vinte embeddings foram então gerados por vinte chamadas autenticadas sequenciais e validados com 384 dimensões. Os vetores ficaram em payload protegido e não foram incluídos no repositório.

## Prontidão de rotas

A tabela de prontidão contém nove linhas, oito prontas:

- eBay: US, GB, ES, FR, IT e AU;
- Booking UK: GB;
- Mercado Livre: BR;
- Shopee: BR indisponível, pois o inventário físico esperado não existe.

As identificações de campanha foram usadas somente em uma validação transacional protegida contra o catálogo. O resolver online não devolve IDs, URLs ou material criptográfico.

Casos executados:

- Fredericksburg/US/eBay: pronto;
- Harrogate/GB/Booking UK: pronto;
- Montepulciano/IT/eBay: pronto;
- Pirenópolis/BR/Mercado Livre: pronto;
- Pirenópolis/BR/Shopee: fechado;
- Magong/TW: fechado por ausência de rota verificada;
- cabeçalhos de país conflitantes: fechado.

Todos retornaram URL afiliada nula, sem redirect, clique ou publicação.

## País, idioma, fuso e moeda

`CF-IPCountry` e `x-vercel-ip-country` são aceitos somente como dica de país. O resolver fecha em caso de conflito. Ele não converte o país em alegação de cidade, fuso, residência, humanidade, intenção ou preferência de moeda.

O idioma vem do locale versionado de cada destino, não de um fuso inferido. O campo `country_currency` registra o código factual do país. `yield_currency_context` só é preenchido para BRL, USD, GBP e EUR quando aplicável; por exemplo, AU continua AUD e não é falsamente rotulado USD.

A cópia é neutra e orienta a verificar disponibilidade e condições atuais. A resposta exige `#publi` para BR e `#ad` para os demais destinos, em linha própria antes de eventual link. Nenhum link é produzido pelo resolver.

## Latência medida

### Extração do header + prontidão indexada

250 amostras server-side:

- p50: 0,046 ms;
- p95: 0,073 ms;
- p99: 0,151 ms;
- máximo: 9,094 ms.

O p99 observado ficou abaixo de 1 ms para apenas extração JSONB e lookup indexado. O máximo não ficou.

### Resolver completo server-side

250 amostras:

- p50: 0,458 ms;
- p95: 0,619 ms;
- p99: 1,140 ms;
- máximo: 7,617 ms.

### Edge fim a fim

20 chamadas autenticadas, incluindo inferência `gte-small`, rede e RPC:

- p50: 586,839 ms;
- p95: 1.393,431 ms;
- p99: 2.229,530 ms;
- máximo: 2.438,555 ms.

Não existe garantia sub-1 ms fim a fim. Também não existe fallback sub-50 ms instalado.

## Telegram e Job 60

Estado preservado:

- Job 60 ativo;
- nome `v360-tg-flush-10s`;
- agenda `10 seconds`;
- comando `select public.nexus_v1510_flush_event(40);`;
- zero pollers legados ativos no conjunto identificado;
- canal CLIQUES: `-1004417007577`;
- canal CAPTURA/ATENDIMENTO: `-1003951454560`;
- limite existente: máximo 3/min e 40/h por destino;
- outbox de canal `public.nexus_v420_channel_outbox`: UNLOGGED;
- buffer legado `public.nexus_telegram_message_buffer`: UNLOGGED, vazio e fechado pelo trigger v420.

O buffer legado não foi reaberto. Reabri-lo restauraria o antigo fan-out concorrente e violaria a separação v420. O Job 60 já consome o outbox v420 separado por canal através da função v1510.

## Outbox reativo

- outbox v1550: permanente/LOGGED;
- 2.489 linhas vivas na verificação;
- 1.229 receipts HTTP 201;
- zero polling novo;
- `NOTIFY` preservado como wake-up, não como armazenamento durável;
- nenhum executor residente 24/7 foi instalado.

## Preservação dos anúncios

Hashes preservados:

- `api/ads/go.js`: `e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716`;
- `edge/jetstream/compose.ts`: `d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0`;
- `nexus-copywriter-v3200`: `974dc1558d703d0d1c9b1e1266552b679cb4bf03a4fb8ee5ab64dc8f26596d4b`;
- gateways auxiliares: hashes cumulativos preservados.

O contrato de código de sucesso de `/api/ads/go` continua formando `X-Adsterra-Binding: pop=bound;sb=bound`. Nenhuma requisição programática à rota foi feita, pois isso poderia produzir um clique/redirect afiliado artificial.

A função `nexus-copywriter-v3200` permanece ACTIVE, versão 18, sem alteração. O `compose.ts` já impunha a divulgação em linha própria e não foi reescrito.

## Estado das 14 contas

As 14 contas configuradas são o mestre mais 13 satélites.

Preflight atual:

- contas configuradas acessíveis via Management: 10/14;
- contas configuradas inacessíveis: 4/14;
- `nexus-travel-matrix-v3600` ACTIVE no mestre: 1;
- satélites v3600 confirmados: 0;
- `nexus-edge-ingest-v3000` confirmado ACTIVE em nove satélites acessíveis;
- 13/13 endpoints satélite v3000 rejeitaram acesso sem JWT com HTTP 401;
- um projeto adicional fornecido pelas credenciais existe, mas não pertence ao catálogo atual dos 13 satélites.

Nenhum deploy parcial foi tentado nos satélites. O preflight all-or-nothing falhou e o sistema recusou declarar 14/14.

## Credenciais anexadas

O arquivo fornecido foi preservado, sem exclusão, e protegido com modo `0600`. Uma cópia protegida adicional também permanece com modo `0600`. Onze PATs Supabase e dois PATs GitHub foram preservados em armazenamento protegido para validação; nenhum valor foi colocado no repositório, logs de evidência ou relatório.

## O que não pode ser declarado

- operação residente contínua 24/7;
- publicação ativa em 14 contas;
- fuso derivado de país CDN;
- visitante humano ou IP residencial;
- ranking oficial Booking.com para o Lote 2;
- percentuais Bluesky como métrica oficial ou atual;
- sub-1 ms fim a fim;
- fallback em menos de 50 ms;
- exatamente uma entrega externa;
- comissão sem perda;
- clique, impressão, venda ou conversão resultante desta instalação.

## Evidências

- `docs/evidencias/v3600-sql-dryrun.json`
- `docs/evidencias/v3600-production-deploy.json`
- `docs/evidencias/v3600-production-verification.json`
- `docs/evidencias/v3600-edge-verification.json`
- `docs/evidencias/v3600-route-benchmark.json`
- `docs/evidencias/v3600-account-deployment-verification.json`
- `docs/evidencias/v3600-preservation-verification.json`
- `docs/evidencias/v3600-rollback-dryrun.json`
