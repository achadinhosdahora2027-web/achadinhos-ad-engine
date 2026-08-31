/**
 * ==============================================================================
 * ULTRA-SMART MULTI-ADVERTISER COMMENT & INTENT MATCHER (CJ & GLOBAL AFFILIATES)
 * ==============================================================================
 * Automatically detects what advertiser or product the user is asking about
 * in Instagram/Facebook comments or DMs across all languages, generating:
 * 1. Public Comment Auto-Reply
 * 2. Private DM with Dynamic CJ/Shopee/NordVPN/Booking Affiliate Tracking Link
 */

const fs = require('fs');
const path = require('path');

function getMatrix() {
  const p = path.join(__dirname, '../../data/advertisers-intent-matrix.json');
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {}
  }
  return { advertisers: [] };
}

function normalizeText(text = '') {
  return text.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
}

function detectLanguage(text = '') {
  const norm = normalizeText(text);
  // Portuguese checks first
  if (/\b(quero|fazer|para|pra|meu|minha|com|tem|desconto|hotel|hospedagem|viagem|viajar|compras|curso|gratis)\b/.test(norm)) return 'pt';
  if (/\b(the|hotels|stay|vacation|free|deals|discount|course|learn|guide|cheap|want)\b/.test(norm)) return 'en';
  if (/\b(hola|quiero|viaje|viajes|alojamiento|cupon|cupones|cursos|gratis)\b/.test(norm)) return 'es';
  if (/\b(bonjour|voyage|vacances|reduction|cours|gratuit)\b/.test(norm)) return 'fr';
  if (/\b(hallo|reise|rabatt|unterkunft|kurs|kostenlos)\b/.test(norm)) return 'de';
  return 'pt'; // Default
}

function matchIntent(commentText = '') {
  const matrix = getMatrix();
  const normalized = normalizeText(commentText);
  const words = normalized.split(/\s+/);
  const lang = detectLanguage(commentText);

  let matchedAdv = null;

  for (const adv of matrix.advertisers) {
    for (const kw of adv.keywords) {
      const normKw = normalizeText(kw);
      // If multi-word keyword, check phrase inclusion
      if (normKw.includes(' ')) {
        if (normalized.includes(normKw)) {
          matchedAdv = adv;
          break;
        }
      } else {
        // If single word, check exact word match
        if (words.includes(normKw)) {
          matchedAdv = adv;
          break;
        }
      }
    }
    if (matchedAdv) break;
  }

  // Fallback to Shopee / Cupons if no specific advertiser matched
  if (!matchedAdv) {
    matchedAdv = matrix.advertisers.find(a => a.brand === 'shopee') || matrix.advertisers[0];
  }

  return { matchedAdv, lang };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
  const commentText = query.comment || query.text || query.message || query.q || 'quero cupom';
  const username = query.username || query.user || 'amigo';
  const userId = query.user_id || query.id || 'anonymous';
  const headers = req.headers || {};
  const country = (query.country || headers['x-vercel-ip-country'] || 'BR').toUpperCase().substring(0, 2);

  const { matchedAdv, lang } = matchIntent(commentText);

  // Generate dynamic tracking link
  const affiliateUrl = `https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=${matchedAdv.brand}&site=ig_comment&slot=auto_intent&country=${country}&sid=ig_comm_${matchedAdv.brand}_${userId}`;

  // Format DM message
  const dmTemplate = matchedAdv.dm_templates[lang] || matchedAdv.dm_templates.pt || matchedAdv.dm_templates.en;
  const dmMessage = dmTemplate.replace('{LINK}', affiliateUrl);

  // Format Public Comment Reply
  const publicReplyTemplate = matchedAdv.public_comment_reply[lang] || matchedAdv.public_comment_reply.pt || matchedAdv.public_comment_reply.en;
  const publicReply = `@${username.replace('@', '')} ${publicReplyTemplate}`;

  // Response for ManyChat / Meta Webhook
  const response = {
    status: "success",
    timestamp: new Date().toISOString(),
    input: {
      original_comment: commentText,
      username: username,
      detected_language: lang,
      country: country
    },
    matched_advertiser: {
      brand: matchedAdv.brand,
      name: matchedAdv.name,
      category: matchedAdv.category,
      discount_badge: matchedAdv.discount_badge,
      affiliate_url: affiliateUrl
    },
    actions: {
      public_comment_reply: publicReply,
      private_direct_message: dmMessage
    },
    manychat_payload_v2: {
      version: "v2",
      content: {
        messages: [
          {
            type: "text",
            text: dmMessage
          }
        ]
      }
    }
  };

  return res.status(200).json(response);
};
