#!/usr/bin/env node
/**
 * ==============================================================================
 * SINCRONIZADOR DO CATALOGO DE PRODUTOS DA CJ AFFILIATE (Product Search API)
 * ==============================================================================
 * DESCOBERTA DA MARATONA (13/09/2026):
 *   O token CJ do projeto — que a auditoria anterior tinha marcado como
 *   "GraphQL 403, inutilizavel" — funciona perfeitamente neste endpoint:
 *       POST https://ads.api.cj.com/query   (GraphQL, 10 queries raiz)
 *   O 403 anterior era do endpoint legado; o 404 era de /graphql (inexistente).
 *
 *   Com ele da para ler o catalogo de produtos REAL da CJ:
 *       12.191 produtos de anunciantes com operacao no BRASIL (Ray-Ban Brazil,
 *              Sunglass Hut Brazil) — preco em BRL
 *       91.410 produtos com filtro "desconto" e moeda BRL (SHEIN entre eles)
 *       2.797.285 produtos precificados em BRL
 *
 *   Porem: no campo `joinedStatus` TODOS vem `false` e `linkCode` volta `null`.
 *   Traduzindo: o produto existe, o preco existe, a imagem existe — mas o nosso
 *   publisher id (101859672) nao esta inscrito no anunciante, entao a CJ NAO
 *   gera o link rastreavel. Inscricao nao tem API: e um clique no painel da CJ
 *   (Advertisers -> Join). Este script detecta exatamente esse estado.
 *
 * O que este script faz toda vez que roda:
 *   1. Consulta a API ao vivo (BR / BRL / palavra-chave "desconto").
 *   2. Para cada produto, pede o linkCode do nosso PID.
 *   3. Grava data/cj-product-feed-live.json com o que existe de verdade:
 *      titulo, preco, moeda, imagem, anunciante, e se o link e rastreavel.
 *   4. Conta quantos tem link rastreavel. Se for ZERO e houver produto, avisa
 *      em letras garrafais o que falta (inscricao no anunciante) em vez de fincar
 *      a cabeca na areia.
 *
 * Quando o usuario inscrever o PID nos anunciantes, este mesmo script passa a
 * gravar os links rastreaveis automaticamente — nada mais precisa mudar.
 *
 * Uso:
 *   node scripts/cj-product-catalog-sync.js
 *   node scripts/cj-product-catalog-sync.js --keywords "tenis,fone" --limit 40
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'cj-product-feed-live.json');
const ENDPOINT = process.env.CJ_GRAPHQL_ENDPOINT || 'https://ads.api.cj.com/query';

const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf(name);
  return i > -1 && argv[i + 1] ? argv[i + 1] : def;
};
const KEYWORDS = argOf('--keywords', 'desconto').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = parseInt(argOf('--limit', '30'), 10);
const CURRENCY = argOf('--currency', 'BRL');
const COUNTRY = argOf('--country', 'BR');

function envFrom(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) {}
  return out;
}

const envFile = envFrom(path.join(ROOT, '.env'));
const TOKEN = process.env.CJ_ACCESS_TOKEN || envFile.CJ_ACCESS_TOKEN || '';
const CID = process.env.CJ_CID || envFile.CJ_CID || '8041957';
const PID = process.env.CJ_PID || envFile.CJ_PID || '101859672';

async function gql(query) {
  if (!TOKEN) return { error: 'CJ_ACCESS_TOKEN ausente' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 40000);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (!res.ok) return { error: `HTTP ${res.status}`, detail: (json ? JSON.stringify(json).slice(0, 300) : text.slice(0, 300)) };
    if (json && json.errors) return { error: 'GraphQL', detail: JSON.stringify(json.errors).slice(0, 300) };
    return { data: json.data };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

/** Consulta de produtos reais com o link de afiliado do NOSSO pid. */
function productQuery(keyword) {
  return `{
    shoppingProducts(companyId: "${CID}", partnerIds: ["${PID}"], keywords: ["${keyword}"], currency: "${CURRENCY}", advertiserCountries: ["${COUNTRY}"], limit: ${LIMIT}) {
      totalCount
      resultList {
        id adId title brand advertiserId advertiserName advertiserCountry targetCountry
        availability discountPercentage imageLink link mobileLink joinedStatus
        price { amount currency }
        salePrice { amount currency }
        linkCode(pid: "${PID}") { clickUrl imageUrl }
      }
    }
  }`;
}

