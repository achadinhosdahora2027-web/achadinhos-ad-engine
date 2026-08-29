# Achadinhos Ad Engine & Global Affiliate Gateway

Motor de alta performance em Vercel Serverless para:
- Atribuição e roteamento dinâmico de cliques (`/api/ads/go?brand=...&site=...&slot=...`).
- Rastreamento e injeção de dynamic SID (`sid={site}_{slot}`).
- API global de câmbio com cache e cálculo de IOF (`/api/ads/exchange-rates` e `/api/ads/global/[country]/currency`).
- Telemetria de anúncios e cliques (`/api/ads/status`).
