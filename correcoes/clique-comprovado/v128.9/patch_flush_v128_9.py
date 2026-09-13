#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v128.9 — flush do Telegram: suborigem real no link + freio de excesso.

Duas correções no flush (api/cron/index.js, job tg-flush):

1) SUBORIGEM REAL — o produtor (matcher do Bluesky) manda só `offer=<hash>`, e o
   catálogo do gateway pode não ter esse hash (arquivo desatualizado). Mas o
   PAYLOAD traz a palavra-chave. Aqui o link de cada destino é enriquecido com
   `&kw=<palavra-chave>` antes do envio: a suborigem do clique passa a ser o
   produto real, não o nome genérico da campanha (medido: saía
   `tg_ofertasbrasilz_us_jetstream_v330_mobile`).

2) FREIO DE EXCESSO — antes de cada envio, consulta o porteiro
   public.nexus_telegram_gate(destino, chave): mesma matéria-prima para o mesmo
   destino numa janela de 12 h não repete; teto de 3 mensagens por minuto e 40
   por hora POR DESTINO. Quando o teto bate, a linha fica pendente e o envio é
   adiado — nunca em rajada. Medido antes: 119 envios do mesmo termo em 6 h;
   dedupe de 6 h suprimiria 500 de 796 mensagens (62,8%).
"""
import sys

ALVO = 'api/cron/index.js'
s = open(ALVO, encoding='utf-8').read()

# ── 1. alvos ganham a palavra-chave no link (2 pontos: fanout e direto) ─────
ALVO_BUILD = """      alvos = dests
        .filter((d) => !feitos[d.id])
        .map((d) => ({
          id: d.id, chat_id: String(d.chat_id), label: d.label || d.id,
          texto: fanout.bodyFor(d, row.body_text, {})
        }))
        .filter((a) => (por_destino[a.id] = por_destino[a.id] || 0) < CAP);"""
assert ALVO_BUILD in s, 'mapa de alvos nao encontrado'
NOVO_BUILD = """      alvos = dests
        .filter((d) => !feitos[d.id])
        .map((d) => ({
          id: d.id, chat_id: String(d.chat_id), label: d.label || d.id,
          texto: enriquecerLink(fanout.bodyFor(d, row.body_text, {}), payload)
        }))
        .filter((a) => (por_destino[a.id] = por_destino[a.id] || 0) < CAP);"""
s = s.replace(ALVO_BUILD, NOVO_BUILD, 1)

ALVO_DIRETO = "      alvos = [{ id: 'direto', chat_id: String(row.chat_id), label: 'direto', texto: row.body_text }];"
assert ALVO_DIRETO in s
s = s.replace(ALVO_DIRETO, "      alvos = [{ id: 'direto', chat_id: String(row.chat_id), label: 'direto', texto: enriquecerLink(row.body_text, payload) }];", 1)

# ── 2. helper de enriquecimento + chave do porteiro ────────────────────────
ANCORA_HELPER = "  const TBL = `${SUPABASE_URL}/rest/v1/nexus_telegram_message_buffer`;"
assert ANCORA_HELPER in s
s = s.replace(ANCORA_HELPER, ANCORA_HELPER + """

  /* v128.9 — suborigem real: o produtor manda a oferta, mas a palavra-chave é
     que identifica o produto no relatório. O link publicado ganha &kw= antes de
     sair; se já tiver kw, não duplica. */
  function enriquecerLink(texto, payload) {
    const kw = String((payload && (payload.keyword || payload.palavra_chave)) || '').trim();
    if (!kw || !texto) return texto;
    return String(texto).replace(/(https?:\\/\\/[^\\s"'<)]*ads\\/go\\?[^\\s"'<)]*)/g, (url) => {
      if (/[?&]kw=/.test(url)) return url;
      return url + (url.includes('?') ? '&' : '?') + 'kw=' + encodeURIComponent(kw.slice(0, 120));
    });
  }

  /* Chave do porteiro: oferta > palavra-chave > texto normalizado. É o que
     impede o mesmo conteúdo de repetir para o mesmo destino. */
  function chavePorteiro(payload, texto) {
    const k = String(
      (payload && (payload.oferta || payload.keyword)) || ''
    ).trim() || String(texto || '').replace(/\\s+/g, ' ').slice(0, 120);
    return k.toLowerCase().slice(0, 120);
  }""", 1)

# ── 3. porteiro antes de cada envio ────────────────────────────────────────
ALVO_ENVIO = """    let algumOk = false, algumErro = '';
    for (const alvo of alvos) {
      const sendRes = await raw("""
assert ALVO_ENVIO in s, 'inicio do laco de envio nao encontrado'
NOVO_ENVIO = """    let algumOk = false, algumErro = '';
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
      const sendRes = await raw("""
s = s.replace(ALVO_ENVIO, NOVO_ENVIO, 1)

# ── 4. adiamento respeitando o porteiro ────────────────────────────────────
ALVO_ADIA = """        : { status: 'pending', request_id: null, payload: { ...payload, fanout_done: done }, attempts: (row.attempts || 0) + 1, last_error: String(algumErro || 'aguardando destinos restantes').slice(0, 300), not_before: new Date(Date.now() + 60000).toISOString(), updated_at: new Date().toISOString() })"""
assert ALVO_ADIA in s
s = s.replace(ALVO_ADIA, """        : { status: 'pending', request_id: null, payload: { ...payload, fanout_done: done }, attempts: (row.attempts || 0) + 1, last_error: String(algumErro || (adiarMs ? 'adiado pelo porteiro anti-flood' : 'aguardando destinos restantes')).slice(0, 300), not_before: new Date(Date.now() + Math.max(adiarMs, 60000)).toISOString(), updated_at: new Date().toISOString() })""", 1)

open(ALVO, 'w', encoding='utf-8').write(s)
print('v128.9 aplicado no flush')
for m in ['enriquecerLink', 'chavePorteiro', 'nexus_telegram_gate', 'adiarMs']:
    print('   %-22s %d' % (m, s.count(m)))
