/**
 * v128.8 — Registro de clique COMPROVADO (compartilhado).
 *
 * Só é chamado pelo endpoint /api/ads/click depois de validar um token que o
 * próprio gateway emitiu ao servir o intersticial. Antes (até v128.7) o clique
 * era gravado no próprio GET do link: qualquer frota de robôs que só fazia GET
 * enchia o banco e o Telegram do operador com cliques que nunca existiram —
 * medido em 13/09/2026: 45.025 cliques em 7 dias, nenhum com Accept-Language,
 * 3.220 IPs de proxy e picos de 105 cliques no mesmo minuto.
 */
const crypto = require('crypto');

const NON_MONETIZED = new Set(['udemy', 'brunoyam', 'safetywing', 'thefork', 'wise', 'faculdade']);

function redeDe(destino) {
  const t = String(destino || '');
  if (t.includes('awin1.com')) return 'awin';
  if (/kqzyfj|jdoqocy|dpbolvw|anrdoezrs|tkqlhce/.test(t)) return 'cj';
  if (t.includes('lmdee')) return 'lomadee';
  if (t.includes('shopee')) return 'shopee';
  if (t.includes('mercadolivre') || t.includes('meli.')) return 'mercadolivre';
  if (t.includes('ebay')) return 'ebay';
  if (t.includes('booking.com')) return 'cj';
  return 'generic';
}

/* IP → hash curto (nunca guardamos o IP: LGPD). */
function hashIp(headers) {
  try {
    const ip = String((headers && (headers['x-forwarded-for'] || headers['x-real-ip'])) || '').split(',')[0].trim();
    return ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16) : null;
  } catch (e) { return null; }
}

/**
 * Grava o clique no banco (ads_clicks) e enfileira o aviso no Telegram.
 * Nunca lança: falha aqui não afeta o visitante.
 */
async function registrarClique(dados) {
  const d = dados || {};
  const res = { banco: 'nao_tentado', fila: 'nao_tentada' };
  const destino = String(d.targetUrl || '');
  const ipHash = hashIp(d.headers);
  const rede = redeDe(destino);

  /* ── 1. banco de cliques ───────────────────────────────────────────────── */
  try {
    const dbUrl = process.env.CLICKS_DB_URL;
    const dbKey = process.env.CLICKS_DB_KEY;
    if (dbUrl && dbKey) {
      let refPage = null;
      try { refPage = new URL((d.headers && d.headers.referer) || '').pathname; } catch (e) {}
      const ctrl = new AbortController();
      const tmr = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`${dbUrl.replace(/\/$/, '')}/rest/v1/ads_clicks`, {
        method: 'POST',
        headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({
          site_slug: d.site || null,
          slot: String(d.slot || '').slice(0, 120) || null,
          ad_id: String(d.brand || '').slice(0, 80) || null,
          network: rede,
          click_url: destino.slice(0, 500),
          click_ref: String(d.sidTag || '').slice(0, 120),
          country: d.country || null,
          user_agent: String((d.headers && d.headers['user-agent']) || '').slice(0, 200),
          referrer: String((d.headers && d.headers.referer) || '').slice(0, 300),
          page_path: refPage,
          device_type: /Mobile|Android|iPhone/i.test(String((d.headers && d.headers['user-agent']) || '')) ? 'mobile' : 'desktop',
          ip_hash: ipHash
        }),
        signal: ctrl.signal
      }).catch(() => null);
      clearTimeout(tmr);
      res.banco = r && r.ok ? 'gravado' : (r ? 'http_' + r.status + ':' + String(r.statusText || '').slice(0,20) : 'falhou_rede');
    } else {
      res.banco = 'sem_credencial';
    }
  } catch (e) { res.banco = 'erro:' + String((e && e.message) || e).slice(0, 44); }

  /* ── 2. fila do Telegram (fan-out, blocos de 18/min pelo cron) ─────────── */
  try {
    const sbUrl = process.env.SUPABASE_URL;
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (sbUrl && sbKey) {
      let destinos = 0;
      try { destinos = require('../telegram/fanout').destinationsFor('clicks').length; } catch (e) { destinos = 0; }
      const agora = new Date().toISOString();
      const ctrl2 = new AbortController();
      const tmr2 = setTimeout(() => ctrl2.abort(), 3000);
      const r2 = await fetch(`${sbUrl.replace(/\/$/, '')}/rest/v1/nexus_telegram_message_buffer`, {
        method: 'POST',
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify([{
          dedupe_key: `click:${d.sidTag || ''}:${d.brand || ''}:${agora.slice(0, 16)}`,
          chat_id: 'fanout',
          body_text: `🖱️ <b>Clique comprovado</b> ${String(d.brand || '')} | ${String(d.country || '')}\n`
            + `tag: <code>${String(d.sidTag || '').slice(0, 60)}</code>\n`
            + `slot: <code>${String(d.slot || '')}</code> | anúncio: ${String(d.anuncio || 'desconhecido')}`,
          parse_mode: 'HTML',
          payload: {
            tipo: 'clique', kind: 'clicks', fanout: true, brand: d.brand, country: d.country, sid: d.sidTag,
            slot: d.slot, site: d.site, comprovado: true, anuncio: d.anuncio || null,
            base_link: destino.slice(0, 300), em: agora
          },
          status: 'pending', attempts: 0, max_attempts: 3
        }]),
        signal: ctrl2.signal
      }).catch(() => null);
      clearTimeout(tmr2);
      res.fila = r2 && r2.ok ? 'enfileirado_' + destinos : (r2 ? 'http_' + r2.status : 'falhou');
    } else {
      res.fila = 'sem_credencial';
    }
  } catch (e) { res.fila = 'erro'; }

  return res;
}

module.exports = { registrarClique, hashIp, redeDe, NON_MONETIZED };
