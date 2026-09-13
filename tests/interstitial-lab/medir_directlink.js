/**
 * Mede o Direct Link da Adsterra COMO PÁGINA (uso correto), em Chromium real.
 * Reporta cada salto da cadeia de redirect, o status, o tamanho e o título final.
 * uso: node medir_directlink.js <url-do-direct-link> <rotulo>
 */
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/tmp/node_modules/playwright-core');
const URL_ALVO = process.argv[2];
const ROTULO = process.argv[3] || 'direct link';
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR' });
  const p = await ctx.newPage();
  const saltos = [];
  p.on('response', async r => {
    let bytes = null; try { bytes = (await r.body()).length; } catch (_) {}
    saltos.push({ status: r.status(), url: r.url(), ct: (r.headers()['content-type'] || '').slice(0, 30), bytes });
  });
  console.log('== ' + ROTULO + ' :: ' + URL_ALVO);
  try {
    const resp = await p.goto(URL_ALVO, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForTimeout(4000);
    console.log('   status inicial: ' + resp.status());
    console.log('   url final: ' + p.url().slice(0, 130));
    console.log('   título: ' + JSON.stringify((await p.title()).slice(0, 80)));
    const txt = (await p.evaluate(() => document.body ? document.body.innerText.slice(0, 160) : '')).replace(/\s+/g, ' ');
    console.log('   texto visível: ' + JSON.stringify(txt.slice(0, 130)));
    console.log('   scripts carregados: ' + await p.evaluate(() => document.scripts.length));
  } catch (e) { console.log('   FALHOU: ' + String(e).split('\n')[0].slice(0, 120)); }
  console.log('   cadeia (' + saltos.length + '):');
  saltos.slice(0, 8).forEach(s => console.log('      ' + s.status + ' ' + (s.bytes === null ? '?' : s.bytes + 'B') + ' ' + s.ct + ' ' + s.url.slice(0, 100)));
  await b.close();
})().catch(e => { console.log('FALHA: ' + String(e).split('\n')[0]); process.exit(1); });
