/**
 * ==============================================================================
 * TELEGRAM OFERTAS BRASIL 24/7 — MULTI-DESTINATION PUBLISHER  (v3.0 — 2026)
 * ==============================================================================
 * O QUE MUDOU EM RELACAO A v2 (e por que):
 *
 *  v2 (defeituoso)                        v3 (esta versao)
 *  -------------------------------------  -------------------------------------
 *  Enviava para UM unico destino          Envia para TODOS os destinos ativos
 *  (TELEGRAM_DEALS_CHANNEL)               (canal + 3 grupos + privado admin)
 *  Link de afiliado sem tag de origem     Link TAGEADO por destino: cada grupo
 *                                         tem sua propria tag rastreavel
 *  Sem retry / sem tratamento de 429      Retry com backoff + respeita retry_after
 *  Falha silenciosa (log e nada mais)     Resultado auditavel por destino
 *  Historico unico global                 Anti-repeticao POR destino
 *  Sem auto-descoberta de grupos          Auto-descobre chat_id dos grupos
 * ==============================================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const {
  loadRegistry,
  saveRegistry,
  activeDestinations,
  pendingDestinations,
  buildTaggedLink,
  broadcast,
  discoverChatIds,
  attributionFooter
} = require('../lib/telegram/multi-destination-sender');

const CATALOG_PATH = path.join(__dirname, '../data/brazilian-viral-deals-catalog.json');
const HISTORY_PATH = path.join(__dirname, '../data/telegram-published-deals-history.json');

function loadJson(p, fallback = {}) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return fallback;
}

function saveJson(p, data) {
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

const STORE_BADGE = {
  Shopee: '🛍️ Shopee Brasil',
  'Amazon Brasil': '📦 Amazon Brasil',
  'Booking.com': '🏨 Booking.com',
  'Mercado Livre': '⚡ Mercado Livre',
  NordVPN: '🔐 NordVPN',
  AliExpress: '🌍 AliExpress',
  eBay: '📦 eBay',
  Surfshark: '🦈 Surfshark',
  NordPass: '🔑 NordPass',
  EconomyBookings: '🚗 EconomyBookings',
  Malwarebytes: '🛡️ Malwarebytes',
  Wondershare: '🎬 Wondershare',
  Movavi: '✂️ Movavi',
  Parallels: '💻 Parallels',
  Corel: '🎨 Corel',
  Sucuri: '🔒 Sucuri',
  UPDF: '📄 UPDF',
  SwitchBot: '🤖 SwitchBot',
  BLUETTI: '🔋 BLUETTI',
  soundcore: '🎧 soundcore',
  Novakid: '👧 Novakid'
};

/**
 * Monta o texto da oferta JA com o link tageado PARA UM DESTINO ESPECIFICO.
 */
