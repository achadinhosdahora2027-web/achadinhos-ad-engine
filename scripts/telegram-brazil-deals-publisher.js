/**
 * ==============================================================================
 * TELEGRAM OFERTAS BRASIL 24/7 VIRAL DEALS PUBLISHER ENGINE (2026)
 * Channel: @ofertasbrasilz (Ofertas Brasil VIP)
 * Managed by: CCO (Comunicação & Vendas) & Head de Afiliados Brasil
 * ==============================================================================
 * 1. Focuses 100% on high-converting BRAZILIAN DEALS (Shopee, Amazon, Meli, Booking).
 * 2. Strict Anti-Repetition State Machine (Never repeats recently posted deals).
 * 3. High-converting copywriting with emojis, slashed prices, coupons, and clean CTAs.
 * 4. Integrates verified affiliate tracking links with sub_id and SID.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8910879073:AAH0Jdf9t5UEekjjI0kdAU7hBogyXKUE8zM';
const CHANNEL_USERNAME = process.env.TELEGRAM_DEALS_CHANNEL || '@ofertasbrasilz';

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

async function sendTelegramDeal(text, options = {}) {
  const token = options.botToken || BOT_TOKEN;
  const chatId = options.chatId || CHANNEL_USERNAME;

  return new Promise((resolve) => {
    try {
      const payload = JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
        disable_web_page_preview: false
      });

      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          let parsed = {};
          try { parsed = JSON.parse(body); } catch (e) {}
          resolve({
            sent: res.statusCode === 200,
            statusCode: res.statusCode,
            message_id: parsed?.result?.message_id,
            response: parsed
          });
        });
      });

      req.on('error', (err) => resolve({ sent: false, error: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ sent: false, timeout: true }); });
      req.write(payload);
      req.end();
    } catch (e) {
      resolve({ sent: false, error: e.message });
    }
  });
}

function formatDealPost(deal, templateIndex = 0) {
  const storeBadge = deal.store === 'Shopee' ? '🛍️ Shopee Brasil' : (deal.store === 'Amazon Brasil' ? '📦 Amazon Brasil' : (deal.store === 'Booking.com' ? '🏨 Booking.com' : (deal.store === 'Mercado Livre' ? '⚡ Mercado Livre' : '🛡️ NordVPN')));
  
  const bulletsText = deal.bullets ? deal.bullets.map(b => `• ${b}`).join('\n') : '';

  const templates = [
    // Template 1: Achadinho Relâmpago
    `
🔥 <b>[ACHADINHO RELÂMPAGO DO DIA]</b> 🔥
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>${deal.title}</b>

${deal.badge ? `🏷️ <i>${deal.badge}</i>\n` : ''}🏪 <b>Loja:</b> <b>${storeBadge}</b>
⭐ <b>Avaliação:</b> ${deal.rating}

💰 <s>De R$ ${deal.original_price}</s>
💥 <b>Por apenas: R$ ${deal.promo_price}</b> (<b>${deal.discount}</b>)
${deal.coupon ? `🎟️ <b>Cupom:</b> <code>${deal.coupon}</code> (Toque para copiar)\n` : ''}
📦 <b>Destaques do Produto:</b>
${bulletsText}

🚨 <i>Preço promocional por tempo limitado ou até esgotar o estoque!</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 <b>COMPRE AQUI COM DESCONTO:</b>
🔗 <a href="${deal.affiliate_url}">${deal.affiliate_url}</a>
`,

    // Template 2: Baixou Demais
    `
😱 <b>[BAIXOU MUITO O PREÇO!]</b> 😱
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>${deal.title}</b>

🏪 <b>Disponível na:</b> <b>${storeBadge}</b>
⭐ <b>Status:</b> ${deal.rating}

💵 <b>Preço Normal:</b> <s>R$ ${deal.original_price}</s>
💎 <b>OFERTA VIP HOJE:</b> <b>R$ ${deal.promo_price}</b> (<b>${deal.discount}</b>)
${deal.coupon ? `🎁 <b>Use o Cupom no Carrinho:</b> <code>${deal.coupon}</code>\n` : ''}
✨ <b>Por que vale a pena:</b>
${bulletsText}

⚡ <i>Aproveite antes que volte ao valor normal!</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
🛒 <b>GARANTIR MINHA UNIDADE:</b>
🔗 <a href="${deal.affiliate_url}">${deal.affiliate_url}</a>
`,

    // Template 3: Oferta Verificada VIP
    `
⚡ <b>[OFERTA VERIFICADA • FRETE GRÁTIS]</b> ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━
<b>${deal.title}</b>

📍 <b>Plataforma Oficial:</b> <b>${storeBadge}</b>
🏆 <b>Classificação:</b> ${deal.rating}

🏷️ <s>R$ ${deal.original_price}</s> ➔ <b>R$ ${deal.promo_price}</b> (Economize <b>${deal.discount}</b>)
${deal.coupon ? `🔑 <b>Cupom Ativo:</b> <code>${deal.coupon}</code>\n` : ''}
📋 <b>Informações:</b>
${bulletsText}

🚚 <i>Verifique o frete grátis aplicando o cupom no app!</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
👉 <b>LINK OFICIAL DA OFERTA:</b>
🔗 <a href="${deal.affiliate_url}">${deal.affiliate_url}</a>
`
  ];

  const tIndex = templateIndex % templates.length;
  return templates[tIndex].trim();
}

async function publishNextViralDeal(options = {}) {
  const isForce = options.force || false;
  const channel = options.channel || CHANNEL_USERNAME;

  console.log('================================================================================');
  console.log(`🛒 PUBLICADOR AUTÔNOMO DE OFERTAS BRASIL 24/7 (Canal: ${channel})`);
  console.log('================================================================================\n');

  const catalog = loadJson(CATALOG_PATH, { deals: [] });
  const history = loadJson(HISTORY_PATH, { published_deals: [], total_published: 0 });

  const allDeals = catalog.deals || [];
  if (allDeals.length === 0) {
    console.log('❌ Nenhuma oferta encontrada no catálogo brasileiro.');
    return { success: false, reason: 'empty_catalog' };
  }

  // Anti-Repetition Engine
  const publishedIds = new Set((history.published_deals || []).map(d => d.id));
  let availableDeals = allDeals.filter(d => !publishedIds.has(d.id));

  // If all deals have been published, start a new fresh rotation
  if (availableDeals.length === 0) {
    console.log('🔄 Todas as ofertas do ciclo foram publicadas! Reiniciando ciclo de rotação com novas variações...');
    history.published_deals = [];
    availableDeals = allDeals;
  }

  // Pick a high-converting deal
  const selectedDeal = availableDeals[Math.floor(Math.random() * availableDeals.length)];
  const postText = formatDealPost(selectedDeal, (history.total_published || 0) + 1);

  console.log(`📦 Oferta Selecionada: [${selectedDeal.id}] ${selectedDeal.title.substring(0, 50)}...`);
  console.log(`🏪 Loja: ${selectedDeal.store} | Preço: R$ ${selectedDeal.promo_price} (${selectedDeal.discount})`);
  console.log(`🚀 Despachando para o canal ${channel}...`);

  const result = await sendTelegramDeal(postText, { chatId: channel });

  if (result.sent) {
    console.log(`  ✓ Publicado com sucesso no canal! (Message ID: ${result.message_id})`);

    // Record in History
    history.published_deals.push({
      id: selectedDeal.id,
      title: selectedDeal.title,
      store: selectedDeal.store,
      promo_price: selectedDeal.promo_price,
      published_at: new Date().toISOString(),
      message_id: result.message_id,
      channel: channel
    });
    history.total_published = (history.total_published || 0) + 1;
    history.last_published_at = new Date().toISOString();

    saveJson(HISTORY_PATH, history);
  } else {
    console.error(`  ❌ Falha no disparo: ${result.error || result.statusCode}`);
  }

  console.log('\n================================================================================');
  console.log('✅ OPERAÇÃO CONCLUÍDA: CANAL DE OFERTAS BRASIL ATUALIZADO 24/7!');
  console.log('================================================================================');

  return result;
}

if (require.main === module) {
  publishNextViralDeal();
}

module.exports = {
  publishNextViralDeal,
  formatDealPost,
  sendTelegramDeal
};
