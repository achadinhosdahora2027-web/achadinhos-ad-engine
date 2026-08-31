/**
 * ==============================================================================
 * PINTEREST RICH PIN & VERTICAL VISUAL SYNDICATION ENGINE (2026)
 * Managed by: CMO (Marketing & Growth) & CDO (Design & UI/UX)
 * ==============================================================================
 * Generates vertical 1000x1500 Rich Pins metadata, board syndication feeds,
 * and high-intent visual cards for travel, home deals, and tarot.
 */

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '../data/top-curated-offers-catalog.json');
const PINTEREST_RSS_PATH = path.join(__dirname, '../../public/feeds/pinterest-pins.rss');
const PINTEREST_JSON_PATH = path.join(__dirname, '../../public/feeds/pinterest-pins.json');

function loadJson(p, fallback = {}) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {}
  return fallback;
}

function generatePinterestSyndication() {
  console.log('================================================================================');
  console.log('📌 PINTEREST RICH PIN & HIGH-INTENT VISUAL SYNDICATION ENGINE (2026)');
  console.log('================================================================================\n');

  const catalog = loadJson(CATALOG_PATH);
  const offers = catalog.offers || [];

  const pins = offers.map((off, idx) => {
    return {
      id: `pin_${off.id}`,
      title: `${off.title} | Cupom Oficial & Desconto Verificado 2026`,
      description: `Confira a melhor condição em ${off.category}. Oferta verificada com menor tarifa e cupom exclusivo ativo hoje.`,
      link: off.affiliate_url,
      board: off.category.includes('Viagens') ? 'Viagens & Roteiros Incríveis' : (off.category.includes('Casa') ? 'Achadinhos de Casa & Decoração' : 'Tecnologia & Produtividade'),
      image_ratio: '2:3 (1000x1500)',
      category: off.category,
      brand: off.brand,
      created_at: new Date().toISOString()
    };
  });

  // Generate Pinterest JSON Feed
  const jsonDir = path.dirname(PINTEREST_JSON_PATH);
  if (!fs.existsSync(jsonDir)) fs.mkdirSync(jsonDir, { recursive: true });
  fs.writeFileSync(PINTEREST_JSON_PATH, JSON.stringify({ updated_at: new Date().toISOString(), total_pins: pins.length, pins }, null, 2));

  // Generate Pinterest RSS Feed
  let rssXml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Aqui Tem Achadinhos - Pinterest Rich Pins Feed</title>
  <link>https://www.aquitemachadinhos.com.br</link>
  <description>Radar oficial de achadinhos, cupons, viagens e tarot 3D.</description>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
`;

  pins.forEach(pin => {
    rssXml += `  <item>
    <title><![CDATA[${pin.title}]]></title>
    <link>${pin.link}</link>
    <description><![CDATA[${pin.description}]]></description>
    <category>${pin.category}</category>
    <pubDate>${new Date().toUTCString()}</pubDate>
    <guid isPermaLink="false">${pin.id}</guid>
  </item>\n`;
  });

  rssXml += `</channel>\n</rss>`;
  fs.writeFileSync(PINTEREST_RSS_PATH, rssXml);

  console.log(`✓ Total de Rich Pins Gerados: ${pins.length} pins verticais de alta conversão`);
  console.log(`✓ Feed RSS Atualizado: public/feeds/pinterest-pins.rss (${fs.statSync(PINTEREST_RSS_PATH).size} bytes)`);
  console.log(`✓ Feed JSON Atualizado: public/feeds/pinterest-pins.json (${fs.statSync(PINTEREST_JSON_PATH).size} bytes)\n`);
  console.log('================================================================================');
  console.log('✅ PINTEREST SYNDICATION CONCLUÍDO COM SUCESSO!');
  console.log('================================================================================');
}

generatePinterestSyndication();
