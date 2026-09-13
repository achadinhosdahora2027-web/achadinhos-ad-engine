#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v128.8 no app do aquitem (aquitemachadinhos) — gate humano + clique comprovado.

Medido em 13/09/2026: ESTE deploy era o produtor dos cliques-fantasma que
chegavam ao operador. Prova: requisição com cabeçalhos de navegador e sem gesto
humano, feita só nele, gerou a linha 'aquitemachadinhos_us_marca_..._desktop' em
public.ads_clicks; a mesma requisição no engine (já corrigido) não gerou nada.
"""
import sys, os

ALVO = sys.argv[1] if len(sys.argv) > 1 else '/tmp/aqfull/api/ads/go.js'
s = open(ALVO, encoding='utf-8').read()

# ── 1. gate humano + token assinado, depois do sid ──────────────────────────
ANCORA = "  const sid = query.sid || `${site}_${country.toLowerCase()}_${slot}_${device}`;"
assert ANCORA in s, 'ancora do sid nao encontrada'
s = s.replace(ANCORA, ANCORA + """

  /* ══ v128.8 GATE HUMANO + CLIQUE COMPROVADO ══════════════════════════════
     Medido: 45.025 cliques em 7 dias, nenhum com Accept-Language, 3.220 IPs de
     proxy. Tráfego sintético não conta clique, não recebe anúncio e não é
     repassado à rede de afiliado (protege CJ/Shopee/Adsterra de tráfego
     inválido). Clique contado agora exige token assinado + aviso do próprio
     intersticial (beacon) depois de a página carregar. */
  const sidTag = String(sid).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 60);
  const SEM_IDIOMA = !String(headers['accept-language'] || '').trim();
  const SID_SENTINELA = /(health|sem_keyword|linkcheck|_audit|audit_|watchdog|monitor|uptime|keepalive|swarm|sentinela|sentinel|smoke|_test|test_)/i.test(sidTag);
  const PROBE_EXPLICITO = String(query.probe || '') === '1';
  const NOINT_EXPLICITO = String(query.noint || '') === '1';
  const MOTIVO_SINTETICO = IS_BOT ? 'ua_robot'
    : PROBE_EXPLICITO ? 'probe_explicito'
    : SID_SENTINELA ? 'suborigem_sentinela'
    : SEM_IDIOMA ? 'sem_accept_language'
    : NOINT_EXPLICITO ? 'noint_explicito'
    : null;
  const SINTETICO = MOTIVO_SINTETICO !== null;
  const NEUTRO = 'https://achadinhos-ad-engine.vercel.app/api/ads/status';
  const SEGREDO_CLIQUE = String(process.env.NEXUS_CLICK_SECRET || process.env.CLICKS_DB_KEY || '');
  const GESTO_HUMANO = String(headers['sec-fetch-user'] || '') === '?1';
  const CONTA_CLIQUE = !SINTETICO && GESTO_HUMANO && SEGREDO_CLIQUE.length > 0;
  const MOSTRAR_TAGS = CONTA_CLIQUE;
  let TOKEN_CLIQUE = '';
  if (CONTA_CLIQUE) {
    try {
      const payload = Buffer.from(JSON.stringify({
        s: site, sl: slot, c: country, b: brandKey, sd: sidTag,
        d: String(targetUrl || '').slice(0, 400), t: Date.now(),
        n: require('crypto').randomBytes(9).toString('hex')
      })).toString('base64url');
      const mac = require('crypto').createHmac('sha256', SEGREDO_CLIQUE).update(payload).digest('base64url').slice(0, 32);
      TOKEN_CLIQUE = payload + '.' + mac;
    } catch (e) { TOKEN_CLIQUE = ''; }
  }""", 1)

# ── 2. remove o registro antigo do clique (a origem dos cliques-fantasma) ────
INI = "  try {\n    const dbUrl = process.env.CLICKS_DB_URL;"
FIM = "  res.setHeader('Cache-Control', 'no-cache"
i, j = s.find(INI), s.find(FIM)
assert i > 0 and j > i, 'bloco do insert nao localizado'
s = s[:i] + """  /* v128.8 — INSERT em ads_clicks REMOVIDO daqui. Era este trecho que gravava
     um clique a cada GET no link, inclusive de frota de robô: 45.025 cliques em
     7 dias sem um único humano. Quem grava agora é /api/ads/click, chamado pelo
     intersticial com token assinado (clique comprovado). */
