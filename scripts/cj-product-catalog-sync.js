#!/usr/bin/env node
'use strict';
/**
 * CJ Product Feed read-only synchronizer (v3360.0).
 *
 * partnerIds are ADVERTISER CIDs. A publisher promotional-property PID belongs
 * only in linkCode(pid: ...). This implementation uses partnerStatus: JOINED so
 * it cannot repeat the former PID/partnerIds category error.
 *
 * Safety: performs read-only API queries; never follows a tracking URL; never
 * emits a token, company CID, property PID, tracking URL, direct URL, or image
 * URL to stdout or the persisted report.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'cj-product-feed-live.json');
const ENDPOINT = process.env.CJ_GRAPHQL_ENDPOINT || 'https://ads.api.cj.com/query';
const argv = process.argv.slice(2);
const argOf = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const cleanCode = (v, re, label) => { const x = String(v || '').trim(); if (!re.test(x)) throw new Error(`${label}_invalid`); return x; };
const KEYWORDS = argOf('--keywords', 'travel,hotel,flight,vacation,rental').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10);
const LIMIT = Math.min(100, Math.max(1, Number.parseInt(argOf('--limit', '30'), 10) || 30));
let COUNTRY, CURRENCY;
try {
  COUNTRY = cleanCode(argOf('--country', 'BR').toUpperCase(), /^[A-Z]{2}$/, 'country');
  CURRENCY = cleanCode(argOf('--currency', 'BRL').toUpperCase(), /^[A-Z]{3}$/, 'currency');
} catch (e) { console.error(`CJ sync disabled: ${e.message}`); process.exit(1); }
const TOKEN = process.env.CJ_ACCESS_TOKEN || '';
const COMPANY_ID = process.env.CJ_COMPANY_ID || process.env.CJ_CID || '';
const PROPERTY_PID = process.env.CJ_PROPERTY_PID || process.env.CJ_PID || '';
const gqlString = (v) => JSON.stringify(String(v));
const hostHash = (value) => {
  try { const h = new URL(value).hostname.toLowerCase(); return crypto.createHash('sha256').update(h).digest('hex'); }
  catch (_) { return null; }
};
async function gql(query) {
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 40000);
  try {
    const response = await fetch(ENDPOINT, { method: 'POST', signal: ctrl.signal, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) return { error: `http_${response.status}` };
    if (!body || body.errors) return { error: 'graphql_rejected' };
    return { data: body.data };
  } catch (e) { return { error: e && e.name === 'AbortError' ? 'timeout' : 'network_error' }; }
  finally { clearTimeout(timer); }
}
function productQuery(keyword, joinedOnly) {
  return `query { shoppingProducts(companyId: ${gqlString(COMPANY_ID)}, ${joinedOnly ? 'partnerStatus: JOINED, ' : ''}keywords: [${gqlString(keyword)}], currency: ${gqlString(CURRENCY)}, serviceableAreas: [${gqlString(COUNTRY)}], limit: ${LIMIT}) { totalCount resultList { id adId title brand advertiserId advertiserName advertiserCountry targetCountry availability discountPercentage price { amount currency } salePrice { amount currency } joinedStatus linkCode(pid: ${gqlString(PROPERTY_PID)}) { clickUrl } link } } }`;
}
function sanitizeProduct(p) {
  const generated = Boolean(p && p.linkCode && p.linkCode.clickUrl);
  return {
    id: p.id || null, ad_id: p.adId || null, title: p.title || null,
    brand: p.brand || null, advertiser: p.advertiserName || null,
    advertiser_id: p.advertiserId || null, advertiser_country: p.advertiserCountry || null,
    target_country: p.targetCountry || null, availability: p.availability || null,
    discount_percentage: p.discountPercentage == null ? null : p.discountPercentage,
    price: p.price || null, sale_price: p.salePrice || null,
    joined: p.joinedStatus === true, affiliate_link_ready: generated,
    affiliate_host_sha256: generated ? hostHash(p.linkCode.clickUrl) : null,
    direct_host_sha256: p.link ? hostHash(p.link) : null,
    affiliate_url_recorded: false, direct_url_recorded: false, image_url_recorded: false,
  };
}
async function main() {
  if (!TOKEN || !/^\d+$/.test(COMPANY_ID) || !/^\d+$/.test(PROPERTY_PID)) {
    console.error('CJ sync disabled: required protected bindings are absent or invalid'); process.exit(1);
  }
  const joined = {}, market = {}; const seen = new Map(); let failed = false;
  for (const keyword of KEYWORDS) {
    for (const [bucket, joinedOnly] of [[joined, true], [market, false]]) {
      const result = await gql(productQuery(keyword, joinedOnly));
      if (result.error) { bucket[keyword] = { error: result.error }; failed = true; continue; }
      const products = result.data && result.data.shoppingProducts;
      if (!products) { bucket[keyword] = { error: 'response_shape_invalid' }; failed = true; continue; }
      bucket[keyword] = { total: products.totalCount, sampled: (products.resultList || []).length };
      for (const p of products.resultList || []) seen.set(String(p.id), sanitizeProduct(p));
    }
  }
  const products = [...seen.values()];
  const report = {
    version: 'v3360.0', generated_at: new Date().toISOString(), endpoint: ENDPOINT,
    binding_present: true, binding_values_recorded: false,
    filter: { serviceable_area: COUNTRY, currency: CURRENCY, keywords: KEYWORDS, limit: LIMIT },
    joined_query: joined, market_query: market,
    diagnostics: {
      unique_products_sampled: products.length,
      joined_products_sampled: products.filter(x => x.joined).length,
      pid_generated_links_sampled: products.filter(x => x.affiliate_link_ready).length,
      query_failures_present: failed,
      routing_ready: !failed && products.some(x => x.joined && x.affiliate_link_ready),
    },
    products: products.slice(0, 200), read_only: true, affiliate_urls_recorded: false,
    affiliate_urls_followed: false, clicks_performed: false, conversions_claimed: false,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ version: report.version, generated_at: report.generated_at, country: COUNTRY, currency: CURRENCY, query_failures_present: failed, unique_products_sampled: products.length, pid_generated_links_sampled: report.diagnostics.pid_generated_links_sampled, routing_ready: report.diagnostics.routing_ready, sensitive_values_emitted: false }));
  process.exit(failed ? 2 : 0);
}
main().catch(() => { console.error('CJ sync failed closed'); process.exit(1); });
