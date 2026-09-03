const fs = require('fs');
const path = require('path');

// ==========================================================================
// CJ Affiliate — identidade correta (auditoria 03/09/2026)
//   CID (empresa/publisher):        8041957   -> usado APENAS em APIs (requestor-cid)
//   PID (website / promotional property) por site -> usado nos links click-{PID}-{LINK}
// ==========================================================================
const CJ_CID = '8041957';
const CJ_PIDS = {
  aquitemachadinhos: '101859672',
  nexus: '101870639',
  solvegrid: '101870640'
};
const CJ_DEFAULT_SITE = 'aquitemachadinhos';

function resolveCjPid(site) {
  const s = String(site || '').toLowerCase();
  if (s.startsWith('nexus')) return CJ_PIDS.nexus;
  if (s.startsWith('solvegrid')) return CJ_PIDS.solvegrid;
  return CJ_PIDS[CJ_DEFAULT_SITE];
}

// Links CJ = Evergreen/Text links REAIS dos programas joined (validados via Link Search API).
// {PID} é substituído em tempo de execução pelo PID do site de origem.
const CJ_LINKS = {
  booking: "https://www.kqzyfj.com/click-{PID}-17293138",
  carla: "https://www.anrdoezrs.net/click-{PID}-17094338",
  nordvpn: "https://www.anrdoezrs.net/click-{PID}-13914989",
  nordpass: "https://www.dpbolvw.net/click-{PID}-17262576",
  surfshark: "https://www.tkqlhce.com/click-{PID}-15736773",
  shopee: "https://s.shopee.com.br/9pG4O5hX8q",
  mercadolivre: "https://meli.la/1U3rtgV",
  amazon: "https://amazon.com.br/?tag=aquitemachadinhos-20",
  amazon_us: "https://www.amazon.com/?tag=aquitemachadinhos-20",
  udemy: "https://www.udemy.com/courses/search/?src=ukw&q=",
  faculdade: "https://faculdade-interativa-core.vercel.app",
  clickbus: "https://www.clickbus.com.br/",
  brunoyam: "https://brunoyam.com/",
  nadpo: "https://nadpo.ru/",
  aliexpress: "https://www.anrdoezrs.net/click-{PID}-17242061",
  malwarebytes: "https://www.dpbolvw.net/click-{PID}-15734534",
  wondershare: "https://www.anrdoezrs.net/click-{PID}-15733675",
  movavi: "https://www.anrdoezrs.net/click-{PID}-15735540",
  parallels: "https://www.jdoqocy.com/click-{PID}-15733336",
  corel: "https://www.tkqlhce.com/click-{PID}-15734376",
  sucuri: "https://www.tkqlhce.com/click-{PID}-15735343",
  updf: "https://www.anrdoezrs.net/click-{PID}-15820753",
  switchbot: "https://www.dpbolvw.net/click-{PID}-15735830",
  bluetti: "https://www.anrdoezrs.net/click-{PID}-15736238",
  soundcore: "https://www.anrdoezrs.net/click-{PID}-17033430",
  novakid: "https://www.dpbolvw.net/click-{PID}-15735619",
  economybookings: "https://www.kqzyfj.com/click-{PID}-15736982",
  booking_latam: "https://www.jdoqocy.com/click-{PID}-17293137",
  booking_uk: "https://www.jdoqocy.com/click-{PID}-15734754"
};

// Compatibilidade: mesmo objeto sob o nome antigo
const VERIFIED_TARGETS = CJ_LINKS;


// Regional Tier Mapping
const REGIONS = {
  LATAM: ['BR', 'AR', 'MX', 'CL', 'CO', 'PE', 'UY', 'PY', 'EC', 'BO', 'VE', 'CR', 'PA', 'DO', 'GT'],
  CIS: ['RU', 'BY', 'KZ', 'AM', 'KG', 'UZ', 'TJ', 'MD', 'AZ', 'GE'],
  TIER1_EN: ['US', 'CA', 'GB', 'AU', 'NZ', 'IE'],
  TIER1_EU: ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'GR'],
  APAC: ['JP', 'KR', 'CN', 'HK', 'TW', 'SG', 'TH', 'MY', 'PH', 'IN', 'ID', 'VN'],
  MENA: ['AE', 'SA', 'QA', 'KW', 'IL', 'EG', 'TR', 'MA', 'ZA']
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

function detectDevice(userAgent = '') {
  const ua = userAgent.toLowerCase();
  if (/mobile|iphone|ipod|android|blackberry|opera mini|opera mobi|skyfire|maemo|windows phone|palm|iemobile|symbian|symbianos|fennec/i.test(ua)) return 'mobile';
  if (/ipad|tablet|playbook|silk|kindle/i.test(ua)) return 'tablet';
  return 'desktop';
}

