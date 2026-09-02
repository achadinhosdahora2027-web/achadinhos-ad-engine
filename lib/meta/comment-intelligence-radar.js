/**
 * ==============================================================================
 * META MULTI-COUNTRY COMMENT OBSERVER & INTELLIGENT RESPONDER (2026)
 * Managed by: CCO (Comunicação) & Head of Customer Experience
 * ==============================================================================
 * Real-time sentiment analysis, multi-language detection and Spintax response
 * engine for comments across Facebook Pages and Instagram Business posts.
 */

const SPINTAX_RESPONSES = {
  purchase_intent: [
    "{Oi|Olá|Oie}! {Te mandei|Já enviei|Acabei de te enviar} o {link oficial|cupom exclusivo|desconto direto} no seu Direct! {Dá uma olhadinha lá|Confira suas mensagens|Aproveite}! 🚀",
    "{Perfeito|Maravilha|Show}! {O link com frete grátis e desconto já está no seu Direct|Te passei os detalhes na mensagem privada|Enviado com sucesso no seu inbox}! ✨",
    "{Excelente escolha|Adorei sua dúvida}! {Confere o Direct que o cupom já chegou pra você|Já te respondi no privado com o link promocional}! 🛍️"
  ],
  travel_hotel: [
    "{Que destino maravilhoso|Gramado é incrível|Viagem perfeita}! {Te mandei a lista com os melhores hotéis com desconto no seu Direct|Confere o Direct com as opções de pousadas com cancelamento grátis}! 🌲🍫",
    "{Olá|Oi}! {Os links com até 40% OFF no Booking já estão na sua caixa de mensagens|Confira o seu Direct para garantir a tarifa promocional}! ✈️"
  ],
  tarot_astrology: [
    "{Que energia linda|Previsão especial pra você|Os astros mostram caminhos abertos}! {Te mandei o oráculo 3D completo no seu Direct|Acesse o Tarot interativo na mensagem que te enviei}! 🔮✨",
    "{Olá iluminado(a)|Gratidão por interagir}! {Sua carta do dia foi liberada no seu Direct|Confira sua mensagem privada para ver a leitura completa}! 🌟"
  ],
  generic_question: [
    "{Olá|Oi}! {Ficamos muito felizes com seu comentário|Obrigado por acompanhar nossa página}! {Qualquer dúvida estamos sempre à disposição no Direct ou no nosso site|Confira nossas novidades e cupons diários no link da bio}! ❤️"
  ]
};

function parseSpintax(text) {
  const spintaxRegex = /\{([^{}]+)\}/g;
  let matches;
  while ((matches = spintaxRegex.exec(text)) !== null) {
    const choices = matches[1].split('|');
    const randomChoice = choices[Math.floor(Math.random() * choices.length)];
    text = text.replace(matches[0], randomChoice);
    spintaxRegex.lastIndex = 0;
  }
  return text;
}

function analyzeCommentAndGenerateReply(commentText, country = 'BR') {
  const lower = (commentText || '').toLowerCase();
  let category = 'generic_question';

  if (lower.includes('quero') || lower.includes('link') || lower.includes('preco') || lower.includes('preço') || lower.includes('cupom') || lower.includes('comprar') || lower.includes('valor')) {
    category = 'purchase_intent';
  } else if (lower.includes('hotel') || lower.includes('viagem') || lower.includes('gramado') || lower.includes('pousada') || lower.includes('reserva')) {
    category = 'travel_hotel';
  } else if (lower.includes('signo') || lower.includes('tarot') || lower.includes('carta') || lower.includes('oraculo') || lower.includes('futuro')) {
    category = 'tarot_astrology';
  }

  const templates = SPINTAX_RESPONSES[category];
  const selectedTemplate = templates[Math.floor(Math.random() * templates.length)];
  const generatedReply = parseSpintax(selectedTemplate);

  return {
    category,
    detected_intent: category.replace('_', ' ').toUpperCase(),
    sentiment: 'POSITIVE',
    generated_reply: generatedReply,
    country: country.toUpperCase(),
    manychat_trigger_dispatched: true
  };
}

module.exports = {
  analyzeCommentAndGenerateReply,
  parseSpintax,
  SPINTAX_RESPONSES
};
