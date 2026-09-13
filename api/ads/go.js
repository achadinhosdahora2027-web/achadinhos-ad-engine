const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════════════════
// v330.0 — INVENTÁRIO SHOPEE REAL (701 ofertas exportadas do painel de afiliado)
// O arquivo data/shopee-offer-links.json é gerado por
// scripts/build-shopee-inventory.js a partir dos CSVs oficiais. Nada aqui é
// inventado: cada link é um short link s.shopee.com.br do próprio painel.
// ══════════════════════════════════════════════════════════════════════════════
let __SHOPEE_INV = null;
function getShopeeInventory() {
  if (__SHOPEE_INV !== null) return __SHOPEE_INV;
  const candidates = [
    path.join(process.cwd(), 'data', 'shopee-offer-links.json'),
    path.join(__dirname, '..', '..', 'data', 'shopee-offer-links.json')
  ];
  for (const f of candidates) {
    try { __SHOPEE_INV = JSON.parse(fs.readFileSync(f, 'utf8')); return __SHOPEE_INV; } catch (e) {}
  }
  __SHOPEE_INV = false; // falha fechado: sem inventário, cai no link genérico de marca
  return __SHOPEE_INV;
}
/** Resolve uma oferta Shopee por hash exato ou por keyword contida na consulta. */
function resolveShopeeOffer(query) {
  const inv = getShopeeInventory();
  if (!inv || !inv.offers) return null;
  const hash = String(query.offer || '').trim();
  if (hash && inv.offers[hash]) return { hash, ...inv.offers[hash], matched_by: 'offer' };
  const kwq = String(query.kw || query.q || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (!kwq) return null;
  if (inv.keywords[kwq] && inv.offers[inv.keywords[kwq]]) {
    return { hash: inv.keywords[kwq], ...inv.offers[inv.keywords[kwq]], matched_by: 'keyword_exata' };
  }
  // 1) chave mais longa contida na consulta = match mais específico
  let best = '';
  for (const k of Object.keys(inv.keywords)) {
    if (k.length > best.length && kwq.includes(k)) best = k;
  }
  if (best) return { hash: inv.keywords[best], ...inv.offers[inv.keywords[best]], matched_by: 'keyword_contida' };
  /* 1b) FORMA COMPACTA — v340.0: "powerbank" (uma palavra) precisa achar
     "Power Bank" e vice-versa. É normalização de escrita, não invenção: só casa
     quando as letras são IDÊNTICAS sem espaços, com no mínimo 6 caracteres. */
  const kwCompacto = kwq.replace(/\s+/g, '');
  if (kwCompacto.length >= 6) {
    let bestC = '';
    for (const k of Object.keys(inv.keywords)) {
      const kc = k.replace(/\s+/g, '');
      if (kc.length < 6) continue;
      if (kc === kwCompacto || kwCompacto.includes(kc) || kc.includes(kwCompacto)) {
        if (k.length > bestC.length) bestC = k;
      }
    }
    if (bestC) return { hash: inv.keywords[bestC], ...inv.offers[inv.keywords[bestC]], matched_by: 'keyword_compacta' };
  }
  // 2) fallback por n-grama: "kit higiene bebe" não casa com "kit higiene cuidados bebe"
  //    (a frase tem 'cuidados' no meio). Geramos as combinações da PRÓPRIA consulta e
  //    testamos da maior para a menor — assim a busca do grupo acha a oferta certa sem
  //    precisar adivinhar; se nenhuma combinação existir, cai no link genérico.
  const tokens = kwq.split(/\s+/).filter((t) => t.length > 1);
  for (let n = Math.min(4, tokens.length); n >= 2; n--) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n).join(' ');
      if (inv.keywords[gram]) return { hash: inv.keywords[gram], ...inv.offers[inv.keywords[gram]], matched_by: 'keyword_ngrama' };
    }
  }
  // 3) termo único forte (marca/modelo com número, ex.: '10000mah', 'tp link' já coberto acima)
  for (const t of tokens) {
    if (t.length >= 6 && inv.keywords[t]) return { hash: inv.keywords[t], ...inv.offers[inv.keywords[t]], matched_by: 'keyword_termo' };
  }
  // 4) conjunto de termos: em conversa real as palavras vêm fora de ordem e com
  //    palavras no meio ("kit higiene bebe" x "Kit Higiene Cuidados Bebe"). Aqui a
  //    consulta é comparada com o NOME de cada oferta e vence quem cobre mais termos
  //    (mínimo 2, para não casar em cima de uma palavra genérica só). Empate vai
  //    para a maior comissão — o melhor anúncio paga o clique.
  const fortes = tokens.filter((t) => t.length >= 4);
  if (fortes.length >= 2) {
    let melhor = null, melhorScore = 0;
    for (const [h, o] of Object.entries(inv.offers)) {
      if (!o.n) continue;
      const alvo = o.n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      let score = 0;
      for (const t of fortes) if (alvo.includes(t)) score++;
      if (score < 2) continue;
      const peso = score * 1000 + (o.c || 0);
      if (peso > melhorScore) { melhorScore = peso; melhor = { h, o, score }; }
    }
    if (melhor) return { hash: melhor.h, ...melhor.o, matched_by: `token_set_${melhor.score}` };
  }
  return null;
}
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
/* ══════════════════════════════════════════════════════════════════════════
   v340.0 — SOVEREIGN GEO-TARGETING CORE (regras medidas, não inventadas)
   ══════════════════════════════════════════════════════════════════════════
   1. TIER-1 EXCLUSIVO: Booking UK (15734754) e eBay Partner Network
      (campid 5339193749) só para US, CA, GB, DE, FR.
   2. TRAVA NACIONAL BR: visitante humano com IP brasileiro NUNCA sai para
      merchant em moeda estrangeira — recebe link curto rastreado da Shopee
      Brasil (catálogo real de até 83% de comissão) ou https://meli.la.
   3. SLOT DINÂMICO: a suborigem passa a ser a keyword REAL do produto que
      disparou o match + a arquitetura do user-agent (ex.: mop_desktop).
      A string sintética '_health_desktop' é recusada por regra.
   ══════════════════════════════════════════════════════════════════════════ */
