# v128.9 — Tag real do produto no clique + freio de excesso no Telegram

**Data:** 13/09/2026 · **Hora da medição:** 06:20–06:35 UTC (03:20–03:35 em São Paulo)
**Regra desta casa:** só entra aqui o que foi medido. O que não foi medido está dito como não medido.

---

## 1. O que estava errado (medido, não suposto)

### 1.1 Tag do link publicado
Link publicado nos grupos `tg_ofertasbrasilz` / `tg_cliquesnow`, copiado do próprio buffer:

```
https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=bsky_zuvnda6egfky&slot=jetstream_v330&geo=BR&offer=f34621207a9b96d85dac3f75245b7165
```

Antes: a suborigem que chegava à rede era o **nome genérico da campanha**
(`bsky_zuvnda6egfky_us_jetstream_v330_mobile`). O relatório não dizia qual produto gerou o clique.

### 1.2 Volume no Telegram — o vetor de ban
Do próprio buffer (`public.nexus_telegram_message_buffer`, projeto AquiTem `efvuzxdhsirpvxclgdfg`):

| hora (UTC) | mensagens | chaves distintas | repetição |
|---|---|---|---|
| 02:00 | 126 | 26 | 79% |
| 03:00 | 161 | 68 | 58% |
| 04:00 | 211 | 94 | 55% |
| 05:00 | 225 | 77 | **66%** |
| 06:00 | 72 | 50 | 31% |

6 h = **796 mensagens, 296 chaves distintas**. Só de repetição: **500 mensagens (62,8%)** — "video game" apareceu **119×**, "la vida" 34×, "que voce" 27×.
Não era excesso de conteúdo novo: era o **mesmo conteúdo repetido em rajada** — exatamente o que o Telegram pune com banimento.

---

## 2. O que foi corrigido

| # | Correção | Onde |
|---|---|---|
| 1 | Suborigem do clique = **nome real do produto** (oferta → catálogo de 1.141 ofertas; senão `kw`); slot declarado por CTA é preservado | `api/ads/go.js` (engine **e** app das cidades) |
| 2 | Arquitetura duplicada no fim do `sid` (`_mobile_mobile`) eliminada | idem |
| 3 | Link do post ganha `&kw=<produto>` | `api/cron/index.js` (flush) **e** `workers/jetstream-consumer.js` (origem do match) |
| 4 | **Freio de entrada:** a mesma matéria-prima (oferta/keyword/texto) não entra duas vezes na fila — 6 h (publicação), 30 min (clique), 1 h (alerta) | trigger `trg_nexus_telegram_dedupe` |
| 5 | **Porteiro de saída:** teto por destino — 3/min e 40/h, com registro em `nexus_telegram_delivery_log`; o que passa do teto é adiado, não enviado | função `nexus_telegram_gate` + flush |

Artefatos: `supabase/migrations/supabase_v128_9_telegram_excesso.sql`, `patch_suborigem_real_v128_9.py`, `patch_flush_v128_9.py`.
Publicados no repositório (commit `a4a726b`, `main`) e em `correcoes/clique-comprovado/v128.9/`.

---

## 3. Prova (o que foi executado e o que voltou)

### 3.1 Tag — link REAL já publicado, em produção
Clique com gesto humano nos 4 links mais recentes do buffer:

| link publicado | suborigem ANTES | suborigem AGORA |
|---|---|---|
| `…site=bsky_zuvnda6egfky…offer=f3462120…` | `bsky_zuvnda6egfky_us_jetstream_v330_mobile` | **`bsky_zuvnda6egfky_us_f_a_mix_mobile`** |
| `…site=bsky_zutgqwisfmp4…offer=c2c4c929…` | `…_jetstream_v330_mobile` | **`…_la_vida_cosmeticos_mobile`** |
| `…site=bsky_zuclatxufo2x…offer=84fce2a2…` | `…_jetstream_v330_mobile` | **`…_refil_filamento_pla_kit_10_20_rolos_50_1_mobile`** |
| `…site=bsky_zua4opr4jg4x…offer=220ffae8…` | `…_jetstream_v330_mobile` | **`…_xarope_dilute_maca_verde_zero_500ml_soda_mobile`** |

URL de destino efetivamente entregue ao visitante no link 1 (copiada do intersticial em produção):

