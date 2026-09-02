/**
 * YANDEX OAUTH EXCHANGE — troca o código de verificação por tokens (USO ÚNICO).
 * Uso: YANDEX_VERIFICATION_CODE=xxxx node scripts/yandex-oauth-exchange.js
 * Grava os tokens em data/yandex-oauth-tokens.json (access + refresh).
 * NÃO imprime os valores — só status.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const CID = process.env.YANDEX_OAUTH_CLIENT_ID || '';
const CSEC = process.env.YANDEX_OAUTH_CLIENT_SECRET || '';
const CODE = process.env.YANDEX_VERIFICATION_CODE || '';
const OUT = path.join(__dirname, '../data/yandex-oauth-tokens.json');

if (!CID || !CSEC || !CODE) {
  console.log('✗ falta YANDEX_OAUTH_CLIENT_ID/SECRET ou YANDEX_VERIFICATION_CODE');
  process.exit(1);
}

const body = new URLSearchParams({
  grant_type: 'authorization_code',
  code: CODE,
  client_id: CID,
  client_secret: CSEC
}).toString();

const req = https.request({ hostname: 'oauth.yandex.ru', path: '/token', method: 'POST', timeout: 15000,
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => {
    try {
      const d = JSON.parse(b);
      if (d.access_token) {
        fs.writeFileSync(OUT, JSON.stringify(d, null, 2));
        console.log(`✓ TOKEN OBTIDO (expira em ${d.expires_in}s = ${(d.expires_in / 86400).toFixed(0)}d)${d.refresh_token ? ' + refresh_token salvo' : ''}`);
        console.log('  salvo em data/yandex-oauth-tokens.json — o sync lê daqui');
      } else {
        console.log(`✗ erro: ${d.error} — ${d.error_description || ''}`);
        if (d.error === 'bad_verification_code') console.log('  → código inválido/expirado (vale ~10 min). Clique no link de autorização de novo e cole o código NOVO.');
      }
    } catch (e) { console.log('✗ resposta não-JSON:', b.slice(0, 120)); }
  });
});
req.on('error', () => console.log('✗ erro de rede'));
req.write(body);
req.end();
