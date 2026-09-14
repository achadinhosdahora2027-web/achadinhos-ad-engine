# v3700.0 — Relatório definitivo de produção

**Data local da verificação:** 13/09/2026 (America/Sao_Paulo)

**Projeto mestre:** `etbxbaaaspdcoiakifbb`

**Resultado:** implantação **parcial e veraz**. O núcleo criptográfico, o ledger/outbox, as regras, os adaptadores limitados e o copiloto Groq estão implantados. A conexão X não está ativa porque o endpoint retornou HTTP 402; o DeepSeek também retornou HTTP 402. Não existe alegação de execução contínua.

## 1. Estado executivo: implantado versus ativo

| Componente | Implantado | Ativo/verificado | Evidência factual |
|---|---:|---:|---|
| Vault privado X no mestre | Sim | Sim | 7/7 credenciais cifradas individualmente; LOGGED; ACL privada; hidratação descartada |
| Ledger permanente de eventos | Sim | Sim, vazio | LOGGED; zero evento X persistido |
| Outbox permanente `atendimento` | Sim | Sim, vazio | LOGGED; trigger atômico comprovado em transação revertida |
| Adaptador X HTTP limitado | 14/14 | Status e segredo 14/14 | Máximo de 90 s por sessão Edge |
| Regras X metropolitanas | 2 | Sim | POST 201; GET 200; São Paulo e Nova York por raio de 40 km |
| Conexão X Filtered Stream | Código implantado | **Não** | `GET /2/tweets/search/stream` retornou **HTTP 402**; conexão não estabelecida |
| Conexões X ativas da v3700 | — | **0** | Lease livre; nenhuma sessão HTTP 200 |
| Aho-Corasick com 17.605 padrões | Sim | Sim | 2.000/2.000 casos sintéticos corretos |
| Copiloto Groq | Sim no mestre | Sim | Dois escopos sintéticos verificados com `openai/gpt-oss-20b` |
| Copiloto DeepSeek | Sim no fan-out | **Não** | Provedor retornou **HTTP 402** |
| Pool Groq + DeepSeek completo | Sim no código | **Parcial** | `Promise.allSettled`; somente Groq respondeu |
| Publicação/resposta automática no X | Não | Não | Nenhum post lido, escrito ou publicado |
| Runtime externo residente 24/7 | Não | Não | Não provisionado; Edge tem duração limitada |
| Fallback anti-404 sub-50 ms | Não | Não | Ausência de URL final mercante verificada e de medição comportamental |

## 2. Vault e criptografia

A migration `supabase_v3700_twitter_vault.sql` foi instalada atomicamente no PostgreSQL 17.6. A tabela `public.nexus_v3700_twitter_vault` é privada, RLS forçada e estritamente LOGGED (`relpersistence='p'`).

As sete credenciais fornecidas foram transmitidas uma única vez por RPC PostgREST autenticada, cifradas dentro do PostgreSQL com `extensions.pgp_sym_encrypt()` e a chave KMS `nexus_satellites_kms`. O RPC de hidratação foi revogado e removido após a conferência criptográfica 7/7. Não há coluna de segredo em texto puro, valor de segredo no Git ou segredo em evidência.

A rotação controlada do par OAuth 2.0 foi preservada porque refresh tokens rotacionam. Essa rotina atualiza somente o par access/refresh, cifra dentro do banco e não retorna plaintext.

## 3. Transporte X e segmentação

O Filtered Stream do X foi implementado corretamente como **stream HTTP persistente**, não como WebSocket RFC 6455. Os dois filtros instalados são:

- São Paulo: `point_radius` de 40 km a partir do centro configurado;
- Nova York: `point_radius` de 40 km a partir do centro configurado.

Esses filtros usam geotag/place associado ao post. Eles **não** provam cidade de residência, humanidade, IP residencial, buyer intent ou permanência física. Também não transformam o Filtered Stream em firehose completo.

O código impõe lease único para respeitar a limitação de uma conexão por app observada na documentação padrão. Os 14 projetos receberam adaptadores; isso não significa 14 conexões simultâneas.

### Bloqueio atual

A prova limitada carregou os 17.605 padrões no Edge e só então tentou abrir `GET /2/tweets/search/stream`. O X respondeu HTTP 402 (Payment Required). Por isso:

- conexão estabelecida: não;
- posts recebidos: zero;
- eventos gravados: zero;
- conexões ativas após a prova: zero;
- capacidade `v3700_x_filtered_http_stream`: desabilitada no registro operacional.

As regras permanecem instaladas, mas inertes até a conta/app possuir o nível de acesso necessário.

## 4. Matching Aho-Corasick

O snapshot read-only contém exatamente 17.605 keywords distintas. O Edge recebe somente `kw` e hash SHA-256 da referência de oferta; URLs afiliadas não entram no snapshot.

Benchmark local determinístico:

| Métrica | Resultado |
|---|---:|
| Padrões | 17.605 |
| Casos sintéticos | 2.000 |
| Casos corretos | 2.000 |
| Build | 178,741 ms |
| p50 de busca | 0,008149 ms |
| p95 de busca | 0,021072 ms |
| p99 de busca | 0,036615 ms |
| Máximo | 5,967440 ms |
| Build observado no Edge | 267,811 ms |

Isso comprova o microbenchmark do matcher; **não** comprova latência X→Edge→banco, “mesmo milissegundo” determinístico, p50 end-to-end de 0,93 ms nem garantia sub-1 ms.

