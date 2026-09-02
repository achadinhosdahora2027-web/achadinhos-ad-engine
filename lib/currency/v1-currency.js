const fs = require('fs');
const path = require('path');

const COUNTRY_MAP = {
  BR: { currency: 'BRL', locale: 'pt-BR', symbol: 'R$', iof: true },
  US: { currency: 'USD', locale: 'en-US', symbol: '$', iof: false },
  GB: { currency: 'GBP', locale: 'en-GB', symbol: '£', iof: false },
  DE: { currency: 'EUR', locale: 'de-DE', symbol: '€', iof: false },
  FR: { currency: 'EUR', locale: 'fr-FR', symbol: '€', iof: false },
  ES: { currency: 'EUR', locale: 'es-ES', symbol: '€', iof: false },
  IT: { currency: 'EUR', locale: 'it-IT', symbol: '€', iof: false },
  JP: { currency: 'JPY', locale: 'ja-JP', symbol: '¥', iof: false },
  CN: { currency: 'CNY', locale: 'zh-CN', symbol: '¥', iof: false },
  CA: { currency: 'CAD', locale: 'en-CA', symbol: 'CA$', iof: false },
  AU: { currency: 'AUD', locale: 'en-AU', symbol: 'A$', iof: false },
  MX: { currency: 'MXN', locale: 'es-MX', symbol: 'Mex$', iof: false },
  CH: { currency: 'CHF', locale: 'de-CH', symbol: 'CHF', iof: false },
  IN: { currency: 'INR', locale: 'en-IN', symbol: '₹', iof: false },
  KR: { currency: 'KRW', locale: 'ko-KR', symbol: '₩', iof: false }
};

function loadRates() {
  const possiblePaths = [
    path.join(__dirname, '..', '..', 'data', 'exchange-rates.json'),
    path.join(process.cwd(), 'data', 'exchange-rates.json')
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      }
    } catch (e) {}
  }

  return {
    base: 'USD',
    date: '2026-08-28',
    source: 'fallback',
    iofPercent: 3.38,
    rates: { BRL: 5.1641, EUR: 0.85889, GBP: 0.73624, JPY: 159.68, CNY: 6.7209, CAD: 1.3854, AUD: 1.3899 }
  };
}

function convert(amount, targetCurrency, baseCurrency = 'USD', applyIof = false) {
  const ratesData = loadRates();
  const rates = ratesData.rates || {};
  rates[ratesData.base || 'USD'] = 1.0;

  if (!rates[baseCurrency] || !rates[targetCurrency]) {
    throw new Error(`Taxa não disponível para par ${baseCurrency}->${targetCurrency}`);
  }

  const inBase = amount / rates[baseCurrency];
  let converted = inBase * rates[targetCurrency];

  if (applyIof && targetCurrency === 'BRL') {
    converted = converted * (1 + (ratesData.iofPercent || 3.38) / 100);
  }

  return {
    value: Number(converted.toFixed(2)),
    rate: rates[targetCurrency],
    date: ratesData.date,
    source: ratesData.source
  };
}

function formatLocal(amount, countryCode = 'BR') {
  const cfg = COUNTRY_MAP[countryCode.toUpperCase()] || COUNTRY_MAP.BR;
  try {
    return new Intl.NumberFormat(cfg.locale, {
      style: 'currency',
      currency: cfg.currency
    }).format(amount);
  } catch (e) {
    return `${cfg.symbol} ${amount.toFixed(2)}`;
  }
}

function priceGrid(amountUsd) {
  const res = {};
  for (const [cc, cfg] of Object.entries(COUNTRY_MAP)) {
    try {
      const conv = convert(amountUsd, cfg.currency, 'USD', cfg.iof);
      res[cc] = {
        currency: cfg.currency,
        value: conv.value,
        formatted: formatLocal(conv.value, cc)
      };
    } catch (e) {
      // skip
    }
  }
  return res;
}

module.exports = {
  COUNTRY_MAP,
  loadRates,
  convert,
  formatLocal,
  priceGrid
};
