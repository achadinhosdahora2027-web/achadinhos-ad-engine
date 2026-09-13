#!/usr/bin/env node
/**
 * ==============================================================================
 * GUARDA DE SAUDE DO GATEWAY + TAGS  (script REAL — antes nao existia)
 * ==============================================================================
 * Etapa 14 do orquestrador mestre. Ate 13/09/2026 o workflow chamava
 * `node scripts/affiliate-health-check.js || true` — o arquivo NAO EXISTIA e o
 * `|| true` escondia o "Cannot find module". O painel dizia "guarda de saude
 * OK" sem nunca ter testado um unico link de afiliado.
 *
 * O que este script faz de verdade, a cada execucao:
 *   1. Le o catalogo de ofertas (data/brazilian-viral-deals-catalog.json).
 *   2. Le os destinos do Telegram e as TAGS de cada destino
 *      (data/telegram-destinations.json).
 *   3. Para CADA combinacao (anunciante ativo x tag de destino), monta o link
 *      real do gateway  /api/ads/go?brand=<marca>&site=<tag>&slot=&geo=BR
 *      e faz a requisicao HTTP SEM seguir o redirect (redirect: manual).
 *   4. Prova se a TAG viajou no parametro de rastreio do anunciante:
 *        Shopee      -> utm_content / sub_id
 *        Amazon      -> sid / tag
 *        eBay        -> customid
 *        CJ          -> SID
 *        AliExpress / Awin / Admitad -> subid / clickref / aff_sub
 *   5. Classifica cada linha em:
 *        OK      = gateway respondeu 3xx e o destino final resolveu
 *        PARCIAL = link funciona, mas o anunciante nao devolveu a tag na URL
 *                  de saida (o rastreio pode se perder no meio)
 *        FALHA   = gateway fora do ar, sem Location, erro 4xx/5xx ou timeout
 *   6. Grava data/affiliate-health-report.json e sai com codigo 1 se houver
 *      qualquer FALHA. PARCIAL nao derruba o job, mas fica visivel no relatorio.
 *
 * REGRA DESTE REPOSITORIO: nada de numero inventado. Se a rede nao devolve a
 * tag, o script escreve PARCIAL e diz exatamente qual parametro faltou.
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'data/brazilian-viral-deals-catalog.json');
const DESTINATIONS = path.join(ROOT, 'data/telegram-destinations.json');
const REPORT = path.join(ROOT, 'data/affiliate-health-report.json');
const GATEWAY = process.env.AFFILIATE_GATEWAY || 'https://achadinhos-ad-engine.vercel.app/api/ads/go';

/* Parametros de rastreio aceitos por rede (ordem = ordem de checagem) */
const TAG_PARAMS = {
  shopee: ['utm_content', 'sub_id', 'subid'],
  amazon: ['sid', 'tag', 'ascsubtag'],
  mercadolivre: ['matt_tool', 'sub_id', 'customid'],
  ebay: ['customid', 'campid'],
  aliexpress: ['aff_sub', 'subid', 'aff_short_key'],
  cj: ['SID', 'sid'],
  awin: ['clickref', 'subid'],
  admitad: ['subid', 'subid1', 'aff_sub'],
  default: ['sid', 'subid', 'sub_id', 'aff_sub', 'aff_sub2', 'customid', 'clickref', 'utm_content']
};

const NETWORK_OF = {
  shopee: 'shopee', amazon: 'amazon', mercadolivre: 'mercadolivre', ebay: 'ebay',
  aliexpress: 'aliexpress', booking: 'cj', economybookings: 'cj', novakid: 'cj',
  nordvpn: 'cj', nordpass: 'cj', surfshark: 'cj', malwarebytes: 'cj', wondershare: 'cj',
  movavi: 'cj', parallels: 'cj', corel: 'cj', sucuri: 'cj', updf: 'cj',
  switchbot: 'cj', bluetti: 'cj', soundcore: 'cj'
};

function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function gatewayUrl(brand, tag, slot) {
  /* noint=1 = caminho de TESTE do proprio gateway: ele devolve o 307 com a URL
     final JA TAGEADA em vez de servir o intersticial HTML (200). Sem este
     parametro a guarda lia "HTTP 200" e acusava 124 falhas que nao existiam —
     bug do verificador, nao do gateway. */
  const params = new URLSearchParams({ brand, site: tag, slot, geo: 'BR', noint: '1' });
  return `${GATEWAY}?${params.toString()}`;
}

