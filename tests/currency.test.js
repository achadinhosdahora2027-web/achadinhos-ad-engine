const assert = require('assert');
const { COUNTRY_MAP, convert, formatLocal, priceGrid } = require('../api/v1/currency');

console.log('--- Testando Motor de Câmbio e Moedas ---');

// Test 1: Convert USD to BRL
const resBrl = convert(100, 'BRL', 'USD', false);
assert.ok(resBrl.value > 400, 'BRL conversion failed');
console.log('✓ USD 100 -> BRL:', resBrl.value);

// Test 2: Convert USD to BRL with IOF (3.38%)
const resBrlIof = convert(100, 'BRL', 'USD', true);
assert.ok(resBrlIof.value > resBrl.value, 'IOF not applied correctly');
console.log('✓ USD 100 + IOF -> BRL:', resBrlIof.value);

// Test 3: Convert USD to EUR
const resEur = convert(100, 'EUR', 'USD', false);
assert.ok(resEur.value > 0, 'EUR conversion failed');
console.log('✓ USD 100 -> EUR:', resEur.value);

// Test 4: Format Local
const formattedBrl = formatLocal(154.87, 'BR');
assert.ok(formattedBrl.includes('154,87') || formattedBrl.includes('154.87') || formattedBrl.includes('R$'), 'Format BRL failed');
console.log('✓ Format BR:', formattedBrl);

// Test 5: Price Grid
const grid = priceGrid(29.99);
assert.ok(grid.BR && grid.DE && grid.JP, 'PriceGrid missing countries');
console.log('✓ PriceGrid keys:', Object.keys(grid).join(', '));

console.log(' Todos os testes de câmbio passaram com sucesso!\n');
