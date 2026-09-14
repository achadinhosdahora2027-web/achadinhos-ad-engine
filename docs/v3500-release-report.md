# Nexus v3500.0 — relatório verificável de instalação

**Data:** 13 de setembro de 2026 (America/Sao_Paulo)  
**Escopo:** núcleo reativo interno, seletor de prontidão e evidências; sem redirecionador afiliado público.

## Resultado executivo

O v3500.0 foi instalado cumulativamente no projeto mestre com uma fronteira deliberadamente menor do que a especificação nominal: o PostgreSQL mantém o outbox LOGGED v1550 como fonte durável e agora emite `NOTIFY nexus_v3500_outbox` somente como sinal de wake-up após mudanças confirmadas. Não foi instalado polling novo das tabelas de origem.

O seletor transacional indexado informa apenas se uma rota validada está pronta. Ele não descriptografa, devolve, segue ou publica URLs de afiliado. O adaptador Edge interno `nexus-quantum-inbound-v3500` está ACTIVE e exige segredo próprio para qualquer POST; o GET público contém somente capacidades e negações não sensíveis.

Não foram instalados: processo residente permanente, “100 threads”, fallback KV, fallback direto ao anunciante, redirecionador público, duplicação de placement, prova de IP residencial/humano, garantia sub-1 ms, garantia sub-50 ms, exactly-once externo, comissão sem perda ou publicação automática nos quatro sites e sete redes sociais.

## Banco instalado

Arquivo principal:

- `supabase/migrations/supabase_v3500_quantum_inbound.sql`

Rollback versionado:

- `supabase/migrations/rollback_v3500_quantum_inbound.sql`

Objetos v3500 instalados:

- trigger `trg_v3500_outbox_signal` sobre `public.nexus_v1550_outbox_logged`;
- função `public.nexus_v3500_signal_outbox()`;
- índice `public.nexus_v3500_cj_route_lookup_idx`;
- função `public.nexus_v3500_currency(text)`;
- função `public.nexus_v3500_route_readiness(jsonb,text,text,text)`;
- função `public.nexus_v3500_operator_status()`;
- tabela de auditoria `public.nexus_v3500_cron_audit`;
- registros de capacidade v3500 no catálogo já existente.

A instalação usou transação, `statement_timeout='4000ms'`, `lock_timeout='1000ms'` e exceções críticas propagadas. O teste da mesma migração com `ROLLBACK` passou antes da instalação; o rollback versionado também passou em teste transacional sem remover a instalação real.

## Outbox e jobs

Verificação física posterior à instalação:

- PostgreSQL 17.6;
- outbox v1550 com `relpersistence='p'` (tabela permanente/LOGGED);
- 2.401 linhas vivas no instante da verificação;
- 1.187 receipts duráveis HTTP 201 já existentes;
- trigger de wake-up habilitado;
- zero pollers legados ativos entre os jobs 15, 16, 18, 21, 35, 36, 38, 40, 41, 44, 47, 48, 62, 63, 64 e 65;
- Job 60 preservado ativo em `10 seconds`, com o comando esperado de flush em lote de 40.

`NOTIFY` não substitui durabilidade: notificações não persistem e não demonstram entrega externa. A instalação não adicionou um executor residente que drene as 2.401 linhas. A remoção do outbox continua condicionada a HTTP 201 pelo núcleo v1550; nenhum clique ou entrega simulada foi criado para fabricar uma nova confirmação.

A auditoria registra o estado de instalação e reaplica `active=false` aos jobs identificados. Isto não torna reativação futura tecnicamente impossível para um administrador privilegiado; por isso a capacidade `future_reactivation_impossible` permanece falsa.

## Seletor de prontidão

O RPC recebe contexto de país somente dos cabeçalhos CDN permitidos, valida conflitos e trata país como dica de roteamento. O país não comprova humanidade, cidade, residência, intenção, disponibilidade comercial ou moeda preferida.

Moedas de contexto suportadas:

- BR → BRL;
- GB → GBP;
- países da área do euro previstos no código → EUR;
- US, CA e AU → USD somente como contexto operacional suportado;
- demais países → indisponível.

