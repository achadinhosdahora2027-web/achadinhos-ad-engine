/**
 * nexus v360 — composição textual (compose).
 *
 * Regras declaradas pelo operador e implementadas aqui:
 *   • idioma do texto segue o idioma do leitor (pt-BR para BR, en para Tier-1);
 *   • frases fechadas com pontuação rígida;
 *   • NUNCA ponto final depois de emoji (o fechamento é o próprio emoji);
 *   • o link embutido é o do shortener (intersticial), com as mídias
 *     programáticas decididas por host no momento do clique — o faturamento de
 *     display continua no intersticial, não no texto.
 *
 * Nada aqui inventa preço, desconto ou comissão: só o que veio do evento.
 */

export interface EventoComposicao {
  /** idioma do leitor: 'pt' | 'en' (do geo_route; default pt) */
  idioma?: string;
  /** nome real do produto */
  produto: string;
  /** keyword que disparou o match */
  keyword: string;
  /** link do shortener já com site/slot/offer */
  link: string;
  /** rede decidida pelo roteador geográfico (v360) */
  rede?: string;
  /** país do leitor */
  country?: string;
}

const EMOJI_FIM = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]$/u;

/** Fecha a frase: se termina em emoji, o emoji é o fechamento (sem ponto). */
export function fecharFrase(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (/[.!?…]$/.test(t)) return t;
  if (EMOJI_FIM.test(t)) return t;             // emoji fecha — sem ponto depois
  return t + ".";
}

/** Primeira letra maiúscula, resto preservado. */
export function capitalizar(s: string): string {
  const t = String(s ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

function limparTermo(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
}

/**
 * Monta a mensagem. O link vai em linha própria para o preview ficar limpo
 * (disable_web_page_preview já é aplicado no envio pelo flush).
 */
export function compor(e: EventoComposicao): string {
  const idioma = (e.idioma || "pt").toLowerCase().startsWith("en") ? "en" : "pt";
  const produto = limparTermo(e.produto) || limparTermo(e.keyword) || "Oferta";
  const termo = limparTermo(e.keyword);

  if (idioma === "en") {
    const l1 = fecharFrase(`Deal spotted: ${produto} 🛒`);
    const l2 = termo && termo !== produto ? fecharFrase(`Found while tracking "${termo}"`) : "";
    return [l1, l2, e.link].filter(Boolean).join("\n");
  }

  const l1 = fecharFrase(`${capitalizar(produto)} 🛒`);
  const l2 = termo && termo !== produto ? fecharFrase(`Achado na busca por “${termo}”`) : "";
  const l3 = e.rede === "mercado_livre" || e.rede === "shopee_br"
    ? "Preço em real, entrega no Brasil 💵"
    : "";
  return [l1, l2, l3, e.link].filter(Boolean).join("\n");
}

/** Assinatura do shortener: uma linha só, para reuso nos posts. */
export function linkDoShortener(base: string, p: {
  brand: string; site: string; slot: string; geo: string; offer?: string; kw?: string;
}): string {
  const u = new URL(base);
  u.searchParams.set("brand", p.brand);
  u.searchParams.set("site", p.site);
  u.searchParams.set("slot", p.slot);
  u.searchParams.set("geo", p.geo);
  if (p.offer) u.searchParams.set("offer", p.offer);
  if (p.kw) u.searchParams.set("kw", p.kw);     // v128.9: suborigem = produto real
  return u.toString();
}