module.exports = async (req, res) => {
  const brandCatalog = getBrandCatalog();
  const query = req.query || {};
  const headers = req.headers || {};
  let brandKey = (query.brand || query.b || '').toLowerCase().trim();
  const site = (query.site || 'aquitemachadinhos').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const slot = (query.slot || 'header').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const rawDest = query.dest || query.url || query.u;
  
  // Extract geo country
  const country = (
    headers['x-vercel-ip-country'] ||
    headers['cf-ipcountry'] ||
    headers['x-country-code'] ||
    query.geo ||
    query.country ||
    'BR'
  ).toUpperCase().substring(0, 2);

  const device = detectDevice(headers['user-agent'] || '');
  const sid = query.sid || `${site}_${country.toLowerCase()}_${slot}_${device}`;

  // Smart Geo-Waterfall Algorithm
  if (!brandKey || brandKey === 'auto') {
    if (REGIONS.LATAM.includes(country)) {
      if (slot.includes('travel')) brandKey = 'booking';
      else if (slot.includes('course') || slot.includes('edu')) brandKey = (country === 'BR') ? 'faculdade' : 'udemy';
      else if (slot.includes('security') || slot.includes('tech')) brandKey = 'nordvpn';
      else brandKey = (country === 'BR') ? 'shopee' : 'aliexpress';
    } else if (REGIONS.CIS.includes(country)) {
      if (slot.includes('course') || slot.includes('edu') || slot.includes('tech')) brandKey = 'brunoyam';
      else if (slot.includes('security')) brandKey = 'nordvpn';
      else brandKey = 'aliexpress';
    } else if (REGIONS.TIER1_EN.includes(country)) {
      if (slot.includes('travel')) brandKey = 'booking';
      else if (slot.includes('course')) brandKey = 'udemy';
      else if (slot.includes('security')) brandKey = 'nordvpn';
      else brandKey = 'amazon_us';
    } else if (REGIONS.TIER1_EU.includes(country)) {
      if (slot.includes('travel')) brandKey = 'booking';
      else if (slot.includes('course')) brandKey = 'udemy';
      else brandKey = 'nordvpn';
    } else if (REGIONS.APAC.includes(country)) {
      if (slot.includes('tech') || slot.includes('security')) brandKey = 'nordvpn';
      else if (slot.includes('course')) brandKey = 'udemy';
      else brandKey = 'aliexpress';
    } else {
      // Universal Global Fallback
      brandKey = slot.includes('travel') ? 'booking' : (slot.includes('security') ? 'nordvpn' : 'aliexpress');
    }
  }

  let targetUrl = '';

  const cjPid = resolveCjPid(site);
  // Booking: programas regionais separados na CJ (BR / LATAM / UK-EU)
  if (brandKey === 'booking') {
    if (REGIONS.TIER1_EU.includes(country) || country === 'GB') brandKey = 'booking_uk';
    else if (REGIONS.LATAM.includes(country) && country !== 'BR') brandKey = 'booking_latam';
  }

  if (VERIFIED_TARGETS[brandKey]) {
    targetUrl = VERIFIED_TARGETS[brandKey].replace('{PID}', cjPid);
    if (brandKey === 'udemy' && rawDest) {
      targetUrl = rawDest;
    }
  } else if (brandCatalog[brandKey] && brandCatalog[brandKey].url) {
    targetUrl = String(brandCatalog[brandKey].url).replace('{PID}', cjPid);
  } else if (rawDest) {
    targetUrl = rawDest;
  } else {
    // Ultimate Fallback
    targetUrl = 'https://www.aquitemachadinhos.com.br';
  }

  // CJ Deep Link Encoding Compliance
  if (rawDest && (/\/click-\d{9}-\d+/.test(targetUrl) || targetUrl.includes('tkqlhce.com') || targetUrl.includes('kqzyfj.com') || targetUrl.includes('jdoqocy.com') || targetUrl.includes('anrdoezrs.net') || targetUrl.includes('dpbolvw.net')) && !targetUrl.includes('url=')) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}url=${encodeURIComponent(rawDest)}`;
  }

  // Multi-Network Dynamic Tracking Ingestion
  try {
    const urlObj = new URL(targetUrl);
    // CJ Affiliate
    urlObj.searchParams.set('sid', sid);
    // HasOffers / Tune
    urlObj.searchParams.set('aff_sub', sid);
    urlObj.searchParams.set('aff_sub2', country);
    // Admitad
    urlObj.searchParams.set('subid', sid);
    urlObj.searchParams.set('subid1', country);
    // Impact Radius
    urlObj.searchParams.set('subId1', sid);
    // Shopee
    if (urlObj.hostname.includes('shopee')) {
      urlObj.searchParams.set('sub_id', sid);
    }
    targetUrl = urlObj.toString();
  } catch (e) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}sid=${encodeURIComponent(sid)}&aff_sub=${encodeURIComponent(sid)}`;
  }

  // Record click telemetry into State Ledger
  try {
    const ledgerCandidates = [
      path.join(__dirname, '..', '..', 'data', 'autonomous-state-ledger.json'),
      path.join(process.cwd(), 'data', 'autonomous-state-ledger.json')
    ];
    for (const lp of ledgerCandidates) {
      if (fs.existsSync(lp)) {
        const ldata = JSON.parse(fs.readFileSync(lp, 'utf8'));
        if (!ldata.cumulative_telemetry) ldata.cumulative_telemetry = {};
        ldata.cumulative_telemetry.total_clicks = (ldata.cumulative_telemetry.total_clicks || 0) + 1;
        fs.writeFileSync(lp, JSON.stringify(ldata, null, 2));
        break;
      }
    }
  } catch (e) {}

  // Edge Headers
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Affiliate-Engine', 'Achadinhos-Global-Gateway-2026');
  res.setHeader('X-Routed-Country', country);
  res.setHeader('X-Routed-Brand', brandKey);
  res.setHeader('X-CJ-PID', cjPid);
  res.setHeader('Location', targetUrl);
  return res.status(307).end();
};