A Bulgária usa EUR porque adotou oficialmente o euro em 1º de janeiro de 2026 ([Comissão Europeia](https://economy-finance.ec.europa.eu/euro/eu-countries-and-euro/bulgaria-and-euro_en)); isso não é inferência de preferência do usuário.

Casos executados em produção, todos sem URL, redirect, clique, impressão ou venda:

- CJ, AU, `en-AU`, hotel: pronto;
- CJ, US, `en-US`, flight: indisponível por ausência de política exata;
- Amazon, BR: pronto por metadado criptografado presente;
- AliExpress, US: pronto por metadado criptografado presente;
- Shein, BR: pronto;
- Shein, US: fechado por escopo regional não validado;
- Mercado Livre, BR: pronto;
- Shopee, BR: fechado porque `public.nexus_shopee_offers` não existe fisicamente no mestre;
- cabeçalhos de país conflitantes: fechado.

A validação anterior, mantida como pré-condição, confirmou somente metadados criptografados esperados de Amazon, AliExpress, Shein e Mercado Livre. Não houve autenticação ao vivo em API/OAuth de cada rede nesta versão. As 19 políticas CJ selecionadas continuam frescas; o backlog CJ selado continua com 1.266 linhas.

ACL validada:

- `anon` não executa o RPC de prontidão diretamente;
- `authenticated` não executa o RPC diretamente;
- `service_role` executa;
- o POST Edge requer `NEXUS_V3500_EDGE_SECRET` e o segredo não foi gravado em repositório ou evidência.

## WebSockets, matching e concorrência

O worker existente preservado usa RFC 6455, backoff exponencial com jitter, Aho-Corasick em memória sobre 17.605 mapeamentos e `Promise.allSettled()` para fan-out de provedores. Os defaults de Nostr foram alinhados para:

- `wss://nos.lol`;
- `wss://relay.damus.io`.

O Jetstream usado pelo worker é `jetstream2.us-east.bsky.network`. O Edge satélite mantém uma sessão limitada por tempo e por 4.000 frames; ele não é um daemon permanente.

Um dry run local de 12 segundos, sem escrita no banco, observou:

- Jetstream conectado;
- nos.lol conectado;
- relay.damus.io conectado e depois uma resposta 521, seguida do caminho de reconexão;
- 458 frames;
- 1 candidato rejeitado por falta de intenção comercial;
- zero aceitos, zero RPC errors, zero gatilhos, zero cliques e zero impressões.

Isso comprova conectividade momentânea e o caminho de reconnect, não operação permanente.

## 13 satélites

A evidência v3005 anterior continua registrando 13 sessões limitadas concluídas, com até 4.000 frames, sem erros de runtime/RPC e sem matches, cliques ou conversões.

Na revalidação atual:

- 13/13 endpoints rejeitaram corretamente requisição sem JWT com HTTP 401;
- 9/13 funções foram confirmadas ACTIVE via Management API com as credenciais atualmente disponíveis;
- 4/13 não puderam ter o estado ACTIVE revalidado porque as credenciais atuais retornam acesso negado;
- nenhuma nova sessão WebSocket satélite foi iniciada;
- nenhum teste de entrega HTTP 201 foi fabricado;
- nenhum satélite demonstrou processo permanente 24/7.

Consequentemente, este relatório **não** declara alcance operacional atual integral de 13/13 nem residência permanente.

## Benchmarks

### HNSW v380

Microbenchmark controlado com 250 amostras em `public.nexus_v380_keyword_vectors`:

- índice no plano: `nexus_v380_kw_hnsw`;
- p50: 0,429 ms;
- p95: 0,469 ms;
- p99: 0,522 ms;
- máximo: 437,959 ms.

Escopo: uma única consulta vetorial repetida, quente, no servidor, com sequential scan desabilitado. O catálogo lógico tem 17.605 palavras, mas a tabela v380 tem 11.568 vetores. Não é teste end-to-end, concorrente ou garantia.

### Seletor de prontidão

Microbenchmark controlado com 250 chamadas server-side do caso CJ AU:

- p50: 0,250 ms;
- p95: 0,297 ms;
- p99: 0,407 ms;
- máximo: 4,285 ms.

O p99 observado ficou abaixo de 1 ms no escopo estreito; o máximo excedeu 1 ms. Não se declara SLA sub-1 ms nem latência Edge fim a fim.

## HTTP/Edge

Verificação do `nexus-quantum-inbound-v3500`:

- função ACTIVE, versão de deploy 1;
- GET de capacidades: HTTP 200;
- POST sem segredo: HTTP 401;
- POST autenticado de status: HTTP 200;
- prontidão CJ AU: HTTP 200;
- país inválido: HTTP 422;
- Shopee indisponível: HTTP 422;
- URL afiliada retornada: não;
- redirect efetuado: não;
- clique, impressão ou venda registrados: não.

Falhas operacionais retornam `Sintonizado em Análise`; elas não são rotuladas como VENDAS.

## Proteções preservadas

- nenhuma alteração nos placements originais Adsterra/Monetag;
- hashes protegidos dos três gateways de anúncio preservados;
- hash de `edge/jetstream/compose.ts` preservado;
- `X-Adsterra-Binding: pop=bound;sb=bound` protegido pelos testes cumulativos;
- `#publi`/`#ad` de linha própria preservados no compositor existente;
- zero URLs afiliadas, tokens, PATs, KMS, JWTs ou segredos incluídos nas evidências;
- zero clique programático, impressão fabricada, conversão ou venda declarada.

## O que ainda não está concluído

1. obter credenciais Management válidas para revalidar os quatro satélites atualmente inacessíveis;
2. prover uma plataforma realmente residente, se operação contínua for requisito — Supabase Edge e GitHub hosted runners não fornecem essa prova;
3. instalar e operar um executor durável do outbox com reconciliação, sem confundir `NOTIFY` com fila;
4. validar inventário físico Shopee antes de marcar a rede pronta;
5. executar autenticação/API real por provedor, onde termos e permissões permitirem;
6. criar uma estratégia de publicação explícita e aprovada antes de ligar qualquer rota promocional pública;
7. medir concorrência e latência end-to-end antes de estabelecer SLA.

## Evidências versionadas

- `docs/evidencias/v3500-sql-dryrun.json`
- `docs/evidencias/v3500-production-deploy.json`
- `docs/evidencias/v3500-production-verification.json`
- `docs/evidencias/v3500-edge-verification.json`
- `docs/evidencias/v3500-rollback-dryrun.json`
- `docs/evidencias/v3500-hnsw-benchmark.json`
- `docs/evidencias/v3500-route-readiness-benchmark.json`
- `docs/evidencias/v3500-rfc6455-dryrun.json`
- `docs/evidencias/v3500-satellite-current-verification.json`
