#!/usr/bin/env node
/**
 * build-shopee-inventory.js — Inventário real de ofertas Shopee Brasil (v330.0)
 *
 * LÊ: data/shopee-batches/Batch*.csv (exportações oficiais do painel de afiliado)
 * GERA:
 *   data/shopee-offer-inventory.json  → catálogo consumido pelo gateway /api/ads/go
 *   supabase/migrations/supabase_v330_shopee_inventory.sql → migração aditiva idempotente
 *
 * REGRA DE OURO: nada é inventado. Todo campo vem do CSV. Se o CSV não tem o dado,
 * o campo sai null. Não existe link "de exemplo", placeholder ou comissão estimada.
 *
 * IMPORTANTE (honestidade de dados): o CSV NÃO traz comissão por produto — traz
 * "Commission Rate"/"Commission" (a comissão do produto, que é o que remunera) e o
 * arquivo de lojas traz "up to NN%" (teto de comissão da loja, não a taxa efetiva).
 * Os dois campos são mantidos separados e rotulados para não confundir teto de loja
 * com comissão de produto.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const BATCH_DIR = path.join(ROOT, 'data', 'shopee-batches');
const OUT_JSON = path.join(ROOT, 'data', 'shopee-offer-inventory.json');
const OUT_SQL = path.join(ROOT, 'supabase', 'migrations', 'supabase_v330_shopee_inventory.sql');

/** Parser CSV tolerante a aspas, vírgulas internas e BOM. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => String(v).trim() !== ''))
    .map((r) => {
      const o = {};
      header.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
      return o;
    });
}

/** md5 de 32 caracteres — chave de deduplicação exigida na tabela. */
const md5 = (s) => crypto.createHash('md5').update(String(s), 'utf8').digest('hex');

const STOP = new Set(['de','da','do','das','dos','com','para','por','em','no','na','nos','nas','e','ou',
  'um','uma','uns','umas','o','a','os','as','ao','aos','the','of','and','pra','pro','sem','sob','sobre',
  'kit','unidade','un','pcs','peça','peca','pecas','peças']);

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s.+]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Extrai frases-chave (2–4 palavras) do nome do produto, sem stopwords nas pontas. */
function keywordsFrom(name) {
  const tokens = norm(name).split(' ').filter(Boolean);
  const out = new Set();
  const clean = tokens.filter((t) => t.length > 1);
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i + n <= clean.length; i++) {
      const gram = clean.slice(i, i + n);
      if (STOP.has(gram[0]) || STOP.has(gram[gram.length - 1])) continue;
      out.add(gram.join(' '));
    }
  }
  // Termos de marca/modelo com número (ex.: 10000mah, 12v) entram sozinhos: são os
  // melhores casadores em conversa real ("to precisando de um power bank 10000mah").
  for (const t of clean) if (/\d/.test(t) && t.length >= 3) out.add(t);
  return Array.from(out);
}

const money = (s) => {
  const m = String(s || '').replace(/[^\d,]/g, '').replace(',', '.');
  const v = parseFloat(m);
  return Number.isFinite(v) ? v : null;
};
const rate = (s) => {
  const m = String(s || '').match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};