/** Mesma busca SEM filtro de parceiro: mostra o que existe no mercado, mesmo
 *  que ainda nao sejamos inscritos (foi assim que descobrimos os 12k do BR). */
function marketQuery(keyword) {
  /* ATENCAO (bug pego rodando): filtrar por advertiserCountries:["BR"] ZERA a
     busca de mercado. A SHEIN, por exemplo, entrega no Brasil (targetCountry=BR)
     mas esta registrada em Singapura (advertiserCountry=SG) — o filtro de pais
     do anunciante a exclui. Por isso aqui filtramos por MOEDA (BRL), que e o
     que importa para o preco mostrado ao cliente, e reportamos targetCountry. */
  return `{
    shoppingProducts(companyId: "${CID}", keywords: ["${keyword}"], currency: "${CURRENCY}", limit: ${LIMIT}) {
      totalCount
      resultList {
        id title brand advertiserId advertiserName advertiserCountry targetCountry
        availability discountPercentage imageLink link joinedStatus
        price { amount currency }
        linkCode(pid: "${PID}") { clickUrl imageUrl }
      }
    }
  }`;
}

async function main() {
  console.log('================================================================================');
  console.log('🛒 SINCRONIZADOR DE PRODUTOS CJ — CATALOGO AO VIVO');
  console.log('================================================================================');
  console.log(`   Endpoint  : ${ENDPOINT}`);
  console.log(`   Company   : ${CID}`);
  console.log(`   Publisher : ${PID}`);
  console.log(`   Filtro    : moeda ${CURRENCY} | anunciante/entrega ${COUNTRY} | palavras: ${KEYWORDS.join(', ')}`);
  console.log(`   Token CJ  : ${TOKEN ? 'presente (' + TOKEN.slice(0, 6) + '…)' : '❌ AUSENTE'}`);
  console.log('');

  if (!TOKEN) {
    console.error('❌ Sem CJ_ACCESS_TOKEN — nada a consultar.');
    process.exit(1);
  }

  const report = {
    generated_at: new Date().toISOString(),
    endpoint: ENDPOINT,
    company_id: CID,
    publisher_id: PID,
    filter: { currency: CURRENCY, country: COUNTRY, keywords: KEYWORDS, limit: LIMIT },
    busca_com_nosso_pid: {},
    mercado_sem_filtro_de_pid: {},
    diagnostico: {}
  };

  /* --- 1. busca restrita aos anunciantes em que ESTAMOS inscritos ---------- */
  console.log('--- 1. BUSCA RESTRITA AOS NOSSOS ANUNCIANTES (partnerIds) ---');
  let totalOur = 0, productsOur = [];
  for (const kw of KEYWORDS) {
    const r = await gql(productQuery(kw));
    if (r.error) { console.log(`   ❌ "${kw}" → ${r.error} ${r.detail ? '| ' + r.detail.slice(0, 120) : ''}`); report.busca_com_nosso_pid[kw] = { error: r.error }; continue; }
    const sp = r.data.shoppingProducts;
    totalOur += sp.totalCount;
    productsOur = productsOur.concat(sp.resultList || []);
    console.log(`   "${kw}" → ${sp.totalCount} produto(s)`);
  }

  /* --- 2. busca de mercado (sem filtro de pid) ---------------------------- */
  console.log('');
  console.log('--- 2. O QUE EXISTE NO MERCADO (sem filtro de anunciante) ---');
  let totalMarket = 0, productsMarket = [];
  for (const kw of KEYWORDS) {
    const r = await gql(marketQuery(kw));
    if (r.error) { console.log(`   ❌ "${kw}" → ${r.error}`); report.mercado_sem_filtro_de_pid[kw] = { error: r.error }; continue; }
    const sp = r.data.shoppingProducts;
    totalMarket += sp.totalCount;
    productsMarket = productsMarket.concat(sp.resultList || []);
    report.mercado_sem_filtro_de_pid[kw] = { total: sp.totalCount, amostra: (sp.resultList || []).length };
    console.log(`   "${kw}" → ${sp.totalCount} produto(s) no mercado, ${(sp.resultList || []).length} amostrados`);
  }

  /* --- 3. quantos tem link rastreavel de verdade -------------------------- */
  const dedupe = new Map();
  for (const p of [...productsOur, ...productsMarket]) dedupe.set(p.id, p);
  const todos = [...dedupe.values()];
  const comLink = todos.filter((p) => p.linkCode && p.linkCode.clickUrl);
  const inscritos = todos.filter((p) => p.joinedStatus === true);
  const anunciantes = [...new Set(todos.map((p) => p.advertiserName))];

  console.log('');
  console.log('--- 3. RASTREABILIDADE (o que realmente gera comissao) ---');
  console.log(`   Produtos únicos vistos ..........: ${todos.length}`);
  console.log(`   Com linkCode rastreável .........: ${comLink.length}`);
  console.log(`   joinedStatus = true .............: ${inscritos.length}`);
  console.log(`   Anunciantes vistos ..............: ${anunciantes.length} (${anunciantes.slice(0, 6).join(', ')}${anunciantes.length > 6 ? '…' : ''})`);

  if (todos.length > 0 && comLink.length === 0) {
    console.log('');
    console.log('   ⛔ NENHUM PRODUTO TEM LINK RASTREÁVEL AINDA.');
    console.log('      Motivo exato devolvido pela API: joinedStatus=false e linkCode=null.');
    console.log('      Os produtos, preços e imagens existem; o que falta é a INSCRIÇÃO do');
    console.log(`      publisher ${PID} no anunciante — ação de painel (CJ → Advertisers → Join).`);
    console.log('      A API da CJ não expõe inscrição: não dá para resolver por código.');
  } else if (comLink.length > 0) {
    console.log('');
    console.log(`   ✅ ${comLink.length} produto(s) já podem ser publicados com link rastreável.`);
  }

  report.busca_com_nosso_pid.total = totalOur;
  report.diagnostico = {
    produtos_unicos: todos.length,
    com_link_rastreavel: comLink.length,
    joined_status_true: inscritos.length,
    anunciantes_vistos: anunciantes,
    bloqueio: comLink.length === 0 && todos.length > 0
      ? `joinedStatus=false para o publisher ${PID}. Necessário inscrever o publisher nos anunciantes no painel da CJ (não há API de inscrição).`
      : null
  };
  report.produtos = todos.slice(0, 200).map((p) => ({
    id: p.id,
    adId: p.adId || null,
    title: p.title,
    brand: p.brand || null,
    advertiser: p.advertiserName,
    advertiser_id: p.advertiserId,
    advertiser_country: p.advertiserCountry || null,
    target_country: p.targetCountry || null,
    availability: p.availability || null,
    discount_percentage: p.discountPercentage || null,
    price: p.price,
    sale_price: p.salePrice || null,
    image: p.imageLink || null,
    joined: p.joinedStatus === true,
    link_rastreavel: (p.linkCode && p.linkCode.clickUrl) || null,
    link_direto: p.link || null
  }));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('');
  console.log(`   📄 Relatório: ${path.relative(ROOT, OUT)}`);
  console.log('================================================================================');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Erro fatal no sincronizador CJ:', e && (e.stack || e.message));
  process.exit(1);
});