function formatDealPost(deal, destination, templateIndex = 0) {
  const storeBadge = STORE_BADGE[deal.store] || `🏪 ${deal.store}`;
  const bulletsText = (deal.bullets || []).map((b) => `• ${b}`).join('\n');

  // O link carrega a tag do destino -> toda venda futura e atribuivel ao grupo
  // slot sem o prefixo redundante "br_" (o gateway ja adiciona o pais na sid)
  const slot = String(deal.id).replace(/^br_/, '');
  const link = buildTaggedLink(destination, {
    brand: deal.brand,
    slot,
    country: 'BR'
  });

  const footer = attributionFooter(destination);

  const hasPrice = deal.promo_price && deal.promo_price !== '—';
  const priceBlock = hasPrice
    ? `💰 <s>De R$ ${deal.original_price}</s>\n💥 <b>Por apenas: R$ ${deal.promo_price}</b> (<b>${deal.discount}</b>)`
    : `💥 <b>${deal.discount}</b>`;

  const couponBlock = deal.coupon ? `🎟️ <b>Cupom:</b> <code>${deal.coupon}</code> (toque para copiar)\n` : '';

  const templates = [
    `
🔥 <b>[ACHADINHO DO DIA]</b> 🔥
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>${deal.title}</b>

🏪 <b>Loja:</b> ${storeBadge}
⭐ <b>Referência:</b> ${deal.rating}

${priceBlock}
${couponBlock}
📦 <b>Destaques:</b>
${bulletsText}

🚨 <i>Promoção por tempo limitado ou até esgotar o estoque!</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 <b>APROVEITAR AGORA:</b>
🔗 <a href="${link}">${link}</a>${footer}`,

    `
😱 <b>[BAIXOU MUITO O PREÇO]</b> 😱
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>${deal.title}</b>

🏪 <b>Disponível em:</b> ${storeBadge}
⭐ <b>Referência:</b> ${deal.rating}

${priceBlock}
${couponBlock}
✨ <b>Por que vale a pena:</b>
${bulletsText}

⚡ <i>Aproveite antes que volte ao valor normal!</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛒 <b>GARANTIR A MINHA:</b>
🔗 <a href="${link}">${link}</a>${footer}`,

    `
⚡ <b>[OFERTA VERIFICADA]</b> ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>${deal.title}</b>

📍 <b>Plataforma:</b> ${storeBadge}
🏆 <b>Referência:</b> ${deal.rating}

${priceBlock}
${couponBlock}
📋 <b>Informações:</b>
${bulletsText}

🚚 <i>Confira as condições de frete e cupom na página da loja.</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 <b>LINK OFICIAL DA OFERTA:</b>
🔗 <a href="${link}">${link}</a>${footer}`
  ];

  return templates[templateIndex % templates.length].trim();
}

/**
 * Escolhe a proxima oferta, respeitando o historico DAQUELE destino.
 * Cada grupo recebe uma oferta diferente no mesmo ciclo (rotacao por indice).
 */
function pickDealForDestination(catalog, history, destination, offset = 0) {
  const all = (catalog.deals || []).filter((d) => d.active !== false);
  if (!all.length) return null;

  const perDest = history[destination.id] || { published_ids: [], total: 0 };
  const published = new Set(perDest.published_ids || []);
  let available = all.filter((d) => !published.has(d.id));

  if (!available.length) {
    // ciclo completo -> reinicia a rotacao para este destino
    perDest.published_ids = [];
    published.clear();
    available = all;
  }

  const deal = available[(offset + perDest.total) % available.length];
  return deal;
}

function recordPublication(history, destination, deal) {
  const perDest = history[destination.id] || { published_ids: [], total: 0, last_published_at: null };
  perDest.published_ids = (perDest.published_ids || []).concat([deal.id]).slice(-200);
  perDest.total = (perDest.total || 0) + 1;
  perDest.last_published_at = new Date().toISOString();
  perDest.last_deal_id = deal.id;
  history[destination.id] = perDest;
  history.total_published = (history.total_published || 0) + 1;
  history.last_run_at = new Date().toISOString();
  return history;
}

