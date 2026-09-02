/**
 * YANDEX WEBMASTER SYNC — dados REAIS via API oficial (api.webmaster.yandex.net v4)
 * Lê: hosts verificados, resumo (URLs INDEXADAS + pesquisáveis), restrições,
 *     estatísticas de rastreamento. Grava ledger.yandex_webmaster_metrics.
 * Token: env YANDEX_OAUTH_ACCESS_TOKEN OU data/yandex-oauth-tokens.json (access_token).
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, '../data/autonomous-state-ledger.json');

function loadToken() {
  if (process.env.YANDEX_OAUTH_ACCESS_TOKEN) return process.env.YANDEX_OAUTH_ACCESS_TOKEN;
  try {
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/yandex-oauth-tokens.json'), 'utf8'));
    if (t.access_token && t.obtained_at && (Date.now() - Date.parse(t.obtained_at)) < (t.expires_in - 86400) * 1000) {
      return t.access_token;
    }
  } catch (e) {}
  return mintToken();
}

// client_credentials: o app tem esse grant liberado (token válido 365d)
function mintToken() {
  const CID = process.env.YANDEX_OAUTH_CLIENT_ID || '';
  const CSEC = process.env.YANDEX_OAUTH_CLIENT_SECRET || '';
  if (!CID || !CSEC) return '';
  return new Promise((resolve) => {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: CID, client_secret: CSEC }).toString();
    const req = https.request({ hostname: 'oauth.yandex.ru', path: '/token', method: 'POST', timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (d.access_token) {
            try {
              fs.writeFileSync(path.join(__dirname, '../data/yandex-oauth-tokens.json'),
                JSON.stringify({ ...d, obtained_at: new Date().toISOString() }, null, 2));
            } catch (e) {}
            console.log('  🔑 token fabricado via client_credentials (validade: ' + Math.round(d.expires_in / 86400) + 'd)');
            resolve(d.access_token);
          } else {
            console.log(`  ✗ mint falhou: ${d.error || '?'}`);
            resolve('');
          }
        } catch (e) { resolve(''); }
      });
    });
    req.on('error', () => resolve(''));
    req.write(body);
    req.end();
  });
}

function yandexApi(token, apiPath) {
  return new Promise((resolve) => {
    const req = https.request({ hostname: 'api.webmaster.yandex.net', path: apiPath, method: 'GET', timeout: 15000,
      headers: { Authorization: `OAuth ${token}` } }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch (e) { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.end();
  });
}

async function runYandexWebmasterSync() {
  console.log('🟡 YANDEX WEBMASTER SYNC (API oficial v4 — dados reais)');
  const token = await loadToken();
  if (!token) {
    console.log('  ⚠️ sem token Yandex (YANDEX_OAUTH_ACCESS_TOKEN) — sync pulado (sem invenção)');
    return;
  }

  const ledger = (() => { try { return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')); } catch (e) { return {}; } })();
  const metrics = { data_source: 'api.webmaster.yandex.net/v4 (API oficial)', measured_at: new Date().toISOString(), hosts: {} };

  const user = await yandexApi(token, '/v4/user');
  if (user.status !== 200 || !user.data) {
    console.log(`  ✗ /v4/user HTTP ${user.status} ${JSON.stringify(user.data || {}).slice(0, 120)}`);
    if (user.status === 403) console.log('  → token expirado/inválido — refazer troca do código de verificação');
    return;
  }
  const userId = user.data.user_id;
  const hosts = (user.data.hosts || []).filter(h => h.verified);
  console.log(`  Hosts verificados no Yandex: ${hosts.length}/${(user.data.hosts || []).length}`);

  for (const h of hosts) {
    const m = { verified: true, host_id: h.host_id };
    const summary = await yandexApi(token, `/v4/user/${userId}/hosts/${encodeURIComponent(h.host_id)}/summary`);
    if (summary.status === 200 && summary.data) {
      m.indexed_urls = summary.data.IndexedUrls ?? summary.data.indexed_urls ?? null;
      m.searchable_pages = summary.data.SearchablePages ?? summary.data.searchable_pages ?? null;
      m.site_problems = summary.data.SiteProblems ?? summary.data.site_problems ?? null;
    }
    const crawl = await yandexApi(token, `/v4/user/${userId}/hosts/${encodeURIComponent(h.host_id)}/crawling/stats`);
    if (crawl.status === 200 && crawl.data) {
      m.crawling = {
        pages_in_queue: crawl.data.PagesInQueue ?? null,
        crawled_pages: crawl.data.CrawledPages ?? null,
        failed_pages: crawl.data.FailedPages ?? null
      };
    }
    metrics.hosts[h.hostname || h.host_id] = m;
    console.log(`  ${h.hostname}: indexadas=${m.indexed_urls ?? 'n/d'} | pesquisáveis=${m.searchable_pages ?? 'n/d'} | fila=${(m.crawling || {}).pages_in_queue ?? 'n/d'} | problemas=${m.site_problems ?? '—'}`);
  }

  ledger.yandex_webmaster_metrics = metrics;
  try {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
    console.log('  💾 ledger.yandex_webmaster_metrics gravado');
  } catch (e) { console.log(`  ✗ falha ao gravar ledger: ${e.message}`); }
}

if (require.main === module) {
  runYandexWebmasterSync();
}

module.exports = { runYandexWebmasterSync };
