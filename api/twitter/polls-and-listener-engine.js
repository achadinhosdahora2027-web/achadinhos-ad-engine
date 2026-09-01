/**
 * ==============================================================================
 * TWITTER / X INTERACTIVE POLLS, DM RESPONDER & MENTION RADAR ENGINE 2026
 * Account: @Savegrid20 | Managed by: CMO & Head of Social Intelligence
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const { publishTweet } = require('./tweet-publisher');

const POLL_TEMPLATES = [
  {
    topic: "Destino das Próximas Férias",
    lang: "pt",
    text: "✈️ Se você pudesse viajar com tudo pago amanhã, qual seria o seu destino dos sonhos?\n\n🏨 Hotéis com até 40% OFF no Booking: https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&sid=tw_poll_travel",
    options: ["Serra Gaúcha (Gramado)", "Praias do Nordeste", "Buenos Aires", "Orlando / Disney"]
  },
  {
    topic: "Tech & Home Automation",
    lang: "en",
    text: "🤖 What's the #1 smart home gadget you can't live without in 2026?\n\n⚡ Exclusive Tech Deals: https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&sid=tw_poll_tech",
    options: ["Robot Vacuum", "Smart Air Fryer", "4K Mini Projector", "AI Noise-Cancelling Buds"]
  },
  {
    topic: "Astrologia & Signos Mais Fortes",
    lang: "pt",
    text: "🔮 Qual elemento do zodíaco tem a intuição mais poderosa?\n\n✨ Consulte o Tarot 3D Grátis: https://www.aquitemachadinhos.com.br/entretenimento.html#tarot",
    options: ["Fogo (Áries/Leão/Sagitário)", "Água (Câncer/Escorpião/Peixes)", "Terra (Touro/Virgem/Capricórnio)", "Ar (Gêmeos/Libra/Aquário)"]
  }
];

const HIGH_INTENT_KEYWORDS = [
  "comprar notebook", "cupom shopee", "desconto booking", "hotel gramado",
  "passagem aerea barata", "nordvpn cupom", "melhor robo aspirador", "tarot online"
];

function generateInteractivePoll(index = 0) {
  const template = POLL_TEMPLATES[index % POLL_TEMPLATES.length];
  return {
    ...template,
    poll: {
      options: template.options,
      duration_minutes: 1440 // 24 hours
    }
  };
}

function matchHighIntentMention(tweetText) {
  const lower = (tweetText || '').toLowerCase();
  for (const kw of HIGH_INTENT_KEYWORDS) {
    if (lower.includes(kw)) {
      let replyBrand = 'shopee';
      if (kw.includes('hotel') || kw.includes('booking') || kw.includes('passagem')) replyBrand = 'booking';
      else if (kw.includes('vpn') || kw.includes('segurança')) replyBrand = 'nordvpn';
      else if (kw.includes('tarot')) replyBrand = 'tarot';

      return {
        matched: true,
        keyword: kw,
        suggested_reply: `Olá! Encontramos essa oferta verificada com cupom ativo hoje para você: https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=${replyBrand}&sid=tw_radar_reply`
      };
    }
  }
  return { matched: false };
}

function processTwitterDm(messageText) {
  const lower = (messageText || '').toLowerCase();
  if (lower.includes('cupom') || lower.includes('desconto') || lower.includes('shopee')) {
    return "🎁 Aqui está seu cupom Shopee com frete grátis liberado: https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&sid=tw_dm_shopee";
  }
  if (lower.includes('hotel') || lower.includes('viagem') || lower.includes('booking')) {
    return "🏨 Acesse até 40% OFF em pousadas e resorts no Booking: https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&sid=tw_dm_booking";
  }
  if (lower.includes('tarot') || lower.includes('signo')) {
    return "🔮 Tire sua carta no Tarot 3D Interativo 100% grátis: https://www.aquitemachadinhos.com.br/entretenimento.html#tarot";
  }
  return "Olá! Sou o assistente automático da SaveGrid / Aqui Tem Achadinhos. Como posso te ajudar com ofertas, viagens ou tecnologia hoje?";
}

module.exports = {
  generateInteractivePoll,
  matchHighIntentMention,
  processTwitterDm,
  POLL_TEMPLATES
};
