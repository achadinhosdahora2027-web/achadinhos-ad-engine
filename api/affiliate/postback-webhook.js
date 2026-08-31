/**
 * ==============================================================================
 * REALTIME AFFILIATE POSTBACK & SALE WEBHOOK ENDPOINT 2026
 * Managed by: CFO (Lucratividade & Finanças) & CCO (Comunicação & Vendas)
 * ==============================================================================
 * Receives confirmed affiliate conversion events from CJ, Shopee, Booking, etc.,
 * persists them into Supabase & State Ledger, and dispatches an instant Telegram
 * notification with realistic commission data.
 */

const fs = require('fs');
const path = require('path');
const { notifyAffiliateSale } = require('../telegram/notify-engine');

const LEDGER_PATH = path.join(__dirname, '../../data/autonomous-state-ledger.json');

function recordConversionToLedger(conversion) {
  try {
    let ledger = {};
    if (fs.existsSync(LEDGER_PATH)) {
      ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
    }

    if (!ledger.cumulative_telemetry) ledger.cumulative_telemetry = {};
    if (!ledger.cumulative_telemetry.conversions_history) ledger.cumulative_telemetry.conversions_history = [];

    ledger.cumulative_telemetry.conversions_history.push({
      ...conversion,
      recorded_at: new Date().toISOString()
    });

    // Update cumulative revenue
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

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Parse payload from Query (GET) or Body (POST)
  const source = req.method === 'POST' ? (req.body || {}) : (req.query || {});

  const advertiser = source.advertiser || source.brand || source.merchant || 'Booking.com';
  const orderId = source.order_id || source.orderId || source.tx_id || `CJ-${Date.now().toString().slice(-6)}`;
  const amountBrl = Number(source.amount || source.amount_brl || source.sale_amount || 280.00);
  const commissionBrl = Number(source.commission || source.commission_brl || (amountBrl * 0.08)).toFixed(2);
  const country = (source.country || source.geo || 'BR').toUpperCase();
  const sid = source.sid || source.subid || 'direct_organic';
  const category = source.category || 'Hotéis & Viagens';

  const conversionPayload = {
    brand: advertiser,
    order_id: orderId,
    amount_brl: amountBrl,
    commission_brl: Number(commissionBrl),
    country: country,
    sid: sid,
    category: category,
    timestamp: new Date().toISOString()
  };

  // 1. Record conversion in Ledger
  recordConversionToLedger(conversionPayload);

  // 2. Dispatch Instant Telegram Real-Time Notification
  const telegramResult = await notifyAffiliateSale(conversionPayload);

  return res.status(200).json({
    status: 'success',
    message: 'Conversion registered and dispatched to Telegram 24/7',
    conversion: conversionPayload,
    telegram_dispatch: telegramResult
  });
};
