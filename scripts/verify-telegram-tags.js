const { loadRegistry, activeDestinations, buildTaggedLink } = require('../lib/telegram/multi-destination-sender');
const reg = loadRegistry();
const dests = activeDestinations(reg, 'deal');
console.log("VERIFICACAO DE TAG POR DESTINO\n"+"=".repeat(100));
for (const d of dests) {
  const link = buildTaggedLink(d, { brand: 'shopee', slot: 'br_shopee_fone_tws', country: 'BR' });
  const u = new URL(link);
  console.log(`${d.label.padEnd(26)} tag=${String(d.tag).padEnd(20)} site=${u.searchParams.get('site')} slot=${u.searchParams.get('slot')}`);
}
