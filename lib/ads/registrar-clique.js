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
 * Grava o clique no banco (ads_clicks). O trigger PostgreSQL v420 enfileira o
 * lote 1:1; este processo não toca mais no buffer legado nem faz fan-out.
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
          ip_hash: ipHash,
          metadata: {
            is_bot: false,
            proved_human: true,
            proof: 'interstitial_beacon',
            ad_state: String(d.anuncio || 'desconhecido').slice(0, 24),
            channel_pipeline: 'v420.0'
          }
        }),
        signal: ctrl.signal
      }).catch(() => null);
      clearTimeout(tmr);
      res.banco = r && r.ok ? 'gravado' : (r ? 'http_' + r.status + ':' + String(r.statusText || '').slice(0,20) : 'falhou_rede');
    } else {
      res.banco = 'sem_credencial';
    }
  } catch (e) { res.banco = 'erro:' + String((e && e.message) || e).slice(0, 44); }

  /* ── 2. mensageria v420 ──────────────────────────────────────────────────
     Não existe mais uma segunda escrita em buffer/fan-out. O AFTER INSERT de
     public.ads_clicks cria o evento no outbox 1:1 do grupo CLIQUES dentro da
     mesma transação do banco. Isso elimina a corrida que gerava duas mensagens
     para um único clique e impede que o payload seja reinterpretado por destino. */
  res.fila = res.banco === 'gravado' ? 'trigger_v420_1to1' : 'nao_enfileirada';

  return res;
}

module.exports = { registrarClique, hashIp, redeDe, NON_MONETIZED };
