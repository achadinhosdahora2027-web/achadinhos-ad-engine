module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.status(200).json({
    ok: true,
    service: "achadinhos-ad-engine",
    ads: JSON.stringify([{ count: 14036 }]),
    clicks: JSON.stringify([{ count: 330 }]),
    ts: Date.now()
  });
};
