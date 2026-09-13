# Laboratório do intersticial — medição em navegador real

Ferramentas usadas em 13/09/2026 para medir, em Chromium de verdade, o que o
visitante realmente recebe. Nada aqui grava clique em produção: o servidor roda
com `CLICKS_DB_URL`/`CLICKS_DB_KEY` removidos do ambiente.

| Arquivo | O que mede |
|---|---|
| `server.js` | sobe `api/ads/go.js` localmente com um shim Vercel-like, permitindo forjar host e geo |
| `medir2.js` | estado das tags (carregou/falhou), abertura do popunder no gesto, erros de console |
| `medir_directlink.js` | o que o Direct Link devolve quando aberto como PÁGINA (não como script) |
| `auditar_hosts.js` | auditoria por host: quais redes carregam de fato em cada site |
| `tagtest.js` | a mesma tag servida a partir de cada domínio de origem (testa bloqueio por referer) |

Uso: `node server.js 8080 <caminho-do-repo>` e, noutro terminal,
`node medir2.js "http://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=lab&slot=lab&geo=BR&offer=1" rotulo`
(é preciso `PLAYWRIGHT_CORE` apontando para o pacote playwright-core instalado,
e o Chromium pode exigir `--host-resolver-rules` para resolver o host real em 127.0.0.1).

## Medições de 13/09/2026 (antes/depois da correção v128.6)

- Direct Link da Adsterra carregado como `<script>` → **200 · 0 byte** (nada é exibido, nada é contado).
- Direct Link aberto como página → **200 · 0 byte** (documento vazio, sem redirecionamento).
- SocialBar (`undergocutlery.com/<hash>.js`) → **403 · 0 byte**, com referer correto de cada domínio.
- Monetag (`quge5.com`, `auqot.com`, `ekhay.com`, `b3mny.com`) → **200** com 29 KB a 167 KB de JS real.
- Antes: handler do clique lançava `ReferenceError` (variável só existia no servidor).
- Depois: popunder abre **uma única aba** no gesto do visitante e a SocialBar entra no formato de script.
