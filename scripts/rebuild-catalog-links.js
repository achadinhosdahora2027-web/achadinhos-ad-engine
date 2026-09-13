#!/usr/bin/env node
/**
 * ==============================================================================
 * RECONSTRUTOR + VERIFICADOR DE LINKS DO CATALOGO (link_verified)
 * ==============================================================================
 * DESCOBERTA (auditoria de 13/09/2026):
 *   19 das 22 ofertas do catalogo tinham `link_verified` preenchido com um
 *   ROTULO DE TEXTO, nao uma URL:
 *       "CJ Affiliate (kqzyfj.com click-101859672-17293138)"
 *       "eBay Partner Network (campid 5339193749)"
 *   Ou seja: qualquer consumidor do catalogo (site, bot, planilha) que tentasse
 *   abrir `link_verified` recebia um erro de URL invalida. O gateway de anuncios
 *   escapava porque mantem o proprio mapa de marcas — mas o dado em si estava
 *   inutilizavel.
 *
 * O que este script faz:
 *   1. Le `link_verified` de cada oferta.
 *   2. Se for rotulo da CJ, reconstroi a URL real a partir do dominio + click id
 *      que o proprio rotulo carrega:   https://www.<dominio>/click-<PID>-<AID>
 *   3. Se for rotulo do eBay, remonta a URL de afiliado canonica:
 *      https://www.ebay.com/deals?campid=<id>&toolid=10001&mkevt=1&mkcid=1&mkrid=711-53200-19255-0
 *   4. TESTA cada URL reconstruida com requisicao HTTP real (sem seguir redirect).
 *   5. Grava de volta no catalogo:  link_verified = URL real  +  link_network_ref
 *      (guarda o rotulo antigo para rastreabilidade) + evidencia do teste.
 *   6. Sai com codigo 1 se alguma URL nao responder 2xx/3xx.
 *
 * Uso:
 *   node scripts/rebuild-catalog-links.js            # corrige e verifica
 *   node scripts/rebuild-catalog-links.js --dry-run  # so mostra o que faria
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'data/brazilian-viral-deals-catalog.json');
const DRY = process.argv.includes('--dry-run');

const CJ_LABEL = /CJ Affiliate \((\S+?) click-(\d+)-(\d+)\)/;
const EBAY_LABEL = /eBay Partner Network \(campid (\d+)\)/;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Converte rotulo -> URL real. Devolve null se nao souber converter. */
function delabel(raw) {
  if (!raw) return { url: null, reason: 'link ausente' };
  const s = String(raw).trim();
  if (/^https?:\/\//i.test(s)) return { url: s, reason: 'ja era URL' };
  let m = s.match(CJ_LABEL);
  if (m) {
    const [, dom, pid, aid] = m;
    return { url: `https://www.${dom}/click-${pid}-${aid}`, reason: 'rotulo CJ reconstruido', network: 'cj', advertiser_id: aid };
  }
  m = s.match(EBAY_LABEL);
  if (m) {
    const campid = m[1];
    return {
      url: `https://www.ebay.com/deals?campid=${campid}&toolid=10001&mkevt=1&mkcid=1&mkrid=711-53200-19255-0`,
      reason: 'rotulo eBay remontado',
      network: 'ebay',
      advertiser_id: campid
    };
  }
  return { url: null, reason: `rotulo nao reconhecido: ${s.slice(0, 60)}` };
}

async function probe(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' }
    });
    const loc = res.headers.get('location') || '';
    let host = '';
    try { host = loc ? new URL(loc).hostname : ''; } catch (e) { host = ''; }
    return { status: res.status, location: loc, host, ms: Date.now() - started, error: null };
  } catch (e) {
    return { status: 0, location: '', host: '', ms: Date.now() - started, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch (e) { return '?'; }
}

async function main() {
  const catalog = readJson(CATALOG);
  if (!Array.isArray(catalog.deals)) {
    console.error('❌ Catalogo sem campo "deals"');
    process.exit(1);
  }

  console.log('================================================================================');
  console.log(`🔗 RECONSTRUCAO E VERIFICACAO DOS LINKS DO CATALOGO${DRY ? '  (DRY-RUN)' : ''}`);
  console.log('================================================================================');
  console.log(`   Catalogo: ${path.relative(ROOT, CATALOG)}`);
  console.log(`   Ofertas : ${catalog.deals.length}`);
  console.log('');

  let converted = 0, already = 0, unrecoverable = 0, failed = 0;

  for (const deal of catalog.deals) {
    const raw = deal.link_verified;
    const { url, reason, network, advertiser_id } = delabel(raw);

    if (!url) {
      unrecoverable++;
      console.log(`  ❌ ${String(deal.id).padEnd(30)} IRRECUPERAVEL — ${reason}`);
      deal.link_rebuild = { status: 'IRRECUPERAVEL', reason, checked_at: new Date().toISOString() };
      continue;
    }

    const wasLabel = !/^https?:\/\//i.test(String(raw || '').trim());
    const r = await probe(url);
    const good = r.status > 0 && r.status < 400;
    if (!good) failed++;

    const icon = good ? '✅' : '❌';
    console.log(`  ${icon} ${String(deal.id).padEnd(30)} HTTP ${String(r.status).padEnd(4)} -> ${(r.host || '-').padEnd(24)} ${wasLabel ? '[' + reason + ']' : ''} ${r.error || ''} (${r.ms}ms)`);

    if (!DRY) {
      if (wasLabel) {
        deal.link_network_ref = String(raw).trim();          /* rotulo original preservado */
        deal.link_verified = url;                            /* agora e URL de verdade  */
        converted++;
      } else {
        already++;
      }
      if (network) deal.link_network = network;
      if (advertiser_id) deal.link_network_advertiser_id = advertiser_id;
      deal.link_rebuild = {
        status: good ? 'OK' : 'FALHA',
        http_status: r.status,
        outbound_host: r.host || null,
        latency_ms: r.ms,
        error: r.error,
        checked_at: new Date().toISOString(),
        method: wasLabel ? 'reconstruido-do-rotulo' : 'url-ja-existente'
      };
      /* Campo humano (antes era string solta tipo "shopee.com.br (HTTP 200)") */
      deal.link_final = good
        ? `${hostOf(url)} (HTTP ${r.status}${r.host ? ' -> ' + r.host : ''})`
        : `FALHA HTTP ${r.status}${r.error ? ' (' + r.error + ')' : ''}`;
      deal.link_verified_at = new Date().toISOString();
    }
  }

  if (!DRY) {
    catalog.metodo = (catalog.metodo || '') + ' | links reconstruidos e reverificados ao vivo em ' + new Date().toISOString();
    catalog.link_audit = {
      audited_at: new Date().toISOString(),
      converted_from_label: converted,
      already_valid: already,
      unrecoverable,
      failed,
      total: catalog.deals.length
    };
    fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  RESULTADO');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  🔧 Rotulos convertidos em URL real : ${converted}`);
  console.log(`  ✔️  Ja eram URL valida            : ${already}`);
  console.log(`  ❌ Irrecuperaveis                 : ${unrecoverable}`);
  console.log(`  💥 URLs que nao responderam       : ${failed}`);
  if (!DRY) console.log(`  💾 Catalogo atualizado: ${path.relative(ROOT, CATALOG)}`);
  console.log('═══════════════════════════════════════════════════════════════════════');

  if (unrecoverable > 0 || failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Erro fatal:', e && e.message);
  process.exit(1);
});
