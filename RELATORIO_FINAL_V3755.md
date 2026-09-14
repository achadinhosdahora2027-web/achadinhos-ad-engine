# Relatório Definitivo — Nexus v3755.0

**Sovereign Free Core Optimization & Liquid LFM Lock Matrix**
**Data:** 2026-09-14
**Projeto mestre:** `etbxbaaaspdcoiakifbb`
**PostgreSQL observado:** 17.6

## Veredito

**PRONTO para publicação como versão cumulativa segura v3755, em modo fail-closed e com o Groq como âncora verificada.**

**NÃO PRONTO para alegar redundância de saída aceita pelo Liquid, custo futuro zero, disponibilidade contínua, operação 24/7, latência ultrabaixa, alcance da frota, cliques ou vendas.** O Liquid respondeu HTTP 200 no ensaio autenticado, mas sua saída divergiu do envelope factual permitido e foi corretamente rejeitada como `unsafe_shape_rejected`. O broker selecionou Groq.

## Resultado executivo

| Controle | Resultado verificado |
|---|---|
| Migração atômica `supabase_v3755_free_optimization.sql` | instalada no mestre |
| Reconciliação pós-deploy | instalada após dry-run transacional |
| Rota Liquid | `liquid/lfm-2.5-2.6b:free` habilitada |
| Preço de catálogo observado | prompt 0 / completion 0 no catálogo consultado |
| Garantia de custo zero | **não** |
| Fan-out | `Promise.allSettled()` com Groq + Liquid |
| Groq | HTTP 200, resposta aceita e selecionada |
| Liquid | HTTP 200, saída rejeitada por segurança factual |
| Copywriter mestre | Edge Function versão 31 |
| Disclosure | `#publi`/`#ad` em linha própria imediatamente antes da linha que contém o link |
| Publicação/clique neste trabalho | nenhum |
| Replay privado | 14/14 gateways responderam HTTP 200 |
| Snapshot RAM | 17.605 mapeamentos; sem mutação automática |
| Cloudflare Pages `aquitem` | zero deploy, zero Direct Upload, zero alteração de placement |
| Diagnóstico Wrangler | configuração baixada; zero asset baixado; comando de recuperação de assets inexistente |
| Job 60 | ativo a cada dez segundos |
| Limite Job 60 | separação por canal, máximo três mensagens/minuto e quarenta/hora |
| Pollers legados | Jobs 15, 16 e 64 inativos; nenhum subminuto inesperado |

## 1. Banco de dados

A migração usa transação explícita, `statement_timeout = 4000ms`, `lock_timeout = 1000ms`, bloco PL/pgSQL com propagação de exceções e aborta integralmente em falha crítica.

Foram instalados:

- política versionada para `liquid/lfm-2.5-2.6b:free`;
- quarentena LOGGED de Cloudflare Pages;
- função de status v3755;
- registro de capacidades conservador;
- verificação de invariantes de catálogo, filas, jobs e configuração;
- reconciliação pós-deploy separando transporte HTTP de aceitação da saída.

Inventário revalidado:

- anúncios: 14.301;
- anúncios ativos: 12.165;
- palavras-chave: 17.605;
- ofertas Shopee: 1.201;
- matriz: 27;
- batches/eventos/outbox v3750: zero.

## 2. Provedores e neutralidade da cópia

O copywriter chama Groq e Liquid simultaneamente por `Promise.allSettled()`. Cada saída passa por um gate exato: a sentença deve coincidir com a composição determinística e factual. Resultados rejeitados não entram na seleção.

Prova sintética autenticada:

- endpoint: HTTP 200;
- requisição sem autenticação: HTTP 401;
- Groq: HTTP 200, `ok`, selecionado;
- Liquid: HTTP 200, `unsafe_shape_rejected`;
- fallback determinístico: disponível;
- conteúdo gerado: não armazenado nos artefatos de evidência;
- publicação externa: não realizada.

A decisão de não afrouxar o gate evita transformar uma resposta do modelo em promessa comercial, preço inventado ou indução indevida. País permanece apenas uma dica de moeda/contexto para BRL, USD, GBP ou EUR.

## 3. Replay white-hat

O componente privado `nexus-whitehat-replay-v3750` foi mantido nos 14 projetos. Todos os 14 endpoints de status responderam HTTP 200 no ensaio final.

