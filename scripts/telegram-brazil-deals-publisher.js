/**
 * TELEGRAM OFERTAS BRASIL 24/7 — produtor C2 v420.
 *
 * O produtor não chama mais a API sendMessage e não faz fan-out. Ele valida
 * preço/link do catálogo, insere a oferta na fonte C2 do mestre e deixa o Job 60
 * consolidar o lote com botões no único canal permitido: Ofertas Brasil.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const {
  loadRegistry,
  activeDestinations,
  buildTaggedLink,
  enqueueV420Offer,
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
  console.log('🛒 PRODUTOR C2 SOBERANO — OFERTAS BRASIL (v420.0)');
  console.log('='.repeat(80));

  // 1. resolve exatamente um destino no registro; não consulta a API Telegram.
  const reg = loadRegistry();
  let destinations = activeDestinations(reg, 'deal');
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

  const dryRun = options.dryRun === true || process.env.DRY_RUN === '1';
  if (dryRun) {
    console.log('\n🧪 DRY RUN: plano validado; nenhuma RPC executada.');
    return { success: true, dry_run: true, queued: 0, failed: 0, total: plan.length,
      plan: plan.map((p) => ({ destination: p.dest.id, deal: p.deal.id, tag: p.dest.tag })) };
  }

  // 5. v420: materializa na fonte C2. O runner NÃO chama sendMessage.
  console.log('\n📥 Enfileirando no mestre v420 (sem envio unitário)...\n');
  const results = [];
  const parseBrl = (v) => {
    const raw = String(v == null ? '' : v).trim();
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  for (const { dest, deal } of plan) {
    const price = parseBrl(deal.promo_price);
    const original = parseBrl(deal.original_price);
    const clickUrl = String(deal.link_verified || '').trim();
    if (!price || !/^https:\/\//i.test(clickUrl)) {
      results.push({ destination: dest.id, queued: false, error: 'preco_brl_ou_link_verificado_ausente' });
      continue;
    }
    const q = await enqueueV420Offer({
      source_key: `github:viral:${deal.id}:${new Date().toISOString().slice(0, 10)}`,
      offer_id: String(deal.id),
      title: deal.title,
      merchant: deal.store,
      brand: deal.brand,
      price_brl: price,
      original_price_brl: original,
      coupon: deal.coupon || null,
      click_url: clickUrl,
      button_text: 'Ver oferta',
      metadata: {
        link_verified_at: deal.link_verified_at || null,
        discount_label: deal.discount || null,
        source: 'github_brazilian_viral_catalog_v420'
      }
    });
    const accepted = Boolean(q.ok);
    const queued = accepted && q.data && q.data.queued === true;
    results.push({ destination: dest.id, accepted, queued, duplicate: accepted && !queued,
      response: q.data, error: q.error || null });
  }

  // 6. histórico registra aceitação/duplicata contida; nunca registra falha de RPC.
  results.forEach((r) => {
    if (r.accepted) {
      const item = plan.find((p) => p.dest.id === r.destination);
      if (item) recordPublication(history, item.dest, item.deal);
    }
  });
  if (results.some((r) => r.accepted)) saveJson(HISTORY_PATH, history);

  const accepted = results.filter((r) => r.accepted).length;
  const queued = results.filter((r) => r.queued).length;
  const failed = results.length - accepted;
  console.log('\n' + '='.repeat(80));
  console.log('📊 RELATÓRIO DE ENFILEIRAMENTO v420');
  console.log('='.repeat(80));
  results.forEach((r) => console.log(`  ${r.accepted ? '✅' : '❌'} ${r.destination}: ${r.queued ? 'enfileirada no lote 1:1' : (r.duplicate ? 'duplicata contida' : r.error)}`));
  console.log(`\n  Total: ${accepted}/${results.length} aceitas (${queued} novas) | ${failed} falha(s)`);
  console.log('='.repeat(80));

  return {
    success: accepted > 0 && failed === 0,
    accepted,
    queued,
    failed,
    total: results.length,
    results,
    plan: plan.map((p) => ({ destination: p.dest.id, deal: p.deal.id, tag: p.dest.tag }))
  };
}

// ------------------------------------------------------------------
// Execucao direta
// ------------------------------------------------------------------
if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = { dryRun: args.includes('--dry') || args.includes('--dry-run') };
  publishToAllDestinations(opts)
    .then((r) => process.exit(r.success ? 0 : 1))
    .catch((e) => {
      console.error('💥 Erro fatal:', e.message);
      process.exit(1);
    });
}

module.exports = { publishToAllDestinations, formatDealPost, pickDealForDestination };