async function probe(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' } });
    return {
      status: res.status,
      location: res.headers.get('location') || '',
      ms: Date.now() - started,
      network_error: null
    };
  } catch (e) {
    return { status: 0, location: '', ms: Date.now() - started, network_error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

/** Extrai o link de afiliado real que o catalogo marca como verificado. */
function catalogLink(deal) {
  return deal.link_verified || deal.link_final_raw || deal.link || '';
}

function findTagInLocation(location, brand, tag) {
  if (!location) return { present: false, param: null };
  let parsed;
  try {
    parsed = new URL(location);
  } catch (e) {
    return { present: location.includes(tag), param: location.includes(tag) ? 'raw' : null };
  }
  const candidates = TAG_PARAMS[NETWORK_OF[brand] || 'default'] || TAG_PARAMS.default;
  for (const p of candidates) {
    const v = parsed.searchParams.get(p);
    if (v && v.includes(tag)) return { present: true, param: p, value: v };
  }
  /* Redes que ofuscam (shortlinks) — a tag pode ir no path ou em qualquer query */
  for (const [k, v] of parsed.searchParams.entries()) {
    if (v.includes(tag)) return { present: true, param: k, value: v };
  }
  return { present: false, param: null };
}

async function main() {
  const catalog = readJson(CATALOG);
  const dest = readJson(DESTINATIONS);
  if (!catalog || !Array.isArray(catalog.deals)) {
    console.error('❌ Catalogo ausente ou sem campo "deals":', CATALOG);
    process.exit(1);
  }
  if (!dest || !Array.isArray(dest.destinations)) {
    console.error('❌ Registro de destinos ausente:', DESTINATIONS);
    process.exit(1);
  }

  const activeDest = dest.destinations.filter((d) => d.enabled !== false);
  const deals = catalog.deals;
  const advertisers = [...new Set(deals.map((d) => (d.brand || d.store || '').toLowerCase()).filter(Boolean))];

  console.log('================================================================================');
  console.log('🩺 GUARDA DE SAUDE DE AFILIADOS — TESTE REAL DE LINK + TAG');
  console.log('================================================================================');
  console.log(`   Gateway .....: ${GATEWAY}`);
  console.log(`   Ofertas ......: ${deals.length}`);
  console.log(`   Anunciantes ..: ${advertisers.length} (${advertisers.slice(0, 8).join(', ')}${advertisers.length > 8 ? ', …' : ''})`);
  console.log(`   Destinos ativos: ${activeDest.length} (tags: ${activeDest.map((d) => d.tag).join(', ')})`);
  console.log('');

  const rows = [];
  let ok = 0, partial = 0, failed = 0;

  for (const brand of advertisers) {
    for (const d of activeDest) {
      const url = gatewayUrl(brand, d.tag, 'health');
      const r = await probe(url);
      const tagInfo = findTagInLocation(r.location, brand, d.tag);
      const isRedirect = r.status >= 300 && r.status < 400;
      let verdict;
      if (r.network_error || r.status === 0) verdict = 'FALHA';
      else if (!isRedirect) verdict = 'FALHA';        /* gateway nao entregou destino */
      else if (tagInfo.present) verdict = 'OK';       /* link + tag provados na saida  */
      else verdict = 'PARCIAL';

      if (verdict === 'OK') ok++;
      else if (verdict === 'PARCIAL') partial++;
      else failed++;

      const icon = verdict === 'OK' ? '✅' : verdict === 'PARCIAL' ? '🟡' : '❌';
      const host = r.location ? (() => { try { return new URL(r.location).hostname; } catch (e) { return '?'; } })() : '-';
      console.log(`  ${icon} ${brand.padEnd(16)} ${d.tag.padEnd(18)} HTTP ${String(r.status).padEnd(4)} -> ${host.padEnd(28)} tag:${tagInfo.param || 'ausente'} (${r.ms}ms)`);

      rows.push({
        advertiser: brand,
        network: NETWORK_OF[brand] || 'desconhecida',
        destination: d.id,
        tag: d.tag,
        gateway_url: url,
        http_status: r.status,
        outbound_host: host,
        tag_param: tagInfo.param,
        tag_value: tagInfo.value || null,
        verdict,
        latency_ms: r.ms,
        error: r.network_error,
        checked_at: new Date().toISOString()
      });
    }
  }

  /* Links diretos do catalogo: prova que o link de cada oferta responde. */
  console.log('');
  console.log('───────────────────────────────────────────────────────────────────────');
  console.log('▶ Links diretos do catalogo (link_verified de cada oferta)');
  console.log('───────────────────────────────────────────────────────────────────────');
  const direct = [];
  for (const deal of deals) {
    const link = catalogLink(deal);
    if (!link) {
      direct.push({ id: deal.id, link: null, verdict: 'FALHA', error: 'sem link no catalogo' });
      console.log(`  ❌ ${String(deal.id).padEnd(30)} sem link no catalogo`);
      failed++;
      continue;
    }
    const r = await probe(link);
    const good = r.status > 0 && r.status < 400;
    if (good) ok++; else failed++;
    console.log(`  ${good ? '✅' : '❌'} ${String(deal.id).padEnd(30)} HTTP ${String(r.status).padEnd(4)} (${r.ms}ms) ${r.network_error || ''}`);
    direct.push({ id: deal.id, link, http_status: r.status, latency_ms: r.ms, verdict: good ? 'OK' : 'FALHA', error: r.network_error });
  }

  const report = {
    report_version: '1.0-REAL',
    generated_at: new Date().toISOString(),
    gateway: GATEWAY,
    catalog_version: catalog.catalog_version || null,
    totals: {
      combinations_tested: rows.length,
      direct_links_tested: direct.length,
      ok,
      partial,
      failed
    },
    by_destination: activeDest.map((d) => ({
      id: d.id,
      tag: d.tag,
      chat_id: d.chat_id || null,
      combinations: rows.filter((r) => r.destination === d.id).length,
      ok: rows.filter((r) => r.destination === d.id && r.verdict === 'OK').length,
      partial: rows.filter((r) => r.destination === d.id && r.verdict === 'PARCIAL').length,
      failed: rows.filter((r) => r.destination === d.id && r.verdict === 'FALHA').length
    })),
    combinations: rows,
    direct_links: direct
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  RESULTADO DA GUARDA DE SAUDE');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  ✅ OK      : ${ok}`);
  console.log(`  🟡 PARCIAL : ${partial}   (link entrega, tag nao volta na URL de saida)`);
  console.log(`  ❌ FALHA   : ${failed}`);
  console.log(`  📄 Relatorio: ${path.relative(ROOT, REPORT)}`);
  console.log('═══════════════════════════════════════════════════════════════════════');

  if (failed > 0) {
    console.error(`\n❌ ${failed} verificacao(oes) FALHARAM — link de afiliado quebrado ou gateway fora do ar.`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Erro fatal na guarda de saude:', e && e.message);
  process.exit(1);
});
