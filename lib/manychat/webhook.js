/**
 * ==============================================================================
 * MANYCHAT 24/7 CONVERSATIONAL AUTOMATION WEBHOOK & DYNAMIC CONTENT ENGINE
 * ==============================================================================
 * Connects ManyChat (WhatsApp, Instagram DM, Messenger) to the Geo-Affiliate Engine.
 * Formats dynamic JSON responses with personalized Tarot, Horoscope, and Affiliate Deals
 * in all languages and countries across the world.
 */

const TAROT_DECK = [
  { name: "O Mago (I)", pt: "Novo início, manifestação e poder criativo.", en: "New beginnings, manifestation, and creative mastery.", es: "Nuevos comienzos, manifestación y poder creativo." },
  { name: "A Sacerdotisa (II)", pt: "Intuição profunda, segredos revelados e sabedoria interior.", en: "Deep intuition, secrets revealed, and inner wisdom.", es: "Intuición profunda, secretos revelados y sabiduría." },
  { name: "A Imperatriz (III)", pt: "Abundância, fertilidade, prosperidade e novos projetos.", en: "Abundance, fertility, prosperity, and thriving projects.", es: "Abundancia, fertilidad, prosperidad y nuevos proyectos." },
  { name: "O Imperador (IV)", pt: "Estrutura, estabilidade, autoridade e conquistas sólidas.", en: "Structure, stability, leadership, and solid achievements.", es: "Estructura, estabilidad, liderazgo y logros sólidos." },
  { name: "A Roda da Fortuna (X)", pt: "Grandes viradas favoráveis, sorte inesperada e destino.", en: "Favorable turning points, unexpected luck, and destiny.", es: "Grandes giros favorables, suerte inesperada y destino." },
  { name: "A Estrela (XVII)", pt: "Esperança renovada, cura, inspiração e bênçãos cósmicas.", en: "Renewed hope, spiritual healing, and cosmic inspiration.", es: "Esperanza renovada, sanación espiritual e inspiración." },
  { name: "O Sol (XIX)", pt: "Sucesso absoluto, clareza mental, vitalidade e alegria.", en: "Total success, mental clarity, vitality, and boundless joy.", es: "Éxito absoluto, claridad mental, vitalidad y alegría." },
  { name: "O Mundo (XXI)", pt: "Ciclos concluídos com vitória, expansão global e triunfo.", en: "Cycles completed with victory, global expansion, and triumph.", es: "Ciclos concluidos con victoria, expansión global y triunfo." }
];

