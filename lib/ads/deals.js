module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  
  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Ofertas e Deals eBay — eletrônicos e importados com desconto</title>
<meta name="description" content="Seleção de ofertas e deals do eBay: eletrônicos e importados com desconto. Link de afiliado (eBay Partner Network)."/>
<meta name="robots" content="index, follow, max-image-preview:large"/>
<link rel="canonical" href="https://achadinhos-ad-engine.vercel.app/leiloes-ebay"/>
<style>
  :root{color-scheme:dark}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e2e8f0;padding:24px}
  header{text-align:center;margin-bottom:32px}
  h1{font-size:1.8rem;margin:0 0 8px;color:#38bdf8}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;max-width:1200px;margin:0 auto}
  .card{background:#111a2e;border:1px solid #1e293b;border-radius:12px;padding:16px;text-decoration:none;color:inherit;transition:0.2s}
  .card:hover{transform:translateY(-2px);border-color:#38bdf8}
  .btn{display:inline-block;background:#38bdf8;color:#0b1220;font-weight:700;padding:8px 16px;border-radius:6px;margin-top:12px;text-align:center;width:100%;box-sizing:border-box}
</style>
</head>
<body>
  <header>
    <h1>⚡ Ofertas & Deals eBay</h1>
    <p>Oportunidades verificadas e atualizadas pelo motor de ofertas.</p>
  </header>
  <main class="grid">
    <div class="card">
      <h3>Eletrônicos & Smart Devices</h3>
      <p>Lotes verificados com envio internacional e rastreio.</p>
      <a href="/api/ads/go?brand=ebay&site=adengine&slot=deals" class="btn" rel="sponsored noopener noreferrer nofollow">Ver no eBay</a>
    </div>
    <div class="card">
      <h3>Proteção Online NordVPN</h3>
      <p>Criptografia de ponta e servidores ultra-rápidos com 70% OFF.</p>
      <a href="/api/ads/go?brand=nordvpn&site=adengine&slot=deals" class="btn" rel="sponsored noopener noreferrer nofollow">Ativar Cupom</a>
    </div>
  </main>
</body></html>`;

  res.status(200).send(html);
};