async function publishToAllDestinations(options = {}) {
  const channel = options.channel;
  console.log('='.repeat(80));
  console.log('🛒 PUBLICADOR MULTI-DESTINO 24/7 — OFERTAS BRASIL (v3.0)');
  console.log('='.repeat(80));

  // 1. auto-descoberta de grupos pendentes
  const reg = loadRegistry();
  const pend = pendingDestinations(reg);
  if (pend.length) {
    console.log(`\n🔎 ${pend.length} destino(s) sem chat_id — tentando auto-descoberta...`);
    const disc = await discoverChatIds(reg);
    if (disc.error) console.log(`   ↳ Telegram respondeu: ${disc.error}`);
    if (disc.discovered && disc.discovered.length) {
      console.log(`   ✅ Resolvido(s): ${disc.discovered.join(', ')}`);
    } else {
      console.log(`   ⏳ Ainda pendente(s): ${pend.map((d) => d.label).join(', ')}`);
      console.log(`      Ação (20s): abra o grupo e envie -> /start@NandimFernandesBot`);
    }
  }

  // 2. destinos ativos
  const reg2 = loadRegistry();
  let destinations = activeDestinations(reg2, 'deal');
  if (channel) destinations = destinations.filter((d) => d.username === channel || d.id === channel);

  if (!destinations.length) {
    console.error('❌ Nenhum destino ativo com chat_id. Verifique data/telegram-destinations.json');
    return { success: false, reason: 'sem_destinos' };
  }

  console.log(`\n📡 Destinos ativos para ofertas: ${destinations.length}`);
  destinations.forEach((d) => console.log(`   • ${d.label.padEnd(28)} chat=${d.chat_id}  tag=${d.tag}`));

  // 3. catalogo + historico
  const catalog = loadJson(CATALOG_PATH, { deals: [] });
  const history = loadJson(HISTORY_PATH, {});
  const allDeals = (catalog.deals || []).filter((d) => d.active !== false);
  if (!allDeals.length) {
    console.error('❌ Catalogo vazio.');
    return { success: false, reason: 'catalogo_vazio' };
  }
  console.log(`\n📦 Catalogo: ${allDeals.length} ofertas verificadas`);

  // 4. monta 1 mensagem por destino (cada uma com seu link tageado)
  const plan = [];
  destinations.forEach((dest, i) => {
    const deal = pickDealForDestination(catalog, history, dest, i);
    if (deal) plan.push({ dest, deal });
  });

  console.log('\n🗺️  PLANO DE DISPARO:');
  plan.forEach(({ dest, deal }) => {
    console.log(`   • ${dest.label.padEnd(28)} -> [${deal.id}] ${deal.title.slice(0, 42)}...`);
  });

  // 5. disparo
  console.log('\n🚀 Disparando...\n');
  const res = await broadcast(
    (dest) => {
      const item = plan.find((p) => p.dest.id === dest.id);
      const tpl = (history[dest.id]?.total || 0) % 3;
      return item ? formatDealPost(item.deal, dest, tpl) : null;
    },
    plan.map((p) => p.dest),
    { gapMs: 900 }
  );

  // 6. registra historico somente dos que foram enviados
  res.results.forEach((r) => {
    if (r.sent) {
      const item = plan.find((p) => p.dest.id === r.destination);
      if (item) recordPublication(history, item.dest, item.deal);
    }
  });
  saveJson(HISTORY_PATH, history);

  // 7. relatorio
  console.log('\n' + '='.repeat(80));
  console.log('📊 RELATORIO DE ENTREGA');
  console.log('='.repeat(80));
  res.results.forEach((r) => {
    const icon = r.sent ? '✅' : '❌';
    console.log(
      `  ${icon} ${String(r.label || r.destination).padEnd(28)} ${r.sent ? `msg_id=${r.message_id} (tentativa ${r.attempts})` : `FALHA: ${r.error}`}`
    );
  });
  console.log(`\n  Total: ${res.sent}/${res.total} entregues | ${res.failed} falha(s)`);
  console.log('='.repeat(80));

  return {
    success: res.sent > 0,
    sent: res.sent,
    failed: res.failed,
    total: res.total,
    results: res.results,
    plan: plan.map((p) => ({ destination: p.dest.id, deal: p.deal.id, tag: p.dest.tag }))
  };
}

// ------------------------------------------------------------------
// Execucao direta
// ------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  if (args.includes('--discover-only')) {
    (async () => {
      const reg = loadRegistry();
      const r = await discoverChatIds(reg);
      console.log(JSON.stringify(r, null, 2));
    })();
  } else {
    publishToAllDestinations(opts)
      .then((r) => process.exit(r.success ? 0 : 1))
      .catch((e) => {
        console.error('💥 Erro fatal:', e.message);
        process.exit(1);
      });
  }
}

module.exports = { publishToAllDestinations, formatDealPost, pickDealForDestination };