```
https://www.anrdoezrs.net/click-101859672-17242061?sid=bsky_zuvnda6egfky_us_f_a_mix_mobile
  &aff_sub=bsky_zuvnda6egfky_us_f_a_mix_mobile&aff_sub2=US
  &subid=bsky_zuvnda6egfky_us_f_a_mix_mobile&subid1=US&subId1=bsky_zuvnda6egfky_us_f_a_mix_mobile
```

Isto é: **os posts que já estão no ar também foram consertados** — a correção é no gateway, não só nos posts novos.

CTA de cidade (slot declarado) segue preservado, como manda a atribuição:
`…slot=city_antananarivo_hotel` → `sid=aquitemachadinhos_us_city_antananarivo_hotel_mobile` (HTTP 200, `x-nexus-tags: servidas`).

Suíte local do gateway: **9/9** (`tests/go.test.js`).
Deploys de produção: engine `achadinhos-ad-engine.vercel.app` e cidades `aquitemachadinhos.com.br` (alias prod).

### 3.2 Freio — prova em produção, caminho real do flush
5 mensagens de teste na mesma fila, mesmo destino, chat inexistente (nada chega ao usuário):

```
pendentes=5 enviados=0 falhas=3 adiadas=2
  id 931 → tentou enviar (chat not found, de propósito)
  id 932 → tentou enviar
  id 933 → tentou enviar
  id 934 → contido: limite_minuto
  id 935 → contido: limite_minuto
```

**Primeira tentativa desta prova FALHOU e está registrada aqui:** o porteiro bloqueava no banco, mas o flush
não lia a resposta (`rpc()` devolve `{ok,data}` e o código testava `porteiro.pode`) → fail-open, as 4 primeiras
passaram. Corrigido (desembrulhar `data`), redeployado e re-testado: a prova acima é do código corrigido.

Freio de entrada, com payload real de post:

| cenário | resultado |
|---|---|
| cópia de um post que já está na fila (mesma oferta) | **0 entrou** |
| duas mensagens novas idênticas (matéria-prima inédita) | **1 entrou** (a 2ª descartada) |

### 3.3 Efeito esperado no volume
Com os 6 h medidos (796 mensagens → 296 chaves distintas), o freio de entrada sozinho corta **62,8%**.
O porteiro de saída ainda limita cada destino a **3/min e 40/h** (antes: 225/h num único canal).
**A taxa real das próximas horas ainda não foi medida** — é a medição de acompanhamento (consulta pronta na seção 5).

---

## 4. Estado do deploy

| peça | estado |
|---|---|
| Engine `api/ads/go.js` v128.9 | **em produção** (`achadinhos-ad-engine.vercel.app`, alias confirmado) |
| Cidades `api/ads/go.js` v128.9 | **em produção** (`aquitemachadinhos.com.br`) |
| Flush `api/cron/index.js` v128.9 | **em produção** (executado às 06:31 e 06:32 UTC com o porteiro ativo) |
| Banco: trigger + função + log | **instalados e testados** no projeto AquiTem |
| `workers/jetstream-consumer.js` com `kw` no link | **no repositório** (GitHub `main`, commit `a4a726b`); passa a valer no próximo ciclo do workflow |

---

## 5. O que fica pendente (com a consulta exata)

1. **Medir a taxa real depois do freio** (próxima vez que o produtor rodar):
   `select to_char(date_trunc('hour',created_at),'HH24:00') hora, count(*) msgs, count(distinct coalesce(payload->>'oferta',payload->>'keyword',left(body_text,40))) chaves from public.nexus_telegram_message_buffer where created_at > now() - interval '6 hours' group by 1 order by 1;`
2. **Afinar o teto** se 40/h ainda for demais (troca de 1 linha: `p_max_hora`).
3. **Confirmar a rota BR** no clique real: a bancada de teste sai por IP dos EUA e o Vercel sobrescreve o
   cabeçalho de país — não foi possível simular visitante brasileiro daqui. A regra BR → Shopee/`meli.la`
   é a verificada na v340; o que falta é o clique real vindo do Brasil, que a telemetria vai mostrar.
4. **Esclarecimento sobre o `www`:** `www.aquitemachadinhos.com.br/mg/antananarivo` responde **200** (site no ar);
   o 404 é só em `/api/ads/go` no `www` (Cloudflare), e os CTAs das cidades apontam para o domínio do engine,
   que responde normalmente. O item antigo "www 404" era mais estreito do que parecia — não derruba o produto.
5. Push do restante da pasta de canônicos e demais pendências herdadas (credencial de fila no AquiTem,
   painel Adsterra, ads.txt Cloudflare, robôs 24-7).
