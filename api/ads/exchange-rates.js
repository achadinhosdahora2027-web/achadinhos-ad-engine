const { loadRates } = require('../../v1/currency');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=21600, s-maxage=21600, stale-while-revalidate=3600');

  try {
    const data = loadRates();
    const reqBase = (req.query.base || 'USD').toUpperCase();
    const reqCur = req.query.cur ? req.query.cur.split(',').map(c => c.trim().toUpperCase()) : null;

    let filteredRates = { ...data.rates };
    if (reqCur) {
      filteredRates = {};
      for (const c of reqCur) {
        if (data.rates[c]) {
          filteredRates[c] = data.rates[c];
        }
      }
    }

    res.status(200).json({
      ok: true,
      base: reqBase,
      date: data.date,
      source: data.source,
      stale: false,
      iofPercent: data.iofPercent || 3.38,
      rates: filteredRates
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: "Serviço de câmbio temporariamente indisponível",
      details: err.message
    });
  }
};
