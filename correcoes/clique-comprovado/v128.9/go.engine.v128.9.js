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
  /* ══ v128.9 SUBORIGEM REAL ═══════════════════════════════════════════════
     Slot genérico de campanha (jetstream_v330, header, inline, health…) não
     identifica produto nenhum. Quando o link traz a oferta ou a palavra-chave,
     a suborigem passa a ser o NOME REAL do produto + arquitetura — é isso que
     aparece no relatório e no painel da rede. Slot de CTA declarado
     (ex.: city_ananindeua_flights) continua preservado: ali a atribuição é do
     botão, não do produto. */
  const SLOT_GENERICO = /^(jetstream|header|inline|health|sem_keyword|radar|city|ci|lab|fanout|digest|v\d{2,3})/i;
  let nomeOferta = '';
  try {
    const hOferta = String(query.offer || query.oferta || '').trim();
    if (hOferta) {
      const inv = (typeof getShopeeInventory === 'function') ? getShopeeInventory() : null;
      if (inv && inv.offers && inv.offers[hOferta] && inv.offers[hOferta].n) nomeOferta = String(inv.offers[hOferta].n);
    }
  } catch (e) { nomeOferta = ''; }
  if (!nomeOferta) nomeOferta = String(query.kw || query.q || query.keyword || '').trim();
  const slotGenerico = SLOT_GENERICO.test(String(query.slot || 'header'));
  const keywordDoClique = ((slotGenerico && nomeOferta) ? nomeOferta
    : String(query.q || query.kw || query.keyword || (typeof shopeeHit !== 'undefined' && shopeeHit && shopeeHit.n) || '')).slice(0, 120);
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
  /* v128.9: quando a suborigem é a palavra-chave real, o slot dinâmico JÁ traz
     a arquitetura no fim (`<produto>_mobile`). Anexar o device de novo gerava
     `..._mobile_mobile` (medido). Só acrescenta se ainda não estiver lá. */
  const slotParaSid = String(slotFinal).slice(0, 40);
  const sid = sidExplicito || `${site}_${country.toLowerCase()}_${slotParaSid}${slotParaSid.toLowerCase().endsWith(String(device).toLowerCase()) ? '' : '_' + device}`;
  const sidTag = String(sid).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 60);

  /* ══ v128.7 GATE HUMANO ══════════════════════════════════════════════════
     Medido em 13/09/2026: 45.025 cliques em 7 dias, nenhum com Accept-Language.
     Nenhum navegador deixa de enviar esse cabeçalho — script de varredura deixa.
     Tráfego sintético não conta clique, não recebe anúncio e não é repassado à
     rede de afiliado (protege as contas de tráfego inválido). */
  const SEM_IDIOMA = !String(headers['accept-language'] || '').trim();
  const SID_SENTINELA = /(health|sem_keyword|linkcheck|_audit|audit_|watchdog|monitor|uptime|keepalive|swarm|sentinela|sentinel|smoke|_test|test_)/i.test(sidTag);
  const PROBE_EXPLICITO = String(query.probe || '') === '1';
  const NOINT_EXPLICITO = String(query.noint || '') === '1';
  const MOTIVO_SINTETICO = IS_BOT ? 'ua_robot'
    : PROBE_EXPLICITO ? 'probe_explicito'
    : SID_SENTINELA ? 'suborigem_sentinela'
    : SEM_IDIOMA ? 'sem_accept_language'
    : NOINT_EXPLICITO ? 'noint_explicito'
    : null;
  const SINTETICO = MOTIVO_SINTETICO !== null;
  const NEUTRO = 'https://achadinhos-ad-engine.vercel.app/api/ads/status';

  /* ── v128.8 CLIQUE COMPROVADO ────────────────────────────────────────────
     O GET do link não grava mais clique. O clique passa a ser avisado pelo
     próprio intersticial (beacon), depois de a página carregar e de a tag de
     anúncio resolver. Duas travas no servidor:
       1) gate humano (v128.7) — robô sem Accept-Language nem chega aqui;
       2) GESTO_HUMANO — 'Sec-Fetch-User: ?1' só existe quando a navegação foi
          iniciada por gesto do usuário. page.goto() de frota automatizada não
          manda esse cabeçalho (medido nos 45.025 cliques de robô).
     Sem token, o beacon não tem o que enviar → frota que só faz GET não conta. */
  const SEGREDO_CLIQUE = String(process.env.NEXUS_CLICK_SECRET || process.env.CLICKS_DB_KEY || '');
  const GESTO_HUMANO = String(headers['sec-fetch-user'] || '') === '?1';
  const CONTA_CLIQUE = !SINTETICO && GESTO_HUMANO && SEGREDO_CLIQUE.length > 0;
  /* Tag de anúncio: depende só de origem humana com gesto (não do segredo do
     clique). Frota que só faz GET nunca recebe anúncio; falta de segredo só
     impede CONTAR o clique, nunca serve anúncio a robô. */
  const MOSTRAR_TAGS = !SINTETICO && GESTO_HUMANO;
  let TOKEN_CLIQUE = '';
  if (CONTA_CLIQUE) {
    try {
      const payload = Buffer.from(JSON.stringify({
        s: site, sl: slotFinal, c: country, b: brandKey, sd: sidTag,
        d: String(targetUrl || '').slice(0, 400), t: Date.now(),
        n: require('crypto').randomBytes(9).toString('hex')
      })).toString('base64url');
      const mac = require('crypto').createHmac('sha256', SEGREDO_CLIQUE).update(payload).digest('base64url').slice(0, 32);
      TOKEN_CLIQUE = payload + '.' + mac;
    } catch (e) { TOKEN_CLIQUE = ''; }
  }

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
  /* v128.8 — o INSERT em ads_clicks saiu daqui: o GET do link não grava mais
     clique (era assim que 45.025 cliques de robô entraram em 7 dias). Quem grava
     agora é /api/ads/click, chamado pelo intersticial com token assinado. */
  // ── v330.0 — FILA UNLOGGED (public.nexus_telegram_message_buffer) ──────────
  // Clique HUMANO legítimo entra na fila; o cron 'tg-flush' entrega em blocos de
  // 18/min ao grupo privado (evita HTTP 429). Robô/crawler não entra na fila.
  // Falha aqui NUNCA afeta o visitante: timeout curto e erro engolido (0ms).
  /* v128.8 — o aviso no Telegram saiu daqui pelo mesmo motivo do banco: quem
     enfileira é /api/ads/click, e só com clique comprovado. O que o visitante
     recebe continua idêntico (intersticial + destino). */
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
  res.setHeader('X-Nexus-Traffic', SINTETICO ? ('synthetic:' + MOTIVO_SINTETICO) : 'human');
  res.setHeader('X-Nexus-Counted', SINTETICO ? '0' : '1');
  res.setHeader('X-Nexus-Tags', MOSTRAR_TAGS ? 'servidas' : 'suprimidas_origem_nao_comprovada');
  res.setHeader('X-Nexus-Click-Token', TOKEN_CLIQUE ? 'emitido' : (SINTETICO ? 'nao_sintetico' : (GESTO_HUMANO ? 'sem_segredo' : 'sem_gesto_humano')));
  const WANT_INT = !SINTETICO && !NOINT_EXPLICITO;
  if (!WANT_INT) {
    /* Robô e diagnóstico não vão para a rede de afiliado: destino neutro nosso.
       O ?noint=1 do operador mantém o destino real para permitir a verificação
       do link (mas continua sem contar clique e sem servir anúncio). */
    const destinoSaida = (SINTETICO && !NOINT_EXPLICITO) || PROBE_EXPLICITO ? NEUTRO : targetUrl;
    res.setHeader('Location', destinoSaida);
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
  // ══════════════════════════════════════════════════════════════════════════
  // v128.6 — INTERSTICIAL CORRIGIDO (medido em Chromium real, 13/09/2026)
  // Antes: Direct Link injetado como <script> (200 · 0 byte = nada exibido) e
  // handler do clique com ReferenceError (a variável só existia no servidor).
  // Painel Adsterra: 0 impressões. Agora: Direct Link é ABERTO no gesto do
  // visitante (uso correto), SocialBar entra como script real do painel e o
  // referer é preservado por origem (a CDN recusa pedido sem referer).
  // ══════════════════════════════════════════════════════════════════════════
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const DIAG = String(query.diag || '') === '1';
  const DWELL = DIAG ? 900000 : DWELL_MS;   // diag: fica na pagina para a leitura ser visivel
  const jstr = (v) => JSON.stringify(v === undefined ? null : v)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const html = [
    '<!DOCTYPE html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex,nofollow">',
    (DIAG ? '<!-- diag: sem redirecionamento automatico -->' : '<meta http-equiv="refresh" content="6;url=' + safeTarget + '">'),
    '<title>Redirecionando…</title>',
    '<style>',
    ' body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}',
    ' .b{max-width:640px;padding:26px}',
    ' .s{width:34px;height:34px;margin:0 auto 16px;border:3px solid #2a2f3a;border-top-color:#4c8bf5;border-radius:50%;animation:r .9s linear infinite}',
    ' @keyframes r{to{transform:rotate(360deg)}}',
    ' a.go{display:inline-block;margin-top:14px;padding:11px 20px;background:#4c8bf5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}',
    ' p{opacity:.75;font-size:14px}.tags{opacity:.5;font-size:11px;margin-top:20px}',
    '</style>',
    '<link rel="preconnect" href="https://undergocutlery.com" crossorigin>',
    '<link rel="preconnect" href="https://quge5.com" crossorigin>',
    '<link rel="dns-prefetch" href="https://undergocutlery.com">',
    '<link rel="dns-prefetch" href="https://quge5.com">',
    '<script>',
    'window.__nexusAds={socialbar:"ausente",popunder:"ocioso",aberto:0,destino:' + jstr(targetUrl) + '};',
    '(function(){',
    ' var TAG_POPUNDER=' + jstr(MOSTRAR_TAGS ? TAG_ADSTERRA : '') + ';',
    ' var TAG_SOCIALBAR=' + jstr(MOSTRAR_TAGS ? TAG_SOCIALBAR : '') + ';',
    ' window.__nexusAds.host=' + jstr(HOST_REQ) + ';',
    // 1) SocialBar: este SIM é um script do painel — formato <script src>.
    ' if(TAG_SOCIALBAR){try{var s=document.createElement("script");s.src=TAG_SOCIALBAR;s.async=true;s.setAttribute("data-cfasync","false");',
    ' s.onload=function(){window.__nexusAds.socialbar="carregou"};s.onerror=function(){window.__nexusAds.socialbar="falhou"};',
    ' (document.head||document.documentElement).appendChild(s);}catch(e){window.__nexusAds.socialbar="erro"}}',
    // 2) Direct Link: NÃO é script. Abre em nova aba, UMA vez, no gesto do visitante.
    //    Um único mecanismo (âncora com target=_blank): window.open(url,"_blank","noopener")
    //    retorna null por especificação e abria DUAS abas (medido 13/09). Trava de sessão
    //    garante no máximo um popunder por visitante, como exige a política da rede.
    ' var jaAbriu=false;',
    ' try{jaAbriu=(sessionStorage.getItem("nexus_pop")==="1");}catch(e){}',
    ' window.__abrirPopunder=function(){',
    '  if(jaAbriu||!TAG_POPUNDER)return false;jaAbriu=true;',
    '  try{sessionStorage.setItem("nexus_pop","1");}catch(e){}',
    '  try{var a=document.createElement("a");a.href=TAG_POPUNDER;a.target="_blank";a.rel="noopener noreferrer";',
    '   a.style.display="none";(document.body||document.documentElement).appendChild(a);a.click();',
    '   window.__nexusAds.popunder="abriu";window.__nexusAds.aberto=1;}',
    '  catch(e){window.__nexusAds.popunder="bloqueado";}return true;};',
    ' ["pointerdown","touchstart","mousedown","keydown"].forEach(function(ev){',
    '  document.addEventListener(ev,function(){window.__abrirPopunder();},{once:true,passive:true});});',
    '})();',
    '</scr' + 'ipt>',
    '</head><body>',
    '<div class="b">',
    '  <div class="s"></div>',
    '  <strong>Levando você à oferta…</strong>',
    '  <p>Se não avançar automaticamente, toque no botão.</p>',
    '  <a class="go" id="go" href="' + safeTarget + '" rel="nofollow noopener">Continuar para a oferta</a>',
    '  <noscript><p><a href="' + safeTarget + '" rel="nofollow noopener">Clique aqui para continuar</a></p></noscript>',
    '  <div class="tags">Ofertas verificadas • ' + esc(site) + ' • ' + esc(country) + ' • v128.8' + (DIAG ? ' • modo diagnóstico' : '') + '</div>',
    '</div>',
    '<script>',
    '(function(){var DEST=' + jstr(targetUrl) + ';',
    ' var goBtn=document.getElementById("go");',
    ' if(goBtn)goBtn.addEventListener("click",function(){try{window.__abrirPopunder();}catch(e){}});',
    ' setTimeout(function(){try{location.replace(DEST)}catch(e){location.href=DEST}},' + DWELL + ');})();',
    // v128.8 — clique comprovado: avisa o servidor SÓ quando a página carregou,
    // a tag de anúncio resolveu e a aba está visível. Token de uso único.
    ' var TOKEN_CLIQUE=' + jstr(TOKEN_CLIQUE) + ';',
    ' var jaAvisou=false;',
    ' function avisarClique(){',
    '  if(jaAvisou||!TOKEN_CLIQUE)return;',
    '  try{if(navigator.webdriver)return;}catch(e){}',
    '  if(document.visibilityState!=="visible")return;',
    '  jaAvisou=true;',
    '  var url="/api/ads/click?t="+encodeURIComponent(TOKEN_CLIQUE)+"&a="+encodeURIComponent(window.__nexusAds.socialbar);',
    '  try{navigator.sendBeacon(url,new Blob([""],{type:"text/plain"}));}',
    '  catch(e){try{fetch(url,{keepalive:true,mode:"no-cors"});}catch(_){}}',
    ' }',
    ' setTimeout(avisarClique,1500);',
    ' document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")setTimeout(avisarClique,300);});',
    // modo diagnóstico: &diag=1 mostra na tela o resultado real das tags
    ' if(' + jstr(String(query.diag || '')) + '==="1"){setTimeout(function(){var d=document.createElement("div");',
    '  d.style.cssText="position:fixed;left:0;right:0;bottom:0;background:#000c;color:#0f0;font:11px monospace;padding:8px;z-index:99999";',
    '  d.textContent="tags: "+JSON.stringify(window.__nexusAds);document.body.appendChild(d);},2500);}',
    '</scr' + 'ipt>',
    '</body></html>'
  ].join('\n');
  return res.status(200).end(html);
};
