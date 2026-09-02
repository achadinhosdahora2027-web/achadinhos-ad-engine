/**
 * ==============================================================================
 * BING WEBMASTER SYNC — dados REAIS do Bing via API oficial (2026-09-02)
 * ==============================================================================
 * Lê: sites verificados, sitemaps, crawl 7d, problemas de rastreamento,
 *     queries (30d), cota de submissão.
 * Grava: ledger.bing_webmaster_metrics → Painel Telegram (seção Bing).
 * Nada é inventado: cada número vem da API ssl.bing.com/webmaster/api.svc.
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

const API_KEY = process.env.BING_WEBMASTER_API_KEY || '';
const LEDGER_FILE = path.join(__dirname, '../data/autonomous-state-ledger.json');

function bingApi(method, params = {}) {
  return new Promise((resolve) => {
    const qs = new URLSearchParams({ apikey: API_KEY, ...params }).toString();
    const req = https.request({ hostname: 'ssl.bing.com', path: `/webmaster/api.svc/json/${method}?${qs}`, method: 'GET', timeout: 15000 }, (res) => {
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

function bingDate(ms) { return new Date(parseInt(ms)).toISOString().slice(0, 10); }

async function runBingWebmasterSync() {
  console.log('🔗 BING WEBMASTER SYNC (API oficial — dados reais)');

  if (!API_KEY) {
    console.log('  ⚠️ BING_WEBMASTER_API_KEY ausente — sync pulado (sem invenção)');
    return;
  }

  const ledger = (() => { try { return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8')); } catch (e) { return {}; } })();
  const metrics = { data_source: 'ssl.bing.com/webmaster/api.svc (API oficial)', measured_at: new Date().toISOString(), sites: {} };

  const sitesRes = await bingApi('GetUserSites');
  const sites = (sitesRes.data && sitesRes.data.d) || [];
  console.log(`  Sites verificados no Bing: ${sites.filter(s => s.IsVerified).length}/${sites.length}`);

  for (const s of sites.filter(s => s.IsVerified)) {
    const siteUrl = s.Url;
    const short = siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const m = { verified: true };

    // Sitemaps
    const feeds = await bingApi('GetFeeds', { siteUrl });
    if (feeds.data && Array.isArray(feeds.data.d)) {
      m.sitemaps = feeds.data.d.map(f => ({ url: f.Url, status: f.Status, urls: f.UrlCount, lastCrawled: f.LastCrawled ? bingDate(f.LastCrawled.match(/\d+/)[0]) : null }));
    }

    // Crawl (últimos 7 registros = ~7 dias)
    const crawl = await bingApi('GetCrawlStats', { siteUrl });
    if (crawl.data && Array.isArray(crawl.data.d)) {
      const days = crawl.data.d.slice(0, 7);
      m.crawl_last7d = {
        crawledPages: days.reduce((a, d) => a + (d.CrawledPages || 0), 0),
        errors: days.reduce((a, d) => a + (d.CrawlErrors || 0), 0),
        code4xx: days.reduce((a, d) => a + (d.Code4xx || 0), 0),
        code5xx: days.reduce((a, d) => a + (d.Code5xx || 0), 0),
        blockedByRobotsTxt: days.reduce((a, d) => a + (d.BlockedByRobotsTxt || 0), 0)
      };
    }

    // Problemas de rastreamento
    const issues = await bingApi('GetCrawlIssues', { siteUrl });
    m.crawlIssues = (issues.data && Array.isArray(issues.data.d)) ? issues.data.d.map(i => ({ type: i.IssueType || 'issue', url: i.Url })) : [];

    // Queries (30 registros = ~30 dias)
    const queries = await bingApi('GetQueryStats', { siteUrl });
    if (queries.data && Array.isArray(queries.data.d)) {
      const q = queries.data.d;
      m.queries_30d = {
        clicks: q.reduce((a, d) => a + (d.Clicks || 0), 0),
        impressions: q.reduce((a, d) => a + (d.Impressions || 0), 0),
        top: q.slice().sort((a, b) => (b.Clicks - a.Clicks) || (b.Impressions - a.Impressions)).slice(0, 3).map(d => ({ query: d.Query, clicks: d.Clicks, impressions: d.Impressions, pos: d.AvgImpressionPosition }))
      };
    }

    // Cota de submissão
    const quota = await bingApi('GetUrlSubmissionQuota', { siteUrl });
    if (quota.data && quota.data.d) {
      m.submissionQuota = { usedToday: quota.data.d.UsedTotal || 0, daily: quota.data.d.DailyQuota || 0, monthly: quota.data.d.MonthlyQuota || 0 };
    }

    metrics.sites[short] = m;
    const q30 = m.queries_30d || {};
    console.log(`  ${short}: crawl7d=${(m.crawl_last7d || {}).crawledPages ?? 'n/d'} págs | cliques30d=${q30.clicks ?? 'n/d'} | impressões30d=${q30.impressions ?? 'n/d'} | problemas=${(m.crawlIssues || []).length}`);
  }

  ledger.bing_webmaster_metrics = metrics;
  try {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2));
    console.log('  💾 ledger.bing_webmaster_metrics gravado');
  } catch (e) {
    console.log(`  ✗ falha ao gravar ledger: ${e.message}`);
  }
}

if (require.main === module) {
  runBingWebmasterSync();
}

module.exports = { runBingWebmasterSync };