const TIER1_CORE = Object.freeze(['US', 'CA', 'GB', 'DE', 'FR']);
const MOEDA_ESTRANGEIRA = Object.freeze([
  'booking', 'booking_uk', 'booking_latam', 'ebay', 'ebay_us', 'amazon', 'amazon_us',
  'aliexpress', 'udemy', 'nordvpn', 'economybookings', 'brunoyam'
]);
const HOSTS_MOEDA_ESTRANGEIRA = /(^|\.)(booking\.com|ebay\.(com|co\.uk|de|fr|it|es|ca|com\.au)|amazon\.(com|co\.uk|de|fr|es|it|ca)|aliexpress\.com|udemy\.com|nordvpn\.com|economybookings\.com|brunoyam\.com)$/i;
const HOSTS_CJ_FOREIGN = /(kqzyfj|jdoqocy|dpbolvw|anrdoezrs|tkqlhce)\.(com|net)/i;
const SLOTS_SINTETICOS = Object.freeze(['_health_desktop', 'health', '_health', 'health_desktop']);

/** Arquitetura do user-agent — a "flag" que entra no slot dinâmico. */
function arquiteturaUA(ua) {
  const s = String(ua || '').toLowerCase();
  if (!s || s.length < 20) return 'desconhecido';
  if (/bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|okhttp|libwww|httpclient|monitor|synthetic|lighthouse|pagespeed/.test(s)) return 'bot';
  if (/ipad|tablet/.test(s)) return 'tablet';
  if (/mobile|android|iphone/.test(s)) return 'mobile';
  return 'desktop';
}

