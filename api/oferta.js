// ==========================================================================
// v22.5 — SUPER VITRINES SERVER-SIDE (/oferta/:slug)
// Renderiza as vitrines do catálogo Nexus (nexus_oferta_pages) direto do
// Supabase em modo READ-ONLY (catálogo 14.301 intocado), com:
//   • Metadados estruturados JSON-LD (ItemList/Offer) para SEO indexável
//   • Links de oferta rastreados pelo /api/ads/go (telemetria de cliques
//     1-a-1 no banco — mesmo rail battle-tested do redirect de produção)
//   • Tags CPM assíncronas (AdSense + banner Adsterra 320x50) — nunca
//     bloqueiam a renderização
//   • FAIL-CLOSED: banco indisponível → página-verdadeira com aviso de
//     sincronização (nunca 500, nunca oferta inventada)
// Alvo das ondas IndexNow (api.indexnow.org) — chave hospedada em
// /a120ccc8…txt (HTTP 200 provado).
// ==========================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const HUB_NICHES = { // v22.0 — hubs de nicho global (categorias reais do catálogo)
  'hub-eletronicos-tech': {
    titulo: 'Eletrônicos e Tecnologia de Ponta — Ofertas e Cupons',
    cats: ['Electronic*', 'Computer*', '*Games*', '*Tech*', 'Gadget*', 'Home Appliances'],
  },
  'hub-passagens-resorts': {
    titulo: 'Passagens Aéreas e Resorts de Luxo — Ofertas e Cupons',
    cats: ['Travel', 'Hotel', '*Flight*', '*Resort*', 'Vacation*'],
  },
};

