module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  
  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Softwares B2B SaaS & Ferramentas de Produtividade</title>
<meta name="description" content="As melhores ferramentas de inteligência artificial, gestão de projetos, no-code e CRM para empresas e criadores."/>
<meta name="robots" content="index, follow, max-image-preview:large"/>
<link rel="canonical" href="https://achadinhos-ad-engine.vercel.app/ferramentas-saas"/>
<style>
  :root{color-scheme:dark}
  body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#030712;color:#f9fafb;padding:24px}
  header{text-align:center;margin-bottom:32px}
  h1{font-size:1.8rem;margin:0 0 8px;color:#3b82f6}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px;max-width:1200px;margin:0 auto}
  .card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px;color:inherit}
  .btn{display:inline-block;background:#3b82f6;color:#fff;font-weight:700;padding:10px 18px;border-radius:6px;margin-top:12px;text-align:center;text-decoration:none;width:100%;box-sizing:border-box}
</style>
</head>
<body>
  <header>
    <h1>🚀 Catálogo B2B SaaS & Cloud Tools</h1>
    <p>Ferramentas selecionadas para produtividade, segurança e escala.</p>
  </header>
  <main class="grid">
    <div class="card">
      <h3>NordVPN Enterprise & Personal</h3>
      <p>VPN com proteção contra ameaças e IP dedicado.</p>
      <a href="/api/ads/go?brand=nordvpn&site=solvegrid&slot=saas" class="btn" rel="sponsored noopener noreferrer nofollow">Experimentar</a>
    </div>
    <div class="card">
      <h3>Surfshark One</h3>
      <p>Suíte completa de segurança cibernética e privacidade.</p>
      <a href="/api/ads/go?brand=surfshark&site=solvegrid&slot=saas" class="btn" rel="sponsored noopener noreferrer nofollow">Acessar</a>
    </div>
  </main>
</body></html>`;

  res.status(200).send(html);
};