/** Slug da keyword real (sem acento, só [a-z0-9] simples). */
function slugKeyword(txt) {
  return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/** Slot dinâmico: keyword real + arquitetura. Sintético é recusado. */
function slotDinamico_(keyword, ua) {
  const kw = slugKeyword(keyword);
  const arch = arquiteturaUA(ua);
  if (!kw || /^[0-9]+$/.test(kw) || SLOTS_SINTETICOS.includes(kw)) return `sem_keyword_${arch}`;
  return `${kw}_${arch}`;
}

/** O destino final é merchant de moeda estrangeira? */
function destinoMoedaEstrangeira(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (HOSTS_CJ_FOREIGN.test(host)) return true;      // redes CJ dos parceiros internacionais
    if (HOSTS_MOEDA_ESTRANGEIRA.test(host)) return true;
    return false;
  } catch (e) { return false; }
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
  /* v340.0 — IP REAL PRIMEIRO. Antes o parâmetro ?geo= vencia o cabeçalho e
     qualquer link (inclusive de robô ou de terceiro) forçava a rota do país que
     quisesse. Agora a ordem é: x-vercel-ip-country → cf-ipcountry → x-country-code
     → e só então o parâmetro, que fica reservado para teste explícito (?geoforce=1). */
  /* Ordem de confiança:
       1) DICA DE BORDA (geoforce=1) — quando quem chama é a NOSSA Pages Function,
          que já mediu o IP real do visitante em request.cf.country. Vence porque
          neste cenário o x-vercel-ip-country é o IP da CLOUDFLARE, não do leitor
          (medido em produção: o motor classificava todo mundo como US).
       2) IP REAL do visitante (x-vercel-ip-country → cf-ipcountry → x-country-code)
          para chamadas diretas do navegador.
       3) Parâmetro ?geo= só com GEO_PARAM_ALLOW=1 (teste controlado).
       4) Default BR (mercado principal). */
  const geoForcado = String(query.geoforce || '') === '1';
  const dicaBorda = geoForcado && geoOverride.length === 2 ? geoOverride : '';
  const country = (
    dicaBorda
    || headers['x-vercel-ip-country'] || headers['cf-ipcountry'] || headers['x-country-code']
    || (geoOverride.length === 2 && process.env.GEO_PARAM_ALLOW === '1' ? geoOverride : '')
    || 'BR'
  ).toUpperCase().substring(0, 2);
  const UA_RAW = String(headers['user-agent'] || '');
  const IS_BOT = !UA_RAW || /bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|go-http|okhttp|libwww|httpclient|facebookexternalhit|whatsapp|telegrambot|skytab|claude|gptbot|ccbot|anthropic|perplexity|bytespider|amazonbot|applebot|skywatch|healthcheck|canary\/|pubkyweb|friendica|akkoma|lightpanda|http\.rb|mastodon\/|pleroma|misskey|gotosocial|writefreely|nodebb|peertube|owncast|castopod|funkwhale|bookwyrm|hubzilla|iceshrimp|sharkey|calckey|firefish|fediverse|activitypub|webfinger|undici|node-fetch|axios|got\/|superagent|guzzle|restsharp|postman|insomnia|urllib|aiohttp|requests|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|dataforseo|lighthouse|pagespeed|pingdom|uptimerobot|lexicore|monitor|synthetic|mention_c|mention_ca|mention_car/i.test(UA_RAW) || UA_RAW.trim() === 'Mozilla/5.0' || UA_RAW.trim().length < 20;
  const device = detectDevice(headers['user-agent'] || '');
  /* sid inicial; é RECALCULADO depois que o slot dinâmico é resolvido — senão a
     suborigem sintética ('_health_desktop') viajaria dentro da tag de atribuição. */
  const sidExplicito = query.sid ? String(query.sid).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 60) : null;
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
  /* v340.0 — SWAP EXCLUSIVO TIER-1 (US, CA, GB, DE, FR). Fora desse núcleo não
     há desvio para Booking UK: a rota regional assumida é a do bloco abaixo. */
  if (brandKey === 'booking') {
    if (TIER1_CORE.includes(country)) brandKey = 'booking_uk';
    else if (REGIONS.LATAM.includes(country) && country !== 'BR') brandKey = 'booking_latam';
    /* sem 'else booking_uk': era exatamente esse o ralo internacional aberto */
  }
  // v330.0 — inventário Shopee real tem prioridade sobre o short link genérico.
  // Só em BR (a oferta é do painel Shopee Brasil); fora do BR o geo-swap existente
  // continua mandando para aliexpress/booking.
  let shopeeHit = null;
  if (!targetUrl && country === 'BR' && (brandKey === 'shopee' || query.offer || query.kw || query.q)) {
    shopeeHit = resolveShopeeOffer(query);
    if (shopeeHit && shopeeHit.u) {
      targetUrl = shopeeHit.u;
      brandKey = 'shopee';
    }
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
  /* ══════════════════════════════════════════════════════════════════════════
     v340.0 — TRAVA NACIONAL DE TRÁFEGO (Brasil / humano / moeda nativa)
     Se o visitante é humano e veio do Brasil, o destino NÃO pode ser merchant
     de moeda estrangeira. Troca-se pelo link curto rastreado da Shopee Brasil
     (oferta real do catálogo quando houver keyword) ou meli.la. O bot não é
     afetado: rastreador não compra e não deve consumir cota de parceiro.
     ══════════════════════════════════════════════════════════════════════════ */
  let brLock = country === 'BR' ? (IS_BOT ? 'br_bot' : 'br_humano') : 'nao_br';
  let brLockMotivo = null;
  if (country === 'BR' && !IS_BOT) {
    const trocar = MOEDA_ESTRANGEIRA.includes(brandKey) || destinoMoedaEstrangeira(targetUrl);
    if (trocar) {
      const antigo = targetUrl;
      const ofertaShopee = (typeof shopeeHit !== 'undefined' && shopeeHit && shopeeHit.u) || null;
      if (ofertaShopee) {
        targetUrl = ofertaShopee; brandKey = 'shopee'; brLockMotivo = 'oferta_catalogo_shopee';
      } else if (query.q || query.kw || query.keyword) {
        const achou = resolveShopeeOffer(query);
        if (achou && achou.u) { targetUrl = achou.u; brandKey = 'shopee'; brLockMotivo = 'busca_catalogo_shopee'; }
      }
      if (!brLockMotivo) {
        targetUrl = VERIFIED_TARGETS.mercadolivre || 'https://meli.la/1U3rtgV';
        brandKey = 'mercadolivre'; brLockMotivo = 'meli_la_fallback';
      }
      brLock = 'aplicada';
      try {
        console.log(JSON.stringify({ v: 'v340.0', br_lock: brLockMotivo, de: String(antigo).slice(0, 90), para: String(targetUrl).slice(0, 90), country }));
      } catch (e) {}
    } else {
      brLock = 'nativa';
    }
  }
  /* Slot dinâmico: keyword real + arquitetura do UA (nunca slot sintético). */
  const keywordDoClique = String(query.q || query.kw || query.keyword || (typeof shopeeHit !== 'undefined' && shopeeHit && shopeeHit.n) || '').slice(0, 120);
  const slotDinamico2 = slotDinamico_(keywordDoClique, headers['user-agent']);
  /* Regra de precedência da suborigem:
       1) keyword REAL do produto que disparou o match  → <keyword>_<arquitetura>
       2) slot sintético (_health_desktop/health)       → descartado, usa dinâmico
       3) slot declarado pelo próprio link da campanha  → mantido (atribuição do CTA)
     O slot original nunca é perdido: vai em slot_origem para auditoria. */
  const slotLink = String(query.slot || '').trim();
  const slotEhSintetico = SLOTS_SINTETICOS.includes(slotLink.toLowerCase());
  const slotFinal = keywordDoClique ? slotDinamico2
                  : (slotEhSintetico ? slotDinamico2 : (slotLink || slotDinamico2));
  /* sid final: tag do destino (explicita) ou derivada com o SLOT DINÂMICO */
  const sid = sidExplicito || `${site}_${country.toLowerCase()}_${String(slotFinal).slice(0, 40)}_${device}`;
  const sidTag = String(sid).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 60);

  try {
    if (!NON_MONETIZED.has(brandKey)) {
      const urlObj = new URL(targetUrl);
      urlObj.searchParams.set('sid', sidTag);
      urlObj.searchParams.set('aff_sub', sidTag);
      urlObj.searchParams.set('aff_sub2', country);
      urlObj.searchParams.set('subid', sidTag);
      urlObj.searchParams.set('subid1', country);
      urlObj.searchParams.set('subId1', sidTag);
      if (urlObj.hostname.includes('shopee')) urlObj.searchParams.set('sub_id', sidTag);
      if (urlObj.hostname.includes('ebay')) urlObj.searchParams.set('customid', sidTag);
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
          slot: String(slotFinal || '').slice(0, 120) || null,
          ad_id: String((typeof shopeeHit !== 'undefined' && shopeeHit && shopeeHit.hash) || brandKey || '').slice(0, 80) || null,
          network: net,
          click_url: String(targetUrl).slice(0, 500),
          click_ref: String(sidTag || '').slice(0, 120),
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

  // ── v330.0 — FILA UNLOGGED (public.nexus_telegram_message_buffer) ──────────
  // Clique HUMANO legítimo entra na fila; o cron 'tg-flush' entrega em blocos de
  // 18/min ao grupo privado (evita HTTP 429). Robô/crawler não entra na fila.
  // Falha aqui NUNCA afeta o visitante: timeout curto e erro engolido (0ms).
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    const bufferChat = process.env.TELEGRAM_BUFFER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;
    /* v336.0 — o clique agora vai para o FAN-OUT: quem resolve os destinos é o flush
       (registro data/telegram-destinations.json). O bufferChat deixou de ser
       pré-requisito: exigí-lo aqui era o que silenciava os grupos quando a variável
       não estava no painel da Vercel. */
    let destinosClique = 0;
    try { destinosClique = require('../../lib/telegram/fanout').destinationsFor('clicks').length; } catch (e) { destinosClique = 0; }
    // Diagnóstico observável: X-Buffer-Enqueued diz se o clique entrou na fila e,
    // se não entrou, exatamente qual peça de configuração faltou.
    // Tráfego SINTÉTICO não entra na fila: sem isso o próprio health-check do CI
    // (que chama o gateway 21 marcas × 5 tags com UA de navegador) enchia a fila
    // com cliques que nunca existiram — 40 linhas pendentes observadas na prática.
    const ehTeste = String(query.noint || '') === '1' || slot.startsWith('health') || String(query.monitor || '') === '1';
    res.setHeader('X-Buffer-Enqueued', !sbUrl ? 'sem_supabase_url'
      : (!sbKey ? 'sem_supabase_key'
        : (IS_BOT ? 'ignorado_bot' : (ehTeste ? 'ignorado_sintetico' : 'sim_fanout_' + destinosClique))));
    res.setHeader('X-Telegram-Destinos', String(destinosClique));
    if (sbUrl && sbKey && !IS_BOT && !ehTeste) {
      // OBS: precisa ser AGUARDADO. Sem await, a Vercel encerra a função assim que
      // a resposta sai e o INSERT é morto no meio — o clique nunca entrava na fila
      // (o header dizia 'sim' e o banco ficava vazio). Teto curto de 800ms: se o
      // banco estiver lento, seguimos sem a linha e o visitante não espera mais.
      const ctrl2 = new AbortController();
      const tmr2 = setTimeout(() => ctrl2.abort(), 800);
      const agora = new Date().toISOString();
      await fetch(`${sbUrl.replace(/\/$/, '')}/rest/v1/nexus_telegram_message_buffer`, {
        method: 'POST',
        headers: {
          apikey: sbKey, Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json', Prefer: 'return=minimal'
        },
        body: JSON.stringify([{
          dedupe_key: `click:${sidTag}:${(shopeeHit && shopeeHit.hash) || brandKey}:${agora.slice(0, 16)}`,
          /* v336.0 — FAN-OUT: em vez de um único chat (era o privado do admin, e os
             grupos não recebiam nada), a linha vai para 'fanout'. O flush do cron
             entrega uma cópia por destino ativo, cada uma com a TAG do grupo no
             link de afiliado (site=<tag> → utm_content/subid/customid). */
          chat_id: 'fanout',
          body_text: `🖱️ <b>Clique</b> ${String(brandKey || '')} | ${String(country || '')}\n`
            + `tag: <code>${String(sidTag || '').slice(0, 60)}</code>\n`
            + `slot: <code>${String(slotFinal || '')}</code> | ${IS_BOT ? 'bot' : 'humano'}`
            + (brLock === 'aplicada' ? `\n🔒 trava BR: moeda estrangeira bloqueada (${brLockMotivo})` : ''),
          parse_mode: 'HTML',
          payload: {
            tipo: 'clique', kind: 'clicks', fanout: true, brand: brandKey, country, sid: sidTag,
            slot: slotFinal, slot_dinamico: Boolean(keywordDoClique), slot_origem: slotLink || null,
            keyword: keywordDoClique || null, arquitetura: arquiteturaUA(headers['user-agent']),
            br_lock: brLock, br_lock_motivo: brLockMotivo,
            site, oferta: (shopeeHit && shopeeHit.hash) || null,
            base_link: String(targetUrl || '').slice(0, 300), em: agora
          },
          status: 'pending', attempts: 0, max_attempts: 3
        }]),
        signal: ctrl2.signal
      }).then((r) => res.setHeader('X-Buffer-Enqueued', r.ok ? 'sim_confirmado' : 'sim_http_' + r.status))
        .catch((e) => res.setHeader('X-Buffer-Enqueued', 'sim_falhou_' + String(e.name || e).slice(0, 18)));
      clearTimeout(tmr2);
    }
  } catch (e) {}

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Affiliate-Engine', 'Achadinhos-Global-Gateway-2026-v340');
  res.setHeader('X-Br-Lock', brLock);
  if (brLockMotivo) res.setHeader('X-Br-Lock-Motivo', brLockMotivo);
  res.setHeader('X-Slot-Dinamico', String(slotFinal || ''));
  res.setHeader('X-Tier1-Core', TIER1_CORE.join(','));
  res.setHeader('X-Geo-Fonte', dicaBorda ? 'dica_borda' : (headers['x-vercel-ip-country'] ? 'ip_real_vercel' : headers['cf-ipcountry'] ? 'ip_real_cf' : 'default'));
  res.setHeader('X-Routed-Country', country);
  res.setHeader('X-Routed-Brand', brandKey);
  if (shopeeHit) {
    res.setHeader('X-Shopee-Offer', shopeeHit.hash);
    res.setHeader('X-Shopee-Store', String(shopeeHit.s || '').slice(0, 60));
    res.setHeader('X-Shopee-Match', shopeeHit.matched_by || 'offer');
  }
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
