/**
 * MEDIÇÃO v2 do intersticial em Chromium real.
 * Mede: estado das tags, abertura do popunder no gesto, erros de console e
 * requisições de rede (status/tamanho). Não grava nada em produção.
 * uso: node medir2.js <url> <rotulo>
 */
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/tmp/node_modules/playwright-core');

const URL_ALVO = process.argv[2];
const ROTULO = process.argv[3] || 'probe';
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

(async () => {
  const b = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage',
      '--host-resolver-rules=MAP achadinhos-ad-engine.vercel.app 127.0.0.1, MAP www.aquitemachadinhos.com.br 127.0.0.1, MAP aquitemachadinhos.com.br 127.0.0.1, MAP www.solvegrid.com.br 127.0.0.1']
  });
  const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR', viewport: { width: 412, height: 915 } });
  const p = await ctx.newPage();

  const erros = [];
  const reqs = [];
  p.on('console', m => { if (m.type() === 'error') erros.push(m.text().slice(0, 200)); });
  p.on('pageerror', e => erros.push('PAGEERROR: ' + String(e.message).slice(0, 200)));
  p.on('response', async r => {
    const u = r.url();
    if (/undergocutlery|quge5|auqot|ekhay|b3mny|6opo/.test(u)) {
      let bytes = null; try { bytes = (await r.body()).length; } catch (_) { bytes = -1; }
      reqs.push({ u, status: r.status(), bytes });
    }
  });

  console.log('== ' + ROTULO);
  const resp = await p.goto(URL_ALVO, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('   HTTP ' + resp.status() + ' | binding: ' + (await resp.headerValue('x-adsterra-binding')));
  console.log('   referrer-policy: ' + (await resp.headerValue('referrer-policy')));
  await p.waitForTimeout(2500);
  const estado = await p.evaluate(() => window.__nexusAds || null).catch(() => null);
  console.log('   estado das tags: ' + JSON.stringify(estado));

  // gesto do visitante (toque/clique) — é o que dispara o Direct Link
  await p.click('#go', { force: true, noWaitAfter: true, timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(1200);
  const estado2 = await p.evaluate(() => window.__nexusAds || null).catch(() => null);
  console.log('   estado depois do clique: ' + JSON.stringify(estado2));
  console.log('   abas abertas: ' + ctx.pages().length + ' → ' + JSON.stringify(ctx.pages().map(x => x.url().slice(0, 70))));
  console.log('   erros de console: ' + (erros.length || 0));
  erros.forEach(e => console.log('      ! ' + e));
  console.log('   requisições de rede (' + reqs.length + '):');
  reqs.slice(0, 8).forEach(r => console.log('      ' + r.status + ' ' + (r.bytes === -1 ? '?' : r.bytes + 'B') + '  ' + r.u.slice(0, 96)));
  await b.close();
})().catch(e => { console.log('FALHA: ' + String(e).split('\n')[0]); process.exit(1); });
