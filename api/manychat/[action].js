/**
 * Router de compatibilidade: /api/manychat/<acao>
 * webhook mantém o handler original; matcher vive em lib/manychat.
 */
const webhookHandler = require('../../lib/manychat/webhook');

module.exports = async (req, res) => {
  const action = (req.query.action || 'webhook').toString().replace(/[^a-z0-9-]/gi, '');

  if (action === 'webhook' && typeof webhookHandler === 'function') {
    return webhookHandler(req, res);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({
    status: 'success',
    action,
    executed_at: new Date().toISOString(),
    compatibility_router: 'api/manychat/[action].js'
  });
};
