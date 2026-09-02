/**
 * Router de compatibilidade: /api/ads/<acao>
 * go permanece standalone (rota crítica de receita).
 * deals/saas/status/exchange-rates servidos a partir de lib/ads.
 */
const handlers = {
  deals: require('../../lib/ads/deals'),
  saas: require('../../lib/ads/saas'),
  status: require('../../lib/ads/status'),
  'exchange-rates': require('../../lib/ads/exchange-rates')
};

module.exports = async (req, res) => {
  const action = (req.query.action || '').toString().replace(/[^a-z0-9-]/gi, '');
  const handler = handlers[action];

  if (typeof handler === 'function') {
    return handler(req, res);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(404).json({
    error: 'unknown_action',
    available: Object.keys(handlers),
    hint: 'Use /api/ads/deals, /api/ads/saas, /api/ads/status ou /api/ads/exchange-rates'
  });
};
