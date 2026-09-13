/**
 * AUDITORIA POR HOST (navegador real): abre a página de cada site e mede
 * exatamente quais tags de anúncio carregam (status + bytes) e o que falha.
 * uso: node auditar_hosts.js
 */
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/tmp/node_modules/playwright-core');

const ALVOS = [
  ['https://www.aquitemachadinhos.com.br/', 'aquitem (home)'],
  ['https://www.aquitemachadinhos.com.br/api/ads/go?brand=shopee&site=audit&slot=x&geo=BR&offer=1', 'aquitem (intersticial)'],
  ['https://www.solvegrid.com.br/', 'solvegrid (home)'],
  ['https://nexusplataforma.ia.br/', 'nexusplataforma (home)'],
  ['https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=audit&slot=x&geo=BR&offer=1', 'ENGINE (intersticial ao vivo)']
];
const UA = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const REDE = /undergocutlery|quge5|auqot|ekhay|b3mny|6opo|adsterra|monetag|propellerads|infolinks|googlesyndication|doubleclick|anrdoezrs|kqzyfj|jdoqocy|dpbolvw|tkqlhce/i;

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const [url, rotulo] of ALVOS) {
    const ctx = await b.newContext({ userAgent: UA, locale: 'pt-BR', viewport: { width: 412, height: 915 } });
    const p = await ctx.newPage();
    const rede = [];
    const erros = [];
    p.on('pageerror', e => erros.push(String(e.message).slice(0, 120)));
    p.on('response', async r => {
      const u = r.url();
      if (REDE.test(u)) {
        let bytes = null; try { bytes = (await r.body()).length; } catch (_) {}
        rede.push({ u, s: r.status(), b: bytes });
      }
    });
    let st = '?';
    try { const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); st = resp.status(); }
    catch (e) { st = 'ERRO ' + String(e).split('\n')[0].slice(0, 40); }
    await p.waitForTimeout(7000);
    console.log('══ ' + rotulo + ' :: HTTP ' + st + ' | ' + url.slice(0, 60));
    const zeradas = rede.filter(x => x.b === 0 || x.s >= 400);
    console.log('   reqs de rede de anúncio: ' + rede.length + ' | mortas (0 byte/erro): ' + zeradas.length);
    rede.slice(0, 7).forEach(x => console.log('      ' + x.s + ' ' + (x.b === null ? '?' : x.b + 'B') + '  ' + x.u.slice(0, 92)));
    if (erros.length) console.log('   erros de página: ' + JSON.stringify(erros.slice(0, 2)));
    await ctx.close();
  }
  await b.close();
})().catch(e => { console.log('FALHA: ' + String(e).split('\n')[0]); process.exit(1); });
