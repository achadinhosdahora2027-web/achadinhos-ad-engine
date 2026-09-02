/**
 * ==============================================================================
 * MULTI-ENGINE GLOBAL SEARCH INDEXING PINGER — VERSÃO INSTRUMENTADA (2026-09-02)
 * ==============================================================================
 * Envia avisos IndexNow INDIVIDUAIS para cada buscador (Bing, Yandex, Seznam,
 * Naver, Yep + rede agregada) e REGISTRA CADA RESPOSTA no Supabase
 * (tabela seo_indexation_log) — alimentando a seção real de indexação
 * multi-buscadores do Painel Consolidado do Telegram.
 *
 * Honestidade: "aceito" = o buscador recebeu o aviso (HTTP 200/202).
 * Aceito NÃO garante indexação; contagem INDEXADA só via Webmaster Tools.
 */

const https = require('https');

const KEY = '8469089b876439517e6c5247573c6e21';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Apenas domínios com arquivo-chave IndexNow acessível (verificado 02/09)
const DOMAINS = [
  'https://www.aquitemachadinhos.com.br',
  'https://solvegrid.com.br'
];

const ENGINES = [
  { name: 'Bing', host: 'www.bing.com' },
  { name: 'Yandex', host: 'yandex.com' },
  { name: 'Seznam', host: 'search.seznam.com' },
  { name: 'Naver', host: 'searchadvisor.naver.com' },
  { name: 'Yep', host: 'yep.com' },
  { name: 'IndexNow-Rede', host: 'api.indexnow.org' }
];

function pingEngine(engine, pageUrl) {
  return new Promise((resolve) => {
    const path = `/indexnow?url=${encodeURIComponent(pageUrl)}&key=${KEY}`;
    const req = https.request({ hostname: engine.host, path, method: 'GET', timeout: 8000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ engine: engine.name, httpStatus: res.statusCode, pageUrl }));
    });
    req.on('error', () => resolve({ engine: engine.name, httpStatus: 0, pageUrl }));
    req.on('timeout', () => { req.destroy(); resolve({ engine: engine.name, httpStatus: 408, pageUrl }); });
    req.end();
  });
}

function logResponse(r) {
  return new Promise((resolve) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return resolve(0);
    const accepted = r.httpStatus === 200 || r.httpStatus === 202;
    const slotHour = new Date().toISOString().slice(0, 13); // data+hora UTC — 1 linha por engine/domínio/ciclo
    const host = new URL(r.pageUrl).hostname;
    const body = JSON.stringify({
      url: r.pageUrl,
      engine: r.engine,
      entity_type: 'indexnow_ping',
      entity_id: `${r.engine}|${host}|${slotHour}`,
      response_payload: `HTTP ${r.httpStatus}`,
      action: 'indexnow_submit',
      status: accepted ? 'accepted' : (r.httpStatus === 0 ? 'error' : 'rejected'),
      http_status: r.httpStatus,
      retry_count: 0,
      last_submitted_at: new Date().toISOString()
    });
    const req = https.request(`${SUPABASE_URL}/rest/v1/seo_indexation_log`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }
    }, (rs) => { rs.resume(); resolve(rs.statusCode); });
    req.on('error', () => resolve(0));
    req.write(body);
    req.end();
  });
}

async function runMultiEngineGlobalPinger() {
  console.log('================================================================================');
  console.log('🌐 PINGER MULTI-BUSCADORES INSTRUMENTADO (BING, YANDEX, SEZNAM, NAVER, YEP)');
  console.log('================================================================================\n');

  const jobs = [];
  for (const domain of DOMAINS) {
    for (const engine of ENGINES) {
      jobs.push(pingEngine(engine, `${domain}/`));
    }
  }
  const results = await Promise.all(jobs);

  const logResults = await Promise.all(results.map(logResponse));

  let accepted = 0, rejected = 0, errored = 0;
  results.forEach((r, i) => {
    const ok = r.httpStatus === 200 || r.httpStatus === 202;
    if (ok) accepted++; else if (r.httpStatus === 0 || r.httpStatus === 408) errored++; else rejected++;
    console.log(`  [${String(i + 1).padStart(2, '0')}/${results.length}] ${r.engine.padEnd(14)} ${ok ? '✅ ACEITO' : (r.httpStatus === 0 || r.httpStatus === 408 ? '⚠️ SEM RESPOSTA' : '❌ REJEITADO')} (HTTP ${r.httpStatus}) → log#${logResults[i] || '—'}`);
  });

  console.log(`\nResultado REAL: ${accepted} aceitos | ${rejected} rejeitados | ${errored} sem resposta (registrados no banco p/ o painel)`);
  console.log('================================================================================');
  console.log(`✅ PING CONCLUÍDO — respostas reais registradas em seo_indexation_log`);
  console.log('================================================================================');
}

if (require.main === module) {
  runMultiEngineGlobalPinger();
}

module.exports = { runMultiEngineGlobalPinger };
