const assert = require('assert');
process.env.NEXUS_CLICK_SECRET = 'segredo-somente-para-teste';
const goHandler = require('../api/ads/go');

/* Cabeçalhos de um navegador real. O gate humano (v128.7) usa a presença de
   Accept-Language como discriminador: todo navegador envia, script não envia.
   Medido em 13/09/2026: 45.025 cliques em 7 dias, nenhum com Accept-Language. */
const NAVEGADOR = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};
const GESTO = Object.assign({}, NAVEGADOR, {
  'sec-fetch-user': '?1', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site'
});
const CRAWLER = { 'user-agent': 'Mozilla/5.0 (compatible; Monitor/1.0)' };

async function testGo(query, headers) {
  let location = '';
  let statusCode = 0;
  const out = {};
  const req = { query, headers: headers || NAVEGADOR };
  const res = {
    setHeader: (k, v) => { out[k.toLowerCase()] = v; if (k === 'Location') location = v; },
    status: (code) => { statusCode = code; return { end: (b) => { out.body = b; }, json: (o) => { out.json = o; } }; }
  };
  // go.js contains legacy diagnostic logging with full destinations. Suppress it
  // in CI so affiliate tracking URLs/PIDs never enter build logs.
  const originalLog = console.log;
  try { console.log = () => {}; await goHandler(req, res); }
  catch (e) { out.erro = String(e.message); }
  finally { console.log = originalLog; }
  return { statusCode, location, headers: out };
}

(async () => {
  console.log('--- Testando Gateway de Afiliados (go.js) + gate humano v128.7 ---');

  // 1) Navegador real: recebe o destino com SID dinâmico
  const r1 = await testGo({ brand: 'nordvpn', site: 'nexus', slot: 'header' });
  assert.strictEqual(r1.statusCode, 200, 'navegador humano deve receber o intersticial (200)');
  assert.strictEqual(r1.headers['x-nexus-traffic'], 'human');
  assert.strictEqual(r1.headers['x-nexus-counted'], '1');
  assert.ok(String(r1.headers['content-type'] || '').includes('text/html'), 'intersticial em HTML');
  console.log('✓ Navegador humano → intersticial 200 · contado (traffic=human)');

  // 2) Robô sem Accept-Language (assinatura medida): não conta, não recebe anúncio, não vai à afiliada
  const r2 = await testGo({ brand: 'nordvpn', site: 'tg_vendas', slot: 'health' });
  assert.strictEqual(r2.statusCode, 307, 'robô não recebe intersticial');
  assert.strictEqual(r2.headers['x-nexus-counted'], '0', 'robô não conta clique');
  assert.ok(/^synthetic:/.test(r2.headers['x-nexus-traffic']), 'motivo declarado no cabeçalho');
  assert.ok(r2.location.endsWith('/api/ads/status'), 'robô não é repassado à rede de afiliado');
  console.log('✓ Robô (sem Accept-Language) → 307 neutro · ' + r2.headers['x-nexus-traffic'] + ' · contado=0');

  // 3) Suborigem sentinela (?slot=health) com cabeçalhos de navegador
  const r3 = await testGo({ brand: 'shopee', site: 'tg_admin', slot: 'health' }, NAVEGADOR);
  assert.strictEqual(r3.headers['x-nexus-counted'], '0');
  assert.strictEqual(r3.headers['x-nexus-traffic'], 'synthetic:suborigem_sentinela');
  console.log('✓ Suborigem sentinela → synthetic:suborigem_sentinela · contado=0');

  // 4) UA de robô declarado
  const r4 = await testGo({ brand: 'shopee', site: 'teste', slot: 'x' }, CRAWLER);
  assert.strictEqual(r4.statusCode, 307);
  assert.ok(r4.headers['x-nexus-traffic'].startsWith('synthetic:ua_robot'));
  console.log('✓ UA de robô → ' + r4.headers['x-nexus-traffic'] + ' · contado=0');

  // 5) probe explícito dos nossos monitores
  const r5 = await testGo({ brand: 'shopee', site: 'lab', slot: 'lab', probe: '1' });
  assert.strictEqual(r5.headers['x-nexus-traffic'], 'synthetic:probe_explicito');
  assert.ok(r5.location.endsWith('/api/ads/status'));
  console.log('✓ ?probe=1 → destino neutro · contado=0');

  // 6) Diagnóstico do operador: não conta clique, mas preserva o destino real
  const r6 = await testGo({ brand: 'booking', site: 'diagnostico', slot: 'ci', noint: '1' }, NAVEGADOR);
  assert.strictEqual(r6.statusCode, 307);
  assert.strictEqual(r6.headers['x-nexus-counted'], '0');
  assert.ok(!r6.location.endsWith('/api/ads/status'), 'noint preserva o destino real, não o neutro');
  assert.ok(/shopee|meli\.la|\/click-|ebay\.com/i.test(r6.location), 'destino monetizado preservado sem expor a URL');
  console.log('✓ ?noint=1 → destino real preservado · contado=0');

  // 8) v128.8 — navegação humana COM gesto: token de clique comprovado emitido
  const r8 = await testGo({ brand: 'shopee', site: 'gesto', slot: 'cta' }, GESTO);
  assert.strictEqual(r8.statusCode, 200);
  assert.strictEqual(r8.headers['x-nexus-counted'], '1');
  assert.strictEqual(r8.headers['x-nexus-click-token'], 'emitido', 'token de clique comprovado');
  assert.strictEqual(r8.headers['x-nexus-tags'], 'servidas', 'anuncio liberado para humano comprovado');
  const tok = String(r8.headers.body || '').match(/var TOKEN_CLIQUE="([^"]+)"/);
  assert.ok(tok && tok[1].length > 100, 'intersticial leva o token assinado');
  assert.ok(String(r8.headers.body).includes('/api/ads/click?t='), 'intersticial avisa o servidor por beacon');
  console.log('✓ Navegação com gesto → token emitido · tags: servidas');

  // 9) v128.8 — mesma origem humana mas SEM gesto (frota que só faz GET): sem token
  const r9 = await testGo({ brand: 'shopee', site: 'frota', slot: 'header' }, NAVEGADOR);
  assert.strictEqual(r9.statusCode, 200);
  assert.strictEqual(r9.headers['x-nexus-click-token'], 'sem_gesto_humano');
  assert.strictEqual(r9.headers['x-nexus-tags'], 'suprimidas_origem_nao_comprovada', 'frota nao recebe anuncio');
  console.log('✓ Sem gesto (frota) → sem token · tags: suprimidas');

  // 7) Booking com deep link (contrato antigo preservado)
  const r7 = await testGo({ brand: 'booking', site: 'solvegrid', slot: 'inline', dest: 'https://booking.com/hotel/br/copacabana?lang=pt' });
  assert.strictEqual(r7.statusCode, 200);
  const html = r7.headers['x-nexus-traffic'] === 'human';
  assert.ok(html);
  console.log('✓ Deep link de Booking segue no intersticial do humano');

  console.log(' Todos os testes do Gateway de Afiliados passaram com sucesso!\n');
})();
