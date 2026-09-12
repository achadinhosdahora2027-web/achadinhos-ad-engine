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

// Valores de site= que NÃO identificam um website (usados por bio/tags/JS compartilhados entre os 3 sites).
const GENERIC_SITE_PARAMS = new Set(['bio_link', 'tag_seo', 'exit_drawer', 'sticky_mobile', 'vip_club', 'wheel', 'health', 'audit', 'auto', '']);

// Site real a partir do host de origem (Referer/Origin). Retorna '' se não der para saber.
function siteFromReferer(headers) {
  const ref = String((headers && (headers.referer || headers.origin)) || '');
  let host = '';
  try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return ''; }
  if (host.includes('nexusplataforma') || host.startsWith('nexus')) return 'nexus';
  if (host.includes('solvegrid')) return 'solvegrid';
  if (host.includes('aquitemachadinhos')) return 'aquitemachadinhos';
  return '';
}

// PID CJ do website. Regra: site= explícito (nexus*/solvegrid*/aquitem*) vence; se for genérico
// (bio_link, tag_seo, exit_drawer...) usa o host de origem; senão o padrão (aquitem).
function resolveCjPid(site, headers) {
  let s = String(site || '').toLowerCase();
  if (GENERIC_SITE_PARAMS.has(s) || !(s.startsWith('nexus') || s.startsWith('solvegrid') || s.startsWith('aquitem'))) {
    s = siteFromReferer(headers) || s;
  }
  if (s.startsWith('nexus')) return CJ_PIDS.nexus;
  if (s.startsWith('solvegrid')) return CJ_PIDS.solvegrid;
  return CJ_PIDS[CJ_DEFAULT_SITE];
}

