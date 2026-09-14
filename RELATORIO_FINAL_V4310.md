# Relatório Definitivo — Nexus v4310.0

**The Sovereign Passive Yield Matrix**

**Data:** 2026-09-14
**Mestre:** `etbxbaaaspdcoiakifbb`
**PostgreSQL observado:** 17.6

## Veredito

**SUCESSO no núcleo seguro, transacional e limitado da v4310.0.**

**PRONTIDÃO GLOBAL INTEGRAL: NÃO.** Não há base factual para cravar WebSocket residente 24/7 dentro de uma função Deno Edge request-scoped, versão Edge arbitrária v940, fallback KV abaixo de 50 ms, comissão sem perdas ou alinhamento dos cinco vaults com o `go.js` imutável. Esses recursos ficaram desativados e visíveis no status do operador.

## Resultado implantado

| Controle | Resultado observado |
|---|---|
| Migração `supabase_v4310_passive_yield_core.sql` | instalada atomicamente |
| Reconciliação pós-deploy | instalada após dry-run transacional |
| Ledger de sinais v4310 | LOGGED |
| Outbox de sinais v4310 | LOGGED |
| Gatilho ledger → outbox | instalado |
| NOTIFY transacional | `nexus_v4310_signal` instalado |
| Pollers legados conhecidos | 0 ativos |
| Job 60 | ativo em `10 seconds` |
| Fila Telegram existente | UNLOGGED, preservada |
| Pacer | máximo 3/min e 40/h por destino |
| Rotas Telegram verificadas | 2 |
| Copywriter | Edge Function versão real 33 |
| Ingresso limitado de sinais | Edge Function versão real 3 |
| Replay privado preservado | 14/14 status HTTP 200 |
| Cloudflare Pages | zero deploy e zero Direct Upload |

## 1. SQL reativo e filas

A migração usa `statement_timeout='4000ms'`, `lock_timeout='1000ms'`, transação explícita e propagação de exceções críticas. O rollback atual também foi executado dentro de transação e revertido.

A v4310 criou um ledger e outbox WAL-backed, ambos LOGGED. O insert no ledger cria a linha de outbox no mesmo commit e emite `pg_notify` somente após a inserção transacional. Nenhum cron executor adicional foi instalado.

Os jobs legados 15, 16, 18, 21, 35, 36, 38, 40, 41, 44, 47, 48, 62, 63, 64 e 65 permanecem inativos. A política v4310 registra esse bloqueio, mas não alega permanência técnica contra uma futura ação de superusuário.

O Job 60 continua sendo a exceção explícita de dez segundos para a fila Telegram existente. A separação entre CLIQUES e CAPTURA/ATENDIMENTO e os dois destinos fornecidos foi revalidada sem registrar tokens.

## 2. Seletor transacional

Cinco travas foram verificadas dentro do banco sem expor identificadores ou URLs em evidência:

- Amazon;
- AliExpress;
- Shein;
- Shopee Brasil, com 1.201 linhas cifradas;
- Mercado Livre.

O seletor é exclusivo de `service_role`, usa acesso direto às chaves JSON `CF-IPCountry` e `x-vercel-ip-country`, falha fechado em conflito e limita o contexto a BRL, USD, GBP ou EUR. País continua sendo dica de contexto/moeda e não prova residência, cidade ou humanidade.

Matriz funcional verificada: Amazon, AliExpress, Shein, Mercado Livre e metadados Shopee responderam `ok` nos respectivos escopos. Para Shopee, a URL cifrada não é descriptografada pelo seletor: a resolução continua atribuída à superfície protegida. Nenhum redirect ou clique foi executado.

Benchmark server-side aquecido, 250 amostras, rota BR/AliExpress:

- p50: 0,599 ms;
- p95: 0,657 ms;
- p99: 0,916 ms;
- máximo: 20,753 ms.

Isso é observação interna do banco, não latência PostgREST/Edge fim a fim e não constitui garantia abaixo de 1 ms. O benchmark HNSW histórico de 11.568 vetores permanece delimitado a p50 0,429 ms em consulta server-side aquecida.

## 3. Pool Multi-LLM

O broker usa `Promise.allSettled()` para Groq e três rotas OpenRouter atualmente presentes com preço de catálogo zero observado:

