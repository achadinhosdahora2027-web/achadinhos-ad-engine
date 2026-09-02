/**
 * ==============================================================================
 * AFFILIATE POSTBACK & SALE WEBHOOK (produção, à prova de dados falsos)
 * ==============================================================================
 * Recebe conversões reais das redes de afiliados (CJ via automação, Shopee,
 * Booking etc.) com autenticação por chave, deduplicação por order_id,
 * persistência no Supabase e alerta instantâneo no Telegram do dono.
 *
 * SEGURANÇA:
 *  - Exige WEBHOOK_SECRET via header `x-webhook-key` OU query `?key=`
 *  - Sem a chave correta: 401 (nada é gravado, nada é notificado)
 *  - SEM números inventados: sem brand/amount/order_id => 400
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { notifyAffiliateSale } = require('../../lib/telegram/notify-engine');

const LEDGER_PATH = path.join(__dirname, '../../data/autonomous-state-ledger.json');

function sbRequest(method, tablePath, body) {
  const SUPA_URL = process.env.SUPABASE_URL || '';
  const SUPA_KEY = process.env.SUPABASE_ANON_KEY || '';
  if (!SUPA_URL || !SUPA_KEY) return Promise.resolve(null);
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(`${SUPA_URL.replace(/\/$/, '')}/rest/v1/${tablePath}`, {
      method,
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: body ? 'return=minimal' : 'count=exact'
      },
      timeout: 8000
    }, (rs) => {
      let data = '';
      rs.on('data', c => data += c);
      rs.on('end', () => {
        let rows = [];
        try { rows = JSON.parse(data || '[]'); } catch (e) {}
        resolve({ status: rs.statusCode, rows: Array.isArray(rows) ? rows : [], count: rs.headers['content-range'] || null });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    if (payload) req.write(payload);
    req.end();
  });
}

function recordConversionToLedger(conversion) {
  try {
    let ledger = fs.existsSync(LEDGER_PATH) ? JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8')) : {};
    if (!ledger.cumulative_telemetry) ledger.cumulative_telemetry = {};
    if (!ledger.cumulative_telemetry.conversions_history) ledger.cumulative_telemetry.conversions_history = [];
    ledger.cumulative_telemetry.conversions_history.push({ ...conversion, recorded_at: new Date().toISOString() });
    ledger.cumulative_telemetry.conversions_history = ledger.cumulative_telemetry.conversions_history.slice(-100);
    const currentRev = ledger.cumulative_telemetry.estimated_revenue_brl || 0;
    ledger.cumulative_telemetry.estimated_revenue_brl = Number((currentRev + Number(conversion.commission_brl || 0)).toFixed(2));
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-webhook-key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // 1. Autenticação obrigatória
  const secret = process.env.WEBHOOK_SECRET || '';
  if (!secret) {
    return res.status(503).json({ error: 'webhook_disabled', reason: 'WEBHOOK_SECRET não configurado' });
  }
  const provided = (req.headers['x-webhook-key'] || (req.query || {}).key || '').toString();
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // 2. Payload: POST (body) ou GET (query) — sem defaults inventados
  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const brand = (source.advertiser || source.brand || source.merchant || '').toString().trim();
  const orderId = (source.order_id || source.orderId || source.tx_id || '').toString().trim();
  const amountRaw = source.amount || source.amount_brl || source.sale_amount;
  const amountBrl = Number(amountRaw);

  const missing = [];
  if (!brand) missing.push('brand (ou advertiser/merchant)');
  if (!orderId) missing.push('order_id');
  if (!amountRaw || Number.isNaN(amountBrl) || amountBrl <= 0) missing.push('amount (> 0)');
  if (missing.length) {
    return res.status(400).json({ error: 'invalid_payload', missing, policy: 'nenhum valor é inventado pelo sistema' });
  }

  const commissionBrl = source.commission !== undefined || source.commission_brl !== undefined
    ? Number(source.commission || source.commission_brl || 0)
    : 0;
  const country = (source.country || source.geo || 'BR').toString().toUpperCase().slice(0, 2);
  const sid = (source.sid || source.subid || 'direct_organic').toString().slice(0, 120);
  const category = (source.category || 'geral').toString().slice(0, 60);

  // 3. Deduplicação por (brand, order_id)
  const dup = await sbRequest('GET', `affiliate_conversions?order_id=eq.${encodeURIComponent(orderId)}&brand=eq.${encodeURIComponent(brand)}&select=id&limit=1`, null);
  if (dup && dup.status === 200 && dup.rows.length > 0) {
    return res.status(200).json({ status: 'duplicate', message: 'order_id já registrado — nada foi duplicado', order_id: orderId });
  }

  const conversion = {
    brand: brand.slice(0, 80),
    order_id: orderId.slice(0, 80),
    amount_brl: Number(amountBrl.toFixed(2)),
    commission_brl: Number(commissionBrl.toFixed(2)),
    country,
    sid,
    category,
    timestamp: new Date().toISOString()
  };

  // 4. Persistência real no Supabase
  await sbRequest('POST', 'affiliate_conversions', {
    brand: conversion.brand,
    order_id: conversion.order_id,
    amount_brl: conversion.amount_brl,
    commission_brl: conversion.commission_brl,
    country: conversion.country,
    sid: conversion.sid,
    category: conversion.category,
    raw: source
  });

  // 5. Ledger local (best-effort)
  recordConversionToLedger(conversion);

  // 6. Alerta instantâneo no Telegram do dono
  let telegramResult = null;
  try {
    telegramResult = await notifyAffiliateSale(conversion);
  } catch (e) {
    telegramResult = { sent: false, error: String(e && e.message || e) };
  }

  return res.status(200).json({
    status: 'success',
    conversion,
    telegram_dispatch: telegramResult && (telegramResult.sent || telegramResult.ok) ? 'sent' : 'failed'
  });
};
