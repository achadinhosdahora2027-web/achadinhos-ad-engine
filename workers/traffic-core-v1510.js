#!/usr/bin/env node
/**
 * Nexus v1510.0 — signed hybrid event-driven traffic worker.
 *
 * Data plane:
 *   Bluesky Jetstream RFC 6455 + Nostr relay RFC 6455
 *   -> in-memory Aho-Corasick over exactly 17,605 measured mappings
 *   -> signature/bot/content/commerce-intent gates
 *   -> signed PostgREST RPC on the master
 *   -> three durable content-trigger intents via Promise.allSettled().
 *
 * There is no HTTP discovery loop and no setInterval. setTimeout is used only
 * for bounded socket reconnection and an optional operator-requested run window.
 * A scheduled GitHub runner is a rolling worker, not a permanent-runtime SLA.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const INVENTORY = process.env.NEXUS_KEYWORD_FILE || path.join(ROOT, 'data', 'shopee-offer-links.json');
const EXPECTED_KEYWORDS = 17605;
const MASTER_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const MASTER_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const INGEST_HMAC = process.env.NEXUS_INGEST_HMAC || '';
const DRY_RUN = process.argv.includes('--dry');
const secAt = process.argv.indexOf('--seconds');
const RUN_SECONDS = secAt >= 0 ? Math.max(0, Number(process.argv[secAt + 1]) || 0) : 0;
const JETSTREAM_URL = process.env.JETSTREAM_URL ||
  'wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post';
const NOSTR_RELAYS = String(process.env.NOSTR_RELAYS || 'wss://relay.primal.net,wss://nos.lol')
  .split(',').map((x) => x.trim()).filter((x) => /^wss:\/\//.test(x)).slice(0, 4);
const ALLOWED_LANGS = new Set(['pt', 'en', 'fr', 'de']);
const RECONNECT_MAX_MS = 60000;

const stats = {
  frames: 0, candidates: 0, accepted: 0, duplicates: 0,
  rejectedBot: 0, rejectedSafety: 0, rejectedKeyword: 0,
  rpcErrors: 0, triggersQueued: 0, triggersFailed: 0,
};

function normalize(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
}

function buildAutomaton(patterns) {
  const nodes = [{ next: new Map(), fail: 0, out: [] }];
  for (const p of patterns) {
    let cursor = 0;
    for (const ch of p.normalized) {
      if (!nodes[cursor].next.has(ch)) {
        nodes.push({ next: new Map(), fail: 0, out: [] });
        nodes[cursor].next.set(ch, nodes.length - 1);
      }
      cursor = nodes[cursor].next.get(ch);
    }
    nodes[cursor].out.push(p);
  }
  const queue = [];
  for (const child of nodes[0].next.values()) queue.push(child);
  for (let q = 0; q < queue.length; q++) {
    const r = queue[q];
    for (const [ch, child] of nodes[r].next) {
      queue.push(child);
      let f = nodes[r].fail;
      while (f && !nodes[f].next.has(ch)) f = nodes[f].fail;
      nodes[child].fail = nodes[f].next.get(ch) || 0;
      nodes[child].out = nodes[child].out.concat(nodes[nodes[child].fail].out);
    }
  }
  return nodes;
}

function hasWordBoundary(text, start, end) {
  const before = start > 0 ? text[start - 1] : '';
  const after = end < text.length ? text[end] : '';
  return !/[a-z0-9]/i.test(before) && !/[a-z0-9]/i.test(after);
}

function searchAutomaton(nodes, rawText) {
  const text = normalize(rawText);
  let cursor = 0;
  let best = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    while (cursor && !nodes[cursor].next.has(ch)) cursor = nodes[cursor].fail;
    cursor = nodes[cursor].next.get(ch) || 0;
    for (const candidate of nodes[cursor].out) {
      const end = i + 1;
      const start = end - candidate.normalized.length;
      if (hasWordBoundary(text, start, end) &&
          (!best || candidate.normalized.length > best.normalized.length)) best = candidate;
    }
  }
  return best;
}

function keywordEligible(keyword) {
  const kw = normalize(keyword);
  if (kw.length < 4 || kw.length > 160 || !/[a-z]{3}/i.test(kw)) return false;
  if (/^\s*\d+(?:[.,]\d+)?\s*(?:ml|mg|g|kg|cm|mm|m|gb|tb|hz|w)?\s*$/i.test(kw)) return false;
  return true;
}

const BOT_MARKERS = /(?:^|[._-])(bot|feed|cron|rss|auto|mirror|bridge|relay|aggregator)(?:$|[._-])/i;
const UNSAFE_CONTENT = /(date[ -]?rape|rape drug|flunitrazepam|rohypnol|fentanyl|methamphetamine|child porn|buy cocaine|comprar coca[ií]na|arma ilegal)/i;
const SPAM_CONTENT = /(guaranteed profit|instant followers|dm me for investment|airdrop claim|seed phrase)/i;

function classifyLikelyHuman({ actor, text, langs, signatureVerified }) {
  const body = String(text || '').trim();
  if (!actor || BOT_MARKERS.test(String(actor))) return { allowed: false, reason: 'automation_identity' };
  if (body.length < 20 || body.length > 1200) return { allowed: false, reason: 'text_bounds' };
  if (UNSAFE_CONTENT.test(body)) return { allowed: false, reason: 'unsafe_content' };
  if (SPAM_CONTENT.test(body)) return { allowed: false, reason: 'spam_content' };
  const language = (Array.isArray(langs) ? langs : [langs]).map((x) => String(x || '').slice(0, 2).toLowerCase())
    .find((x) => ALLOWED_LANGS.has(x));
  if (!language) return { allowed: false, reason: 'unsupported_or_missing_language' };
  if (signatureVerified === false) return { allowed: false, reason: 'invalid_protocol_signature' };
  // This is a conservative heuristic, explicitly not proof of a residential IP.
  const humanScore = signatureVerified === true ? 0.90 : 0.84;
  return { allowed: true, reason: 'human_likely', language, humanScore };
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
function signingMaterial(event) {
  return [event.event_id, event.platform, event.keyword, event.offer_hash,
    event.content_sha256, event.occurred_at_ms].join('|');
}
function signEvent(event, secret = INGEST_HMAC) {
  return crypto.createHmac('sha256', secret).update(signingMaterial(event), 'utf8').digest('hex');
}
function signContentTrigger(eventId, channel, eventHash, secret = INGEST_HMAC) {
  return crypto.createHmac('sha256', secret)
    .update(`${eventId}|${channel}|${eventHash}`, 'utf8').digest('hex');
}

async function rpc(name, body, timeoutMs = 1900) {
  if (!MASTER_URL || !MASTER_KEY) throw new Error('master_not_configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${MASTER_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: MASTER_KEY,
        Authorization: `Bearer ${MASTER_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text.slice(0, 200) }; }
    if (!response.ok) throw new Error(`rpc_${name}_http_${response.status}:${text.slice(0, 120)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function queueContentTriggers(event, eventHash) {
  const channels = ['instagram_story', 'bluesky_reply', 'c2_channel'];
  const settled = await Promise.allSettled(channels.map((channel) => rpc(
    'nexus_v1510_queue_content_trigger',
    {
      p_event_id: event.event_id,
      p_channel: channel,
      p_signature: signContentTrigger(event.event_id, channel, eventHash),
    }, 900,
  )));
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value && result.value.ok) stats.triggersQueued++;
    else stats.triggersFailed++;
  }
  return settled;
}

async function dispatchEvent(baseEvent) {
  if (DRY_RUN) return { ok: true, dry_run: true };
  const event = { ...baseEvent, signature: signEvent(baseEvent) };
  const eventHash = sha256(signingMaterial(event));
  try {
    const result = await rpc('nexus_v1510_ingest_event', { p_event: event });
    if (!result || !result.ok) {
      stats.rpcErrors++;
      console.error('[v1510] ingest contained:', result && result.reason || 'unknown');
      return result;
    }
    if (result.duplicate) stats.duplicates++;
    else stats.accepted++;
    if (result.accepted || result.duplicate) await queueContentTriggers(event, eventHash);
    return result;
  } catch (error) {
    stats.rpcErrors++;
    console.error('[v1510] ingest error:', String(error && error.message || error).slice(0, 220));
    return { ok: false, reason: 'Sintonizado em Análise' };
  }
}

function loadInventory() {
  const parsed = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const entries = Object.entries(parsed.keywords || {});
  if (entries.length !== EXPECTED_KEYWORDS) {
    throw new Error(`keyword_count_drift:${entries.length}:expected:${EXPECTED_KEYWORDS}`);
  }
  const patterns = entries.map(([keyword, offerHash]) => ({
    keyword: String(keyword), normalized: normalize(keyword), offerHash: String(offerHash),
  })).filter((p) => p.normalized && parsed.offers && parsed.offers[p.offerHash]);
  if (patterns.length !== EXPECTED_KEYWORDS) throw new Error(`keyword_offer_mapping_drift:${patterns.length}`);
  return { inventory: parsed, patterns, automaton: buildAutomaton(patterns) };
}

function makeEvent({ platform, protocolId, relayUrl, actor, sourceUrl, text, langs,
  occurredAtMs, signatureVerified, match }) {
  const gate = classifyLikelyHuman({ actor, text, langs, signatureVerified });
  if (!gate.allowed) {
    if (gate.reason === 'unsafe_content' || gate.reason === 'spam_content') stats.rejectedSafety++;
    else stats.rejectedBot++;
    return null;
  }
  if (!keywordEligible(match.keyword)) { stats.rejectedKeyword++; return null; }
  const event = {
    event_id: `${platform}:${protocolId}`,
    platform,
    relay_url: relayUrl,
    actor_ref: String(actor).slice(0, 220),
    source_url: sourceUrl,
    text: String(text).trim().slice(0, 1200),
    keyword: String(match.keyword).toLowerCase().trim(),
    offer_hash: match.offerHash,
    content_sha256: sha256(String(text).trim().slice(0, 1200)),
    human_score: gate.humanScore,
    classification: 'human_likely',
    is_bot: false,
    language: gate.language,
    country: null,
    occurred_at_ms: Number(occurredAtMs),
  };
  if (!Number.isFinite(event.occurred_at_ms) || Math.abs(Date.now() - event.occurred_at_ms) > 300000) return null;
  return event;
}

function socketLoop(label, url, onOpen, onFrame) {
  let stopped = false;
  let backoff = 1000;
  let socket = null;
  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(url, { handshakeTimeout: 12000, perMessageDeflate: false });
    socket.on('open', () => {
      backoff = 1000;
      console.log(`[v1510] ${label} connected`);
      if (onOpen) onOpen(socket);
    });
    socket.on('message', (data) => {
      stats.frames++;
      Promise.resolve(onFrame(data.toString())).catch((e) => {
        stats.rpcErrors++;
        console.error(`[v1510] ${label} frame contained:`, String(e && e.message || e).slice(0, 180));
      });
    });
    socket.on('error', (e) => console.error(`[v1510] ${label} socket:`, String(e.message || e).slice(0, 160)));
    socket.on('close', () => {
      if (stopped) return;
      const wait = backoff + Math.floor(Math.random() * 250);
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      console.error(`[v1510] ${label} closed; reconnect event in ${wait}ms`);
      setTimeout(connect, wait);
    });
  };
  connect();
  return () => {
    stopped = true;
    if (socket) try { socket.close(1000, 'operator_stop'); } catch (_) {}
  };
}

async function start() {
  if (!DRY_RUN && (!MASTER_URL || !MASTER_KEY || INGEST_HMAC.length < 32)) {
    throw new Error('signed_master_configuration_missing');
  }
  const { automaton } = loadInventory();
  console.log(`[v1510] in-memory keyword mappings=${EXPECTED_KEYWORDS}; no residential-IP claim`);
  const seen = new Map();
  const dedupe = (id) => {
    if (seen.has(id)) return false;
    seen.set(id, Date.now());
    if (seen.size > 10000) seen.delete(seen.keys().next().value);
    return true;
  };
  const stops = [];

  stops.push(socketLoop('jetstream', JETSTREAM_URL, null, async (raw) => {
    let frame;
    try { frame = JSON.parse(raw); } catch (_) { return; }
    const commit = frame && frame.commit;
    const record = commit && commit.record;
    if (frame.kind !== 'commit' || commit.operation !== 'create' ||
        commit.collection !== 'app.bsky.feed.post' || !record || !record.text) return;
    const id = `${frame.did || ''}:${commit.rkey || ''}`;
    if (!id.includes(':') || !dedupe(`b:${id}`)) return;
    const match = searchAutomaton(automaton, record.text);
    if (!match) return;
    stats.candidates++;
    const event = makeEvent({
      platform: 'bluesky', protocolId: id,
      relayUrl: JETSTREAM_URL.split('?')[0], actor: frame.did,
      sourceUrl: `https://bsky.app/profile/${encodeURIComponent(frame.did)}/post/${encodeURIComponent(commit.rkey)}`,
      text: record.text, langs: record.langs,
      occurredAtMs: frame.time_us ? Math.floor(Number(frame.time_us) / 1000) : Date.now(),
      signatureVerified: null, match,
    });
    if (event) await dispatchEvent(event);
  }));

  const { verifyEvent } = await import('nostr-tools');
  for (const relay of NOSTR_RELAYS) {
    const subscription = `v1510-${sha256(relay).slice(0, 12)}`;
    stops.push(socketLoop(`nostr:${new URL(relay).hostname}`, relay, (ws) => {
      ws.send(JSON.stringify(['REQ', subscription, { kinds: [1], since: Math.floor(Date.now() / 1000) - 30 }]));
    }, async (raw) => {
      let frame;
      try { frame = JSON.parse(raw); } catch (_) { return; }
      if (!Array.isArray(frame) || frame[0] !== 'EVENT' || frame[1] !== subscription) return;
      const note = frame[2];
      if (!note || note.kind !== 1 || !note.id || !note.content || !dedupe(`n:${note.id}`)) return;
      const verified = verifyEvent(note);
      if (!verified) { stats.rejectedBot++; return; }
      const match = searchAutomaton(automaton, note.content);
      if (!match) return;
      stats.candidates++;
      const languageTag = Array.isArray(note.tags)
        ? note.tags.find((tag) => Array.isArray(tag) && tag[0] === 'l' && ALLOWED_LANGS.has(String(tag[1] || '').slice(0, 2).toLowerCase()))
        : null;
      const event = makeEvent({
        platform: 'nostr', protocolId: note.id, relayUrl: relay, actor: note.pubkey,
        sourceUrl: `https://njump.me/${note.id}`, text: note.content,
        langs: languageTag ? [String(languageTag[1]).slice(0, 2).toLowerCase()] : [],
        occurredAtMs: Number(note.created_at) * 1000, signatureVerified: true, match,
      });
      if (event) await dispatchEvent(event);
    }));
  }

  const stopAll = () => {
    for (const stop of stops) stop();
    console.log('[v1510] final', JSON.stringify(stats));
  };
  process.once('SIGINT', () => { stopAll(); process.exit(0); });
  process.once('SIGTERM', () => { stopAll(); process.exit(0); });
  if (RUN_SECONDS > 0) setTimeout(() => { stopAll(); process.exit(0); }, RUN_SECONDS * 1000);
}

if (require.main === module) {
  start().catch((e) => {
    console.error('[v1510] fatal:', String(e && e.message || e));
    process.exit(1);
  });
}

module.exports = {
  EXPECTED_KEYWORDS, normalize, buildAutomaton, searchAutomaton, keywordEligible,
  classifyLikelyHuman, sha256, signingMaterial, signEvent, signContentTrigger,
  makeEvent, loadInventory,
};
