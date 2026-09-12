const fs = require('fs');
const path = require('path');
const CJ_CID = '8041957';
const CJ_PIDS = { aquitemachadinhos: '101859672', nexus: '101870639', solvegrid: '101870640' };
const CJ_DEFAULT_SITE = 'aquitemachadinhos';
const GENERIC_SITE_PARAMS = new Set(['bio_link', 'tag_seo', 'exit_drawer', 'sticky_mobile', 'vip_club', 'wheel', 'health', 'audit', 'auto', '']);
function siteFromReferer(headers) {
  const ref = String((headers && (headers.referer || headers.origin)) || '');
  let host = '';
  try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return ''; }
  if (host.includes('nexusplataforma') || host.startsWith('nexus')) return 'nexus';
  if (host.includes('solvegrid')) return 'solvegrid';
  if (host.includes('aquitemachadinhos')) return 'aquitemachadinhos';
  return '';
}
function resolveCjPid(site, headers) {
  let s = String(site || '').toLowerCase();
  if (GENERIC_SITE_PARAMS.has(s) || !(s.startsWith('nexus') || s.startsWith('solvegrid') || s.startsWith('aquitem'))) {
    s = siteFromReferer(headers) || s;
  }
  if (s.startsWith('nexus')) return CJ_PIDS.nexus;
  if (s.startsWith('solvegrid')) return CJ_PIDS.solvegrid;
  return CJ_PIDS[CJ_DEFAULT_SITE];
}
const CJ_LINKS = {
  booking: "https://www.kqzyfj.com/click-{PID}-17293138",
  voo: "https://www.anrdoezrs.net/click-{PID}-17323048",
  carla: "https://www.anrdoezrs.net/click-{PID}-17094338",
  nordvpn: "https://www.anrdoezrs.net/click-{PID}-13914989",
  nordpass: "https://www.dpbolvw.net/click-{PID}-17262576",
  surfshark: "https://www.tkqlhce.com/click-{PID}-15736773",
  shopee: "https://s.shopee.com.br/30n7ohzzU6",
  mercadolivre: "https://meli.la/1U3rtgV",
  ebay: "https://www.ebay.com/deals?campid=5339193749&toolid=10001&mkevt=1&mkcid=1&mkrid=711-53200-19255-0",
  amazon: "https://amazon.com.br/?tag=aquitemachadinhos-20",
  amazon_us: "https://www.amazon.com/?tag=aquitemachadinhos-20",
  udemy: "https://www.udemy.com/courses/search/?src=ukw&q=",
  faculdade: "https://www.udemy.com/courses/search/?src=ukw&q=",
  clickbus: "https://www.clickbus.com.br/",
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
const VERIFIED_TARGETS = CJ_LINKS;
const REGIONS = {
  LATAM: ['BR', 'AR', 'MX', 'CL', 'CO', 'PE', 'UY', 'PY', 'EC', 'BO', 'VE', 'CR', 'PA', 'DO', 'GT'],
  CIS: ['RU', 'BY', 'KZ', 'AM', 'KG', 'UZ', 'TJ', 'MD', 'AZ', 'GE'],
  TIER1_EN: ['US', 'CA', 'GB', 'AU', 'NZ', 'IE'],
  TIER1_EU: ['FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'GR'],
  APAC: ['JP', 'KR', 'CN', 'HK', 'TW', 'SG', 'TH', 'MY', 'PH', 'IN', 'ID', 'VN'],
  MENA: ['AE', 'SA', 'QA', 'KW', 'IL', 'EG', 'TR', 'MA', 'ZA']
};
function getBrandCatalog() {
  const possiblePaths = [path.join(__dirname, '..', '..', 'data', 'brand-discovery.json'), path.join(process.cwd(), 'data', 'brand-discovery.json')];
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
const NON_MONETIZED = new Set(['udemy', 'brunoyam', 'safetywing', 'thefork', 'wise', 'faculdade']);
module.exports = async (req, res) => {
  const brandCatalog = getBrandCatalog();
  const query = req.query || {};
  const headers = req.headers || {};
  let brandKey = (query.brand || query.b || '').toLowerCase().trim();
  let site = String(query.site || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!site || GENERIC_SITE_PARAMS.has(site)) site = siteFromReferer(headers) || site || 'aquitemachadinhos';
  const slot = (query.slot || 'header').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const rawDest = query.dest || query.url || query.u;
  const geoOverride = String(query.geo || query.country || '').toUpperCase().replace(/[^A-Z]/g, '').substring(0, 2);
  const country = ((geoOverride.length === 2 ? geoOverride : '') || headers['x-vercel-ip-country'] || headers['cf-ipcountry'] || headers['x-country-code'] || 'BR').toUpperCase().substring(0, 2);
  const UA_RAW = String(headers['user-agent'] || '');
  const IS_BOT = !UA_RAW || /bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|go-http|okhttp|libwww|httpclient|facebookexternalhit|whatsapp|telegrambot|skytab|claude|gptbot|ccbot|anthropic|perplexity|bytespider|amazonbot|applebot|skywatch|healthcheck|canary\/|pubkyweb|friendica|akkoma|lightpanda|http\.rb|mastodon\/|pleroma|misskey|gotosocial|writefreely|nodebb|peertube|owncast|castopod|funkwhale|bookwyrm|hubzilla|iceshrimp|sharkey|calckey|firefish|fediverse|activitypub|webfinger|undici|node-fetch|axios|got\/|superagent|guzzle|restsharp|postman|insomnia|urllib|aiohttp|requests|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|dataforseo|lighthouse|pagespeed|pingdom|uptimerobot|lexicore|monitor|synthetic|mention_c|mention_ca|mention_car/i.test(UA_RAW) || UA_RAW.trim() === 'Mozilla/5.0' || UA_RAW.trim().length < 20;
  const device = detectDevice(headers['user-agent'] || '');
  const sid = query.sid || `${site}_${country.toLowerCase()}_${slot}_${device}`;
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
      brandKey = slot.includes('travel') ? 'booking' : (slot.includes('security') ? 'nordvpn' : 'aliexpress');
    }
  }
  if (brandKey === 'voo' || brandKey === 'flight' || brandKey === 'voos') brandKey = 'booking';
  else if (brandKey === 'carla' || brandKey === 'car' || brandKey === 'aluguel') brandKey = 'economybookings';
  if (brandKey === 'amazon' && country !== 'BR' && country !== 'PT') brandKey = 'amazon_us';
  if ((brandKey === 'shopee' || brandKey === 'mercadolivre') && country !== 'BR' && country !== 'PT') brandKey = 'aliexpress';
  if (brandKey === 'clickbus' && country !== 'BR' && country !== 'PT') brandKey = 'booking';
  let targetUrl = '';
  const cjPid = resolveCjPid(site, headers);
  const ofertaId = String(query.oferta || query.offer || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ofertaId)) {
    try {
      const dbU = process.env.CLICKS_DB_URL, dbK = process.env.CLICKS_DB_KEY;
      if (dbU && dbK) {
        const ac = new AbortController();
        const tmo = setTimeout(() => ac.abort(), 2500);
        const rr = await fetch(`${dbU.replace(/\/$/, '')}/rest/v1/ads?id=eq.${encodeURIComponent(ofertaId)}&active=is.true&select=click_url,advertiser&limit=1`, { headers: { apikey: dbK, Authorization: `Bearer ${dbK}` }, signal: ac.signal });
        clearTimeout(tmo);
        if (rr.ok) {
          const rows = await rr.json();
          const raw = Array.isArray(rows) && rows[0] && rows[0].click_url;
          if (raw && /^https?:\/\//i.test(raw)) targetUrl = String(raw).replace(/click-\d+-/, `click-${cjPid}-`);
        }
      }
    } catch (e) {}
  }
  if (brandKey === 'booking') {
    if (REGIONS.TIER1_EU.includes(country) || country === 'GB' || country === 'US' || country === 'CA' || country === 'AU' || country === 'NZ' || country === 'IE' || country === 'ZA') brandKey = 'booking_uk';
    else if (REGIONS.LATAM.includes(country) && country !== 'BR') brandKey = 'booking_latam';
    else if (country !== 'BR') brandKey = 'booking_uk';
  }
  if (!targetUrl && VERIFIED_TARGETS[brandKey]) {
    targetUrl = VERIFIED_TARGETS[brandKey].replace('{PID}', cjPid);
    if (brandKey === 'udemy' && rawDest) targetUrl = rawDest;
  } else if (!targetUrl && brandCatalog[brandKey] && brandCatalog[brandKey].url) {
    targetUrl = String(brandCatalog[brandKey].url).replace('{PID}', cjPid);
  } else if (!targetUrl && rawDest) targetUrl = rawDest;
  else if (!targetUrl) targetUrl = 'https://www.aquitemachadinhos.com.br';
  if (rawDest && (/\/click-\d{9}-\d+/.test(targetUrl) || targetUrl.includes('tkqlhce.com') || targetUrl.includes('kqzyfj.com') || targetUrl.includes('jdoqocy.com') || targetUrl.includes('anrdoezrs.net') || targetUrl.includes('dpbolvw.net')) && !targetUrl.includes('url=')) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}url=${encodeURIComponent(rawDest)}`;
  }
  try {
    if (!NON_MONETIZED.has(brandKey)) {
      const urlObj = new URL(targetUrl);
      urlObj.searchParams.set('sid', sid);
      urlObj.searchParams.set('aff_sub', sid);
      urlObj.searchParams.set('aff_sub2', country);
      urlObj.searchParams.set('subid', sid);
      urlObj.searchParams.set('subid1', country);
      urlObj.searchParams.set('subId1', sid);
      if (urlObj.hostname.includes('shopee')) urlObj.searchParams.set('sub_id', sid);
      if (urlObj.hostname.includes('ebay')) urlObj.searchParams.set('customid', sid);
      targetUrl = urlObj.toString();
    }
  } catch (e) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}sid=${encodeURIComponent(sid)}&aff_sub=${encodeURIComponent(sid)}`;
  }
  try {
    const dbUrl = process.env.CLICKS_DB_URL;
    const dbKey = process.env.CLICKS_DB_KEY;
    if (dbUrl && dbKey && !IS_BOT) {
      const net = targetUrl.includes('awin1.com') ? 'awin' : /kqzyfj|jdoqocy|dpbolvw|anrdoezrs|tkqlhce/.test(targetUrl) ? 'cj' : targetUrl.includes('lmdee') ? 'lomadee' : targetUrl.includes('shopee') ? 'shopee' : (targetUrl.includes('mercadolivre') || targetUrl.includes('meli.')) ? 'mercadolivre' : targetUrl.includes('ebay') ? 'ebay' : targetUrl.includes('booking.com') ? 'cj' : NON_MONETIZED.has(brandKey) ? 'direct' : 'generic';
      let refPage = null;
      try { refPage = new URL(headers.referer || '').pathname; } catch (e) {}
      let ipHash = null;
      try { ipHash = require('crypto').createHash('sha256').update(String(headers['x-forwarded-for'] || '')).digest('hex').slice(0, 16); } catch (e) {}
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 2500);
      await fetch(`${dbUrl.replace(/\/$/, '')}/rest/v1/ads_clicks`, {
        method: 'POST',
        headers: { 'apikey': dbKey, 'Authorization': `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_slug: site || null,
          slot: String(query.slot || '').slice(0, 120) || null,
          ad_id: String(brandKey || '').slice(0, 80) || null,
          network: net,
          click_url: String(targetUrl).slice(0, 500),
          click_ref: String(sid || '').slice(0, 120),
          country: country || null,
          user_agent: String(headers['user-agent'] || '').slice(0, 200),
          referrer: String(headers.referer || '').slice(0, 300),
          page_path: refPage,
          device_type: IS_BOT ? 'bot' : (/Mobile|Android|iPhone/i.test(UA_RAW) ? 'mobile' : 'desktop'),
          ip_hash: ipHash
        }),
        signal: ctrl.signal
      }).catch(() => {});
      clearTimeout(tmr);
    }
  } catch (e) {}
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Affiliate-Engine', 'Achadinhos-Global-Gateway-2026-v128');
  res.setHeader('X-Routed-Country', country);
  res.setHeader('X-Routed-Brand', brandKey);
  res.setHeader('X-CJ-PID', cjPid);
  res.setHeader('X-Monetized', NON_MONETIZED.has(brandKey) ? 'false' : 'true');
  const WANT_INT = !IS_BOT && String(query.noint || '') !== '1';
  if (!WANT_INT) {
    res.setHeader('Location', targetUrl);
    return res.status(307).end();
  }
  // ══ v128 SOVEREIGN HOST ALIGNMENT — binding 1:1 fail-closed ══
  // Fonte da verdade: nexus_host_tag_alignment (Supabase mestre). Host sem binding
  // próprio → SEM tags (null). PROIBIDO default cruzado ou força por referer:
  // tag de host A nunca serve em host B (ads.txt mismatch = descarte Adsterra).
  const ADSTERRA_POR_HOST = {
    'achadinhos-ad-engine.vercel.app': 'https://undergocutlery.com/v6k6sq45dm?key=90f19ab095cebec116b7ee5f129e1b2b',
    'solvegrid.com.br': 'https://undergocutlery.com/kpppprb1h5?key=3d010529a102de694b51b617cbfa2221',
    'aquitemachadinhos.com.br': 'https://undergocutlery.com/n125219ufh?key=0474000233cefd60e54ca390d15beaaf',
    'nexusplataforma.ia.br': 'https://undergocutlery.com/zqmeg0npik?key=9829517559c74ab7fd87b787ee036287'
  };
  const ADSTERRA_SOCIALBAR_POR_HOST = {
    'aquitemachadinhos.com.br': 'https://undergocutlery.com/a0/4b/ea/a04bea8f13eec4c1e3b87777107a3c6e.js',
    'solvegrid.com.br': 'https://undergocutlery.com/24/92/83/24928371ac3714c625a6644222607191.js',            // v128.5: SocialBar placement 31166085 (website 6042199) — código do painel
    'achadinhos-ad-engine.vercel.app': 'https://undergocutlery.com/65/0f/e1/650fe1ea8c40a70c29031a35f6ac5e49.js', // v128.5: SocialBar placement 31180418 (website 6044306) — código do painel; corrobora v112
    'nexusplataforma.ia.br': null            // PENDENTE: SocialBar placement 30879030 (website 6002104)
  };
  const HOST_REQ = String(headers['x-forwarded-host'] || headers['host'] || '').toLowerCase().replace(/^www\./, '');
  let TAG_ADSTERRA = null;   // v128: fail-closed — sem host próprio, sem tag
  let TAG_SOCIALBAR = null;
  for (const dom in ADSTERRA_POR_HOST) {
    if (HOST_REQ === dom || HOST_REQ.endsWith('.' + dom)) { TAG_ADSTERRA = ADSTERRA_POR_HOST[dom]; break; }
  }
  for (const dom in ADSTERRA_SOCIALBAR_POR_HOST) {
    if (HOST_REQ === dom || HOST_REQ.endsWith('.' + dom)) { TAG_SOCIALBAR = ADSTERRA_SOCIALBAR_POR_HOST[dom]; break; }
  }
  const TAG_BINDING = 'pop=' + (TAG_ADSTERRA ? 'bound' : 'none') + ';sb=' + (TAG_SOCIALBAR ? 'bound' : 'none');
  const DWELL_MS = 4000;
  const esc = (u) => String(u).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeTarget = esc(targetUrl);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Adsterra-Binding', TAG_BINDING);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(200).end('<!DOCTYPE html>\n<html lang="pt-BR"><head><meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<meta name="robots" content="noindex,nofollow">\n<meta http-equiv="refresh" content="6;url=' + safeTarget + '">\n<title>Redirecionando…</title>\n<style>\n body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}\n .b{max-width:640px;padding:26px}\n .s{width:34px;height:34px;margin:0 auto 16px;border:3px solid #2a2f3a;border-top-color:#4c8bf5;border-radius:50%;animation:r .9s linear infinite}\n @keyframes r{to{transform:rotate(360deg)}}\n a.go{display:inline-block;margin-top:14px;padding:11px 20px;background:#4c8bf5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}\n p{opacity:.75;font-size:14px}.tags{opacity:.5;font-size:11px;margin-top:20px}\n</style><link rel="preconnect" href="https://undergocutlery.com" crossorigin>\n<link rel="preconnect" href="https://quge5.com" crossorigin>\n<link rel="preconnect" href="https://6opo.com" crossorigin>\n<link rel="preconnect" href="https://auqot.com" crossorigin>\n<link rel="preconnect" href="https://ekhay.com" crossorigin>\n<link rel="preconnect" href="https://b3mny.com" crossorigin>\n<link rel="dns-prefetch" href="https://undergocutlery.com">\n<link rel="dns-prefetch" href="https://quge5.com">\n<link rel="dns-prefetch" href="https://6opo.com">\n<script>(function(){function T(src,zone){try{var s=document.createElement("script");s.src=src;s.async=true;s.setAttribute("data-cfasync","false");if(zone)s.setAttribute("data-zone",zone);(document.head||document.documentElement).appendChild(s)}catch(e){}}' + (TAG_ADSTERRA ? 'T(\'' + TAG_ADSTERRA + '\');' : '') + (TAG_SOCIALBAR ? 'T(\'' + TAG_SOCIALBAR + '\');' : '') + 'T("https://quge5.com/88/tag.min.js","274860");T("https://quge5.com/88/tag.min.js","278800");T("https://auqot.com/pfe/current/tag.min.js?z=11691068");T("https://ekhay.com/vignette.min.js?z=11691067");T("https://b3mny.com/tag.min.js?z=11691066");T("https://auqot.com/pfe/current/tag.min.js?z=11771440");T("https://ekhay.com/vignette.min.js?z=11771438");T("https://b3mny.com/tag.min.js?z=11771437");})();<\/script>\n</head><body>\n<div class="b">\n  <div class="s"></div>\n  <strong>Levando você à oferta…</strong>\n  <p>Se não avançar automaticamente, toque no botão.</p>\n  <a class="go" id="go" href="' + safeTarget + '" rel="nofollow noopener">Continuar para a oferta</a>\n  <noscript><p><a href="' + safeTarget + '" rel="nofollow noopener">Clique aqui para continuar</a></p></noscript>\n  <div class="tags">Ofertas verificadas • ' + site + ' • ' + country + ' • v128</div>\n</div>\n<script>(function(){var DEST=' + JSON.stringify(targetUrl) + ';var SITE="' + site + '";var COUNTRY="' + country + '";function load(src,zone,name){return new Promise(function(res){try{var s=document.createElement("script");s.src=src;s.async=true;s.setAttribute("data-cfasync","false");if(zone)s.setAttribute("data-zone",zone);s.onload=function(){res("ok")};s.onerror=function(){res("err")};document.body.appendChild(s)}catch(e){res("err")}})}var tags=[' + (TAG_ADSTERRA ? 'load(\'' + TAG_ADSTERRA + '\', null, \'adsterra_popunder\'),' : '') + (TAG_SOCIALBAR ? 'load(\'' + TAG_SOCIALBAR + '\', null, \'adsterra_socialbar\'),' : '') + 'load("https://quge5.com/88/tag.min.js","274860","monetag_274860"),load("https://quge5.com/88/tag.min.js","278800","monetag_278800")];if(Promise.allSettled)Promise.allSettled(tags);var goBtn=document.getElementById("go");if(goBtn){goBtn.addEventListener("click",function(){if(!TAG_ADSTERRA)return;try{var s=document.createElement("script");s.src=TAG_ADSTERRA;s.async=true;document.body.appendChild(s)}catch(e){}})}setTimeout(function(){try{location.replace(DEST)}catch(e){location.href=DEST}},' + DWELL_MS + ');})();<\/script>\n</body></html>');
};
