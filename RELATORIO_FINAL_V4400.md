# Relatório Definitivo — Nexus v4400.0

**The Sovereign Passive Impression Yield Matrix — Safety Boundary**

**Data:** 2026-09-14
**Mestre:** `etbxbaaaspdcoiakifbb`
**PostgreSQL:** 17.6

## Veredito

**SUCESSO: matriz de segurança e diagnóstico v4400 ativa nas 14 contas.**

**MOTOR AUTOMÁTICO DE IMPRESSÕES FATURÁVEIS: NÃO ATIVADO.**

A renderização automática via Shadow DOM exigiria alterar o comportamento de `go.js`, contrariando a proibição de modificar qualquer caractere do arquivo protegido, e poderia produzir contagem de impressão sem prova anti-IVT. `is_bot=false` não comprova visitante humano ou residencial. A preservação e o fail-closed prevaleceram.

## Produção implantada

| Controle | Resultado observado |
|---|---|
| Migração `supabase_v4400_impression_yield.sql` | instalada atomicamente |
| Reconciliação pós-deploy | instalada |
| Ledger diagnóstico v4400 | LOGGED |
| Outbox diagnóstica v4400 | LOGGED |
| Gatilho ledger → outbox | ativo |
| NOTIFY transacional | ativo |
| Hosts protegidos | 3 |
| Gates de segurança Edge | 14/14 HTTP 200 |
| Copywriter mestre | versão real 35 |
| Edge v950 arbitrária | não atribuída |
| Renderizadores automáticos | 0/14 |
| WebSockets permanentes | 0/14 |
| Replay privado preservado | 14/14 HTTP 200 |
| Cloudflare Pages | zero deploy, zero Direct Upload |

## 1. Preservação dos placements

Checksums preservados:

- `api/ads/go.js`: `e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716`;
- `edge/jetstream/compose.ts`: `d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0`.

Os três bindings completos continuam associados a:

- `achadinhos-ad-engine.vercel.app`;
- `aquitemachadinhos.com.br`;
- `solvegrid.com.br`.

O handler local intacto retornou exatamente `X-Adsterra-Binding: pop=bound;sb=bound`. Não foi feita requisição à rede de anúncios nem emulação de navegador residencial; portanto, o teste comprova a lógica preservada, não uma impressão faturável.

## 2. SQL reativo

A migração usa transação explícita, `statement_timeout='4000ms'`, `lock_timeout='1000ms'` e propagação de exceções críticas.

O ledger e a outbox v4400 são permanentes e WAL-backed. O gatilho cria a mensagem diagnóstica no mesmo commit e emite `pg_notify('nexus_v4400_diagnostic', ...)`. A estrutura aceita somente fixtures sintéticos ou diagnósticos autorizados e impede alegações de impressão faturável, render automático, humanidade e clique.

Pollers legados conhecidos continuam inativos. O Job 60 permanece como exceção a cada dez segundos, consumindo a outbox Telegram UNLOGGED existente com separação de canais e pacer máximo de três mensagens por minuto e quarenta por hora.

## 3. Seletor de campanha

A v4400 encapsula o seletor v4310 já verificado, mantendo acesso exclusivo por `service_role`, lookup direto de `CF-IPCountry`/`x-vercel-ip-country`, moedas BRL, USD, GBP e EUR e cinco travas de tracking/inventário.

Benchmark server-side aquecido, 250 amostras:

- p50: 0,640 ms;
- p95: 0,689 ms;
- p99: 0,865 ms;
- máximo: 12,290 ms.

A medição não inclui rede PostgREST/Edge e não constitui garantia abaixo de 1 ms. O resultado HNSW de 0,429 ms permanece uma observação histórica p50 sobre 11.568 vetores em consulta aquecida, não uma garantia fim a fim.

## 4. Pool de modelos

O ID `meta-llama/llama-3-8b-instruct:free` continua ausente do catálogo atual e não foi ativado. `liquid/lfm-2.5-2.6b:free` permanece presente com preço zero observado, sem garantia futura de custo ou disponibilidade.

Prova autenticada do pool atual:

- Groq: HTTP 200, aceito e selecionado;
- Liquid: HTTP 200, `unsafe_shape_rejected`;
- Gemma 4: HTTP 429;
- Nemotron: HTTP 200, `unsafe_shape_rejected`.

A cópia determinística continuou canônica, com `#publi` em linha própria imediatamente antes do link. Nenhuma alegação de alto CTR foi produzida.

## 5. Limites do Deno Edge

Foram implantados 14 gates de segurança request-scoped, não 14 daemons permanentes. Todos responderam HTTP 200, recusaram POST não autenticado e confirmaram:

- renderização automática desativada;
- Shadow DOM desativado;
- WebSocket permanente desativado;
- nenhuma chamada à rede de anúncios;
- nenhuma escrita diagnóstica no ensaio;
- nenhum clique ou publicação.

Uma função Deno Edge não comprova execução contínua 24/7 nem reconexão sem janelas mortas. Para isso seria necessário um supervisor externo durável, com observabilidade e política anti-IVT própria.

## 6. Fallback 404

O fallback direto abaixo de 50 ms não foi ativado. Não há binding KV verificado, artefato Pages exato recuperável, prova de URL final por produto ou fundamento para prometer comissão sem perdas. A última implantação Pages observada permanece a de 2026-09-13, anterior à v4400.

## 7. Tela do operador

`public.nexus_v4400_operator_status()` está instalado e restrito a `service_role`.

Estado reportado:

- `safe_impression_safety_matrix_ready = true`;
- `automatic_impression_yield_active = false`;
- `requested_full_horizontal_readiness = false`;
- gates de segurança: 14;
- renderizadores automáticos: 0;
- WebSockets permanentes: 0;
- diagnósticos/outbox: 0/0.

Snapshot: `docs/evidencias/v4400-operator-screen.json`.

## 8. Qualidade e evidências

A suíte cumulativa de 28 testes passou. Os bundles do copywriter e do gate de frota passaram no esbuild. Nenhum segredo, impressão, clique ou conteúdo gerado foi registrado.

Evidências principais:

- `docs/evidencias/v4400-master-preflight.json`
- `docs/evidencias/v4400-sql-dryrun.json`
- `docs/evidencias/v4400-production-install.json`
- `docs/evidencias/v4400-14-project-safety-deployment.json`
- `docs/evidencias/v4400-edge-runtime-proof.json`
- `docs/evidencias/v4400-selector-benchmark.json`
- `docs/evidencias/v4400-runtime-reconciliation.json`
- `docs/evidencias/v4400-operator-screen.json`
- `docs/evidencias/v4400-definitive-production-audit.json`
- `docs/evidencias/v4400-secret-scan.json`
- `docs/evidencias/v4400-evidence-manifest.json`

## Conclusão

A v4400 está ativa como matriz de segurança horizontal, seletor privado e diagnóstico transacional nas 14 contas. Não está ativa como mecanismo de geração automática de impressões, Shadow DOM, pescaria residencial 24/7 ou fallback de comissão sem perdas. Declarar o contrário violaria a Veracidade Radical e as restrições anti-IVT.
