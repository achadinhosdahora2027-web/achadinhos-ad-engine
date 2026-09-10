// ==========================================================================
// v24.0 — CAPTURA COMPORTAMENTAL REALTIME (/api/signal)
// Recebe sinais de comportamento das vitrines: rage_click, exit_intent,
// scroll_depth, heartbeat (time-on-page) e view. Grava no Supabase
// (nexus_behavior_signals) com gatilho LISTEN/NOTIFY 'nexus_scarcity'.
// ANTIFRAUDE REAL: sessão abusiva (>120 sinais/10min) → HTTP 429 (bloqueio).
// FAIL-CLOSED: qualquer falha → 204 silencioso (a página NUNCA quebra).
// ==========================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const KINDS = new Set(['view', 'rage_click', 'exit_intent', 'scroll_depth', 'heartbeat']);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(204).end(); return; }

  try {
    const b = req.body || {};
    const kind = String(b.kind || '');
    if (!KINDS.has(kind)) { res.status(204).end(); return; }

    const session = String(b.session || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
    const slug = String(b.slug || '').replace(/[^a-z0-9-]/g, '').slice(0, 120);
    const brand = String(b.brand || '').slice(0, 120);
    const device = String(b.device || '').slice(0, 40);
    let meta = {};
    try { meta = (typeof b.meta === 'object' && b.meta) || {}; } catch (e) { meta = {}; }

    // Antifraude por sessão (bloqueio REAL de abuso — RPC no banco)
    if (session) {
      try {
        const u = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/nexus_is_abusive_session`);
        const r = await fetch(u, {
          method: 'POST',
          headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({ p_session: session }),
        });
        const j = await r.json();
        if (j === true) { res.status(429).end(); return; } // sessão abusiva bloqueada
      } catch (e) { /* falha na checagem nunca bloquea legítimo */ }
    }

    try {
      const u = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/nexus_behavior_signals`);
      await fetch(u, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({
          kind, slug: slug || null, brand: brand || null,
          session_id: session || null, device: device || null, meta,
        }),
      });
    } catch (e) { /* sinal pode se perder; a página nunca sabe */ }
  } catch (e) { /* fail-closed absoluto */ }
  res.status(204).end();
};
