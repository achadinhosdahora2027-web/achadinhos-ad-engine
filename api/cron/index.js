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

/** JOB: telegram — drena a fila de mensagens do banco para a API do Telegram */
async function jobTelegram() {
  const steps = {};
  steps.flush = await rpc('nexus_telegram_message_buffer_flush', { p_force: false });
  steps.reap = await rpc('nexus_telegram_message_buffer_reap', { p_limit: 200 });
  const pend = await timedFetch(`${SUPABASE_URL}/rest/v1/nexus_telegram_message_buffer?status=eq.pending&select=id`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  }, 7000);
  let pendingCount = null;
  try {
    pendingCount = JSON.parse(pend.body).length;
  } catch (e) {}
  const ok = steps.flush.ok !== false;
  return {
    ok,
    detail: {
      buffer_flush: steps.flush,
      buffer_reap: steps.reap,
      mensagens_pendentes_restantes: pendingCount
    }
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

/* ---------------------------------------------------------------- v330.0 */
/**
 * Flush do buffer UNLOGGED public.nexus_telegram_message_buffer.
 * Espelha o cronjob 'v325-tg-flush' da spec: entrega em blocos (padrão 18/min,
 * teto que evita HTTP 429 do Telegram) e marca cada linha como sent/failed.
 * Cliques humanos legítimos entram nessa fila pelo gateway /api/ads/go.
 */
async function jobTgFlush() {
  const BLOCK = Math.max(1, Math.min(50, Number(process.env.TG_FLUSH_BLOCK_SIZE || 18)));
  /* Teto POR DESTINO por rodada (= por minuto, já que o cron roda de 1 em 1 min).
     O limite real do Telegram é ~20 mensagens/min por grupo; 18 dá folga. */
  const CAP = Math.max(1, Math.min(30, Number(process.env.TG_DEST_CAP || 18)));
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const fanout = require('../../lib/telegram/fanout');
  const diag = {
    tem_url: Boolean(SUPABASE_URL),
    tem_chave: Boolean(SUPABASE_KEY),
    tem_token: Boolean(token)
  };
  if (!SUPABASE_KEY) return { ok: false, reason: 'supabase_key_ausente', diag };
  if (!token) return { ok: false, reason: 'telegram_token_ausente', diag };

  /* fetch próprio: o helper timedFetch trunca o corpo em 400 chars, o que quebra
     a leitura de listas. Aqui precisamos do JSON completo das linhas da fila. */
  async function raw(url, opts = {}, ms = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      const txt = await r.text();
      return { ok: r.ok, status: r.status, text: txt };
    } catch (e) {
      return { ok: false, status: 0, text: String(e.name === 'AbortError' ? 'timeout' : (e.message || e)) };
    } finally { clearTimeout(t); }
  }
  const H = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' };
  const HREP = { ...H, Prefer: 'return=representation' };
  const TBL = `${SUPABASE_URL}/rest/v1/nexus_telegram_message_buffer`;

  /* v128.9 — suborigem real: o produtor manda a oferta, mas a palavra-chave é
     que identifica o produto no relatório. O link publicado ganha &kw= antes de
     sair; se já tiver kw, não duplica. */
  function enriquecerLink(texto, payload) {
    const kw = String((payload && (payload.keyword || payload.palavra_chave)) || '').trim();
    if (!kw || !texto) return texto;
    return String(texto).replace(/(https?:\/\/[^\s"'<)]*ads\/go\?[^\s"'<)]*)/g, (url) => {
      if (/[?&]kw=/.test(url)) return url;
      return url + (url.includes('?') ? '&' : '?') + 'kw=' + encodeURIComponent(kw.slice(0, 120));
    });
  }

  /* Chave do porteiro: oferta > palavra-chave > texto normalizado. É o que
     impede o mesmo conteúdo de repetir para o mesmo destino. */
  function chavePorteiro(payload, texto) {
    const k = String(
      (payload && (payload.oferta || payload.keyword)) || ''
    ).trim() || String(texto || '').replace(/\s+/g, ' ').slice(0, 120);
    return k.toLowerCase().slice(0, 120);
  }
  const nowIso = new Date().toISOString();
  /* ATENÇÃO: nexus_telegram_message_buffer.request_id é BIGINT. Uma string aqui
     devolvia HTTP 400 no claim e a rodada terminava "com sucesso" sem processar
     NADA — o defeito mais perigoso possível numa fila. Só inteiro. */
  const runId = Date.now();

  /* ── 0) Registro de destinos ─────────────────────────────────────────────── */
  const registry = fanout.loadRegistry();
  const registryIds = (registry.destinations || []).map((d) => `${d.id}=${d.chat_id || 'SEM_CHAT_ID'}`);
  diag.registro = registryIds;
  diag.registro_arquivo = fanout.registryPath();

  /* ── 0.1) Linhas presas em 'dispatched' por uma rodada que morreu (timeout 57014,
     deploy no meio, etc.) voltam para 'pending' depois de 5 minutos. Sem isso a
     fila entope e as notificações param em silêncio. */
  const staleCut = new Date(Date.now() - 5 * 60000).toISOString();
  await raw(`${TBL}?status=eq.dispatched&updated_at=lt.${encodeURIComponent(staleCut)}`, {
    method: 'PATCH', headers: H,
    body: JSON.stringify({ status: 'pending', request_id: null, last_error: 'retomado de dispatched preso' })
  });

  /* ── 1) Reivindicação atômica do bloco ────────────────────────────────────
     Lê os ids elegíveis e marca como 'dispatched' com filtro status=eq.pending:
     o que voltar em return=representation é EXATAMENTE o que esta rodada é dona.
     Duas rodadas concorrentes (pg_cron do shard, GitHub Actions e Vercel) nunca
     entregam a mesma linha duas vezes. */
  const listRes = await raw(`${TBL}?status=eq.pending&not_before=lte.${encodeURIComponent(nowIso)}&order=id.asc&limit=${BLOCK}`, { headers: H });
  let candidatos = [];
  try { candidatos = JSON.parse(listRes.text); } catch (e) { candidatos = []; }
  if (!Array.isArray(candidatos)) candidatos = [];
  diag.fila_status = listRes.status;
  diag.fila_resposta = String(listRes.text).slice(0, 160);
  /* FAIL-CLOSED: fila ilegível (401/403/404/erro de rede) NUNCA pode ser lida
     como "fila vazia" — foi assim que uma chave inválida reportava sucesso com a
     fila parada. Aqui o job falha alto e o painel vê. */
  if (!listRes.ok || !Array.isArray(candidatos)) {
    return { ok: false, reason: 'fila_indisponivel', status_http: listRes.status, diag };
  }

  let rows = [];
  if (candidatos.length) {
    const ids = candidatos.map((r) => r.id).join(',');
    const claim = await raw(`${TBL}?id=in.(${ids})&status=eq.pending`, {
      method: 'PATCH', headers: HREP,
      body: JSON.stringify({ status: 'dispatched', request_id: runId, updated_at: new Date().toISOString() })
    });
    try { rows = JSON.parse(claim.text); } catch (e) { rows = []; }
    if (!Array.isArray(rows)) rows = [];
    if (!claim.ok) {
      return { ok: false, reason: 'claim_falhou', status_http: claim.status,
               resposta: String(claim.text).slice(0, 200), run_id: runId, diag };
    }
  }
  diag.reivindicadas = rows.length;
  diag.candidatas = candidatos.length;

  let sent = 0, failed = 0, puladas = 0, adiadas = 0;
  const enviados = [];
  const por_destino = {};

  for (const row of rows) {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
    const ehFanout = row.chat_id === 'fanout' || payload.fanout === true;

    /* Monta a lista de alvos desta linha. */
    let alvos;
    if (ehFanout) {
      const kind = payload.kind || 'publish';
      const dests = fanout.destinationsFor(kind, registry);
      const feitos = payload.fanout_done && typeof payload.fanout_done === 'object' ? payload.fanout_done : {};
      alvos = dests
        .filter((d) => !feitos[d.id])
        .map((d) => ({
          id: d.id, chat_id: String(d.chat_id), label: d.label || d.id,
          texto: enriquecerLink(fanout.bodyFor(d, row.body_text, {}), payload)
        }))
        .filter((a) => (por_destino[a.id] = por_destino[a.id] || 0) < CAP);
      if (!dests.length) {
        /* Nenhum destino resolvido: NÃO some com a mensagem. Volta para a fila
           e a causa fica registrada (o operador resolve e a fila drena). */
        await raw(`${TBL}?id=eq.${row.id}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify({
            status: 'pending', request_id: null, attempts: (row.attempts || 0) + 1,
            last_error: 'fanout sem destino com chat_id resolvido',
            not_before: new Date(Date.now() + 5 * 60000).toISOString(), updated_at: new Date().toISOString()
          })
        });
        adiadas++; enviados.push({ id: row.id, fanout: true, ok: false, erro: 'sem_destino_resolvido' }); continue;
      }
      if (!alvos.length) { /* todos os destinos já receberam ou bateram o teto agora */
        const todosFeitos = dests.every((d) => (payload.fanout_done || {})[d.id]);
        await raw(`${TBL}?id=eq.${row.id}`, {
          method: 'PATCH', headers: H,
          body: JSON.stringify(todosFeitos
            ? { status: 'sent', sent_at: new Date().toISOString(), request_id: null, response_body: 'fanout completo', updated_at: new Date().toISOString() }
            : { status: 'pending', request_id: null, not_before: new Date(Date.now() + 60000).toISOString(), updated_at: new Date().toISOString() })
        });
        if (todosFeitos) sent++; else adiadas++;
        continue;
      }
    } else {
      alvos = [{ id: 'direto', chat_id: String(row.chat_id), label: 'direto', texto: enriquecerLink(row.body_text, payload) }];
    }

    /* Entrega uma cópia por destino, com a tag do destino no link. */
    const done = ehFanout ? { ...(payload.fanout_done || {}) } : null;
    let algumOk = false, algumErro = '';
    let adiarMs = 0;
    const chaveMsg = chavePorteiro(payload, row.body_text);
    for (const alvo of alvos) {
      /* v128.9 — porteiro anti-flood: mesma matéria-prima não repete e nenhum
         destino passa do teto por minuto/hora. Telegram pune rajada. */
      let porteiro = { pode: true };
      try {
        porteiro = await rpc('nexus_telegram_gate', { p_destino: alvo.id, p_chave: chaveMsg });
      } catch (e) { porteiro = { pode: true, erro_porteiro: String((e && e.message) || e).slice(0, 80) }; }
      if (porteiro && porteiro.pode === false) {
        if (porteiro.motivo === 'duplicado_recente') {
          puladas++; if (done) done[alvo.id] = new Date().toISOString();
        } else {
          adiadas++;
          adiarMs = Math.max(adiarMs, Number(porteiro.esperar_ms) || 60000);
        }
        enviados.push({ id: row.id, destino: alvo.id, ok: false, contido: true, motivo: porteiro.motivo });
        continue;
      }
      const sendRes = await raw(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: alvo.chat_id,
          text: alvo.texto,
          parse_mode: row.parse_mode || 'HTML',
          disable_web_page_preview: true
        })
      });
      let ok = false, mid = null, erro = '';
      try {
        const j = JSON.parse(sendRes.text);
        ok = Boolean(j.ok); mid = j.result && j.result.message_id;
        erro = j.description || '';
      } catch (e) { erro = sendRes.text; }

      if (ok) {
        sent++; algumOk = true;
        por_destino[alvo.id] = (por_destino[alvo.id] || 0) + 1;
        if (done) done[alvo.id] = new Date().toISOString();
      } else {
        failed++; if (!algumErro) algumErro = `${alvo.id}: ${erro}`;
      }
      enviados.push({ id: row.id, destino: alvo.id, chat_id: alvo.chat_id, ok, message_id: mid || undefined, erro: ok ? undefined : erro });
      await new Promise((r) => setTimeout(r, 350)); /* respiro entre envios */
    }

    if (!ehFanout) {
      const patch = algumOk
        ? { status: 'sent', sent_at: new Date().toISOString(), response_body: `message_id=${enviados[enviados.length - 1].message_id}`, request_id: null, attempts: (row.attempts || 0) + 1, updated_at: new Date().toISOString() }
        : { status: ((row.attempts || 0) + 1 >= (row.max_attempts || 3)) ? 'failed' : 'pending',
            attempts: (row.attempts || 0) + 1, request_id: null, last_error: String(algumErro).slice(0, 300),
            not_before: new Date(Date.now() + Math.pow(2, (row.attempts || 0) + 1) * 60000).toISOString(),
            updated_at: new Date().toISOString() };
      await raw(`${TBL}?id=eq.${row.id}`, { method: 'PATCH', headers: H, body: JSON.stringify(patch) });
      continue;
    }

    /* Linha de fan-out: grava o progresso por destino. Só vira 'sent' quando
       TODOS os destinos ativos receberam. O que faltar continua na fila. */
    const restantes = fanout.destinationsFor(payload.kind || 'publish', registry);
    const completo = restantes.every((d) => done[d.id]);
    await raw(`${TBL}?id=eq.${row.id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify(completo
        ? { status: 'sent', sent_at: new Date().toISOString(), request_id: null, payload: { ...payload, fanout_done: done }, response_body: `fanout completo (${Object.keys(done).length} destinos)`, updated_at: new Date().toISOString() }
        : { status: 'pending', request_id: null, payload: { ...payload, fanout_done: done }, attempts: (row.attempts || 0) + 1, last_error: String(algumErro || (adiarMs ? 'adiado pelo porteiro anti-flood' : 'aguardando destinos restantes')).slice(0, 300), not_before: new Date(Date.now() + Math.max(adiarMs, 60000)).toISOString(), updated_at: new Date().toISOString() })
    });
  }

  /* Telemetria no lugar certo: no projeto MESTRE existe nexus_telegram_dispatch_state
     (a nexus_sat_telemetry só existe nos shards — gravar nela daqui daria 404). */
  await raw(`${SUPABASE_URL}/rest/v1/nexus_telegram_dispatch_state?on_conflict=id`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{
      id: true,
      block_size: BLOCK,
      block_ms: 60000,
      last_dispatch_at: new Date().toISOString(),
      last_result: {
        job: 'v336-tg-flush', run_id: String(runId), pendentes: rows.length, enviados: sent, falhas: failed,
        adiadas, por_destino, destinos_com_chat: registryIds.filter((x) => !x.endsWith('SEM_CHAT_ID')),
        destinos_sem_chat: registryIds.filter((x) => x.endsWith('SEM_CHAT_ID')), em: nowIso
      },
      updated_at: new Date().toISOString()
    }])
  }, 5000);

  return { ok: failed === 0, run_id: String(runId), block_size: BLOCK, cap_por_destino: CAP,
           pendentes: rows.length, enviados: sent, falhas: failed, adiadas, por_destino, diag, detalhe: enviados };
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
