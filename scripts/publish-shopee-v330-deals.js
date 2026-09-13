#!/usr/bin/env node
/**
 * publish-shopee-v330-deals.js — Publicação 24/7 de ofertas Shopee reais (v330.0)
 *
 * O que faz:
 *   1. Lê o inventário real (data/shopee-offer-links.json — 701 ofertas do painel).
 *   2. Escolhe as melhores ofertas por comissão (dado real, não estimativa).
 *   3. Valida preço/link de cada oferta.
 *   4. Enfileira na fonte C2 v420 (um único destino: Ofertas Brasil).
 *   5. O Job 60 consolida o lote e registra a entrega; este runner não envia.
 *
 * Uso:  node scripts/publish-shopee-v330-deals.js [--limit 3] [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sender = require('../lib/telegram/multi-destination-sender.js');

const ROOT = path.resolve(__dirname, '..');
const INV = path.join(ROOT, 'data', 'shopee-offer-links.json');
const REPORT = path.join(ROOT, 'data', 'shopee-v330-publish-report.json');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Math.max(1, parseInt(args[limitArg + 1], 10) || 3) : 3;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const brl = (v) => (v == null ? null : 'R$ ' + Number(v).toFixed(2).replace('.', ','));

function topOffers(inv, n) {
  return Object.entries(inv.offers)
    .map(([hash, o]) => ({ hash, ...o }))
    .filter((o) => o.k === 'shopee_product' && o.c != null && o.u)
    .sort((a, b) => (b.c - a.c) || ((a.p || 9e9) - (b.p || 9e9)))
    .slice(0, n);
}

function buildMessage(dest, offer, opts) {
  const link = sender.buildTaggedLink(dest, {
    brand: 'shopee',
    slot: 'shopee_v330',
    country: 'BR',
    offer: offer.hash
  });
  const linhas = [
    '🛒 <b>' + esc(offer.n) + '</b>',
    '',
    '🏬 Loja: <b>' + esc(offer.s || 'Shopee') + '</b>',
    offer.p != null ? '💰 Preço: <b>' + esc(brl(offer.p)) + '</b>' : null,
    '📈 Comissão: <b>' + esc(offer.c) + '%</b>',
    '',
    '👉 <a href="' + link + '">Ver oferta na Shopee</a>',
    '',
    '<i>Aqui Tem Achadinhos · tag ' + esc(dest.tag) + '</i>'
  ].filter((l) => l !== null);
  return { text: linhas.join('\n'), link };
}

async function main() {
  if (!fs.existsSync(INV)) { console.error('ERRO: inventário ausente:', INV); process.exit(1); }
  const inv = JSON.parse(fs.readFileSync(INV, 'utf8'));
  const reg = sender.loadRegistry();
  const dests = sender.activeDestinations(reg, 'offers');
  const offers = topOffers(inv, LIMIT);

  console.log('inventário:', Object.keys(inv.offers).length, 'ofertas |', Object.keys(inv.keywords).length, 'keywords');
  console.log('destino estrito:', dests.map((d) => `${d.id}(${d.chat_id || 'sem chat_id'})`).join(', ') || 'nenhum');
  console.log('ofertas escolhidas (maior comissão real):');
  offers.forEach((o) => console.log(`  ${o.c}% | ${o.s} | ${o.n.slice(0, 52)} | ${o.u}`));

  if (dests.length !== 1 || dests[0].id !== 'canal_ofertas_brasil') {
    throw new Error('mapa v420 sem destino 1:1 de ofertas');
  }
  if (DRY) {
    for (const offer of offers) {
      console.log(`\n[DRY] C2 -> ${offer.hash} | ${brl(offer.p)} | ${offer.u}`);
    }
    return;
  }

  const day = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const offer of offers) {
    const r = await sender.enqueueV420Offer({
      source_key: `github:shopee:${offer.hash}:${day}`,
      offer_id: offer.hash,
      title: offer.n,
      merchant: offer.s || 'Shopee',
      brand: 'shopee',
      price_brl: offer.p,
      click_url: offer.u,
      button_text: 'Ver na Shopee',
      metadata: {
        commission_pct: offer.c,
        inventory_kind: offer.k,
        source: 'shopee_offer_links_v420'
      }
    });
    const accepted = Boolean(r.ok);
    const queued = accepted && r.data && r.data.queued === true;
    results.push({
      destination: 'canal_ofertas_brasil', accepted, queued,
      duplicate: accepted && !queued,
      offer_hash: offer.hash, offer_name: offer.n, offer_link: offer.u,
      commission_pct: offer.c, response: r.data, error: r.error || null
    });
    console.log(`  → ${offer.hash}: ${queued ? 'ENFILEIRADA NO LOTE v420' : (accepted ? 'DUPLICATA CONTIDA' : 'FALHOU ' + (r.error || r.status || ''))}`);
  }

  const report = {
    generated_at: new Date().toISOString(),
    inventory_file: 'data/shopee-offer-links.json',
    inventory_counts: inv.counts,
    accepted: results.filter((r) => r.accepted).length,
    queued: results.filter((r) => r.queued).length,
    failed: results.filter((r) => !r.accepted).length,
    results
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log('\nrelatório:', path.relative(ROOT, REPORT), '| aceitas:', report.accepted, '| novas:', report.queued, '| falhas:', report.failed);
  if (report.failed) process.exitCode = 1;
}

main().catch((e) => { console.error('ERRO FATAL:', e.message); process.exit(1); });
