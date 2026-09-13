#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v128.9 — SUBORIGEM REAL nos links publicados (engine e app das cidades).

Medido em 13/09/2026 nos links que saem para os grupos:
  .../api/ads/go?brand=shopee&site=tg_ofertasbrasilz&slot=jetstream_v330&offer=<hash>
  → sid = tg_ofertasbrasilz_us_jetstream_v330_mobile
Ou seja: a tag de DESTINO estava certa, mas a suborigem era o nome genérico da
campanha — o relatório não dizia QUAL produto gerou o clique.

Agora: quando o link traz a oferta (offer=<hash>) ou a palavra-chave (kw/q) e o
slot é genérico de campanha (jetstream*, header, inline, health…), a suborigem
passa a ser o nome REAL do produto + arquitetura (regra v340). Slot de CTA
declarado (ex.: city_ananindeua_flights) continua preservado para não perder a
atribuição do botão.
"""
import sys

ALVO = sys.argv[1] if len(sys.argv) > 1 else 'api/ads/go.js'
s = open(ALVO, encoding='utf-8').read()

# aceita tanto o engine quanto o app das cidades (mesma linha, nome igual)
ANTIGO = "  const keywordDoClique = String(query.q || query.kw || query.keyword || (typeof shopeeHit !== 'undefined' && shopeeHit && shopeeHit.n) || '').slice(0, 120);"
assert ANTIGO in s, 'linha do keywordDoClique nao encontrada'

NOVO = """  /* ══ v128.9 SUBORIGEM REAL ═══════════════════════════════════════════════
     Slot genérico de campanha (jetstream_v330, header, inline, health…) não
     identifica produto nenhum. Quando o link traz a oferta ou a palavra-chave,
     a suborigem passa a ser o NOME REAL do produto + arquitetura — é isso que
     aparece no relatório e no painel da rede. Slot de CTA declarado
     (ex.: city_ananindeua_flights) continua preservado: ali a atribuição é do
     botão, não do produto. */
  const SLOT_GENERICO = /^(jetstream|header|inline|health|sem_keyword|radar|city|ci|lab|fanout|digest|v\\d{2,3})/i;
  let nomeOferta = '';
  try {
    const hOferta = String(query.offer || query.oferta || '').trim();
    if (hOferta) {
      const inv = (typeof getShopeeInventory === 'function') ? getShopeeInventory() : null;
      if (inv && inv.offers && inv.offers[hOferta] && inv.offers[hOferta].n) nomeOferta = String(inv.offers[hOferta].n);
    }
  } catch (e) { nomeOferta = ''; }
  if (!nomeOferta) nomeOferta = String(query.kw || query.q || query.keyword || '').trim();
  const slotGenerico = SLOT_GENERICO.test(String(query.slot || 'header'));
  const keywordDoClique = ((slotGenerico && nomeOferta) ? nomeOferta
    : String(query.q || query.kw || query.keyword || (typeof shopeeHit !== 'undefined' && shopeeHit && shopeeHit.n) || '')).slice(0, 120);"""

s = s.replace(ANTIGO, NOVO, 1)
open(ALVO, 'w', encoding='utf-8').write(s)
print('v128.9 aplicado em ' + ALVO)
print('   marcadores:', s.count('SLOT_GENERICO'), '| nomeOferta:', s.count('nomeOferta'))