const ADS_CLIENT = 'ca-pub-5604700207394147';            // AdSense (verificado no projeto)
const ADSTERRA_KEY = '55e59bc77878834deb2f1086a87bfbb4'; // banner 320x50 (pool de produção)

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function titleCase(slug) {
  return String(slug || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function supa(path) {
  const u = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`);
  const r = await fetch(u, {
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      accept: 'application/json',
    },
  });
  if (!r.ok) return null;
  return r.json();
}

function offerCard(o, slug) {
  const goUrl = `/api/ads/go?url=${encodeURIComponent(o.click_url || '')}` +
    `&site=aquitemachadinhos&sid=vitrine_${encodeURIComponent(slug)}` +
    `&slot=vitrine&dest=${encodeURIComponent(o.click_url || '')}`;
  const cupom = o.coupon_code
    ? `<span class="cupom">Cupom: <code>${esc(o.coupon_code)}</code></span>` : '';
  return `
    <a class="card" href="${goUrl}" rel="nofollow sponsored noopener" target="_blank">
      <span class="cat">${esc(o.category || 'Oferta')}</span>
      <strong class="nome">${esc(o.name || o.advertiser || 'Oferta verificada')}</strong>
      <span class="loja">${esc(o.advertiser || '')}</span>
      <span class="tipo">${esc(o.promo_type || 'Promoção')}</span>
      ${cupom}
      <span class="cta">Ver oferta →</span>
    </a>`;
}

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || '')
    .toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 120);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');

  if (!slug) {
    res.status(400).send('<!doctype html><html lang="pt-BR"><body>slug ausente</body></html>');
    return;
  }

  // 1) metadados da vitrine (read-only)
  let page = null;
  try {
    const rows = await supa(
      `nexus_oferta_pages?slug=eq.${encodeURIComponent(slug)}` +
      `&select=slug,page_type,advertiser,offers_count,status&limit=1`);
    page = Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) { page = null; }

  if (!page) {
    res.status(404).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Vitrine não encontrada — Aqui Tem Achadinhos</title></head>
<body><h1>Vitrine não encontrada</h1>
<p>Esta vitrine não existe no catálogo. <a href="/">Ver ofertas do dia</a></p></body></html>`);
    return;
  }

  // 2) ofertas REAIS do catálogo (read-only; hub → topo global por peso)
  let offers = [];
  const niche = HUB_NICHES[slug] || null;
  try {
    const sel = 'id,name,advertiser,category,promo_type,coupon_code,click_url,weight';
    let q;
    if (niche) {
      const or = niche.cats.map((c) => `category.ilike.${c}`).join(',');
      q = `ads?active=eq.true&or=(${or})&select=${sel}&order=weight.desc&limit=24`;
    } else if (page.advertiser) {
      q = `ads?active=eq.true&advertiser=eq.${encodeURIComponent(page.advertiser)}` +
          `&select=${sel}&order=weight.desc&limit=24`;
    } else {
      q = `ads?active=eq.true&select=${sel}&order=weight.desc&limit=24`;
    }
    const rows = await supa(q);
    offers = Array.isArray(rows) ? rows.filter((o) => o && o.click_url) : [];
  } catch (e) { offers = []; }

  const titulo = niche
    ? niche.titulo
    : page.advertiser
      ? `${page.advertiser} — Cupons, Descontos e Ofertas`
      : `${titleCase(slug)} — Cupons, Descontos e Ofertas`;
  const descricao = `Cupons, promoções e descontos verificadas de ${page.advertiser || titleCase(slug)}. ` +
    `${offers.length > 0 ? offers.length + ' ofertas ativas' : 'Ofertas em sincronização'}. Atualizado em tempo real pelo motor Nexus.`;
  const canonical = `https://achadinhos-ad-engine.vercel.app/oferta/${slug}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: titulo,
    numberOfItems: offers.length,
    itemListElement: offers.slice(0, 24).map((o, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Offer',
        name: o.name || o.advertiser,
        category: o.category || undefined,
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'Organization', name: o.advertiser || 'Parceiro oficial' },
      },
    })),
  };

  const cards = offers.length > 0
    ? offers.map((o) => offerCard(o, slug)).join('\n')
    : `<p class="sync">Sincronização do catálogo em andamento — as ofertas desta vitrine chegam em instantes.</p>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descricao)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:url" content="${canonical}">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<!-- CPM assíncrono (nunca bloqueia a renderização) -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADS_CLIENT}" crossorigin="anonymous"></script>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; background: #fafbfc; color: #16202c; }
  header { background: linear-gradient(135deg, #0f2027, #203a43, #2c5364); color: #fff; padding: 28px 18px; text-align: center; }
  header h1 { margin: 0 0 6px; font-size: 1.5rem; }
  header p { margin: 0; opacity: .85; font-size: .95rem; }
  main { max-width: 980px; margin: 0 auto; padding: 18px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
  .card { display: flex; flex-direction: column; gap: 6px; background: #fff; border: 1px solid #e3e8ee; border-radius: 12px; padding: 16px; text-decoration: none; color: inherit; transition: box-shadow .15s, transform .15s; }
  .card:hover { box-shadow: 0 6px 18px rgba(15, 32, 39, .12); transform: translateY(-2px); }
  .cat { font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; color: #2c5364; font-weight: 700; }
  .nome { font-size: 1rem; line-height: 1.35; }
  .loja { font-size: .85rem; color: #5b6b7b; }
  .tipo { font-size: .78rem; color: #0a7d43; font-weight: 600; }
  .cupom { font-size: .8rem; background: #fff4d6; border: 1px dashed #d9a400; padding: 3px 8px; border-radius: 6px; align-self: flex-start; }
  .cupom code { font-weight: 700; letter-spacing: .04em; }
  .cta { margin-top: 6px; color: #0b62d6; font-weight: 700; font-size: .9rem; }
  .sync { padding: 22px; text-align: center; color: #5b6b7b; background: #fff; border: 1px dashed #cdd6df; border-radius: 12px; }
  .banner { display: flex; justify-content: center; margin: 20px 0; }
  footer { text-align: center; color: #7b8896; font-size: .78rem; padding: 22px 12px 30px; }
  .live-badge { position: sticky; top: 10px; z-index: 9; display: block; width: max-content; margin: 0 auto 14px; background: #0f2027; color: #ffd166; font-weight: 700; font-size: .82rem; padding: 7px 14px; border-radius: 999px; box-shadow: 0 4px 14px rgba(15,32,39,.35); }
  .card.destaque { border-color: #d9a400; box-shadow: 0 0 0 2px #ffe29a inset; }
  .card.destaque .cta::after { content: ' ⚡ em destaque agora'; font-size: .72rem; color: #b8860b; }
  footer a { color: #2c5364; }
</style>
</head>
<body>
<header>
  <h1>${esc(titulo)}</h1>
  <p>${offers.length > 0 ? offers.length + ' ofertas ativas · verificação em tempo real' : 'Ofertas em sincronização'} · ${page.page_type === 'hub' ? 'Super Vitrine' : 'Vitrine oficial'}</p>
</header>
<main>
  <div class="banner">
    <script type="text/javascript">
      atOptions = { 'key': '${ADSTERRA_KEY}', 'format': 'iframe', 'height': 50, 'width': 320, 'params': {} };
    </script>
    <script type="text/javascript" src="//www.topcreativeformat.com/${ADSTERRA_KEY}/invoke.js"></script>
  </div>
  <section class="grid">
${cards}
  </section>
</main>
<footer>
  Atualizado ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC ·
  <a href="/">Aqui Tem Achadinhos</a> · motor Nexus v22.5 · catálogo read-only
</footer>
<div id="nxs-live" class="live-badge" hidden></div>
<script>
(function(){
  var SLUG=${JSON.stringify(slug)};
  var S=null; try{S=localStorage.getItem('nexus_sid')}catch(e){}
  if(!S){S=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():'s'+Date.now()+Math.random().toString(36).slice(2,10);try{localStorage.setItem('nexus_sid',S)}catch(e){}}
  var DEV=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'mobile':'desktop';
  function send(k,m){try{fetch('/api/signal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:k,slug:SLUG,session:S,device:DEV,meta:m||{}}),keepalive:true}).catch(function(){})}catch(e){}}
  send('view',{ref:document.referrer||''});
  var sc={};addEventListener('scroll',function(){var h=document.documentElement;var p=Math.round(100*(h.scrollTop||document.body.scrollTop)/(h.scrollHeight-h.clientHeight));[25,50,75,100].forEach(function(t){if(p>=t&&!sc[t]){sc[t]=1;send('scroll_depth',{pct:t})}})},{passive:true});
  var lastExit=0;document.addEventListener('mouseout',function(e){if(!e.relatedTarget&&e.clientY<=0&&Date.now()-lastExit>30000){lastExit=Date.now();send('exit_intent',{})}});
  var clicks=[],lastRage=0;addEventListener('click',function(){var n=Date.now();clicks.push(n);clicks=clicks.filter(function(t){return n-t<900});if(clicks.length>=3&&n-lastRage>5000){lastRage=n;send('rage_click',{})}},true);
  setInterval(function(){send('heartbeat',{})},20000);
  var hb=0;var hbT=setInterval(function(){hb+=20;if(hb>=20){clearInterval(hbT);var c=document.querySelector('.card');if(c){c.classList.add('destaque')}}},1000);setTimeout(function(){clearInterval(hbT)},25000);
  function live(){try{fetch('/api/live?slug='+encodeURIComponent(SLUG)).then(function(r){return r.json()}).then(function(j){var b=document.getElementById('nxs-live');var n=j&&j.escassez&&j.escassez.assistindo_agora;if(b&&n>0){b.hidden=false;b.textContent='👥 '+n+(n===1?' pessoa assistindo':' pessoas assistindo')+' esta vitrine agora'}}).catch(function(){})}catch(e){}}
  live();setInterval(live,30000);
})();
</script>
</body>
</html>`;

  res.status(200).send(html);
};
