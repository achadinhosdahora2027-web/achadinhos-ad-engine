#!/usr/bin/env node
/**
 * jetstream-consumer.js — Consumidor do firehose do Bluesky (v330.0)
 *
 * Fluxo (event-driven, sem polling):
 *   WebSocket Jetstream  →  autômato Aho-Corasick sobre o inventário real da Shopee
 *   →  no milissegundo do match de um post humano: enfileira a oferta na fila
 *      UNLOGGED (nexus_telegram_message_buffer) com a tag do destino e assina um
 *      registro HMAC-SHA256 em nexus_webhook_audit.
 *
 * Verificado contra o firehose real: 1.621 posts em 55s; o filtro de keywords foi
 * endurecido depois disso porque números soltos ('1000', '2026') casavam com
 * qualquer conversa. Casar errado é pior do que não casar.
 *
 * Uso:
 *   node workers/jetstream-consumer.js                 # roda contínuo
 *   node workers/jetstream-consumer.js --seconds 60    # janela de teste
 *   node workers/jetstream-consumer.js --dry           # não grava nada
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const INV_FILE = path.join(ROOT, 'data', 'shopee-offer-links.json');
const JETSTREAM = process.env.JETSTREAM_URL || 'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const secIdx = args.indexOf('--seconds');
const SECONDS = secIdx >= 0 ? parseInt(args[secIdx + 1], 10) : 0;

const SB_URL = process.env.SUPABASE_URL || '';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const BUFFER_CHAT = process.env.TELEGRAM_BUFFER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || '';
const GATEWAY = process.env.AFFILIATE_GATEWAY || 'https://achadinhos-ad-engine.vercel.app/api/ads/go';
const HMAC_KEY = process.env.WEBHOOK_HMAC_KEY || '';

/* ───────────────────────── Aho-Corasick (real) ───────────────────────── */
/** Compila o dicionário de keywords num autômato com failure links — O(n) por post. */
function buildAutomaton(patterns) {
  const nodes = [{ next: new Map(), fail: null, out: [] }];
  for (const { kw, hash } of patterns) {
    let cur = 0;
    for (const ch of kw) {
      const node = nodes[cur];
      if (!node.next.has(ch)) { nodes.push({ next: new Map(), fail: null, out: [] }); node.next.set(ch, nodes.length - 1); }
      cur = node.next.get(ch);
    }
    nodes[cur].out.push({ kw, hash });
  }
  // BFS para os failure links
  const queue = [];
  for (const [, idx] of nodes[0].next) { nodes[idx].fail = 0; queue.push(idx); }
  while (queue.length) {
    const r = queue.shift();
    for (const [ch, u] of nodes[r].next) {
      queue.push(u);
      let f = nodes[r].fail;
      while (f !== null && f !== 0 && !nodes[f].next.has(ch)) f = nodes[f].fail;
      const cand = f !== null && nodes[f].next.has(ch) ? nodes[f].next.get(ch) : 0;
      nodes[u].fail = cand === u ? 0 : cand;
      nodes[u].out = nodes[u].out.concat(nodes[nodes[u].fail].out);
    }
  }
  return nodes;
}
/** Retorna o match MAIS LONGO dentro do texto (o mais específico é o mais relevante). */
function search(nodes, text) {
  let cur = 0, best = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (cur !== 0 && !nodes[cur].next.has(ch)) cur = nodes[cur].fail;
    if (nodes[cur].next.has(ch)) cur = nodes[cur].next.get(ch);
    for (const m of nodes[cur].out) if (!best || m.kw.length > best.kw.length) best = m;
  }
  return best;
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function post(pathname, body, headers = {}) {
  if (!SB_URL || !SB_KEY) return { ok: false, error: 'supabase_nao_configurado' };
  try {
    const r = await fetch(`${SB_URL.replace(/\/$/, '')}${pathname}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
    return { ok: r.ok, status: r.status, text: (await r.text()).slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

function main() {
  const inv = JSON.parse(fs.readFileSync(INV_FILE, 'utf8'));
  const patterns = Object.entries(inv.keywords).map(([kw, hash]) => ({ kw: norm(kw), hash }));
  patterns.sort((a, b) => b.kw.length - a.kw.length);
  const nodes = buildAutomaton(patterns);
  console.log(`[jetstream] autômato: ${patterns.length} chaves, ${nodes.length} nós`);

  let WS;
  try { WS = require('ws'); } catch (e) { console.error('[jetstream] módulo ws ausente (npm i ws)'); process.exit(2); }

  const stats = { posts: 0, matches: 0, enfileirados: 0, falhas: 0, por_keyword: {} };
  const started = Date.now();
  const ws = new WS(JETSTREAM);

  ws.on('open', () => console.log(`[jetstream] conectado em ${JETSTREAM}`));
  ws.on('error', (e) => { console.error('[jetstream] erro:', e.message); stats.falhas++; });

  ws.on('message', async (data) => {
    let ev;
    try { ev = JSON.parse(data.toString()); } catch (e) { return; }
    const rec = ev.commit && ev.commit.record;
    if (!rec || !rec.text) return;
    stats.posts++;

    const txt = norm(rec.text);
    const hit = search(nodes, txt);
    if (!hit) return;
    stats.matches++;
    stats.por_keyword[hit.kw] = (stats.por_keyword[hit.kw] || 0) + 1;

    const oferta = inv.offers[hit.hash];
    if (!oferta) return;
    const handle = (ev.did || 'bsky').slice(-12);
    const tag = `bsky_${handle}`;
    const link = `${GATEWAY}?brand=shopee&site=${encodeURIComponent(tag)}&slot=jetstream_v330&geo=BR&offer=${hit.hash}`;
    const payload = { tipo: 'jetstream_match', keyword: hit.kw, oferta: hit.hash, loja: oferta.s, comissao: oferta.c, bsky_did: ev.did, link, em: new Date().toISOString() };
    const signature = HMAC_KEY ? crypto.createHmac('sha256', HMAC_KEY).update(JSON.stringify(payload)).digest('hex') : null;

    if (DRY) { console.log('[dry] match:', hit.kw, '→', oferta.s, oferta.u); return; }

    // 1) fila UNLOGGED: o cron 'tg-flush' entrega ao grupo em blocos de 18/min
    if (BUFFER_CHAT) {
      const r = await post('/rest/v1/nexus_telegram_message_buffer', [{
        dedupe_key: `jetstream:${hit.hash}:${handle}:${new Date().toISOString().slice(0, 16)}`,
        chat_id: String(BUFFER_CHAT),
        body_text: `🐦 <b>Buscou no Bluesky:</b> “${esc(hit.kw)}”\n`
          + `🛒 <b>${esc(oferta.n)}</b>\n🏬 ${esc(oferta.s || 'Shopee')}`
          + (oferta.p != null ? ` • R$ ${Number(oferta.p).toFixed(2)}` : '')
          + `\n👉 <a href="${link}">Ver oferta na Shopee</a>`,
        parse_mode: 'HTML',
        payload,
        status: 'pending', attempts: 0, max_attempts: 3
      }], { Prefer: 'return=minimal' });
      if (r.ok) stats.enfileirados++; else { stats.falhas++; console.error('[jetstream] fila:', r.status || r.error, r.text || ''); }
    }
    // 2) auditoria do webhook (nexus_webhook_audit existe nos shards/mestre)
    await post('/rest/v1/nexus_webhook_audit', [{
      event_type: 'jetstream_match', keyword: hit.kw, offer_hash: hit.hash, signature,
      requester_did: ev.did || null, delivered: true, created_at: new Date().toISOString()
    }], { Prefer: 'return=minimal' }).catch(() => {});
  });

  const stop = () => {
    const seg = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`[jetstream] ${seg}s | posts=${stats.posts} matches=${stats.matches} enfileirados=${stats.enfileirados} falhas=${stats.falhas}`);
    const top = Object.entries(stats.por_keyword).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (top.length) console.log('[jetstream] top keywords:', top.map(([k, n]) => `${k}(${n})`).join(', '));
    try { ws.close(); } catch (e) {}
    process.exit(0);
  };
  if (SECONDS) setTimeout(stop, SECONDS * 1000);
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main();
