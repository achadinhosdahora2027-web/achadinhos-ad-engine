/**
 * Testa se a CDN da Adsterra aceita a tag conforme o DOMÍNIO DE ORIGEM (referer).
 * Serve a mesma página de teste em cada host real (via host-resolver-rules) e
 * mede o status/bytes de cada tag. Responde à pergunta: o 403 é do referer?
 * uso: node tagtest.js
 */
const http = require('http');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/tmp/node_modules/playwright-core');

const HOSTS = {
  'www.aquitemachadinhos.com.br': {
    socialbar: 'https://undergocutlery.com/a0/4b/ea/a04bea8f13eec4c1e3b87777107a3c6e.js',
    popunder: 'https://undergocutlery.com/n125219ufh?key=0474000233cefd60e54ca390d15beaaf'
  },
  'www.solvegrid.com.br': {
    socialbar: 'https://undergocutlery.com/24/92/83/24928371ac3714c625a6644222607191.js',
    popunder: 'https://undergocutlery.com/kpppprb1h5?key=3d010529a102de694b51b617cbfa2221'
  },
  'nexusplataforma.ia.br': {
    socialbar: null,
    popunder: 'https://undergocutlery.com/zqmeg0npik?key=9829517559c74ab7fd87b787ee036287'
  },
  'achadinhos-ad-engine.vercel.app': {
    socialbar: 'https://undergocutlery.com/65/0f/e1/650fe1ea8c40a70c29031a35f6ac5e49.js',
    popunder: 'https://undergocutlery.com/v6k6sq45dm?key=90f19ab095cebec116b7ee5f129e1b2b'
  }
};

const PORTA = 8081;
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const server = http.createServer((req, res) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  const cfg = HOSTS[host] || {};
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">'
    + '<title>teste de tag ' + host + '</title>'
    + (cfg.socialbar ? '<script src="' + cfg.socialbar + '" data-cfasync="false"></script>' : '<!-- sem socialbar para este host -->')
    + '</head><body><h1>' + host + '</h1><p>teste de tag</p></body></html>');
});

server.listen(PORTA, '0.0.0.0', async () => {
  const lista = Object.keys(HOSTS);
  const args = ['--no-sandbox', '--disable-dev-shm-usage',
    '--host-resolver-rules=' + lista.map(h => 'MAP ' + h + ' 127.0.0.1:' + PORTA).join(', ') + ', EXCLUDE 127.0.0.1'];
  const b = await chromium.launch({ args });
  for (const host of lista) {
    const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR' });
    const p = await ctx.newPage();
    const achados = [];
    p.on('response', async r => {
      const u = r.url();
      if (/undergocutlery|highperformance|profitablerate/.test(u)) {
        let bytes = null; try { bytes = (await r.body()).length; } catch (_) {}
        achados.push({ u, s: r.status(), b: bytes });
      }
    });
    await p.goto('http://' + host + '/tagtest.html', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(5000);
    console.log('══ origem: ' + host);
    if (!achados.length) console.log('      (nenhuma requisição de tag Adsterra)');
    achados.forEach(x => console.log('      ' + x.s + ' ' + (x.b === null ? '?' : x.b + 'B') + '  ' + x.u.replace('https://undergocutlery.com', '').slice(0, 70)));
    await ctx.close();
  }
  await b.close();
  server.close();
});
