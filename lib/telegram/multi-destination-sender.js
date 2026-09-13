/**
 * TELEGRAM STRICT DESTINATION REGISTRY — v420.0
 *
 * O runtime de ofertas usa apenas enqueueV420Offer. As rotinas de transporte
 * remanescentes servem diagnósticos explícitos e aceitam no máximo um destino já
 * resolvido; não existe seleção implícita, admin fallback ou fan-out.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const REGISTRY_CANDIDATES = [
  path.join(__dirname, '../../data/telegram-destinations.json'),
  path.join(__dirname, '../../../data/telegram-destinations.json'),
  path.join(process.cwd(), 'data/telegram-destinations.json')
];

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const GATEWAY = process.env.AFFILIATE_GATEWAY || 'https://achadinhos-ad-engine.vercel.app/api/ads/go';

/* ------------------------------------------------------------------ */
/* Registry                                                           */
/* ------------------------------------------------------------------ */

function registryPath() {
  for (const c of REGISTRY_CANDIDATES) if (fs.existsSync(c)) return c;
  return REGISTRY_CANDIDATES[0];
}

function loadRegistry() {
  try {
    return JSON.parse(fs.readFileSync(registryPath(), 'utf8'));
  } catch (e) {
    return { destinations: [] };
  }
}

function saveRegistry(reg) {
  try {
    reg.updated_at = new Date().toISOString();
    fs.writeFileSync(registryPath(), JSON.stringify(reg, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

/* v420 — separação estrita. Cada natureza lógica resolve para zero ou UM destino.
   Kind ausente/desconhecido falha fechado; não existe mais broadcast implícito. */
const STRICT_DESTINATION_BY_KIND = Object.freeze({
  clicks: 'grupo_cliques', click: 'grupo_cliques',
  sales: 'grupo_vendas', sale: 'grupo_vendas', conversion: 'grupo_vendas',
  capture: 'grupo_captura_atendimento', mention: 'grupo_captura_atendimento',
  offers: 'canal_ofertas_brasil', offer: 'canal_ofertas_brasil',
  publish: 'canal_ofertas_brasil', deal: 'canal_ofertas_brasil', oferta: 'canal_ofertas_brasil'
});

function activeDestinations(reg, kind) {
  const wanted = STRICT_DESTINATION_BY_KIND[String(kind || '').toLowerCase()];
  if (!wanted) return [];
  return (reg.destinations || [])
    .filter((d) => d.enabled !== false && d.chat_id && d.id === wanted)
    .slice(0, 1);
}

function pendingDestinations(reg) {
  return (reg.destinations || []).filter((d) => !d.chat_id && d.enabled !== false);
}

/* ------------------------------------------------------------------ */
/* Tagged affiliate links                                             */
/* ------------------------------------------------------------------ */

/**
 * Gera o link de afiliado JA TAGEADO com o identificador do destino.
 * A tag viaja como `site` para o gateway, que a propaga em:
 *   Shopee  -> utm_content / sub_id
 *   Amazon  -> sid / tag
 *   eBay    -> customid
 *   CJ      -> SID
 *   AliExpress / Awin / Admitad -> subid / clickref
 */
function buildTaggedLink(destination, opts = {}) {
  const brand = opts.brand || 'auto';
  const slot = String(opts.slot || 'deal').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48) || 'deal';
  const country = (opts.country || 'BR').toUpperCase().slice(0, 2);
  const tag = destination.tag || `tg_${destination.id}`;
  const params = new URLSearchParams({
    brand,
    site: tag,
    slot,
    geo: country
  });
  if (opts.dest) params.set('dest', opts.dest);
  // v330.0 — permite apontar a oferta exata do inventário Shopee real (701 ofertas
  // exportadas do painel). Sem isso, cai no link genérico da marca.
  if (opts.offer) params.set('offer', String(opts.offer).slice(0, 64));
  if (opts.q) params.set('q', String(opts.q).slice(0, 90));
  return `${GATEWAY}?${params.toString()}`;
}

/**
 * v420: ofertas não são mais enviadas diretamente pelo runner. Elas entram na
 * tabela public.nexus_telegram_c2_ofertas via RPC; o Job 60 consolida o lote e
 * cria os botões no único canal autorizado.
 */
async function enqueueV420Offer(offer) {
  const sbUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
  if (!sbUrl || !sbKey) return { ok: false, error: 'supabase_v420_nao_configurado' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${sbUrl}/rest/v1/rpc/nexus_v420_offer_enqueue`, {
      method: 'POST',
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_offer: offer }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { ok: r.ok && data && data.ok !== false, status: r.status, data, error: r.ok ? null : text.slice(0, 240) };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e) };
  }
}

/* ------------------------------------------------------------------ */
/* Telegram transport                                                 */
/* ------------------------------------------------------------------ */

function telegramRequest(method, payload) {
  return new Promise((resolve) => {
    if (!BOT_TOKEN) return resolve({ ok: false, error: 'TELEGRAM_BOT_TOKEN ausente' });
    let body;
    try {
      body = JSON.stringify(payload);
    } catch (e) {
      return resolve({ ok: false, error: 'payload invalido' });
    }
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/${method}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 12000
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = JSON.parse(out);
          } catch (e) {
            parsed = { ok: false, raw: out.slice(0, 300) };
          }
          resolve({
            ok: res.statusCode === 200 && parsed.ok !== false,
            status: res.statusCode,
            result: parsed.result,
            description: parsed.description,
            retry_after: parsed.parameters && parsed.parameters.retry_after
          });
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Envia texto para um destino, com retry exponencial e respeito ao 429 */
async function sendToDestination(destination, text, opts = {}) {
  const chatId = opts.chatId || destination.chat_id;
  if (!chatId) return { destination: destination.id, sent: false, reason: 'chat_id_ausente' };

  const maxAttempts = opts.maxAttempts || 3;
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await telegramRequest('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: opts.parse_mode || 'HTML',
      disable_web_page_preview: opts.disable_web_page_preview !== false,
      link_preview_options: opts.disable_web_page_preview === false ? undefined : { is_disabled: true }
    });

    if (res.ok) {
      return {
        destination: destination.id,
        label: destination.label,
        chat_id: String(chatId),
        tag: destination.tag,
        sent: true,
        message_id: res.result && res.result.message_id,
        attempts: attempt
      };
    }

    last = res;
    // 429 = rate limit -> espera o tempo pedido pelo Telegram
    if (res.status === 429 && res.retry_after) {
      await sleep(Math.min(res.retry_after + 1, 60) * 1000);
    } else if (res.status >= 400 && res.status < 500 && res.status !== 429) {
      // erro permanente (chat invalido, bot sem permissao) -> nao insiste
      break;
    } else {
      await sleep(1200 * attempt);
    }
  }

  return {
    destination: destination.id,
    label: destination.label,
    chat_id: String(chatId),
    tag: destination.tag,
    sent: false,
    status: last && last.status,
    error: (last && (last.description || last.error)) || 'falha desconhecida'
  };
}

/** Compatibilidade fail-closed: aceita exatamente um destino, nunca broadcast. */
async function broadcast(textBuilder, destinations, opts = {}) {
  if (!Array.isArray(destinations) || destinations.length !== 1) {
    return { total: 0, sent: 0, failed: 1, results: [], error: 'v420_requer_destino_unico' };
  }
  const dest = destinations[0];
  const text = typeof textBuilder === 'function' ? textBuilder(dest) : textBuilder;
  const r = await sendToDestination(dest, text, opts);
  return { total: 1, sent: r.sent ? 1 : 0, failed: r.sent ? 0 : 1, results: [r] };
}

/* ------------------------------------------------------------------ */
/* Auto-descoberta de chat_id (grupos privados)                       */
/* ------------------------------------------------------------------ */

/**
 * Le updates pendentes do Telegram e resolve chat_id de grupos privados.
 * Um grupo privado se revela quando:
 *   - o bot e adicionado/removido   -> update my_chat_member
 *   - alguem usa /comando@BotName   -> update message
 *   - alguem responde uma mensagem do bot -> update message
 * Retorna { discovered: [...], skipped: n }
 */
async function discoverChatIds(reg, opts = {}) {
  const pend = pendingDestinations(reg);
  if (!pend.length) return { discovered: [], pending: 0 };

  const res = await telegramRequest('getUpdates', {
    limit: 100,
    timeout: 0,
    allowed_updates: ['message', 'channel_post', 'my_chat_member', 'my_chat_member']
  });
  if (!res.ok) return { discovered: [], error: res.description || res.error };

  const updates = (res.result || []).filter((u) => u.my_chat_member || u.message || u.channel_post);
  const found = [];
  const seen = new Map();

  for (const u of updates) {
    const m = u.my_chat_member || u.message || u.channel_post;
    if (!m || !m.chat) continue;
    const c = m.chat;
    if (c.type === 'private') continue;
    if (!seen.has(c.id)) {
      seen.set(c.id, {
        chat_id: String(c.id),
        title: c.title,
        username: c.username || null,
        type: c.type
      });
    }
  }

  // Casa por @username quando disponivel
  for (const dest of pend) {
    const want = (dest.username || '').replace('@', '').toLowerCase();
    if (!want) continue;
    for (const [, info] of seen) {
      if (info.username && info.username.toLowerCase() === want) {
        dest.chat_id = info.chat_id;
        dest.verified = true;
        dest.pending_reason = null;
        dest.resolved_at = new Date().toISOString();
        dest.resolved_by = 'auto_discovery_username';
        found.push(dest.id);
      }
    }
  }

  // Se sobrou exatamente UM destino pendente e UM grupo novo nao mapeado, casa 1:1
  const stillPending = pendingDestinations(reg).filter((d) => !d.username);
  const unmapped = [...seen.values()].filter(
    (i) => !(reg.destinations || []).some((d) => d.chat_id === i.chat_id)
  );
  if (stillPending.length === 1 && unmapped.length === 1) {
    stillPending[0].chat_id = unmapped[0].chat_id;
    stillPending[0].verified = true;
    stillPending[0].pending_reason = null;
    stillPending[0].resolved_at = new Date().toISOString();
    stillPending[0].resolved_by = 'auto_discovery_1to1';
    found.push(stillPending[0].id);
  }

  if (found.length) saveRegistry(reg);

  return {
    discovered: found,
    pending: pendingDestinations(reg).length,
    candidates_seen: [...seen.values()],
    update_offset: updates.length ? updates[updates.length - 1].update_id : null
  };
}

/* ------------------------------------------------------------------ */
/* Rodape de atribuicao                                               */
/* ------------------------------------------------------------------ */

function attributionFooter(destination) {
  return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n🏷️ <i>Origem rastreada:</i> <code>${destination.tag}</code>`;
}

module.exports = {
  loadRegistry,
  saveRegistry,
  activeDestinations,
  pendingDestinations,
  buildTaggedLink,
  sendToDestination,
  broadcast,
  discoverChatIds,
  attributionFooter,
  telegramRequest,
  enqueueV420Offer,
  STRICT_DESTINATION_BY_KIND
};
