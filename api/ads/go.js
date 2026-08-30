const fs = require('fs');
const path = require('path');

// Verified working affiliate endpoints and dynamic fallback routing
const VERIFIED_TARGETS = {
  booking: "https://www.tkqlhce.com/click-8041957-17288448",
  carla: "https://www.jdoqocy.com/click-8041957-17075184",
  nordvpn: "https://go.nordvpn.net/aff_c?offer_id=15&aff_id=8041957",
  surfshark: "https://get.surfshark.net/aff_c?offer_id=6&aff_id=8041957",
  shopee: "https://s.shopee.com.br/9pG4O5hX8q",
  mercadolivre: "https://meli.la/1U3rtgV",
  amazon: "https://amazon.com.br/?tag=aquitemachadinhos-20",
  udemy: "https://www.udemy.com/courses/search/?src=ukw&q=",
  faculdade: "https://faculdade-interativa-core.vercel.app",
  clickbus: "https://www.clickbus.com.br/"
};

function getBrandCatalog() {
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'data', 'brand-discovery.json'),
    path.join(process.cwd(), 'data', 'brand-discovery.json')
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed.brands) return parsed.brands;
      }
    } catch (e) {}
  }
  return {};
}

module.exports = async (req, res) => {
  const brandCatalog = getBrandCatalog();
  let brandKey = (req.query.brand || req.query.b || '').toLowerCase().trim();
  const site = (req.query.site || 'aquitemachadinhos').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const slot = (req.query.slot || 'header').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const rawDest = req.query.dest || req.query.url || req.query.u;
  const country = (req.headers['x-vercel-ip-country'] || 'BR').toUpperCase();
  const sid = req.query.sid || `${site}_${country.toLowerCase()}_${slot}`;

  // Smart Geo-Intent Multiplier
  if (!brandKey || brandKey === 'auto') {
    if (country === 'BR') {
      brandKey = slot.includes('travel') ? 'booking' : (slot.includes('course') ? 'udemy' : 'mercadolivre');
    } else {
      brandKey = 'nordvpn';
    }
  }

  let targetUrl = '';

  if (VERIFIED_TARGETS[brandKey]) {
    targetUrl = VERIFIED_TARGETS[brandKey];
    if (brandKey === 'udemy' && rawDest) {
      targetUrl = rawDest;
    }
  } else if (brandCatalog[brandKey] && brandCatalog[brandKey].url) {
    targetUrl = brandCatalog[brandKey].url;
  } else if (rawDest) {
    targetUrl = rawDest;
  } else {
    targetUrl = 'https://www.aquitemachadinhos.com.br';
  }

  // CJ compliance: If there is a deep link destination, encode it properly
  if (rawDest && targetUrl.includes('click-8041957') && !targetUrl.includes('url=')) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}url=${encodeURIComponent(rawDest)}`;
  }

  // Inject dynamic SID
  try {
    const urlObj = new URL(targetUrl);
    urlObj.searchParams.set('sid', sid);
    urlObj.searchParams.set('aff_sub', sid);
    targetUrl = urlObj.toString();
  } catch (e) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}sid=${encodeURIComponent(sid)}`;
  }

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Location', targetUrl);
  return res.status(307).end();
};
