#!/usr/bin/env node
/**
 * ebay-vault-verify.js — Handshake real contra a API do eBay (v336.0)
 *
 * O que faz, em ordem:
 *   1. Lê as credenciais CIFRADAS do cofre via nexus_ebay_api_credentials(kms)
 *      (SECURITY DEFINER — a chave só existe em memória aqui, nunca no banco em claro).
 *   2. Faz o handshake OAuth client_credentials contra a API REAL do eBay.
 *   3. Registra o resultado em nexus_ebay_api_mark_verification(): SÓ marca
 *      'verificado' se o eBay responder 200. 401/erro mantém PENDENTE.
 *   4. Grava telemetria 'Sintonizado em Análise' quando falha (fail-closed).
 *
 * Uso:  KMS=<chave> node scripts/ebay-vault-verify.js [--project-ref REF]
 */
'use strict';
const https = require('https');

const REF = process.argv.includes('--project-ref')
  ? process.argv[process.argv.indexOf('--project-ref') + 1]
  : process.env.SUPABASE_PROJECT_REF || 'xyzpfccmzvekfvcpqlke';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const KMS = process.env.KMS || process.env.NEXUS_SATELLITES_KMS || '';
const ENDPOINTS = {
  production: 'https://api.ebay.com/identity/v1/oauth2/token',
  sandbox: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
};

function sql(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${REF}/database/query`,
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function oauth(url, clientId, clientSecret) {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const payload = 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope');
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) }
    }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d.slice(0, 400) }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    req.write(payload); req.end();
  });
}

(async () => {
  if (!TOKEN || !KMS) {
    console.error('Faltam SUPABASE_ACCESS_TOKEN e KMS no ambiente.');
    process.exit(2);
  }
  const esc = (s) => String(s).replace(/'/g, "''");
  const r = await sql(`select client_id, client_secret, verified, campaign_id from public.nexus_ebay_api_credentials('${esc(KMS)}')`);
  const row = Array.isArray(r.body) ? r.body[0] : null;
  if (!row) {
    console.log('cofre não devolveu credenciais (chave errada, credencial ausente ou sem permissão).');
    process.exit(1);
  }
  const mask = (s) => (s ? s.slice(0, 4) + '…' + s.slice(-4) : '(vazio)');
  console.log(`credencial do cofre: ${mask(row.client_id)} | verificada até agora: ${row.verified}`);
  console.log(`campaign id no cofre: ${row.campaign_id}`);

  for (const [nome, url] of Object.entries(ENDPOINTS)) {
    const t0 = Date.now();
    const res = await oauth(url, row.client_id, row.client_secret);
    const ms = Date.now() - t0;
    const ok = res.status === 200;
    console.log(`  ${nome.padEnd(10)} HTTP ${res.status} (${ms}ms) ${ok ? '→ TOKEN OBTIDO' : '→ ' + res.body.slice(0, 120)}`);
    if (ok) {
      const mark = await sql(`select public.nexus_ebay_api_mark_verification(true, 'handshake OAuth OK em ${nome} (${ms}ms)') as r`);
      console.log('  verificação registrada:', JSON.stringify(mark.body));
      process.exit(0);
    }
  }
  const nota = 'handshake OAuth falhou em produção e sandbox em ' + new Date().toISOString().slice(0, 10) + ' — credencial mantida pendente (fail-closed)';
  const mark = await sql(`select public.nexus_ebay_api_mark_verification(false, '${esc(nota)}') as r`);
  console.log('  ', nota);
  console.log('  verificação registrada:', JSON.stringify(mark.body));
  process.exit(3);
})();