Limites preservados:

- somente dados sintéticos ou staging autorizado;
- sem cookies de X;
- sem session keys inautênticas;
- sem scraper;
- sem emulação humana/residencial;
- sem clique programático;
- sem mutação automática do snapshot de 17.605 palavras-chave;
- deleção do outbox satélite somente com HTTP 201.

Nenhum replay de produção foi executado nesta publicação.

## 4. Cloudflare Pages e Wrangler

Foi feito apenas diagnóstico de configuração com Wrangler 4.131.1 em Node 22 efêmero. `wrangler pages download config` retornou a configuração; não baixou assets. A CLI não expõe um comando de download dos assets de uma implantação Pages.

Como 31 dos 39 arquivos comparados continuam divergentes, `aquitem` permanece em quarentena:

- Direct Upload permitido: não;
- Direct Upload executado: não;
- deploy de produção nesta versão: não;
- assets baixados: zero;
- placements protegidos alterados: não.

Isso preserva o bloqueio de integridade em vez de sobrescrever a implantação com um build incompleto.

## 5. Jobs, fila e limites

O Job 60 permanece ativo com agenda `10 seconds` e comando `select public.nexus_v1510_flush_event(40);`. A função preserva:

- bloqueio transacional por canal;
- máximo de três mensagens por minuto por canal;
- máximo de quarenta mensagens por hora por canal;
- processamento de uma linha por canal a cada execução;
- nenhum poller subminuto concorrente.

Jobs 15, 16 e 64 permanecem inativos.

## 6. Arquivos protegidos

Checksums SHA-256 revalidados:

- `api/ads/go.js`: `e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716`;
- `edge/jetstream/compose.ts`: `d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0`.

`api/ads/go.js`, `edge/jetstream/compose.ts` e os placements Adsterra/Monetag não foram modificados. O handler local protegido foi executado com um fixture de diagnóstico, sem requisição de rede ou redirect de afiliado, e retornou exatamente `X-Adsterra-Binding: pop=bound;sb=bound`. O resultado verifica a lógica preservada do arquivo; não é apresentado como uma nova medição da implantação Pages.

## 7. Rollback

`supabase/migrations/rollback_v3755_free_optimization.sql` foi validado dentro de transação com rollback e remove somente objetos/políticas/capacidades v3755. Ele não altera Jobs nem inventários. A reversão do Edge é deliberadamente separada: exige redeploy da fonte v3200 do commit-base `eee3ccd6e7e9b8f806c61d11b3eca7ddf5452a13`; nenhum segredo deve ser removido durante essa ação. Cloudflare não requer rollback porque não recebeu deploy ou mutação.

## 8. Limitações explícitas

A evidência não sustenta alegações de:

- saída Liquid aceita pelo gate factual;
- disponibilidade futura de Groq ou Liquid;
- custo futuro sempre zero;
- exactly-once;
- perda zero;
- operação 24/7;
- p50 de 0,93 ms;
- cliques, vendas ou alcance de frota.

Falha de rede/provedor continua sendo classificada como `Sintonizado em Análise`, nunca como VENDAS.

## 9. Evidências principais

- `docs/evidencias/v3755-sql-dryrun.json`
- `docs/evidencias/v3755-production-install.json`
- `docs/evidencias/v3755-edge-runtime-proof.json`
- `docs/evidencias/v3755-runtime-reconciliation.json`
- `docs/evidencias/v3755-wrangler-config-preflight.json`
- `docs/evidencias/v3755-cloudflare-readonly-verification.json`
- `docs/evidencias/v3755-complete-test-suite.json`
- `docs/evidencias/v3755-secret-scan.json`
- `docs/evidencias/v3755-definitive-production-audit.json`
- `docs/evidencias/v3755-evidence-manifest.json`

## Conclusão

A v3755 está instalada e operacional no escopo verificável: política Liquid ativa, fan-out concorrente implantado, Groq aceito como âncora, Liquid alcançável mas rejeitado pelo gate neste ensaio, replay privado preservado, banco íntegro e Cloudflare protegido. A prontidão é **segura e degradada**, não uma autorização para afirmar redundância Liquid aceita ou disponibilidade contínua.
