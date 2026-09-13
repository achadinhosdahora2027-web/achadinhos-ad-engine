/**
 * ==============================================================================
 * TELEGRAM MULTI-DESTINATION 24/7 DELIVERY ENGINE  (v2.5 — 2026)
 * ==============================================================================
 * Corrige o defeito estrutural da v1: o sistema antigo enviava para UM unico
 * chat_id (privado) e deixava os GRUPOS sem notificacao nenhuma.
 *
 * Este motor:
 *   1. Le o registro central data/telegram-destinations.json
 *   2. Para CADA destino ativo, injeta uma TAG PROPRIA no link de afiliado
 *      (via gateway /api/ads/go?site=<tag>), de forma que todo clique e toda
 *      venda possam ser atribuidos ao grupo de origem.
 *   3. Envia com retry + backoff, respeitando o rate-limit do Telegram.
 *   4. Auto-descobre chat_ids pendentes (grupos privados com apenas convite).
 *   5. Registra o resultado de cada entrega (auditavel).
 * ==============================================================================
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

function activeDestinations(reg, kind) {
  return (reg.destinations || []).filter(
    (d) => d.enabled !== false && d.chat_id && (!kind || (d.receives || []).includes(kind))
  );
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
  return `${GATEWAY}?${params.toString()}`;
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

/**
 * Envia o MESMO conteudo para TODOS os destinos ativos, com tag individual.
 * O texto recebe um rodape de origem para o usuario saber de onde veio.
 */
async function broadcast(textBuilder, destinations, opts = {}) {
  const results = [];
  for (const dest of destinations) {
    const text = typeof textBuilder === 'function' ? textBuilder(dest) : textBuilder;
    const r = await sendToDestination(dest, text, opts);
    results.push(r);
    // pausa curta entre destinos para nao estourar o rate-limit por grupo
    await sleep(opts.gapMs || 900);
  }
  return {
    total: results.length,
    sent: results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
    results
  };
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
  telegramRequest
};
