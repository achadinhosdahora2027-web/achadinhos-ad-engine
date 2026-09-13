/**
 * ==============================================================================
 * FAN-OUT DE NOTIFICAÇÕES POR DESTINO (v336.0)
 * ==============================================================================
 * Defeito que este módulo corrige (medido em produção em 13/09/2026):
 *   a fila nexus_telegram_message_buffer recebia chat_id de UM único destino
 *   (o privado do admin, 5808022745) e por isso os GRUPOS não recebiam NADA —
 *   198 mensagens enviadas, 0 falhas, 0 chegando nos grupos.
 *
 * Como funciona agora:
 *   1. O produtor enfileira com chat_id = 'fanout' (sentinela).
 *   2. O flush expande a linha para TODOS os destinos ativos do registro
 *      data/telegram-destinations.json que aceitam aquele tipo de conteúdo.
 *   3. Cada CÓPIA recebe no link de afiliado a TAG DO PRÓPRIO DESTINO
 *      (parâmetro `site`, que o gateway propaga em utm_content/subid/customid),
 *      de modo que todo clique e toda venda sejam atribuíveis ao grupo de origem.
 *   4. Entrega por destino é idempotente: o progresso fica em
 *      payload.fanout_done, então nenhum destino recebe a mesma mensagem 2×.
 * ==============================================================================
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

/** Destinos ativos (têm chat_id resolvido) que aceitam este tipo de conteúdo. */
function destinationsFor(kind, registry) {
  const reg = registry || loadRegistry();
  return (reg.destinations || []).filter(
    (d) => d.enabled !== false && d.chat_id && (!kind || (d.receives || []).includes(kind))
  );
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

/**
 * Troca a tag (`site=`) de TODOS os links presentes no corpo da mensagem.
 * É o que faz a MESMA linha produzir N cópias, cada uma creditada ao seu grupo.
 */
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
};
