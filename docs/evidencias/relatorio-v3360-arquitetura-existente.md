# v3360.0 — inspeção da arquitetura existente

**Escopo da inspeção:** ingestão CJ, catálogo, resolução territorial, copywriter, landing pages, redirecionamento, telemetria, conversões, CI/CD, Supabase Edge e placements protegidos. Nenhuma constatação abaixo é tratada como clique, impressão, venda ou alcance de produção.

## Componentes aproveitáveis

- O v3340 já mantém léxico LOGGED, RPC somente para `service_role`, comparação cosseno corretamente rotulada e resposta sem redirecionamento.
- Os vaults v3310–v3350 estabelecem o padrão de criptografia individual via `pgcrypto` e KMS que não sai do PostgreSQL.
- `nexus-copywriter-v3200` preserva cópia determinística como canônica e rejeita saída livre do modelo.
- CI executa testes antes do deploy Vercel.
- O fluxo v420 preserva separação dos destinos Telegram e as invariantes dos jobs protegidos.

## Problema corrigido no escopo v3360

`scripts/cj-product-catalog-sync.js` tratava `partnerIds` como PID de publisher. Na API Product Feed, `partnerIds` são CIDs de anunciantes; o PID pertence a `linkCode(pid: ...)`. A versão v3360 usa `partnerStatus: JOINED`, `serviceableAreas` e `linkCode` no lugar correto. Também remove defaults de CID/PID, não mostra prefixo do token e não grava tracking/direct/image URLs.

## Superfícies preexistentes não usadas pelo v3360

### `api/telemetry/collect.js`

Há bases aleatórias de pageviews/visitantes e estimativas locais de impressões/receita. Esses números não são eventos W3C observados e não podem alimentar v3360, relatórios de venda ou otimização. A persistência em arquivo de uma função serverless também não prova durabilidade.

### `api/oferta.js`

A página preexistente marca `Offer` como `InStock` sem evidência específica de estoque, usa linguagem de “verificação em tempo real” baseada apenas em linhas `active`, e não põe disclosure de afiliado em linha própria antes de cada link. O destaque automático após tempo de tela não representa performance comprovada. v3360 não publica páginas por esse renderizador.

### `api/affiliate/postback-webhook.js`

O fluxo consulta duplicata e depois executa persistência, ledger e Telegram em etapas separadas. O retorno da inserção não é exigido antes dos efeitos posteriores; portanto, não oferece idempotência transacional nem exactly-once externo. v3360 não o usa para afirmar conversões.

### `api/ads/go.js` e `edge/jetstream/compose.ts`

São superfícies protegidas. Permanecem byte-idênticas. Em especial, o cabeçalho de sucesso de `/api/ads/go` não foi alterado. A expansão local não injeta nem duplica Adsterra/Monetag. O harness `tests/go.test.js` foi ajustado para suprimir o diagnóstico legado de `go.js` durante os testes, impedindo que URLs/PIDs completos apareçam nos logs de CI; a lógica do gateway não foi modificada.

## Decisão arquitetural v3360

A implementação é aditiva e isolada:

- tabela delta de 816 entidades novas, sem duplicar 37 linhas v3340;
- política CJ de 87 combinações sem URL em texto claro;
- hidratação opcional por payload protegido: RPC temporário restrito a `service_role` via corpo preparado do PostgREST, ou GUC transacional em sessão direta; o RPC retorna apenas contagens e deve ser removido depois da instalação;
- allowlist estrita dos hosts CJ observados, 87 chaves distintas e frescor máximo de 24 horas antes da criptografia individual;
- rotas desligadas quando a URL criptografada/fresca não existe;
- RPC e Edge internos retornam metadados, cópia e `placement_key`, mas nunca URL;
- publicação, sitemap, IndexNow e endpoint de redirecionamento permanecem desligados.

A migração cumulativa, a hidratação cifrada e o adaptador Edge interno foram aplicados e validados fisicamente em 13/09/2026. O RPC transitório de hidratação foi removido após a instalação. Não há página pública, redirecionador v3360, sitemap nem indexação.

Essa decisão evita propagar as métricas sintéticas e as afirmações indevidas das superfícies legadas para a expansão.