const LOCALIZED_RESPONSES = {
  pt: {
    tarot_title: "✨ Sua Revelação do Tarot 3D",
    tarot_sub: "Conselho do Oráculo:",
    coupon_card_title: "🎁 Recompensa Cósmica Desbloqueada",
    coupon_card_sub: "Cupom exclusivo verificado para hotéis, tecnologia e compras.",
    btn_claim: "Resgatar Agora ➔",
    btn_share: "Compartilhar com Amigos 💬"
  },
  en: {
    tarot_title: "✨ Your 3D Tarot Daily Oracle",
    tarot_sub: "Cosmic Guidance:",
    coupon_card_title: "🎁 Cosmic VIP Reward Unlocked",
    coupon_card_sub: "Verified coupon for travel bookings, security, and top deals.",
    btn_claim: "Claim Voucher ➔",
    btn_share: "Share with Friends 💬"
  },
  es: {
    tarot_title: "✨ Tu Revelación del Tarot 3D",
    tarot_sub: "Consejo del Oráculo:",
    coupon_card_title: "🎁 Recompensa Cósmica Desbloqueada",
    coupon_card_sub: "Cupón verificado para viajes, tecnología y compras.",
    btn_claim: "Reclamar Cupón ➔",
    btn_share: "Compartir con Amigos 💬"
  }
};

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
  const intent = (query.intent || query.action || 'tarot').toLowerCase().trim();
  const lang = (query.lang || query.locale || 'pt').substring(0, 2).toLowerCase();
  const country = (query.country || query.geo || req.headers['x-vercel-ip-country'] || 'BR').toUpperCase().substring(0, 2);
  const subscriberId = query.subscriber_id || query.id || 'anonymous';

  const t = LOCALIZED_RESPONSES[lang] || LOCALIZED_RESPONSES.pt;
  const card = TAROT_DECK[Math.floor(Math.random() * TAROT_DECK.length)];
  const cardMeaning = card[lang] || card.pt;

  const affiliateUrl = `https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=auto&site=manychat&slot=bot_${intent}&country=${country}&sid=manychat_${country.toLowerCase()}_${subscriberId}`;

  // Build ManyChat Dynamic Content Response format (v2 standard)
  let responseData;

  if (intent === 'tarot') {
    responseData = {
      version: "v2",
      content: {
        messages: [
          {
            type: "text",
            text: `${t.tarot_title}\n\n🃏 Carta: *${card.name}*\n🔮 ${t.tarot_sub} ${cardMeaning}\n\n⚡ Previsão gerada em tempo real pelo ecossistema Aqui Tem Achadinhos.`
          },
          {
            type: "cards",
            elements: [
              {
                title: t.coupon_card_title,
                subtitle: t.coupon_card_sub,
                image_url: "https://www.aquitemachadinhos.com.br/favicon.ico",
                buttons: [
                  {
                    type: "url",
                    caption: t.btn_claim,
                    url: affiliateUrl
                  },
                  {
                    type: "url",
                    caption: t.btn_share,
                    url: `https://api.whatsapp.com/send?text=${encodeURIComponent(`✨ Tirei a carta ${card.name} no Tarot 3D! Veja a sua carta do dia grátis: https://www.aquitemachadinhos.com.br/entretenimento.html#tarot`)}`
                  }
                ]
              }
            ]
          }
        ]
      }
    };
  } else if (intent === 'deals' || intent === 'cupom') {
    responseData = {
      version: "v2",
      content: {
        messages: [
          {
            type: "text",
            text: `🔥 *RADAR DE CUPONS & ACHADINHOS AO VIVO (${country})*\n\nCupons válidos e verificados hoje com até 70% OFF em viagens, produtos importados, cursos e tecnologia.`
          },
          {
            type: "cards",
            elements: [
              {
                title: "🏨 Booking.com: Hotéis & Pousadas",
                subtitle: "Até 15% a 30% OFF em reservas nacionais e internacionais.",
                buttons: [
                  {
                    type: "url",
                    caption: "Acessar Desconto Booking ➔",
                    url: `https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&site=manychat&slot=deals&country=${country}`
                  }
                ]
              },
              {
                title: "🛍️ Shopee & Mercado Livre: Cupons Relâmpago",
                subtitle: "Frete grátis e cupons de compras verificadas.",
                buttons: [
                  {
                    type: "url",
                    caption: "Ver Cupons de Compras ➔",
                    url: `https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=manychat&slot=deals&country=${country}`
                  }
                ]
              },
              {
                title: "🛡️ NordVPN Shield & Cursos Tech",
                subtitle: "Proteção cibernética e cursos certificados.",
                buttons: [
                  {
                    type: "url",
                    caption: "Blindar Conexão (70% OFF) ➔",
                    url: `https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=nordvpn&site=manychat&slot=deals&country=${country}`
                  }
                ]
              }
            ]
          }
        ]
      }
    };
  } else {
    // Default Fallback
    responseData = {
      version: "v2",
      content: {
        messages: [
          {
            type: "text",
            text: `✨ Bem-vindo ao Assistente Inteligente 24/7 do Aqui Tem Achadinhos!\n\nSelecione o que deseja receber:\n1️⃣ Digite *TAROT* para tirar sua carta\n2️⃣ Digite *CUPOM* para cupons do dia\n3️⃣ Digite *VIAGEM* para guias de turismo`
          }
        ]
      }
    };
  }

  return res.status(200).json(responseData);
};
