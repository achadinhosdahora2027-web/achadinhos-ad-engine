# Correções do gateway — 13/09/2026 (v128.7 + v128.8)

Arquivos prontos para subir ao repositório (o token do GitHub expirou às 06h; nada
foi pushado). São exatamente os arquivos que estão **no ar** no motor
(`achadinhos-ad-engine.vercel.app`) e nas cidades do aquitem.

## O que subir, onde

| Arquivo aqui | Destino no repositório | Estado |
|---|---|---|
| `api/ads/go.js` | `api/ads/go.js` (motor) | no ar ✅ |
| `api/ads/go.aquitem.js` | `api/ads/go.js` do app **aquitem/cidades** | no ar ✅ |
| `api/ads/click.js` | `api/ads/click.js` (novo) | no ar ✅ |
| `lib/ads/registrar-clique.js` | `lib/ads/registrar-clique.js` (novo) | no ar ✅ |
| `tests/go.test.js` | `tests/go.test.js` | 9/9 verdes ✅ |
| `patch_aquitem_v128_8.py` | ferramenta (opcional) | aplica a correção no app das cidades |

## O que cada correção faz

1. **Gate humano (v128.7)** — tráfego sintético não conta clique, não recebe anúncio
   e não é repassado às redes de afiliado. Discriminador medido: ausência do
   cabeçalho `Accept-Language` (0 de 45.025 cliques em 7 dias tinham esse cabeçalho).
2. **Clique comprovado (v128.8)** — o GET do link não grava mais clique. O clique é
   avisado pelo próprio intersticial (beacon) com token assinado por HMAC, emitido
   só para navegação com gesto real (`Sec-Fetch-User: ?1`). Sem token, não grava;
   token repetido ou adulterado é recusado; sem gesto, não serve anúncio.
3. **Segredo do clique** — variável `NEXUS_CLICK_SECRET` criada em produção nos dois
   projetos da Vercel (motor e aquitem). Valor não fica em texto claro em nenhum
   arquivo deste workspace.

## Comandos de verificação (rodam contra produção)

```bash
bash tests/prova_clique_comprovado.sh          # bateria completa (9 provas)
node tests/go.test.js                          # testes automatizados do gateway
```

## Pendências

- Cloudflare: tokens `cfat_…` estão 401 — sem eles o `www.aquitemachadinhos.com.br/api/ads/go`
  continua 404 e o ads.txt novo não sobe.
- `workers/jetstream-consumer.js`: passar `&kw=<produto>` para a suborigem por produto.
