/**
 * v128.8 — /api/ads/click — clique COMPROVADO.
 *
 * Chamado apenas pelo próprio intersticial (navigator.sendBeacon), depois de a
 * página carregar e a tag de anúncio resolver. O token é assinado pelo gateway
 * (HMAC-SHA256) na hora de servir o intersticial e só é emitido quando:
 *   • o gate humano classificou a requisição como gente (v128.7); e
 *   • a navegação veio de gesto real do usuário (`Sec-Fetch-User: ?1`).
 *
 * Sem token válido, nada é gravado. Uso único, validade de 5 minutos e teto de
 * 4 avisos por minuto por IP — o suficiente para uma pessoa, apertado para uma
 * frota de robôs.
 */
const crypto = require('crypto');
const { registrarClique } = require('../../lib/ads/registrar-clique');

const TTL_MS = 5 * 60 * 1000;
const JANELA_MS = 60 * 1000;
const MAX_POR_JANELA = 4;
const vistos = new Map();     // nonce -> quando foi usado
const porIp = new Map();      // ip -> [timestamps]

function podar() {
  const agora = Date.now();
  for (const [k, v] of vistos) if (agora - v > TTL_MS) vistos.delete(k);
  for (const [k, arr] of porIp) {
    const limpo = arr.filter((t) => agora - t < JANELA_MS);
    if (limpo.length) porIp.set(k, limpo); else porIp.delete(k);
  }
}

function ipDe(headers) {
  return String(headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim() || 'sem_ip';
}

function abrirToken(t, segredo) {
  if (!t || typeof t !== 'string' || t.indexOf('.') < 0) return { erro: 'formato' };
  const [payload, mac] = t.split('.');
  const esperado = crypto.createHmac('sha256', segredo).update(payload).digest('base64url').slice(0, 32);
  const a = Buffer.from(mac || '');
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { erro: 'assinatura_invalida' };
  let dados;
  try { dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch (e) { return { erro: 'payload_ilegivel' }; }
  if (!dados || typeof dados.t !== 'number') return { erro: 'payload_incompleto' };
  if (Date.now() - dados.t > TTL_MS) return { erro: 'expirado' };
  if (Date.now() - dados.t < -60000) return { erro: 'relogio_adiantado' };
  return { dados };
}

module.exports = async (req, res) => {
  const headers = req.headers || {};
  const query = req.query || {};
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const segredo = String(process.env.NEXUS_CLICK_SECRET || process.env.CLICKS_DB_KEY || '');
  if (!segredo) {
    res.setHeader('X-Nexus-Click', 'sem_segredo_configurado');
    return res.status(200).json({ ok: false, motivo: 'sem_segredo_configurado' });
  }

  const aberto = abrirToken(String(query.t || ''), segredo);
  if (aberto.erro) {
    res.setHeader('X-Nexus-Click', 'recusado_' + aberto.erro);
    return res.status(200).json({ ok: false, motivo: aberto.erro });
  }
  const d = aberto.dados;

  podar();
  if (vistos.has(d.n)) {
    res.setHeader('X-Nexus-Click', 'recusado_repetido');
    return res.status(200).json({ ok: false, motivo: 'token_repetido' });
  }
  const ip = ipDe(headers);
  const janela = (porIp.get(ip) || []).filter((t) => Date.now() - t < JANELA_MS);
  if (janela.length >= MAX_POR_JANELA) {
    res.setHeader('X-Nexus-Click', 'recusado_limite');
    return res.status(200).json({ ok: false, motivo: 'limite_por_ip' });
  }
  vistos.set(d.n, Date.now());
  janela.push(Date.now());
  porIp.set(ip, janela);

  /* Prova de render: o intersticial manda o estado da tag de anúncio. */
  const anuncio = String(query.a || '').slice(0, 24) || 'desconhecido';

  const resultado = await registrarClique({
    site: d.s, slot: d.sl, brand: d.b, country: d.c, sidTag: d.sd,
    targetUrl: d.d, headers, anuncio
  });

  res.setHeader('X-Nexus-Click', 'contado');
  res.setHeader('X-Nexus-Click-Banco', resultado.banco);
  res.setHeader('X-Nexus-Click-Fila', resultado.fila);
  return res.status(200).json({ ok: true, banco: resultado.banco, fila: resultado.fila, anuncio });
};
