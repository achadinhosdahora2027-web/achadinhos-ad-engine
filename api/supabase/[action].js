/**
 * Router de compatibilidade: /api/supabase/<acao>
 * ledger-sync mantém o handler original; vector-ai vive em lib/supabase.
 */
const ledgerSyncHandler = require('../../lib/supabase/ledger-sync-handler');

module.exports = async (req, res) => {
  const action = (req.query.action || '').toString().replace(/[^a-z0-9-]/gi, '');

  if (action === 'ledger-sync' && typeof ledgerSyncHandler === 'function') {
    return ledgerSyncHandler(req, res);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({
    status: 'success',
    action: action || 'index',
    executed_at: new Date().toISOString(),
    compatibility_router: 'api/supabase/[action].js'
  });
};
