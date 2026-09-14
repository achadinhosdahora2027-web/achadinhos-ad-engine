# Laudo de produção v3380.0 — CJ Global Encrypted Backlog Seal

**Projeto mestre:** `etbxbaaaspdcoiakifbb`  
**Data da instalação:** 2026-09-13 (America/Sao_Paulo)  
**Resultado:** aprovado, instalado, cifrado e lacrado em modo fail-closed.

## 1. Descoberta CJ atual

A auditoria read-only consultou o escopo dos 196 países/territórios presentes no delta v3380.

| Evidência | Resultado |
|---|---:|
| Países consultados | 196 |
| Respostas API válidas | 196 |
| Erros de API | 0 |
| Registros Link Search examinados | 84.100 |
| Registros únicos por consulta-país | 84.100 |
| Candidatos text-link de viagem, joined, anunciante ativo e contrato ativo | 1.266 |
| Países com candidatos protegidos | 74 |
| URLs seguidas durante auditoria | 0 |
| Cliques, impressões ou vendas produzidos | 0 |

A presença em uma resposta filtrada por país não foi tratada como prova de cobertura de cidade, residência, idioma preferido, humanidade ou intenção de compra.

## 2. Cofre global instalado

Foram instaladas, como objetos LOGGED:

- `public.nexus_v3380_cj_global_ingestion`;
- `public.nexus_v3380_cj_global_vault`.

O payload foi transportado a partir do arquivo protegido em 13 lotes transacionais e somente foi marcado como lacrado após a validação integral de contagem.

Controles fisicamente verificados:

- 1.266 linhas cifradas e lacradas;
- 1.266 tracking URLs descriptografáveis internamente e com hash de host correspondente;
- 1.266 identidades CJ cifradas;
- 1.266 identificadores/destinos cifrados;
- 1.266 evidências com país explicitamente declarado no link;
- zero coluna sensível em texto plano;
- zero rota de backlog aprovada ou ativada;
- leitura direta negada a `anon`, `authenticated` e `service_role`;
- acesso somente por funções `SECURITY DEFINER` explicitamente concedidas ao `service_role`;
- KMS: vínculo existente `nexus_satellites_kms` obtido internamente de `nexus_growth_secrets`;
- evidência com validade de 24 horas e falha fechada após expiração.

A migração canônica é:

`supabase/migrations/supabase_v3380_cj_global_ingestion.sql`

Ela foi validada primeiro por transação real com `ROLLBACK` no PostgreSQL de produção. A migração de reversão é:

`supabase/migrations/rollback_v3380_cj_global_ingestion.sql`

## 3. Separação entre backlog e roteamento aprovado

O backlog global é um acervo cifrado de evidências, não uma autorização automática de roteamento.

| Estado | Resultado |
|---|---:|
| Backlog cifrado | 1.266 |
| Países no backlog | 74 |
| Rotas globais ativadas em massa | 0 |
| Rotas previamente selecionadas por país/locale/intent | 19 |
| Países das rotas selecionadas | 12 |

As 19 rotas já selecionadas continuam separadas em `nexus_v3380_cj_placement_policy`. O restante permanece com `activation_reason='backlog_quarantined_not_semantically_selected'`.

## 4. Edge publicado

A função interna `nexus-cj-global-v3380` foi publicada com segredo próprio e `verify_jwt` desativado somente para permitir o segredo interno customizado.

Verificações físicas:

- GET: HTTP 200;
- POST sem segredo: HTTP 401;
- POST interno autorizado: HTTP 200;
- retorno agregado: 1.266 linhas, 74 países, zero rota global ativada e 19 rotas selecionadas vigentes;
- nenhuma URL afiliada retornada;
- nenhum redirect, clique, impressão ou venda produzido.

A função publicada é de status interno. Ela não descriptografa URLs para o navegador e não executa geo-swap.

## 5. Infraestrutura preservada

- catálogo canônico: 17.605 keywords, inalterado;
- Job 60: ativo, agenda `10 seconds`;
- Jobs 15, 16 e 64: inativos;
- `statement_timeout='4000ms'` e `lock_timeout='1000ms'` usados na migração;
- falhas críticas propagam erro e revertem a transação;
- `api/ads/go.js`: SHA-256 `e77aab2895e8a194542866bf7c9e997a0fe37138638ce57125c8536009827716`;
- `edge/jetstream/compose.ts`: SHA-256 `d99ce7b5ca412102659f44d6d58f8f84f1b111f0f08865f208f13fd12cc730d0`;
- driver aquitem preservado: SHA-256 `7ad88bb3133169bc16ce005655829375faf5d85270e4676e10134cf2fd2e80bc`;
- terceiro driver preservado: SHA-256 `7da009550dcbad0d86b297f58ed9520e239c15d0f88a84d853ec9c703b000e9c`.

Nenhuma tag Adsterra/Monetag ou `ads.txt` foi alterada. O contrato de sucesso `X-Adsterra-Binding: pop=bound;sb=bound` permanece sob os drivers originais.

## 6. Itens deliberadamente não implantados

Por Veracidade Radical e conformidade anti-IVT, não foram implantados:

1. inferência de usuário humano baseada apenas em `is_bot=false`;
2. inferência de cidade ou proximidade com `CF-IPCountry`/`x-vercel-ip-country`;
3. entrega forçada de Mercado Livre/Shopee apenas porque o código CDN é BR;
4. identificadores comerciais citados sem revalidação de titularidade, contrato e link completo;
5. fallback automático que contorne o interstitial e atribua comissão em erro 404;
6. garantia de execução abaixo de 1 ms ou fallback abaixo de 50 ms;
7. promessa de comissão “sem perdas”;
8. ativação em massa dos 1.266 registros;
9. qualquer clique, impressão, compra ou conversão sintética.

O `compose.ts` permaneceu intacto, conservando a política existente de disclosure em linha própria. Nenhum dado observado autoriza transformar país em prova de disponibilidade municipal.

## 7. Vazão comprovada

“Vazão” neste laudo significa apenas processamento da instalação, não tráfego humano nem vendas:

- 84.100 registros de API examinados;
- 1.266 registros protegidos processados;
- 13 lotes de hidratação;
- 1.347.207 bytes de payload protegido transportados nos lotes;
- 12.571 ms acumulados de resposta dos lotes de hidratação;
- zero métrica de clique ou venda fabricada.

## Conclusão

O backlog global CJ v3380 está instalado e criptograficamente lacrado, mas corretamente quarentenado. A produção dispõe de 19 rotas semanticamente selecionadas e vigentes; não dispõe de prova para ativar automaticamente os demais 1.266 registros. O sistema permanece fail-closed, sem redirecionamento público e sem alegações de cobertura urbana, latência garantida ou receita.
