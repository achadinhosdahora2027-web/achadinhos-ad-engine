#!/usr/bin/env node
/**
 * telegram-destination-discovery.js — DESCOBERTA AUTOMÁTICA DE chat_id (v336.0)
 *
 * POR QUE EXISTE
 *   Dois dos três grupos exigidos pelo operador são privados e só têm link de
 *   convite (https://t.me/+-KMiaOcqTic1ZmEx e https://t.me/+zvXvaNM4fDJlNDMx).
 *   O Bot API NÃO converte convite em chat_id, e o bot também não entra sozinho
 *   em grupo por link. O que a API entrega de graça é o update `my_chat_member`
 *   quando o bot É ADICIONADO ao grupo — e nesse payload vem o chat.id. É esse
 *   gancho que este worker usa.
 *
 * O QUE FAZ
 *   1. Lê data/telegram-destinations.json e separa os destinos sem chat_id.
 *   2. Puxa os updates do bot (getUpdates) e casa os chats vistos com os
 *      destinos pendentes por: invite_link exato → username → título normalizado.
 *   3. Confirma que o bot consegue falar no grupo (getChatMember/getChat) antes
 *      de gravar.
 *   4. Escreve o chat_id no registro, marca verified e registra resolved_at.
 *   5. Sai com código 0 e imprime o diff. Quem chama decide commitar.
 *
 * USO
 *   TELEGRAM_BOT_TOKEN=... node workers/telegram-destination-discovery.js [--dry]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const DRY = process.argv.includes('--dry');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const REGISTRY = process.env.DESTINATIONS_FILE
  || path.join(process.cwd(), 'data/telegram-destinations.json');

function api(method, qs = '') {
  return new Promise((resolve) => {
    const req = https.request(
      { hostname: 'api.telegram.org', path: `/bot${TOKEN}/${method}${qs}`, method: 'GET', timeout: 15000 },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ ok: false, raw: d.slice(0, 200) }); } });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** Coleta todo objeto `chat` presente nos updates, com o contexto do update. */
function chatsFromUpdates(updates) {
  const out = [];
  for (const u of updates) {
    const kinds = ['message', 'channel_post', 'my_chat_member', 'chat_member', 'chat_join_request'];
    for (const k of kinds) {
      if (u[k] && u[k].chat) {
        out.push({ via: k, update_id: u.update_id, chat: u[k].chat, from_title: u[k].chat.title || u[k].chat.username || u[k].chat.first_name });
      }
    }
  }
  return out;
}

(async () => {
  if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN ausente'); process.exit(2); }
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  const pend = (reg.destinations || []).filter((d) => d.enabled !== false && !d.chat_id);

  console.log(`registro: ${REGISTRY}`);
  console.log(`destinos: ${(reg.destinations || []).length} | com chat_id: ${(reg.destinations || []).length - pend.length} | pendentes: ${pend.length}`);
  pend.forEach((d) => console.log(`  pendente: ${d.id} (${d.label}) convite=${d.invite || '-'}`));

  if (!pend.length) {
    console.log('nada a descobrir: todos os destinos têm chat_id.');
    process.exit(0);
  }

  const me = await api('getMe');
  console.log(`bot: @${me.result && me.result.username} (id ${me.result && me.result.id})`);

  const ups = await api('getUpdates', '?limit=100&allowed_updates=%5B%22message%22%2C%22channel_post%22%2C%22my_chat_member%22%2C%22chat_member%22%2C%22chat_join_request%22%5D');
  if (!ups.ok) {
    console.error('getUpdates falhou:', JSON.stringify(ups).slice(0, 200),
      ups.error_code === 409 ? '(existe WEBHOOK ativo: remova-o para usar getUpdates)' : '');
    process.exit(3);
  }
  const vistos = chatsFromUpdates(ups.result || []);
  console.log(`updates: ${(ups.result || []).length} | chats vistos: ${vistos.length}`);
  vistos.forEach((v) => console.log(`   [${v.via}] chat_id=${v.chat.id} tipo=${v.chat.type} título="${v.from_title}" convite=${v.chat.invite_link || '-'}`));

  let mudou = false;
  for (const dest of pend) {
    const alvoInvite = String(dest.invite || '').replace(/^https?:\/\/t\.me\//, '').replace(/^\+/, '');
    const alvoUser = String(dest.username || '').replace(/^@/, '').toLowerCase();
    const alvoTitulo = norm(dest.label).replace(/^grupo |^canal /, '');

    const match = vistos.find((v) => {
      const c = v.chat;
      if (c.type !== 'supergroup' && c.type !== 'channel' && c.type !== 'group') return false;
      if (c.invite_link) {
        const inv = String(c.invite_link).replace(/^https?:\/\/t\.me\//, '').replace(/^\+/, '');
        if (inv && inv === alvoInvite) return true;      // casamento EXATO pelo convite
      }
      if (alvoUser && String(c.username || '').toLowerCase() === alvoUser) return true;
      const t = norm(c.title);
      if (t && alvoTitulo && (t === alvoTitulo || t.includes(alvoTitulo) || alvoTitulo.includes(t))) return true;
      return false;
    });

    if (!match) {
      console.log(`  ${dest.id}: ainda NÃO descoberto.`);
      console.log('     → ação necessária: adicionar @'
        + (me.result && me.result.username) + ' ao grupo ' + (dest.invite || dest.label)
        + ' (de preferência como ADMINISTRADOR, para poder publicar).');
      continue;
    }

    /* Confirma que o bot está no grupo e consegue publicar. */
    const member = await api('getChatMember', `?chat_id=${match.chat.id}&user_id=${me.result.id}`);
    const status = member.result && member.result.status;
    const podePostar = ['creator', 'administrator', 'member', 'restricted'].includes(status);
    console.log(`  ${dest.id}: candidato chat_id=${match.chat.id} ("${match.from_title}") status do bot=${status}`);
    if (!podePostar) { console.log(`     → bot sem permissão de leitura/publicação; adicione-o como administrador.`); continue; }

    if (!DRY) {
      dest.chat_id = String(match.chat.id);
      dest.verified = true;
      dest.resolved_at = new Date().toISOString();
      dest.resolved_via = `getUpdates/${match.via}` + (match.chat.invite_link ? '+invite_link' : '');
      delete dest.pending_reason;
      mudou = true;
    }
    console.log(`     ${DRY ? '[dry] gravaria' : 'GRAVADO'} chat_id=${match.chat.id} em ${dest.id}`);
  }

  if (mudou && !DRY) {
    reg.updated_at = new Date().toISOString();
    reg.last_discovery = { em: reg.updated_at, resolved: (reg.destinations || []).filter((d) => d.resolved_at).map((d) => d.id) };
    fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
    console.log('registro atualizado:', REGISTRY);
  }

  /* Acknowledga os updates já consumidos (o canal não perde nada: só o bot lê). */
  const last = (ups.result || []).reduce((m, u) => Math.max(m, u.update_id || 0), 0);
  if (last && !DRY) { await api('getUpdates', `?offset=${last + 1}&limit=1`); }
  process.exit(mudou ? 10 : 0);
})();
