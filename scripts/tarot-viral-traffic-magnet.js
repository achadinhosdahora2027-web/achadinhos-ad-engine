/**
 * ==============================================================================
 * TAROT 3D & COSMIC FORECAST VIRAL TRAFFIC MAGNET ENGINE (2026)
 * Managed by: Head of Viral Content & Chief Astrological Strategist
 * ==============================================================================
 * Generates dynamic daily horoscope and tarot draws across 12 zodiac signs
 * in multiple languages, driving organic search traffic to ad-monetized pages.
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_FEED = path.join(__dirname, '../public/feeds/tarot-daily-feed.json');

const ZODIAC_SIGNS = [
  { sign: 'aries', symbol: '♈', name: 'Áries', card: 'O Imperador', advice: 'Momento de ação direta. Uma oportunidade financeira ou de viagem surgirá nos próximos dias.' },
  { sign: 'touro', symbol: '♉', name: 'Touro', card: 'A Imperatriz', advice: 'Abundância material e colheita. Ótimo período para compras planejadas e conforto no lar.' },
  { sign: 'gemeos', symbol: '♊', name: 'Gêmeos', card: 'Os Enamorados', advice: 'Decisões importantes à vista. Conexões e novidades digitais impulsionam seus projetos.' },
  { sign: 'cancer', symbol: '♋', name: 'Câncer', card: 'A Carruagem', advice: 'Caminhos abertos para conquistas e viagens em família. Confie na sua intuição protetora.' },
  { sign: 'leao', symbol: '♌', name: 'Leão', card: 'O Sol', advice: 'Brilho pessoal e prosperidade. Oportunidades profissionais e reconhecimento em alta.' },
  { sign: 'virgem', symbol: '♍', name: 'Virgem', card: 'O Eremita', advice: 'Organização e foco nos detalhes trarão economia e resultados duradouros.' },
  { sign: 'libra', symbol: '♎', name: 'Libra', card: 'A Justiça', advice: 'Equilíbrio e harmonia nos relacionamentos. Contratos e acordos favoráveis hoje.' },
  { sign: 'escorpiao', symbol: '♏', name: 'Escorpião', card: 'A Morte (Renascimento)', advice: 'Transformação positiva e superação. Deixe o velho ir para o novo florescer.' },
  { sign: 'sagitario', symbol: '♐', name: 'Sagitário', card: 'A Roda da Fortuna', advice: 'Sorte inesperada em viagens e novas experiências. O universo conspira a seu favor.' },
  { sign: 'capricornio', symbol: '♑', name: 'Capricórnio', card: 'O Mundo', advice: 'Conclusão vitoriosa de metas e estabilidade financeira consolidada.' },
  { sign: 'aquario', symbol: '♒', name: 'Aquário', card: 'A Estrela', advice: 'Esperança renovada, inspiração e inovação tecnológica transformando sua rotina.' },
  { sign: 'peixes', symbol: '♓', name: 'Peixes', card: 'A Lua', advice: 'Sensibilidade e intuição aguçada. Sonhos e pressentimentos reveladores.' }
];

function generateDailyTarotFeed() {
  console.log('================================================================================');
  console.log('🔮 GERANDO FEED DIÁRIO DE TAROT 3D & PREVISÕES ASTRAIS 2026');
  console.log('================================================================================\n');

  const now = new Date();
  const dateStr = now.toLocaleDateString('pt-BR');

  const dailyForecasts = ZODIAC_SIGNS.map(s => {
    return {
      sign: s.sign,
      symbol: s.symbol,
      name: s.name,
      card_drawn: s.card,
      cosmic_advice: s.advice,
      lucky_numbers: [Math.floor(1 + Math.random() * 60), Math.floor(1 + Math.random() * 60), Math.floor(1 + Math.random() * 60)],
      exclusive_deal: {
        title: s.sign === 'sagitario' || s.sign === 'cancer' ? 'Hotéis Booking com até 40% OFF' : 'Cupons Shopee com Frete Grátis',
        url: s.sign === 'sagitario' || s.sign === 'cancer' ? 'https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=booking&sid=tarot_astral' : 'https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&sid=tarot_astral'
      }
    };
  });

  const payload = {
    date: dateStr,
    generated_at: now.toISOString(),
    total_signs: dailyForecasts.length,
    forecasts: dailyForecasts
  };

  const dir = path.dirname(OUTPUT_FEED);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_FEED, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`✓ Feed de Tarot gerado com sucesso: ${OUTPUT_FEED} (${dailyForecasts.length} signos)`);
  console.log('\n================================================================================');
  console.log('✅ MOTOR DE TRÁFEGO VIRAL DE TAROT & SIGNOS SINCRONIZADO COM SUCESSO!');
  console.log('================================================================================');
}

if (require.main === module) {
  generateDailyTarotFeed();
}

module.exports = {
  generateDailyTarotFeed,
  ZODIAC_SIGNS
};
