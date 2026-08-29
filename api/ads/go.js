// Affiliate Redirect Gateway with dynamic SID injection
const AFFILIATE_ENDPOINTS = {
  nordvpn: "https://www.tkqlhce.com/click-8041957-12884704",
  surfshark: "https://www.dpbolvw.net/click-8041957-13936081",
  booking: "https://www.anrdoezrs.net/click-8041957-15745124",
  carla: "https://www.jdoqocy.com/click-8041957-15892301",
  economybookings: "https://www.tkqlhce.com/click-8041957-13768291",
  malwarebytes: "https://www.anrdoezrs.net/click-8041957-15243102",
  wondershare: "https://www.kqzyfj.com/click-8041957-14298109"
};

module.exports = async (req, res) => {
  const brand = (req.query.brand || req.query.b || '').toLowerCase();
  const site = (req.query.site || 'aquitemachadinhos').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const slot = (req.query.slot || 'header').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const sid = req.query.sid || `${site}_${slot}`;

  let targetUrl = AFFILIATE_ENDPOINTS[brand];
  if (!targetUrl) {
    targetUrl = req.query.url || 'https://www.aquitemachadinhos.com.br';
  }

  // Inject SID for CJ / Admitad tracking
  const sep = targetUrl.includes('?') ? '&' : '?';
  const finalUrl = `${targetUrl}${sep}sid=${encodeURIComponent(sid)}`;

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Location', finalUrl);
  return res.status(307).end();
};