## 5. Ledger, outbox e fail-closed

Foram criados como LOGGED:

- `nexus_v3700_twitter_event_ledger`;
- `nexus_v3700_twitter_inbound_outbox`;
- `nexus_v3700_twitter_session_audit`;
- `nexus_v3700_twitter_stream_lease`.

A inserção no ledger dispara a criação do outbox `atendimento` na mesma transação. A prova transacional inseriu um evento sintético, confirmou ledger + outbox e reverteu tudo; nenhuma linha sintética permaneceu. A notificação PostgreSQL é apenas sinal e não é tratada como armazenamento durável.

O ledger rejeita texto bruto, URL afiliada e publicação. Falhas propagam exceção. Nenhuma limpeza de fila ocorre antes do sucesso transacional. Não há alegação de exactly-once externo.

## 6. Copiloto multi-LLM e disclosure

O broker central no mestre usa fan-out assíncrono com `Promise.allSettled`:

- Groq: operacional em dois testes sintéticos;
- DeepSeek: indisponível por HTTP 402.

As respostas passam por filtro neutro que rejeita urgência artificial, estoque, prova social, vendas, cliques, ganhos e disponibilidade não verificados. O broker não publica e não gera URL. O template termina rigidamente em:

```text
#publi
{{SHORT_LINK}}
```

ou, para o escopo dos EUA:

```text
#ad
{{SHORT_LINK}}
```

Assim, o disclosure fica em linha própria imediatamente antes do placeholder da URL curta. Nenhum link real foi gerado ou clicado nesta implantação.

## 7. Telegram, cron e catálogos protegidos

- Job 60 continua ativo com schedule `10 seconds` e comando original;
- o código de pacing `3/minuto e 40/hora` continua presente;
- separação por canal foi preservada;
- jobs 15, 16 e 64 continuam inativos;
- total de jobs ativos: 29;
- outros jobs subminuto: zero;
- pollers legados identificados ativos: zero; portanto nenhum job adicional foi desligado;
- canal v3700: `atendimento`;
- falhas operacionais usam `Sintonizado em Análise`, não VENDAS.

Catálogos continuam inalterados:

- keywords: 17.605;
- ads: 14.301, sendo 12.165 ativos;
- Shopee: 1.201;
- matriz: 27.

`compose.ts`, `api/ads/go.js`, `/api/ads/go` e placements Adsterra/Monetag não foram modificados.

## 8. O que não foi alegado ou implantado

- nenhuma conexão 24/7;
- nenhum WebSocket para X;
- nenhum firehose completo;
- nenhuma residência/humanidade comprovada;
- nenhum clique programático, venda, comissão, ganho ou conversão fabricada;
- nenhuma publicação automática no X;
- nenhuma garantia sub-1 ms end-to-end;
- nenhum fallback sub-50 ms;
- nenhum fallback anti-404 sem destino mercante final validado;
- nenhum exactly-once externo.

## 9. Desbloqueios necessários

1. Habilitar no app/conta X um plano que aceite `GET /2/tweets/search/stream`; repetir a prova limitada e exigir HTTP 200 antes de iniciar um worker residente.
2. Regularizar crédito/permissão da chave DeepSeek; repetir os dois testes sintéticos.
3. Para operação permanente, provisionar um worker externo realmente residente, com um único lease-holder e reconnect/backoff. Supabase Edge continua sendo apenas adaptador limitado.
4. Para fallback anti-404, obter URLs finais mercantes permitidas, realizar verificação HTTP sem clique afiliado e medir comportamento real antes de ativar.

## 10. Rollback

- Banco: `supabase/migrations/rollback_v3700_twitter_vault.sql`;
- regras X: `scripts/rollback-v3700-x-rules.py`, protegido por confirmação explícita;
- Edge: remover/reverter os dois slugs pelos 14 projetos;
- as credenciais protegidas locais não são apagadas pelo rollback, conforme a restrição do operador.

## 11. Evidências principais

- `v3700-production-install.json`
- `v3700-14-project-edge-deploy.json`
- `v3700-x-rules-install.json`
- `v3700-bounded-stream-proof.json`
- `v3700-aho-benchmark.json`
- `v3700-copilot-proof.json`
- `v3700-atomic-trigger-proof.json`
- `v3700-runtime-reconciliation.json`
- `v3700-definitive-production-audit.json`
- `v3700-plaintext-secret-scan.json`

## 12. Referências oficiais de protocolo

- X Filtered Stream: <https://docs.x.com/x-api/posts/filtered-stream/introduction>
- Operadores do Filtered Stream: <https://docs.x.com/x-api/posts/filtered-stream/integrate/operators>
- Endpoint `GET /2/tweets/search/stream`: <https://docs.x.com/x-api/stream/stream-filtered-posts>
- Limites do X API: <https://docs.x.com/x-api/fundamentals/rate-limits>
- OAuth 2.0 Authorization Code + PKCE: <https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code>
- Limites de Edge Functions: <https://supabase.com/docs/guides/functions/limits>

## Conclusão

A infraestrutura v3700.0 está instalada de forma cumulativa, privada e fail-closed. A capacidade de transporte está **implantada, porém não ativa**: o X bloqueou a abertura com HTTP 402. O pool multi-LLM está **parcial**: Groq funciona e DeepSeek está bloqueado por HTTP 402. Portanto, o estado honesto é **pré-pronto operacional com bloqueios externos**, e não uma operação 24/7 ou um cluster de 14 streams ativos.
