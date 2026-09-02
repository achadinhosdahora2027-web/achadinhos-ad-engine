/**
 * Router de compatibilidade: /api/meta/<acao>
 * Módulos reais vivem em lib/meta.
 */
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const action = (req.query.action || '').toString().replace(/[^a-z0-9-]/gi, '');

  return res.status(200).json({
    status: 'success',
    action: action || 'index',
    executed_at: new Date().toISOString(),
    compatibility_router: 'api/meta/[action].js'
  });
};
