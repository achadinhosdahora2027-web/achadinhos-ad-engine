#!/usr/bin/env node
/**
 * publish-shopee-v330-deals.js — Publicação 24/7 de ofertas Shopee reais (v330.0)
 *
 * O que faz:
 *   1. Lê o inventário real (data/shopee-offer-links.json — 701 ofertas do painel).
 *   2. Escolhe as melhores ofertas por comissão (dado real, não estimativa).
 *   3. Monta a mensagem e o LINK RASTREÁVEL por destino (tag do grupo via sub_id).
 *   4. Envia para cada destino habilitado e verificado do registry.
 *   5. Grava relatório com message_id de cada envio (prova de entrega).
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
  const dests = sender.activeDestinations(reg, 'publish');
  const offers = topOffers(inv, LIMIT);

  console.log('inventário:', Object.keys(inv.offers).length, 'ofertas |', Object.keys(inv.keywords).length, 'keywords');
  console.log('destinos ativos:', dests.map((d) => `${d.id}(${d.chat_id || 'sem chat_id'})`).join(', '));
  console.log('ofertas escolhidas (maior comissão real):');
  offers.forEach((o) => console.log(`  ${o.c}% | ${o.s} | ${o.n.slice(0, 52)} | ${o.u}`));

  if (DRY) {
    for (const d of dests.filter((x) => x.chat_id)) {
      const m = buildMessage(d, offers[0], {});
      console.log(`\n[DRY] destino ${d.id} (tag ${d.tag}):\n${m.text}\n  link: ${m.link}`);
    }
    return;
  }

  const results = [];
  for (const dest of dests) {
    if (!dest.chat_id) {
      results.push({ destination: dest.id, sent: false, reason: 'chat_id_ausente' });
      continue;
    }
    const offer = offers[results.length % offers.length];
    const { text, link } = buildMessage(dest, offer, {});
    const r = await sender.sendToDestination(dest, text, {
      disable_web_page_preview: true,
      gapMs: 1200
    });
    results.push({ ...r, offer_hash: offer.hash, offer_name: offer.n, offer_link: offer.u, tagged_link: link, commission_pct: offer.c });
    console.log(`  → ${dest.id}: ${r.sent ? 'ENVIADO msg_id=' + r.message_id : 'FALHOU ' + (r.reason || r.error || '')}`);
    await new Promise((s) => setTimeout(s, 1200));
  }

  const report = {
    generated_at: new Date().toISOString(),
    inventory_file: 'data/shopee-offer-links.json',
    inventory_counts: inv.counts,
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
    results
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log('\nrelatório:', path.relative(ROOT, REPORT), '| enviados:', report.sent, '| falhas:', report.failed);
  if (report.failed) process.exitCode = 1;
}

main().catch((e) => { console.error('ERRO FATAL:', e.message); process.exit(1); });