""" + s[j:]

# ── 3. saída: robô/diagnóstico não vão para a rede de afiliado ──────────────
ALVO_SAIDA = """  const WANT_INT = !IS_BOT && String(query.noint || '') !== '1';
  if (!WANT_INT) {
    res.setHeader('Location', targetUrl);
    return res.status(307).end();
  }"""
assert ALVO_SAIDA in s, 'bloco WANT_INT nao encontrado'
s = s.replace(ALVO_SAIDA, """  res.setHeader('X-Nexus-Traffic', SINTETICO ? ('synthetic:' + MOTIVO_SINTETICO) : 'human');
  res.setHeader('X-Nexus-Counted', SINTETICO ? '0' : '1');
  res.setHeader('X-Nexus-Tags', MOSTRAR_TAGS ? 'servidas' : 'suprimidas_origem_nao_comprovada');
  res.setHeader('X-Nexus-Click-Token', TOKEN_CLIQUE ? 'emitido' : (SINTETICO ? 'nao_sintetico' : (GESTO_HUMANO ? 'sem_segredo' : 'sem_gesto_humano')));
  const WANT_INT = !SINTETICO && !NOINT_EXPLICITO;
  if (!WANT_INT) {
    /* Robô e diagnóstico não vão para a rede de afiliado: destino neutro nosso.
       O ?noint=1 do operador preserva o destino real para conferir o link. */
    const destinoSaida = (SINTETICO && !NOINT_EXPLICITO) || PROBE_EXPLICITO ? NEUTRO : targetUrl;
    res.setHeader('Location', destinoSaida);
    return res.status(307).end();
  }""", 1)

# ── 4. HTML: tag só para origem comprovada + beacon do clique ───────────────
LINHA_HTML = None
for linha in s.split('\n'):
    if "return res.status(200).end('<!DOCTYPE html>" in linha:
        LINHA_HTML = linha
        break
assert LINHA_HTML, 'linha do HTML nao encontrada'
alvo_html = LINHA_HTML
alvo_html = alvo_html.replace("(TAG_ADSTERRA ?", "(TAG_ADSTERRA_EF ?").replace("(TAG_SOCIALBAR ?", "(TAG_SOCIALBAR_EF ?")
alvo_html = alvo_html.replace("if(!TAG_ADSTERRA)return;", "if(!TAG_ADSTERRA_EF)return;")
alvo_html = alvo_html.replace("' • v128</div>'", "' • v128.8</div>'")
BEACON = ("setTimeout(function(){try{location.replace(DEST)}catch(e){location.href=DEST}},' + DWELL_MS + ');"
          "var TOKEN_CLIQUE=" + "' + JSON.stringify(TOKEN_CLIQUE) + '" + ";var jaAvisou=false;"
          "function avisarClique(){if(jaAvisou||!TOKEN_CLIQUE)return;try{if(navigator.webdriver)return}catch(e){}"
          "if(document.visibilityState!==\"visible\")return;jaAvisou=true;"
          "var url=\"/api/ads/click?t=\"+encodeURIComponent(TOKEN_CLIQUE)+\"&a=ok\";"
          "try{navigator.sendBeacon(url,new Blob([\"\"],{type:\"text/plain\"}))}catch(e){try{fetch(url,{keepalive:true,mode:\"no-cors\"})}catch(_){}}}"
          "setTimeout(avisarClique,1500);"
          "document.addEventListener(\"visibilitychange\",function(){if(document.visibilityState===\"visible\")setTimeout(avisarClique,300)});")
assert "setTimeout(function(){try{location.replace(DEST)}catch(e){location.href=DEST}},' + DWELL_MS + ');" in alvo_html, 'trecho do redirecionamento nao encontrado'
alvo_html = alvo_html.replace("setTimeout(function(){try{location.replace(DEST)}catch(e){location.href=DEST}},' + DWELL_MS + ');", BEACON, 1)
s = s.replace(LINHA_HTML, alvo_html, 1)

# variáveis efetivas das tags, definidas antes do HTML
ALVO_TAGS = "  const TAG_BINDING = 'pop=' + (TAG_ADSTERRA ? 'bound' : 'none') + ';sb=' + (TAG_SOCIALBAR ? 'bound' : 'none');"
assert ALVO_TAGS in s
s = s.replace(ALVO_TAGS, ALVO_TAGS + """
  /* v128.8 — tag de anúncio só para origem COMPROVADA (gate + gesto humano).
     Frota que só faz GET recebe o intersticial sem tag: nenhuma impressão
     inválida entra na Adsterra/Monetag. */
  const TAG_ADSTERRA_EF = MOSTRAR_TAGS ? TAG_ADSTERRA : null;
  const TAG_SOCIALBAR_EF = MOSTRAR_TAGS ? TAG_SOCIALBAR : null;""", 1)

open(ALVO, 'w', encoding='utf-8').write(s)
print('v128.8 aplicado em ' + ALVO)
for m in ['SINTETICO', 'TOKEN_CLIQUE', '/api/ads/click', 'MOSTRAR_TAGS', 'TAG_ADSTERRA_EF']:
    print('   %-18s %d' % (m, s.count(m)))
print('   insert antigo presente?', 'CLICKS_DB_URL' in s)
