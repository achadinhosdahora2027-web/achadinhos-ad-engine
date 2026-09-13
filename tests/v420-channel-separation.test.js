'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const registry = JSON.parse(read('data/telegram-destinations.json'));
const fanout = require('../lib/telegram/fanout');
const sender = require('../lib/telegram/multi-destination-sender');

const expected = {
  clicks: ['grupo_cliques', '-1004417007577'],
  capture: ['grupo_captura_atendimento', '-1003951454560'],
  sales: ['grupo_vendas', '-1003987455421'],
  offers: ['canal_ofertas_brasil', '-1004317377063']
};

assert.equal(registry.version, '2026.9-v420-STRICT-1TO1');
for (const [kind, [id, chat]] of Object.entries(expected)) {
  const a = fanout.destinationsFor(kind, registry);
  const b = sender.activeDestinations(registry, kind);
  assert.equal(a.length, 1, `${kind}: fanout não resolveu exatamente um`);
  assert.equal(b.length, 1, `${kind}: sender não resolveu exatamente um`);
  assert.equal(a[0].id, id);
  assert.equal(String(a[0].chat_id), chat);
  assert.equal(b[0].id, id);
}
assert.deepEqual(fanout.destinationsFor('desconhecido', registry), []);
assert.deepEqual(sender.activeDestinations(registry, 'desconhecido'), []);
assert.equal(new Set(Object.values(expected).map((x) => x[1])).size, 4);

const compose = read('edge/jetstream/compose.ts');
assert.match(compose, /linhas\.splice\(indice, 0, rotulo\)/);
assert.match(compose, /return idioma === "pt" \? "#publi" : "#ad"/);

const registrar = read('lib/ads/registrar-clique.js');
assert.doesNotMatch(registrar, /nexus_telegram_message_buffer/);
assert.match(registrar, /proved_human/);

const cron = read('api/cron/index.js');
assert.doesNotMatch(cron, /\/sendMessage/);
assert.doesNotMatch(cron, /nexus_telegram_message_buffer/);
assert.match(cron, /delegated_to: 'pg_cron job 60 v360-tg-flush-10s'/);

const worker = read('workers/jetstream-consumer.js');
assert.doesNotMatch(worker, /rest\/v1\/nexus_telegram_message_buffer/);
assert.doesNotMatch(worker, /api\.telegram\.org\/bot/);
assert.match(worker, /setTimeout\(\(\) => ctrl\.abort\(\), 1900\)/);

const fleet = read('edge/jetstream/fleet.ts');
assert.match(fleet, /Math\.min\(opt\.timeoutMs \?\? 1900, 1900\)/);
assert.match(fleet, /Promise\.all\(nos\.map/);
assert.match(fleet, /Sintonizado em Análise/);

for (const producer of ['scripts/telegram-brazil-deals-publisher.js', 'scripts/publish-shopee-v330-deals.js']) {
  const src = read(producer);
  assert.match(src, /enqueueV420Offer/);
  assert.doesNotMatch(src, /sendToDestination\(/);
  assert.doesNotMatch(src, /api\.telegram\.org\/bot/);
}

const sql = read('supabase/migrations/supabase_v420_channel_separation.sql');
for (const [kind, [, chat]] of Object.entries(expected)) {
  assert.match(sql, new RegExp(chat.replace('-', '\\-')),
    `${kind}: chat não aparece na migração`);
}
assert.match(sql, /statement_timeout','2000'/);
assert.match(sql, /lock_timeout','1000'/);
assert.match(sql, /Sintonizado em Análise/);
assert.match(sql, /truncate table public\.nexus_telegram_message_buffer/);
assert.match(sql, /count\(\*\) filter \(where active is true\)/);
assert.match(sql, /commission_amount/);
assert.match(sql, /telegram_ok/);

console.log('v420-channel-separation: invariantes estáticas OK');
