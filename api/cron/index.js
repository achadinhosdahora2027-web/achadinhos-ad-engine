/**
 * ==============================================================================
 * UNIFIED AUTONOMOUS CRON ENDPOINT — v2 (13/09/2026)
 * ==============================================================================
 * MOTIVO DA REESCRITA (auditoria forense 13/09/2026):
 *
 *   A v1 deste arquivo era um PLACEBO. Ela respondia:
 *     {"status":"success","system_health":"100% OPERATIONAL"}
 *   ...sem executar absolutamente NADA. Pior: gravava o "sucesso" em
 *   data/autonomous-state-ledger.json, arquivo que NAO PERSISTE em ambiente
 *   serverless da Vercel (filesystem efemero e read-only em producao).
 *   Resultado: 1.275 execucoes de pg_cron com ZERO trabalho real e "100% OK"
 *   no log. Isso mascarava falhas em vez de revela-las.
 *
 * A v2 executa trabalho REAL e reporta o resultado VERDADEIRO de cada passo,
 * incluindo falhas explicitas. Nunca devolve "100% OK" sem ter feito nada.
 * ==============================================================================
 */

const CRON_SECRET = process.env.CRON_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://efvuzxdhsirpvxclgdfg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const SITE = 'https://www.aquitemachadinhos.com.br';
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || 'a120ccc82c4e2dbeeda51d4cd6d03284e2909f92f101984a2133e567b748455c';

/* ---------------------------------------------------------------- utils */

async function timedFetch(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const body = await r.text();
    return { ok: r.ok, status: r.status, ms: Date.now() - started, body: body.slice(0, 400) };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message, ms: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

async function rpc(fn, args = {}) {
  if (!SUPABASE_KEY) return { ok: false, error: 'SUPABASE service key ausente no ambiente' };
  const r = await timedFetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  }, 9000);
  if (!r.ok) return { ok: false, status: r.status, error: r.body || r.error };
  try {
    return { ok: true, data: JSON.parse(r.body) };
  } catch (e) {
    return { ok: true, data: r.body };
  }
}

async function count(table, filter = '') {
  if (!SUPABASE_KEY) return { ok: false, error: 'sem service key' };
  const r = await timedFetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1${filter}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0'
    }
  }, 8000);
  return { ok: r.ok, status: r.status, raw: r.body };
}

/* ---------------------------------------------------------------- jobs */

/** JOB: telegram — somente observabilidade. A entrega é exclusiva do Job 60. */
async function jobTelegram() {
  if (!SUPABASE_KEY) return { ok: false, reason: 'supabase_key_ausente' };
  const status = await timedFetch(`${SUPABASE_URL}/rest/v1/nexus_v420_status_v?select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  }, 1900);
  return {
    ok: status.ok,
    delegated_to: 'pg_cron job 60 v360-tg-flush-10s',
    detail: status.ok ? status.body : { estado: 'Sintonizado em Análise', http_status: status.status || 0, erro: status.error || status.body }
  };
}

/** JOB: global-indexer — avisa os buscadores via IndexNow (trabalho real de rede) */
async function jobGlobalIndexer() {
  const keyLocation = `${SITE}/${INDEXNOW_KEY}.txt`;
  const payload = {
    host: 'www.aquitemachadinhos.com.br',
    key: INDEXNOW_KEY,
    keyLocation,
    urlList: [`${SITE}/`, `${SITE}/sitemap.xml`, `${SITE}/sitemap-mundial-paises.xml`]
  };
  const engines = {};
  // IndexNow unico endpoint propaga para Bing, Yandex, Seznam e Naver
  engines.indexnow = await timedFetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  }, 9000);
  engines.bing = await timedFetch(`https://www.bing.com/indexnow?url=${encodeURIComponent(SITE + '/')}&key=${INDEXNOW_KEY}`, {}, 9000);
  const okAny = Object.values(engines).some((e) => e.status === 200 || e.status === 202);
  return { ok: okAny, detail: engines };
}

/** JOB: self-healing — checa os endpoints criticos e acusa quedas */
async function jobSelfHealing() {
  const checks = {};
  checks.site_home = await timedFetch(SITE, {}, 9000);
  checks.robots = await timedFetch(`${SITE}/robots.txt`, {}, 9000);
  checks.sitemap = await timedFetch(`${SITE}/sitemap.xml`, {}, 9000);
  checks.affiliate_gateway = await timedFetch(
    'https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=shopee&site=healthcheck&slot=cron&geo=BR&noint=1',
    { redirect: 'manual' },
    9000
  );
  checks.telegram_api = await timedFetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN || ''}/getMe`,
    {},
    8000
  );
  const down = Object.entries(checks)
    .filter(([, v]) => !v.ok && v.status !== 307 && v.status !== 302)
    .map(([k]) => k);
  return { ok: down.length === 0, detail: { checks, componentes_com_falha: down } };
}

/** JOB: cj-radar — verifica se o gateway de afiliados esta roteando */
async function jobCjRadar() {
  const brands = ['booking', 'shopee', 'mercadolivre', 'amazon', 'nordvpn', 'aliexpress'];
  const out = {};
  for (const b of brands) {
    const r = await timedFetch(
      `https://achadinhos-ad-engine.vercel.app/api/ads/go?brand=${b}&site=cron_healthcheck&slot=radar&geo=BR&noint=1`,
      { redirect: 'manual' },
      7000
    );
    const loc = r.status === 307 || r.status === 302 ? 'redireciona' : `HTTP ${r.status}`;
    out[b] = loc;
  }
  const falhas = Object.entries(out).filter(([, v]) => v.startsWith('HTTP') && v !== 'HTTP 307' && v !== 'HTTP 302');
  return { ok: falhas.length === 0, detail: { rotas: out, anunciantes_com_falha: falhas.map(([k]) => k) } };
}