// Links CJ = Evergreen/Text links REAIS dos programas joined (validados via Link Search API).
// {PID} é substituído em tempo de execução pelo PID do site de origem.
const CJ_LINKS = {
  booking: "https://www.kqzyfj.com/click-{PID}-17293138",
  voo: "https://www.anrdoezrs.net/click-{PID}-17323048",
  carla: "https://www.anrdoezrs.net/click-{PID}-17094338",
  nordvpn: "https://www.anrdoezrs.net/click-{PID}-13914989",
  nordpass: "https://www.dpbolvw.net/click-{PID}-17262576",
  surfshark: "https://www.tkqlhce.com/click-{PID}-15736773",
  // Shopee: shortlink 9pG4O5hX8q morto (shope.ee/error_page em 03/09/2026). 30n7ohzzU6 e o unico shortlink
  // valido no projeto (afiliado an_18336420850). Gerar shortlink de home/ofertas no portal Shopee Afiliados.
  shopee: "https://s.shopee.com.br/30n7ohzzU6",
  mercadolivre: "https://meli.la/1U3rtgV",
  // eBay Partner Network (campanha 5339193749). /deals resolve p/ bots e users; campid rastreia a campanha.
  ebay: "https://www.ebay.com/deals?campid=5339193749&toolid=10001&mkevt=1&mkcid=1&mkrid=711-53200-19255-0",
  amazon: "https://amazon.com.br/?tag=aquitemachadinhos-20",
  amazon_us: "https://www.amazon.com/?tag=aquitemachadinhos-20",
  udemy: "https://www.udemy.com/courses/search/?src=ukw&q=",
  // faculdade-interativa: projeto ENCERRADO/EXCLUÍDO 08/09 — CTAs de cursos vão p/ Udemy (não-monetizado)
  faculdade: "https://www.udemy.com/courses/search/?src=ukw&q=",
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

// Marcas sem programa de afiliados ativo na conta (trafego sem comissao). Udemy: nao existe na CJ.
const NON_MONETIZED = new Set(['udemy', 'brunoyam', 'safetywing', 'thefork', 'wise', 'faculdade']);

module.exports = async (req, res) => {
  const brandCatalog = getBrandCatalog();
  const query = req.query || {};
  const headers = req.headers || {};
  let brandKey = (query.brand || query.b || '').toLowerCase().trim();
  // site= ausente ou genérico → tenta descobrir pelo host de origem; senão padrão aquitem.
  let site = String(query.site || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!site || GENERIC_SITE_PARAMS.has(site)) site = siteFromReferer(headers) || site || 'aquitemachadinhos';
  const slot = (query.slot || 'header').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const rawDest = query.dest || query.url || query.u;
  
  // Extract geo country
  // v195: PRECEDENCIA DO GEO — override explicito vem PRIMEIRO.
  // Medido em 11/09: a Vercel SEMPRE injeta x-vercel-ip-country com o IP do
  // requisitante, e como ele vinha primeiro na cadeia, `?geo=` era inalcancavel:
  // GB/DE/BR/PT liam todos "US". Consequencia real: o roteamento geografico
  // ficava NAO-AUDITAVEL (impossivel provar que BR vai para a loja nacional) e
  // qualquer teste de QA por pais era impossivel.
  // `?geo=` agora tem prioridade; na ausencia dele o header real do CDN manda,
  // exatamente como antes para o trafego organico.
  const geoOverride = String(query.geo || query.country || '')
    .toUpperCase().replace(/[^A-Z]/g, '').substring(0, 2);
  const country = (
    (geoOverride.length === 2 ? geoOverride : '') ||
    headers['x-vercel-ip-country'] ||
    headers['cf-ipcountry'] ||
    headers['x-country-code'] ||
    'BR'
  ).toUpperCase().substring(0, 2);

  // v113 FIX C3/A1: classificacao de BOT. Antes disto NENHUM clique era
  // marcado como bot (device_type so tinha mobile/desktop) e 52% da base de
  // ads_clicks era bot -- inclusive o SkytabBot (URL Resolution), que faz
  // prefix-scan da querystring e criava 11 variantes truncadas de 'mention_care'.
  const UA_RAW = String(headers['user-agent'] || '');
  const IS_BOT = !UA_RAW || /bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|go-http|okhttp|libwww|httpclient|facebookexternalhit|whatsapp|telegrambot|skytab|claude|gptbot|ccbot|anthropic|perplexity|bytespider|amazonbot|applebot|skywatch|healthcheck|canary\/|pubkyweb|friendica|akkoma|lightpanda|http\.rb|mastodon\/|pleroma|misskey|gotosocial|writefreely|nodebb|peertube|owncast|castopod|funkwhale|bookwyrm|hubzilla|iceshrimp|sharkey|calckey|firefish|fediverse|activitypub|webfinger|undici|node-fetch|axios|got\/|superagent|guzzle|restsharp|postman|insomnia|urllib|aiohttp|requests|scrapy|semrush|ahrefs|mj12|dotbot|petalbot|dataforseo|lighthouse|pagespeed|pingdom|uptimerobot|lexicore|monitor|synthetic/i.test(UA_RAW)
    // v113.2: UA generico demais tambem e bot (ex.: 'Mozilla/5.0' nu, 'node', 'mint/1.9.3').
    || UA_RAW.trim() === 'Mozilla/5.0' || UA_RAW.trim().length < 20;

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

  // v126.2: CORRECAO DE GEO PARA AMAZON.
  // Medido: 489 de 490 cliques que caiam em amazon.com.br vinham de FORA do
  // Brasil (297 US, 185 FR...). A Amazon BR nao converte para esse publico —
  // o visitante cai numa loja em portugues que nao entrega no pais dele, e a
  // venda simplesmente nao acontece. O roteador por slot ja acertava; o furo
  // era 'brand=amazon' EXPLICITO, que ignorava o pais. Aqui o brand explicito
  // passa a respeitar a geografia: so BR (e PT) segue para amazon.com.br.
  // v185: MARCAS FANTASMA DAS IAs. Medido em producao 11/09: as IAs de reply
  // publicaram 212x 'brand=voo' e 158x 'brand=carla' — nenhuma existe no
  // catalogo, e o fail-closed jogava o clique na HOME (clique gasto, zero
  // chance de venda). 370 de 2.145 links publicados em 48h = 17% desperdicados.
  // Mapeamento para o destino real da intencao, respeitando geo.
  if (brandKey === 'voo' || brandKey === 'flight' || brandKey === 'voos') {
    brandKey = 'booking';           // intencao de viagem -> Booking (geo-swap adiante)
  } else if (brandKey === 'carla' || brandKey === 'car' || brandKey === 'aluguel') {
    brandKey = 'economybookings';   // intencao de carro -> EconomyBookings (CJ ativo)
  }

  if (brandKey === 'amazon' && country !== 'BR' && country !== 'PT') {
    brandKey = 'amazon_us';
  }

  // v195: MARKETPLACE NACIONAL SO PARA QUEM RECEBE A ENTREGA.
  // Mesmo furo que a Amazon tinha (corrigido na v126.2): o roteador por SLOT ja
  // protegia (linha ~172: country==='BR' ? shopee : aliexpress), mas o brand
  // EXPLICITO `?brand=shopee` ignorava o pais. Um visitante de US/GB/DE caia na
  // Shopee Brasil, que nao entrega no pais dele — carrinho abandonado garantido.
  // Fora de BR/PT o equivalente global e o AliExpress (mesmo perfil de catalogo,
  // frete internacional real).
  if ((brandKey === 'shopee' || brandKey === 'mercadolivre')
      && country !== 'BR' && country !== 'PT') {
    brandKey = 'aliexpress';
  }

  // v200: clickbus e rodoviaria EXCLUSIVAMENTE brasileira (clickbus.com.br).
  // Medido: 5 cliques em 7d, 4 deles de FORA do BR — o visitante gringo caia
  // numa passagem de onibus interestadual do Brasil. Volume baixo, mas e o
  // mesmo defeito de entrega das v126.2/v195. Fora de BR/PT vira booking
  // (intencao de transporte/viagem), que o geo-swap adiante regionaliza.
  if (brandKey === 'clickbus' && country !== 'BR' && country !== 'PT') {
    brandKey = 'booking';
  }

  let targetUrl = '';

  // v205.1: cjPid PRECISA existir antes do bloco ?oferta= (que o usa para
  // reescrever o PID). Na v205 ele era declarado depois -> ReferenceError
  // silenciado pelo try/catch, e TODA oferta caia no fallback Amazon.
  const cjPid = resolveCjPid(site, headers);

  // ==========================================================================
  // v205: SUPORTE A ?oferta=<uuid> — CORRIGE VAZAMENTO DE COMISSAO.
  // Medido em 11/09 na varredura CJ: o engine NAO implementava `?oferta=`.
  // O parametro era silenciosamente ignorado e o clique caia no fallback
  // (Amazon). Prova: oferta b70db192... (Erommy, EPC3m 202.75, comissao 8%)
  //   engine   /api/ads/go?oferta=<id>  -> amazon.com/?tag=...   COMISSAO PERDIDA
  //   satelite /go?oferta=<id>          -> click-101870640-17250692  correto
  // Ou seja: a mesma oferta pagava no satelite e vazava no engine. Sao 160
  // advertisers CJ ativos com EPC>0 que so sao alcancaveis por `?oferta=`.
  // Le o click_url REAL do catalogo (read-only) e reescreve o PID para o do
  // site que originou o clique. Fail-closed: qualquer falha cai no fluxo
  // normal de marca, nunca derruba o redirect.
  // ==========================================================================
  const ofertaId = String(query.oferta || query.offer || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ofertaId)) {
    try {
      const dbU = process.env.CLICKS_DB_URL, dbK = process.env.CLICKS_DB_KEY;
      if (dbU && dbK) {
        const ac = new AbortController();
        const tmo = setTimeout(() => ac.abort(), 2500);
        const rr = await fetch(
          `${dbU.replace(/\/$/, '')}/rest/v1/ads?id=eq.${encodeURIComponent(ofertaId)}` +
          `&active=is.true&select=click_url,advertiser&limit=1`,
          { headers: { apikey: dbK, Authorization: `Bearer ${dbK}` }, signal: ac.signal });
        clearTimeout(tmo);
        if (rr.ok) {
          const rows = await rr.json();
          const raw = Array.isArray(rows) && rows[0] && rows[0].click_url;
          if (raw && /^https?:\/\//i.test(raw)) {
            // PID do site que originou o clique (mantem a atribuicao correta)
            targetUrl = String(raw).replace(/click-\d+-/, `click-${cjPid}-`);
          }
        }
      }
    } catch (e) { /* fail-closed: segue para o roteamento por marca */ }
  }

  // Booking: programas regionais separados na CJ (BR / LATAM / UK-EU)
  if (brandKey === 'booking') {
    // v125.5: US/CA e demais anglofonos caiam no programa BR (17293138), de baixo
    // EPC para esse trafego. Agora seguem o Booking UK (15734754), verificado 302.
    if (REGIONS.TIER1_EU.includes(country) || country === 'GB'
        || country === 'US' || country === 'CA' || country === 'AU'
        || country === 'NZ' || country === 'IE' || country === 'ZA') brandKey = 'booking_uk';
    else if (REGIONS.LATAM.includes(country) && country !== 'BR') brandKey = 'booking_latam';
    // v210: TODO O RESTO DO MUNDO (APAC, CIS, Africa, Oriente Medio) tambem vai
    // para o Booking UK. Antes caia no programa BRASIL por ser o default.
    // Medido na varredura de 11/09 (EPC 3 meses oficial da CJ):
    //   Booking UK      328.20   <- aceita reserva mundial, maior EPC da rede
    //   Booking Brazil   98.68   <- destino errado p/ JP, RU, SG, KR, IN...
    //   Booking APAC      3.72   <- 26x PIOR que o UK; NAO usar
    // Trafego afetado: 1.740 cliques/7d de JP+RU+SG+TW+KR+IN.
    // BR continua no programa Brazil (moeda e checkout nativos).
    else if (country !== 'BR') brandKey = 'booking_uk';
  }

  if (!targetUrl && VERIFIED_TARGETS[brandKey]) {
    targetUrl = VERIFIED_TARGETS[brandKey].replace('{PID}', cjPid);
    if (brandKey === 'udemy' && rawDest) {
      targetUrl = rawDest;
    }
  } else if (!targetUrl && brandCatalog[brandKey] && brandCatalog[brandKey].url) {
    targetUrl = String(brandCatalog[brandKey].url).replace('{PID}', cjPid);
  } else if (!targetUrl && rawDest) {
    targetUrl = rawDest;
  } else if (!targetUrl) {
    // Ultimate Fallback
    targetUrl = 'https://www.aquitemachadinhos.com.br';
  }

  // CJ Deep Link Encoding Compliance
  if (rawDest && (/\/click-\d{9}-\d+/.test(targetUrl) || targetUrl.includes('tkqlhce.com') || targetUrl.includes('kqzyfj.com') || targetUrl.includes('jdoqocy.com') || targetUrl.includes('anrdoezrs.net') || targetUrl.includes('dpbolvw.net')) && !targetUrl.includes('url=')) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${sep}url=${encodeURIComponent(rawDest)}`;
  }

  // Multi-Network Dynamic Tracking Ingestion (apenas marcas monetizadas —
  // links diretos oficiais (NON_MONETIZED) seguem limpos, sem parâmetros)
  try {
    if (!NON_MONETIZED.has(brandKey)) {
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
    // eBay Partner Network
    if (urlObj.hostname.includes('ebay')) {
      urlObj.searchParams.set('customid', sid);
    }
    targetUrl = urlObj.toString();
    }
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

  // Clickstream ingestion (fail-closed) — reativa o log de cliques em
  // ads_clicks (etbx) com click_ref/SID preenchido. Nunca quebra o redirect.
  try {
    const dbUrl = process.env.CLICKS_DB_URL;
    const dbKey = process.env.CLICKS_DB_KEY;
    // v113: bot NAO entra em ads_clicks (poluia EPC/CTR/bandit).
    if (dbUrl && dbKey && !IS_BOT) {
      const net = targetUrl.includes('awin1.com') ? 'awin'
        : /kqzyfj|jdoqocy|dpbolvw|anrdoezrs|tkqlhce/.test(targetUrl) ? 'cj'
        : targetUrl.includes('lmdee') ? 'lomadee'
        : targetUrl.includes('shopee') ? 'shopee'
        : (targetUrl.includes('mercadolivre') || targetUrl.includes('meli.')) ? 'mercadolivre'
        : targetUrl.includes('ebay') ? 'ebay'
        : targetUrl.includes('booking.com') ? 'cj'
        : NON_MONETIZED.has(brandKey) ? 'direct' : 'generic';
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

  // Edge Headers
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Affiliate-Engine', 'Achadinhos-Global-Gateway-2026');
  res.setHeader('X-Routed-Country', country);
  res.setHeader('X-Routed-Brand', brandKey);
  res.setHeader('X-CJ-PID', cjPid);
  res.setHeader('X-Monetized', NON_MONETIZED.has(brandKey) ? 'false' : 'true');
  // ==========================================================================
  // v126: INTERSTITIAL DE MONETIZACAO
  //
  // PORQUE ISTO EXISTE (medido, nao suposto): 11.128 de 12.099 cliques humanos
  // de 7 dias (92%) nao tinham page_path — ou seja, tomavam 307 puro e NUNCA
  // renderizavam HTML. Um 307 nao executa JavaScript, logo Adsterra/Monetag
  // jamais contavam impressao. Os cliques chegavam ao Telegram (server-side)
  // mas eram invisiveis para as redes. Este interstitial e o elo que faltava.
  //
  // Regras de seguranca:
  //  - BOT  -> 307 seco (nao gasta banco nem impressao invalida)
  //  - ?noint=1 -> 307 seco (escape hatch)
  //  - Humano -> HTML leve com as tags VERIFICADAS 200 + auto-redirect
  //  - Tags carregam ASSINCRONAS (nao bloqueiam o paint)
  //  - <noscript> + <a> visivel: sem JS o usuario ainda chega ao destino
  //  - meta refresh como 2a rede de seguranca
  // Tags: Popunder Adsterra 30703817 (dominio 5975392) + Monetag 274860/278800.
  // Excluidas: 11691043 (404), container 65ecd104 (403). Verificadas ao vivo.
  // ==========================================================================
  const WANT_INT = !IS_BOT && String(query.noint || '') !== '1';
  if (!WANT_INT) {
    res.setHeader('Location', targetUrl);
    return res.status(307).end();
  }

  // v250: 1500 -> 2200ms. Medicao em navegador real mostrou que as zonas
  // Monetag (6opo.com) so eram requisitadas aos ~3.055ms com o script no body.
  // Com as tags no <head> + preconnect a 1a request cai para ~300-600ms, mas as
  // zonas secundarias (que o loader dispara depois) precisam de ~1.2s a mais.
  // 2200ms garante que TODAS as 4 requests completem antes do redirect, sem
  // tornar a espera perceptivel (padrao de mercado para interstitial: 2-3s).
  const DWELL_MS = 2200;
  const esc = (u) => String(u).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
                              .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeTarget = esc(targetUrl);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.status(200).end(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="refresh" content="3;url=${safeTarget}">
<title>Redirecionando…</title>
<style>
 body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      background:#0f1115;color:#e8eaed;display:flex;min-height:100vh;
      align-items:center;justify-content:center;text-align:center}
 .b{max-width:640px;padding:26px}
 .s{width:34px;height:34px;margin:0 auto 16px;border:3px solid #2a2f3a;
    border-top-color:#4c8bf5;border-radius:50%;animation:r .9s linear infinite}
 @keyframes r{to{transform:rotate(360deg)}}
 a.go{display:inline-block;margin-top:14px;padding:11px 20px;background:#4c8bf5;
      color:#fff;text-decoration:none;border-radius:8px;font-weight:600}
 p{opacity:.75;font-size:14px}
</style><link rel="preconnect" href="https://undergocutlery.com" crossorigin>
<link rel="preconnect" href="https://quge5.com" crossorigin>
<link rel="preconnect" href="https://6opo.com" crossorigin>
<link rel="dns-prefetch" href="https://undergocutlery.com">
<link rel="dns-prefetch" href="https://quge5.com">
<link rel="dns-prefetch" href="https://6opo.com">
<script>
/* v250: TAGS NO HEAD — disparo imediato.
   MEDIDO em navegador real (12/09): com o script no fim do <body>, a 1a tag
   so era requisitada aos 2.341ms, mas o redirect ocorre aos 1.500ms. Ou seja:
   TODA impressao acontecia DEPOIS do usuario ja ter saido da pagina.
   Requests observados: 2341ms (adsterra+monetag loader), 3055ms (zonas 6opo).
   Aqui as tags entram no <head>, antes do body existir, usando
   document.head.appendChild — nao dependem do DOM estar pronto.
   preconnect/dns-prefetch derrubam a latencia de handshake TLS dos 3 dominios. */
(function(){
  function T(src,zone){
    try{
      var s=document.createElement('script');
      s.src=src; s.async=true; s.setAttribute('data-cfasync','false');
      if(zone) s.setAttribute('data-zone',zone);
      (document.head||document.documentElement).appendChild(s);
    }catch(e){}
  }
  T('https://undergocutlery.com/n125219ufh?key=0474000233cefd60e54ca390d15beaaf');
  T('https://quge5.com/88/tag.min.js','274860');
  T('https://quge5.com/88/tag.min.js','278800');
})();
</script>
</head><body>
<div class="b">
  <div class="s"></div>
  <strong>Levando você à oferta…</strong>
  <p>Se não avançar automaticamente, toque no botão.</p>
  <a class="go" id="go" href="${safeTarget}" rel="nofollow noopener">Continuar para a oferta</a>
  <noscript><p><a href="${safeTarget}" rel="nofollow noopener">Clique aqui para continuar</a></p></noscript>
</div>
<script>
(function(){
  var DEST=${JSON.stringify(targetUrl)};
  // Promise.allSettled: uma tag que falhe NUNCA atrasa o redirect nem as outras.
  function load(src,zone){
    return new Promise(function(res){
      try{
        var s=document.createElement('script');
        s.src=src; s.async=true; s.setAttribute('data-cfasync','false');
        if(zone) s.setAttribute('data-zone',zone);
        s.onload=function(){res('ok')}; s.onerror=function(){res('err')};
        document.body.appendChild(s);
      }catch(e){res('err')}
    });
  }
  var tags=[
    load('https://undergocutlery.com/n125219ufh?key=0474000233cefd60e54ca390d15beaaf'),
    load('https://quge5.com/88/tag.min.js','274860'),
    load('https://quge5.com/88/tag.min.js','278800')
  ];
  if(Promise.allSettled) Promise.allSettled(tags);
  // Redirect por tempo fixo: nao depende das tags terminarem (fail-closed).
  setTimeout(function(){ try{location.replace(DEST)}catch(e){location.href=DEST} }, ${DWELL_MS});
})();
</script>
</body></html>`);
};