- `liquid/lfm-2.5-2.6b:free`;
- `google/gemma-4-26b-a4b-it:free`;
- `nvidia/nemotron-3.5-lightning:free`.

Os IDs solicitados `meta-llama/llama-3-8b-instruct:free` e `google/gemma-2-9b-it:free` não estavam no catálogo atual de 445 modelos e não foram ativados.

Prova concorrente autenticada:

- Groq: HTTP 200, `ok`, selecionado;
- Liquid: HTTP 200, `unsafe_shape_rejected`;
- Gemma 4: HTTP 429, rejeitado;
- Nemotron: HTTP 200, `unsafe_shape_rejected`.

A cópia determinística permaneceu canônica. `#publi` ficou em linha própria imediatamente antes da linha do link. Não foi feita alegação de CTR, disponibilidade futura ou custo sempre zero.

## 4. Ingresso Aho-Corasick

Foi implantado um ingresso autenticado e limitado, não um daemon permanente. O matcher carregou o snapshot de exatamente 17.605 palavras-chave e encontrou um evento no ensaio sintético dry-run.

O ensaio registrou:

- zero escrita no ledger;
- zero escrita na outbox;
- zero chamada de provedor;
- zero publicação;
- zero clique;
- texto bruto não persistido.

Lotes reais autorizados usam um único RPC transacional: todos os sinais válidos commitam juntos ou a chamada falha.

## 5. Limites do Deno Edge e fallback

Não foi instalada rotina infinita de WebSocket ou reconexão em segundo plano. Uma função Deno Edge atende requisições e não é um supervisor de processo durável capaz de provar operação segundo a segundo sem janelas mortas.

O fallback KV anti-404 também não foi ativado porque:

- binding KV não foi verificado;
- o artefato exato de Pages não está disponível;
- 31 divergências protegidas permanecem conhecidas;
- sobrescrever Pages violaria a preservação de placements;
- latência abaixo de 50 ms e comissão sem perdas não podem ser garantidas.

## 6. Preservação programática

Checksums SHA-256 preservados:

- `api/ads/go.js`: `e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716`;
- `edge/jetstream/compose.ts`: `d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0`.

O handler local intacto retornou exatamente `X-Adsterra-Binding: pop=bound;sb=bound`. Não houve chamada de rede à rota afiliada, emulação residencial, alteração de placement, publicação ou clique.

A última implantação Pages observada continua sendo a de 2026-09-13, anterior à v4310.

## 7. Status do operador

`public.nexus_v4310_operator_status()` está instalado e restrito a `service_role`. O snapshot está em `docs/evidencias/v4310-operator-screen.json`.

Estado reportado:

- `safe_bounded_core_ready = true`;
- `requested_full_global_readiness = false`;
- sinais/outbox v4310 = 0/0;
- WebSocket permanente = false;
- fallback KV = false;
- alinhamento dos vaults com o `go.js` imutável = não comprovado.

## 8. Testes e evidências

A suíte cumulativa de 27 testes passou, os dois bundles Edge passaram no esbuild e o npm audit observou zero vulnerabilidades.

Evidências principais:

- `docs/evidencias/v4310-master-preflight.json`
- `docs/evidencias/v4310-openrouter-catalog-audit.json`
- `docs/evidencias/v4310-sql-dryrun.json`
- `docs/evidencias/v4310-production-install.json`
- `docs/evidencias/v4310-edge-deployment.json`
- `docs/evidencias/v4310-edge-runtime-proof.json`
- `docs/evidencias/v4310-selector-benchmark.json`
- `docs/evidencias/v4310-route-and-queue-proof.json`
- `docs/evidencias/v4310-runtime-reconciliation.json`
- `docs/evidencias/v4310-operator-screen.json`
- `docs/evidencias/v4310-definitive-production-audit.json`
- `docs/evidencias/v4310-secret-scan.json`
- `docs/evidencias/v4310-evidence-manifest.json`

## Conclusão

A v4310 está ativa em produção no escopo seguro comprovado: SQL reativo LOGGED, gatilhos atômicos, seletor privado, três rotas OpenRouter atuais em fan-out com Groq, ingresso Aho limitado, filas e Job 60 preservados. A versão não autoriza afirmar daemon WebSocket 24/7, fallback KV, comissão sem perdas, cinco credenciais alinhadas ao `go.js`, Edge v940 ou prontidão horizontal integral da frota.