const shortcode = (url) => {
  const m = String(url || '').match(/s\.shopee\.com\.br\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
};

function main() {
  if (!fs.existsSync(BATCH_DIR)) {
    console.error('ERRO: pasta de lotes não encontrada:', BATCH_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(BATCH_DIR).filter((f) => /^Batch.*\.csv$/i.test(f)).sort();
  if (!files.length) { console.error('ERRO: nenhum CSV em', BATCH_DIR); process.exit(1); }

  const products = [], stores = [], categories = [];
  for (const f of files) {
    const rows = parseCsv(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8'));
    if (!rows.length) continue;
    const head = Object.keys(rows[0]);
    if (head.includes('Item Id')) {
      for (const r of rows) products.push({ file: f, r });
    } else if (head.includes('Trackable Link_short')) {
      for (const r of rows) stores.push({ file: f, r });
    } else if (head.includes('Offer Link')) {
      for (const r of rows) categories.push({ file: f, r });
    }
  }

  const seenHash = new Set();
  const inventory = [];

  for (const { file, r } of products) {
    const name = r['Item Name'];
    const offer = r['Offer Link'];
    const hash = md5('shopee_product:' + r['Item Id']);
    if (seenHash.has(hash)) continue;
    seenHash.add(hash);
    inventory.push({
      match_hash: hash,
      kind: 'shopee_product',
      source_file: file,
      item_id: r['Item Id'] || null,
      name,
      store: r['Nome da loja'] || null,
      commission_rate_pct: rate(r['Commission Rate']),
      commission_brl: money(r['Commission']),
      price_brl: money(r['Price']),
      sales_label: r['Sales'] || null,
      product_link: r['Product Link'] || null,
      offer_link: offer || null,
      offer_shortcode: shortcode(offer),
      keywords: keywordsFrom(name),
      region: 'BR',
      currency: 'BRL',
      network: 'shopee_affiliate',
      read_only: true
    });
  }

  for (const { file, r } of stores) {
    const name = r['Offer Name'];
    const link = r['Trackable Link_short'];
    const hash = md5('shopee_store:' + name);
    if (seenHash.has(hash)) continue;
    seenHash.add(hash);
    const period = String(r['Offer Period'] || '');
    const start = (period.match(/start:\s*([\d-]+)/) || [])[1] || null;
    inventory.push({
      match_hash: hash,
      kind: 'shopee_store',
      source_file: file,
      item_id: null,
      name,
      store: name,
      // "up to 83%" é TETO da loja, não a taxa efetiva de cada produto.
      commission_rate_pct: null,
      commission_ceiling_pct: rate(r['Commission Rate']),
      commission_ceiling_label: r['Commission Rate'] || null,
      commission_brl: null,
      price_brl: null,
      sales_label: null,
      product_link: r['Offer Link'] || null,
      offer_link: link || null,
      offer_shortcode: shortcode(link),
      offer_period_start: start,
      keywords: (() => {
        const base = keywordsFrom(name);
        return base.length ? base : [norm(name)].filter(Boolean);
      })(),
      region: 'BR', currency: 'BRL', network: 'shopee_affiliate', read_only: true
    });
  }

  for (const { file, r } of categories) {
    const name = r['Offer Name'];
    const link = r['Offer Link'];
    const hash = md5('shopee_category:' + name);
    if (seenHash.has(hash)) continue;
    seenHash.add(hash);
    inventory.push({
      match_hash: hash,
      kind: 'shopee_category',
      source_file: file,
      name,
      store: null,
      commission_rate_pct: rate(r['Commission Rate']),
      commission_brl: null, price_brl: null, sales_label: null,
      product_link: null,
      offer_link: link || null,
      offer_shortcode: shortcode(link),
      offer_type: r['Offer Type'] || null,
      keywords: [norm(name)].filter(Boolean),
      region: 'BR', currency: 'BRL', network: 'shopee_affiliate', read_only: true
    });
  }

  // ---- validações duras: nada entra com link inventado ----
  const problems = [];
  for (const it of inventory) {
    if (!it.offer_link) problems.push(`${it.kind}/${it.name}: SEM offer_link`);
    else if (!/^https:\/\/s\.shopee\.com\.br\/[A-Za-z0-9]+$/.test(it.offer_link)) {
      problems.push(`${it.kind}/${it.name}: offer_link não é short link oficial (${it.offer_link})`);
    }
    if (it.kind === 'shopee_product' && !it.item_id) problems.push(`${it.name}: sem Item Id`);
  }
  if (problems.length) {
    console.error('VALIDAÇÃO FALHOU — ' + problems.length + ' problema(s):');
    problems.slice(0, 15).forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }

  const totalKeywords = inventory.reduce((a, i) => a + i.keywords.length, 0);
  const dupKeywords = (() => {
    const m = new Map();
    for (const it of inventory) for (const k of it.keywords) m.set(k, (m.get(k) || 0) + 1);
    let d = 0; for (const [, n] of m) if (n > 1) d++;
    return { unique: m.size, shared: d };
  })();

  const byKind = inventory.reduce((a, i) => { a[i.kind] = (a[i.kind] || 0) + 1; return a; }, {});
  const withRate = inventory.filter((i) => i.kind === 'shopee_product' && i.commission_rate_pct != null);

  const doc = {
    generated_at: new Date().toISOString(),
    generator: 'scripts/build-shopee-inventory.js',
    source: 'Excelência Shopee Afiliados — exportações Batch*.csv',
    network: 'shopee_affiliate',
    region: 'BR',
    currency: 'BRL',
    read_only_inventory: true,
    counts: {
      offers_total: inventory.length,
      by_kind: byKind,
      keywords_total: totalKeywords,
      keywords_unique: dupKeywords.unique,
      keywords_shared: dupKeywords.shared
    },
    integrity: {
      fabricated_links: 0,
      note: 'Todo offer_link é short link oficial exportado do painel (s.shopee.com.br/<code>). Nenhum link de exemplo foi criado.',
      commission_note: 'commission_rate_pct = comissão do PRODUTO (CSV BatchProductLinks). commission_ceiling_pct = teto "up to NN%" da LOJA (CSV BatchShopLinks) — não é taxa efetiva.'
    },
    offers: inventory
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(doc, null, 2));
  console.log('JSON →', path.relative(ROOT, OUT_JSON));
  console.log('  ofertas:', inventory.length, JSON.stringify(byKind));
  console.log('  keywords:', totalKeywords, '(únicas:', dupKeywords.unique + ', compartilhadas:', dupKeywords.shared + ')');
  if (withRate.length) {
    const avg = (withRate.reduce((a, i) => a + i.commission_rate_pct, 0) / withRate.length).toFixed(2);
    const max = Math.max(...withRate.map((i) => i.commission_rate_pct));
    console.log('  comissão de produto: média', avg + '%', '| máxima', max + '%');
  }

  // ---------------- SQL (aditivo, idempotente) ----------------
  const sqlEscape = (v) => (v === null || v === undefined) ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
  const sqlNum = (v) => (v === null || v === undefined || Number.isNaN(v)) ? 'NULL' : String(v);
  const sqlJson = (v) => `${sqlEscape(JSON.stringify(v))}::jsonb`;

  const cols = ['match_hash','kind','name','store','item_id','commission_rate_pct','commission_ceiling_pct',
    'commission_brl','price_brl','sales_label','product_link','offer_link','offer_shortcode','keywords',
    'offer_period_start','offer_type','region','currency','network','source_file'];
  const val = (i) => '(' + [
    sqlEscape(i.match_hash), sqlEscape(i.kind), sqlEscape(i.name), sqlEscape(i.store), sqlEscape(i.item_id),
    sqlNum(i.commission_rate_pct), sqlNum(i.commission_ceiling_pct), sqlNum(i.commission_brl), sqlNum(i.price_brl),
    sqlEscape(i.sales_label), sqlEscape(i.product_link), sqlEscape(i.offer_link), sqlEscape(i.offer_shortcode),
    sqlJson(i.keywords), sqlEscape(i.offer_period_start), sqlEscape(i.offer_type), sqlEscape(i.region),
    sqlEscape(i.currency), sqlEscape(i.network), sqlEscape(i.source_file)
  ].join(', ') + ')';

  // INSERT em blocos de 100 linhas (fácil de ler no diff, sem estourar o statement_timeout)
  const chunks = [];
  for (let i = 0; i < inventory.length; i += 100) chunks.push(inventory.slice(i, i + 100));

  const sql = `-- ============================================================================
-- supabase_v330_shopee_inventory.sql — Módulo de Ingestão de Ultra-Vazão v330.0
-- GERADO AUTOMATICAMENTE por scripts/build-shopee-inventory.js — não editar à mão.
-- Gerado em: ${doc.generated_at}
-- Fonte: ${doc.source}
--
-- ADITIVO E IDEMPOTENTE. Não apaga, não sobrescreve e não trunca nada:
--  • cria a tabela nova public.nexus_shopee_offers (inventário canônico, read-only);
--  • ESTENDE public.nexus_brand_keywords (que já existia com 691 linhas de viagem/VPN)
--    mantendo as 691 linhas intactas e adicionando as chaves Shopee com kind='shopee_*';
--  • dedupe por md5 de 32 caracteres via índice UNIQUE;
--  • limites do pool PostgREST (statement_timeout 1000ms / lock_timeout 500ms) na
--    transação + bloco EXCEPTION para não derrubar a conexão (erro 57014).
--
-- ${doc.integrity.note}
-- ${doc.integrity.commission_note}
--
-- IMPORTANTE: nenhum link é inventado. Todos os offer_link vêm dos CSVs do painel.
-- ============================================================================

BEGIN;

-- Tetos do pool PostgREST nesta transação.
SET LOCAL statement_timeout = '1000ms';  -- teto exigido pela spec v330.0
SET LOCAL lock_timeout = '500ms';

DO $v330$
DECLARE v_total int; v_kw int; v_status text := 'OK'; v_msg text;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1) Tabela canônica do inventário
  -- -------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.nexus_shopee_offers (
    match_hash              text PRIMARY KEY,
    kind                    text        NOT NULL,
    name                    text        NOT NULL,
    store                   text,
    item_id                 text,
    commission_rate_pct     numeric(6,2),
    commission_ceiling_pct  numeric(6,2),
    commission_brl          numeric(12,2),
    price_brl               numeric(12,2),
    sales_label             text,
    product_link            text,
    offer_link              text        NOT NULL,
    offer_shortcode         text,
    keywords                jsonb       NOT NULL DEFAULT '[]'::jsonb,
    offer_period_start      date,
    offer_type              text,
    region                  text        NOT NULL DEFAULT 'BR',
    currency                text        NOT NULL DEFAULT 'BRL',
    network                 text        NOT NULL DEFAULT 'shopee_affiliate',
    source_file             text,
    read_only               boolean     NOT NULL DEFAULT true,
    updated_at              timestamptz NOT NULL DEFAULT now()
  );

  -- O painel é a única fonte de verdade: UPDATE/DELETE são proibidos.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'nexus_shopee_offers_read_only_guard') THEN
    EXECUTE $ddl$
      CREATE OR REPLACE FUNCTION public.nexus_shopee_offers_block_write()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        RAISE EXCEPTION 'Inventario Shopee e read-only (regra v330.0). Use INSERT ... ON CONFLICT DO NOTHING.';
      END $fn$;
      CREATE TRIGGER nexus_shopee_offers_read_only_guard
        BEFORE UPDATE OR DELETE ON public.nexus_shopee_offers
        FOR EACH ROW EXECUTE FUNCTION public.nexus_shopee_offers_block_write();
    $ddl$;
  END IF;

  -- -------------------------------------------------------------------------
  -- 2) Extensão aditiva de nexus_brand_keywords (691 linhas existentes intactas)
  -- -------------------------------------------------------------------------
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS kind            text;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS offer_link      text;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS product_link    text;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS store           text;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS item_id         text;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS commission_rate_pct numeric(6,2);
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS match_hash      text;
  ALTER TABLE public.nexus_brand_keywords ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

  -- Unicidade por PAR (oferta, keyword). Só match_hash colidiria: cada oferta gera
  -- vários indexadores e todos compartilham o mesmo hash da oferta.
  -- A chave lógica continua sendo keyword (PK), então keyword repetida entre ofertas
  -- também não entra.
  CREATE UNIQUE INDEX IF NOT EXISTS nexus_brand_keywords_match_hash_uidx
    ON public.nexus_brand_keywords (match_hash, keyword) WHERE match_hash IS NOT NULL;
  CREATE INDEX IF NOT EXISTS nexus_brand_keywords_kind_idx
    ON public.nexus_brand_keywords (kind) WHERE kind IS NOT NULL;

  -- -------------------------------------------------------------------------
  -- 3) Carga do inventário (${inventory.length} ofertas reais)
  --    Chave lógica = keyword; prefixo 'shopee:' evita colisão com as 691
  --    chaves de viagem/VPN já existentes.
  -- -------------------------------------------------------------------------
${chunks.map((chunk, ci) => `  -- bloco ${ci + 1}/${chunks.length}
  INSERT INTO public.nexus_shopee_offers
    (${cols.join(', ')})
  VALUES
${chunk.map(val).join(',\n')}
  ON CONFLICT (match_hash) DO NOTHING;

  INSERT INTO public.nexus_brand_keywords (keyword, active, kind, offer_link, product_link, store, item_id, commission_rate_pct, match_hash)
  SELECT lower('shopee:' || k.kw), true, o.kind, o.offer_link, o.product_link, o.store, o.item_id,
         o.commission_rate_pct, o.match_hash
    FROM public.nexus_shopee_offers o
    CROSS JOIN LATERAL jsonb_array_elements_text(o.keywords) AS k(kw)
   WHERE o.match_hash = ANY (ARRAY[${chunk.map((x) => sqlEscape(x.match_hash)).join(', ')}]::text[])
     AND length(k.kw) >= 4
   -- Comissão maior ganha a keyword compartilhada (do nada, o melhor anúncio paga).
   ORDER BY (o.commission_rate_pct IS NULL), o.commission_rate_pct DESC, o.match_hash
  ON CONFLICT (keyword) DO NOTHING;`).join('\n\n')}

  -- -------------------------------------------------------------------------
  -- 4) Conferência (esperado: 500 produtos + 200 lojas + 1 categoria = 701)
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_total FROM public.nexus_shopee_offers;
  SELECT count(*) INTO v_kw    FROM public.nexus_brand_keywords WHERE kind LIKE 'shopee%';
  v_msg := format('v330.0 — nexus_shopee_offers=%s ; keywords_shopee=%s', v_total, v_kw);
  RAISE NOTICE '%', v_msg;

  PERFORM set_config('nexus.v330_status', v_status, false);
  PERFORM set_config('nexus.v330_msg',    v_msg,    false);

EXCEPTION WHEN OTHERS THEN
  -- Falha silenciosa e controlada: não derruba o pool do PostgREST (57014/timeout).
  RAISE WARNING 'v330.0 abortado (%). Nada foi aplicado.', SQLERRM;
  PERFORM set_config('nexus.v330_status', 'ABORTADO', false);
  PERFORM set_config('nexus.v330_msg',    SQLERRM,    false);
END
$v330$;

COMMIT;

-- Telemetria do job (o painel lê isto para saber que a onda passou).
INSERT INTO public.nexus_sat_telemetry (job, status, message)
VALUES ('v330-shopee-ingest', current_setting('nexus.v330_status', true),
        left(coalesce(current_setting('nexus.v330_msg', true), 'sem mensagem'), 400));
`;

  // ---- catálogo enxuto para o runtime do gateway (sem keywords gigantes) ----
  const slim = {
    generated_at: doc.generated_at,
    source: doc.source,
    counts: doc.counts,
    offers: {},
    keywords: {}
  };
  for (const it of inventory) {
    slim.offers[it.match_hash] = {
      k: it.kind,
      n: it.name,
      s: it.store,
      u: it.offer_link,
      c: it.commission_rate_pct,
      ce: it.commission_ceiling_pct,
      p: it.price_brl,
      i: it.item_id
    };
    // keyword → oferta de MAIOR comissão (o melhor anúncio paga o clique)
    for (const kw of it.keywords) {
      if (kw.length < 4) continue;
      const cur = slim.keywords[kw];
      if (!cur) slim.keywords[kw] = it.match_hash;
      else {
        const a = slim.offers[cur].c || 0, b = it.commission_rate_pct || 0;
        if (b > a) slim.keywords[kw] = it.match_hash;
      }
    }
  }
  const OUT_SLIM = path.join(ROOT, 'data', 'shopee-offer-links.json');
  fs.writeFileSync(OUT_SLIM, JSON.stringify(slim));
  console.log('SLIM →', path.relative(ROOT, OUT_SLIM), '(' + (fs.statSync(OUT_SLIM).size / 1024).toFixed(0) + ' KB) — ofertas:', Object.keys(slim.offers).length, '| keywords:', Object.keys(slim.keywords).length);

  fs.mkdirSync(path.dirname(OUT_SQL), { recursive: true });
  fs.writeFileSync(OUT_SQL, sql);
  console.log('SQL  →', path.relative(ROOT, OUT_SQL), '(' + (sql.length / 1024).toFixed(0) + ' KB)');
}

main();
