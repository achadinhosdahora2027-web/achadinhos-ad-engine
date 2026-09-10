// ==========================================================================
// v24.0 — AUDIÊNCIA AO VIVO & ESCASSEZ REAL (/api/live?slug=...)
// Contadores 100% REAIS: sessões assistindo agora (heartbeats 90s), ofertas
// ativas do hub e cliques humanos 24h. ZERO número inventado — sem audiência
// o contador simplesmente não aparece na vitrine.
// ==========================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

async function rpc(name, args) {
  const u = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/${name}`);
  const r = await fetch(u, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  if (!r.ok) return null;
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    const slug = String((req.query && req.query.slug) || '').replace(/[^a-z0-9-]/g, '').slice(0, 120);
    const board = slug ? await rpc('nexus_scarcity_board', { p_slug: slug }) : null;
    const audience = await rpc('nexus_live_audience', {});
    res.status(200).json({
      ok: true,
      slug: slug || null,
      escassez: board || null,       // assistindo_agora · ofertas_ativas · cliques_24h (REAIS)
      audiencia: audience || null,   // vitrines com sessões ativas agora
    });
  } catch (e) {
    res.status(200).json({ ok: false }); // fail-closed: vitrine segue sem badge
  }
};
