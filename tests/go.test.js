const assert = require('assert');
const goHandler = require('../api/ads/go');

async function testGo(query) {
  let location = '';
  let statusCode = 0;
  const req = { query };
  const res = {
    setHeader: (k, v) => {
      if (k === 'Location') location = v;
    },
    status: (code) => {
      statusCode = code;
      return { end: () => {} };
    }
  };

  await goHandler(req, res);
  return { statusCode, location };
}

(async () => {
  console.log('--- Testando Gateway de Afiliados (go.js) ---');

  // Test 1: NordVPN redirect with dynamic SID
  const r1 = await testGo({ brand: 'nordvpn', site: 'nexus', slot: 'header' });
  assert.strictEqual(r1.statusCode, 307);
  assert.ok(r1.location.includes('sid=nexus_br_header_desktop'), 'Missing dynamic SID nexus_header');
  console.log('✓ NordVPN Dynamic SID:', r1.location);

  // Test 2: Booking with deep link destination encoding
  const r2 = await testGo({ brand: 'booking', site: 'solvegrid', slot: 'inline', dest: 'https://booking.com/hotel/br/copacabana?lang=pt' });
  assert.strictEqual(r2.statusCode, 307);
  assert.ok(r2.location.includes('url=https%3A%2F%2Fbooking.com%2Fhotel%2Fbr%2Fcopacabana%3Flang%3Dpt'), 'URL destination not properly encoded');
  assert.ok(r2.location.includes('sid=solvegrid_br_inline_desktop'), 'Missing dynamic SID solvegrid_inline');
  console.log('✓ Booking Deep Link Encoded:', r2.location);

  // Test 3: Discovered brand (SwitchBot)
  const r3 = await testGo({ brand: 'switchbot', site: 'aquitemachadinhos', slot: 'rectangle' });
  assert.strictEqual(r3.statusCode, 307);
  assert.ok(r3.location.includes('sid=aquitemachadinhos_br_rectangle_desktop'));
  console.log('✓ Discovered Brand SwitchBot:', r3.location);

  console.log(' Todos os testes do Gateway de Afiliados passaram com sucesso!\n');
})();
