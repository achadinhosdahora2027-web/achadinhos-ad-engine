/**
 * MEDIÇÃO EM NAVEGADOR REAL (Chromium) do intersticial.
 * Captura: erros de console, requisições de rede (status/tamanho) e o efeito do clique.
 * uso: node medir.js <url> <rotulo>
 */
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/tmp/node_modules/playwright-core');

const URL_ALVO = process.argv[2];
const ROTULO = process.argv[3] || 'probe';
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage',
    '--host-resolver-rules=MAP achadinhos-ad-engine.vercel.app 127.0.0.1, MAP www.aquitemachadinhos.com.br 127.0.0.1, MAP www.solvegrid.com.br 127.0.0.1'] });
  const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR', viewport: { width: 412, height: 915 } });
  const p = await ctx.newPage();

  const erros = [];
  const reqs = [];
  p.on('console', m => { if (m.type() === 'error') erros.push(m.text().slice(0, 220)); });
  p.on('pageerror', e => erros.push('PAGEERROR: ' + String(e.message).slice(0, 220)));
  p.on('request', r => {
    const u = r.url();
    if (!u.startsWith('data:')) reqs.push({ url: u, tipo: r.resourceType(), status: null, bytes: null });
  });
  p.on('response', async r => {
    const u = r.url();
    const e = reqs.find(x => x.url === u && x.status === null);
    if (e) {
      e.status = r.status();
      try { const b2 = await r.body(); e.bytes = b2.length; } catch (_) { e.bytes = -1; }
    }
  });

  console.log('== ' + ROTULO + ' :: ' + URL_ALVO);
  const resp = await p.goto(URL_ALVO, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log('  HTTP ' + resp.status() + ' | ' + (await resp.headerValue('x-adsterra-binding') || 'sem header binding'));
  await p.waitForTimeout(9000); // deixa as tags carregarem (popunder/socialbar/monetag)

  // clique no botão (mesmo gesto do visitante)
  const antes = reqs.length;
  let clicou = false;
  try { await p.click('#go', { timeout: 2500, noWaitAfter: true, force: true }); clicou = true; } catch (e) { clicou = false; }
  await p.waitForTimeout(4000);

  const novas = reqs.slice(antes).filter(r => /under|quge|auqot|ekhay|b3mny|6opo|adsterra|monetag|shopee|mercadolivre|anrdoezrs|meli/i.test(r.url));

  console.log('  páginas abertas: ' + ctx.pages().length + ' | clique disparado: ' + clicou);
  console.log('  ERROS DE CONSOLE: ' + (erros.length ? erros.length : 0));
  erros.forEach(e => console.log('     ! ' + e));
  const tags = reqs.filter(r => /undergocutlery|quge5|auqot|ekhay|b3mny|6opo/.test(r.url));
  console.log('  REQUISIÇÕES DE TAG (' + tags.length + '):');
  tags.forEach(r => console.log('     ' + (r.status === null ? 'SEM-RESPOSTA' : r.status) + ' ' + (r.bytes === null ? '?' : r.bytes + 'B') + '  ' + r.url.slice(0, 110)));
  console.log('  REQUISIÇÕES APÓS O CLIQUE (' + novas.length + '):');
  novas.slice(0, 10).forEach(r => console.log('     ' + (r.status === null ? 'SEM-RESPOSTA' : r.status) + ' ' + (r.bytes === null ? '?' : r.bytes + 'B') + '  ' + r.url.slice(0, 110)));
  const abas = ctx.pages().map(x => x.url().slice(0, 110));
  console.log('  ABAS: ' + JSON.stringify(abas));
  await b.close();
})().catch(e => { console.log('FALHA NA MEDIÇÃO: ' + String(e).split('\n')[0]); process.exit(1); });
