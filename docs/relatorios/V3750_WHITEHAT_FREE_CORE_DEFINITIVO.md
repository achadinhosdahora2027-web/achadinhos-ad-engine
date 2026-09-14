# v3750.0 — Laudo definitivo White-Hat Replay & Free Core

**Data:** 14/09/2026

**Mestre:** `etbxbaaaspdcoiakifbb` — PostgreSQL 17.6

**Resultado:** implantação segura **parcialmente operacional**. O core SQL e os 14 gateways de replay estão ativos; Groq respondeu; OpenRouter foi configurado com modelos de preço catalogado zero, mas retornou rate limit/timeout; o patch Cloudflare foi bloqueado antes da produção por divergência do artefato estático.

## Estado implantado

| Componente | Estado comprovado |
|---|---|
| Migration `supabase_v3750_free_core.sql` | Instalada atomicamente no mestre |
| Snapshot Aho-Corasick | 17.605 keywords exatas |
| Gateways de replay limitado | 14/14 implantados e autenticados |
| Fontes aceitas | fixture sintética, exportação do operador e staging próprio |
| X, cookies e scraping | Excluídos; campo de sessão proibido retornou HTTP 422 |
| Ledger e outbox | LOGGED; trigger atômico comprovado em transação revertida |
| Replay persistido | Zero; a prova foi dry-run sem escrita |
| Groq | Operacional em dois testes sintéticos |
| OpenRouter | Allowlist ativa no código; HTTP 429 e timeout na prova |
| Cloudflare `aquitem` | Credencial válida e projeto encontrado; patch não publicado |
| `go.js` e `compose.ts` | Imutáveis, hashes preservados |
| Job 60 | Ativo a cada 10 segundos; pacing 3/minuto e 40/hora preservado |

## Allowlist OpenRouter

Os dois modelos originalmente propostos não aparecem no catálogo atual de 445 modelos. Após autorização do operador, foram selecionados:

- `google/gemma-4-26b-a4b-it:free`;
- `nvidia/nemotron-3.5-lightning:free`.

Ambos estavam presentes e com preço de prompt/completion igual a zero no catálogo consultado. Isso não garante disponibilidade, ausência de rate limit ou custo futuro. Na prova autenticada, Gemma retornou HTTP 429 e Nemotron expirou por timeout. Nenhum HTTP 402 foi observado. O fan-out `Promise.allSettled()` permaneceu funcional e o Groq respondeu.

## Replay e matching

O endpoint `nexus-whitehat-replay-v3750` foi implantado nos 14 Supabase. Ele:

- rejeita cookies, `auth_token`, proxy residencial e sessão de navegador;
- aceita no máximo 50 itens por chamada limitada;
- carrega 17.605 padrões em RAM;
- persiste somente hashes e metadados quando `persist=true`;
- usa dry-run por padrão;
- não publica, não redireciona e não registra clique;
- trata país apenas como dica de mercado/moeda.

Na prova dry-run, um item sintético encontrou correspondência, o Aho foi construído no Edge em 290,512 ms e nenhuma linha foi gravada.

## Cloudflare Pages `aquitem`

O novo token de conta autenticou com HTTP 200, e o projeto `aquitem` foi encontrado entre três projetos Pages. O token e as credenciais R2 foram preservados em arquivo protegido `0600` e não entraram no Git.

A auditoria comparou 39 arquivos locais com o host Pages: somente 8 foram idênticos; 31 divergiram ou não puderam ser confirmados. Um Direct Upload poderia substituir o artefato atual e violar a proibição de alterar placements. Por isso, o integrity gate bloqueou o deploy.

O componente aditivo está versionado em `functions/api/v3750/context.ts`, mas **não está ativo em produção**. Ele não redireciona nem retorna URL afiliada. Para publicação segura, é necessário recuperar o artefato-fonte exato atualmente implantado ou fornecer um fluxo de deploy que preserve todos os assets existentes.

## Roteamento e fallback

`CF-IPCountry` e `x-vercel-ip-country` são tratados somente como dicas de contexto. Não comprovam país de residência, humanidade, cidade, fuso, idioma preferido ou intenção de compra.

Não foi implementado fallback direto porque não existe, neste escopo, uma URL final de produto verificada por item e uma medição real do comportamento. Consequentemente, não são alegados:

- p50 end-to-end de 0,93 ms;
- garantia sub-1 ms;
- fallback sub-50 ms;
- comissão sem perdas;
- tráfego residencial/humano comprovado.

## Filas, cron e inventário

- Job 60 continua ativo e inalterado;
- outros jobs subminuto: zero;
- pollers legados identificados ativos: zero;
- ads: 14.301, sendo 12.165 ativos;
- keywords: 17.605;
- Shopee: 1.201;
- matriz: 27;
- eventos/outbox v3750 persistidos: zero.

As três respostas `ads.txt` consultadas retornaram HTTP 200, mas não são byte a byte idênticas ao arquivo deste repositório nem entre si. Como nenhum host foi alterado, o laudo registra preservação, não uma falsa paridade entre conteúdos diferentes.

## Exclusões verificadas

- nenhum transporte X;
- nenhum cookie de terceiro;
- nenhum scraper;
- nenhuma emulação humana/residencial;
- nenhum clique afiliado programático;
- nenhuma publicação;
- nenhuma modificação em `api/ads/go.js` ou `edge/jetstream/compose.ts`;
- nenhuma operação contínua 24/7 alegada.

## Conclusão

A v3750.0 segura está ativa no mestre e nos 14 gateways Supabase para staging/replay limitado. O estado do pool é parcial: Groq operacional e OpenRouter configurado, porém rate-limited/timeout na prova. O Cloudflare `aquitem` permanece intocado devido ao integrity gate. Portanto, não é correto declarar redirecionamento Cloudflare, fallback direto, custo zero garantido ou operação planetária 24/7.