/** JOB: instagram — espaco reservado; reporta honestamente que nao roda no edge */
async function jobInstagram() {
  return {
    ok: true,
    skipped: true,
    reason: 'Publicacao no Instagram exige os tokens META_* e roda no GitHub Actions (job 7 do orquestrador). Este endpoint nao simula sucesso.'
  };
}

/** JOB: twitter — idem */
async function jobTwitter() {
  return {
    ok: true,
    skipped: true,
    reason: 'Publicacao no X/Twitter roda no GitHub Actions (workflow Twitter 24/7). Este endpoint nao simula sucesso.'
  };
}

/* ---------------------------------------------------------------- v420.0 */
/**
 * O endpoint HTTP não disputa mais o lease do Job 60, não lê o buffer legado e
 * não possui transporte sendMessage. O alias permanece apenas para clientes
 * antigos obterem a fotografia de saúde read-only da separação soberana.
 */
async function jobTgFlush() {
  return jobTelegram();
}

const JOBS = {
  telegram: jobTelegram,
  indexer: jobGlobalIndexer,
  'global-indexer': jobGlobalIndexer,
  'self-healing': jobSelfHealing,
  'cj-radar': jobCjRadar,
  'tg-flush': jobTgFlush,
  instagram: jobInstagram,
  twitter: jobTwitter
};

/* ---------------------------------------------------------------- handler */

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const started = Date.now();
  const query = req.query || {};
  /* Aceita o job por tres caminhos:
       /api/cron?job=master        (query — usado pelo pg_cron e pelo Vercel)
       /api/cron/master            (caminho, antigo api/cron/[task].js PLACEBO)
       /api/cron?action=...        (compatibilidade)
     O antigo [task].js respondia {"status":"success"} sem executar NADA — era um
     dos placebos que faziam o painel parecer 100% enquanto nada rodava. Fundido
     aqui, /api/cron/<nome> agora executa o trabalho de verdade. */
  const job = String(query.job || query.action || query.task || 'self-healing').toLowerCase();

  // Autenticacao: aceita o CRON_SECRET do banco ou a query ?key= (para cron-job.org)
  const auth = String(req.headers.authorization || '');
  const provided = auth.replace(/^Bearer\s+/i, '') || String(query.key || '');
  const secretRequired = Boolean(CRON_SECRET);
  if (secretRequired && provided !== CRON_SECRET && job !== 'ping') {
    return res.status(401).json({
      ok: false,
      error: 'nao_autorizado',
      hint: 'Envie Authorization: Bearer <CRON_SECRET>'
    });
  }

  if (job === 'ping') {
    return res.status(200).json({ ok: true, pong: true, at: new Date().toISOString() });
  }

  // "master" executa todos os jobs reais em sequencia
  const targets = job === 'master' ? ['telegram', 'self-healing', 'global-indexer', 'cj-radar', 'tg-flush'] : [job];
  const results = {};

  for (const t of targets) {
    const fn = JOBS[t];
    if (!fn) {
      results[t] = { ok: false, error: 'job_desconhecido', jobs_disponiveis: Object.keys(JOBS).concat('master') };
      continue;
    }
    try {
      const r = await fn();
      /* v336.0 — o resumo antigo descartava TUDO que não fosse ok/reason/detail, e
         por isso a resposta dizia apenas '{"ok":true}' mesmo quando o job tinha
         entregado 18 mensagens ou devolvido uma fila ilegível. O painel precisa ver
         o trabalho real: propagamos todos os campos. */
      const { ok, skipped, reason, ...resto } = r || {};
      results[t] = { ok, ...(skipped ? { skipped: true, reason } : {}), ...resto };
    } catch (e) {
      results[t] = { ok: false, error: e.message };
    }
  }

  const allOk = Object.values(results).every((r) => r.ok !== false);
  const elapsed = Date.now() - started;

  return res.status(allOk ? 200 : 207).json({
    ok: allOk,
    job,
    executed_at: new Date().toISOString(),
    duration_ms: elapsed,
    work_performed: true,
    note: 'Este endpoint EXECUTA trabalho real. status 207 = pelo menos um passo falhou.',
    results
  });
};
