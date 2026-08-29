const { COUNTRY_MAP, convert, formatLocal } = require('../../../../v1/currency');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=21600, s-maxage=21600, stale-while-revalidate=3600');

  const country = (req.query.country || 'BR').toUpperCase();
  const amount = parseFloat(req.query.amount || '0');
  const from = (req.query.from || 'USD').toUpperCase();
  const applyIof = req.query.iof === 'true' || req.query.iof === '1';

  if (!COUNTRY_MAP[country]) {
    return res.status(400).json({
      ok: false,
      error: `País '${country}' não suportado`,
      availableCountries: Object.keys(COUNTRY_MAP)
    });
  }

  const targetCfg = COUNTRY_MAP[country];

  try {
    const conv = convert(amount, targetCfg.currency, from, applyIof);
    const formatted = formatLocal(conv.value, country);

    res.status(200).json({
      ok: true,
      country,
      locale: targetCfg.locale,
      from,
      amount,
      converted: true,
      value: conv.value,
      formatted,
      currency: targetCfg.currency,
      rate: conv.rate,
      iofApplied: applyIof,
      iofPercent: applyIof ? 3.38 : 0,
      source: conv.source,
      date: conv.date
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
};
