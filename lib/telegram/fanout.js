/**
 * REGISTRO E ROTEAMENTO TELEGRAM 1:1 — v420.0
 *
 * Cada natureza lógica resolve para exatamente um destino soberano. Kind
 * desconhecido, destino sem chat_id ou registro incoerente resulta em lista
 * vazia; nunca existe fallback para admin, broadcast ou mistura de canais.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const GATEWAY =
  process.env.AFFILIATE_GATEWAY || 'https://achadinhos-ad-engine.vercel.app/api/ads/go';

const REGISTRY_PATHS = [
  path.join(process.cwd(), 'data/telegram-destinations.json'),
  path.join(__dirname, '../../data/telegram-destinations.json'),
  path.join(__dirname, '../../../data/telegram-destinations.json'),
  '/var/task/data/telegram-destinations.json',
];

function registryPath() {
  for (const p of REGISTRY_PATHS) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* segue */ }
  }
  return REGISTRY_PATHS[0];
}

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
  } catch (e) {
    return { destinations: [], registry_error: String((e && e.message) || e) };
  }
}

/* v420: cada natureza lógica possui exatamente um destino. Sem kind conhecido,
   não há fallback nem broadcast: o resultado vazio é o comportamento fail-closed. */
const STRICT_DESTINATION_BY_KIND = Object.freeze({
  clicks: 'grupo_cliques',
  click: 'grupo_cliques',
  sales: 'grupo_vendas',
  sale: 'grupo_vendas',
  conversion: 'grupo_vendas',
  capture: 'grupo_captura_atendimento',
  mention: 'grupo_captura_atendimento',
  offers: 'canal_ofertas_brasil',
  offer: 'canal_ofertas_brasil',
  publish: 'canal_ofertas_brasil',
  deal: 'canal_ofertas_brasil'
});

/** Retorna zero ou um destino: fan-out cross-channel é proibido no v420. */
function destinationsFor(kind, registry) {
  const reg = registry || loadRegistry();
  const wanted = STRICT_DESTINATION_BY_KIND[String(kind || '').toLowerCase()];
  if (!wanted) return [];
  return (reg.destinations || []).filter(
    (d) => d.enabled !== false && d.chat_id && d.id === wanted
  ).slice(0, 1);
}

/** Destinos ainda sem chat_id (grupos privados só com link de convite). */
function pendingDestinations(registry) {
  const reg = registry || loadRegistry();
  return (reg.destinations || []).filter((d) => d.enabled !== false && !d.chat_id);
}

function tagOf(dest) {
  return dest.tag || `tg_${dest.id}`;
}

/**
 * Link de afiliado já TAGEADO com o destino. A `site` é a tag; o gateway
 * propaga para Shopee (utm_content), Amazon (sid), eBay (customid), CJ (SID),
 * AliExpress/Awin/Admitad (subid) — ver api/ads/go.js.
 */
function taggedLink(dest, opts = {}) {
  const params = new URLSearchParams({
    brand: opts.brand || 'auto',
    site: tagOf(dest),
    slot: String(opts.slot || 'deal').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48) || 'deal',
    geo: String(opts.geo || 'BR').toUpperCase().slice(0, 2),
  });
  if (opts.offer) params.set('offer', String(opts.offer).slice(0, 64));
  if (opts.q) params.set('q', String(opts.q).slice(0, 90));
  if (opts.dest) params.set('dest', opts.dest);
  return `${GATEWAY}?${params.toString()}`;
}

/** Troca a tag (`site=`) dos links para o único destino já resolvido. */
function retagText(text, dest) {
  const tag = encodeURIComponent(tagOf(dest));
  return String(text).replace(/([?&]site=)[^&"'\s)<>]+/g, `$1${tag}`);
}

/** Rodapé com a tag visível (hashtag do Telegram) + identificação do destino. */
function tagFooter(dest) {
  return `\n🏷 <code>${tagOf(dest)}</code> • ${String(dest.label || dest.id).slice(0, 40)}`;
}

/** Corpo final para um destino: links retagueados (+ rodapé de tag, se ligado). */
function bodyFor(dest, bodyText, opts = {}) {
  const base = retagText(bodyText, dest);
  if (opts.showTag === false || process.env.FANOUT_SHOW_TAG === '0') return base;
  return base + tagFooter(dest);
}

module.exports = {
  GATEWAY,
  registryPath,
  loadRegistry,
  destinationsFor,
  pendingDestinations,
  taggedLink,
  retagText,
  bodyFor,
  tagOf,
  STRICT_DESTINATION_BY_KIND,
};
