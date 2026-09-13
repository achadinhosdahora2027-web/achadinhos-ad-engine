/**
 * nexus v3200.0 — factual contextual copy core.
 *
 * Regras de veracidade:
 *   • o texto atua como assistência neutra de produto e nunca se apresenta como
 *     consumidor, usuário orgânico, comprador ou especialista com experiência;
 *   • o link de saída entra no fim de uma frase curta e pontuada;
 *   • o país informado pela borda escolhe idioma/rede, mas não prova humanidade
 *     nem residência;
 *   • preço e desconto só aparecem quando fornecidos como fatos verificados;
 *   • placements e o gateway de mídia não são manipulados por este módulo.
 */

export type Idioma = "pt" | "en" | "fr" | "de";

export interface OfertaConhecida {
  /** preço real vindo do catálogo (opcional; nunca estimado) */
  preco?: number | null;
  /** moeda real do catálogo (ex.: "R$") */
  moeda?: string | null;
  /** desconto real do catálogo, em % (opcional) */
  desconto_pct?: number | null;
}

export interface EventoHumano {
  /** Nome histórico mantido por compatibilidade; não constitui prova humana. */
  /** nome real do produto */
  produto: string;
  /** keyword que disparou o match */
  keyword?: string | null;
  /** link do shortener (intersticial) já com site/slot/offer/kw */
  link: string;
  /** idioma do leitor: 'pt' | 'en' | 'fr' | 'de' (do geo_route) */
  idioma?: string | null;
  /** país do leitor (`x-vercel-ip-country`) */
  country?: string | null;
  /** rede decidida pelo roteador geográfico (v360/v370) */
  rede?: string | null;
  /** dados medidos do catálogo — opcional */
  oferta?: OfertaConhecida | null;
  /** semente determinística (default: derivada de produto+keyword) */
  seed?: number | null;
}

/* ───────────────────────── texto ───────────────────────── */

const EMOJI_FIM =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]$/u;

const PONTUACAO_FIM = /[.!?…:;»)]$/;

/** Emoji fechando a frase: o emoji é o fechamento (sem ponto depois). */
export function ehEmojiFinal(t: string): boolean {
  return EMOJI_FIM.test(String(t ?? "").trim());
}

/** Fecha a frase com pontuação rígida — exceto quando termina em emoji. */
export function fecharFrase(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (PONTUACAO_FIM.test(t)) return t;
  if (ehEmojiFinal(t)) return t; // regra v360 mantida: sem ponto após emoji
  return t + ".";
}

/** Primeira letra maiúscula, resto preservado. */
export function capitalizar(s: string): string {
  const t = String(s ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Normaliza um termo vindo do evento (sem inventar nada). */
export function limparTermo(s: unknown, max = 90): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/* ─────────────────── aleatoriedade determinística ─────────────────── */

/** FNV-1a 32 bits — mesma entrada, mesma frase (auditável). */
export function seedDe(texto: string): number {
  let h = 0x811c9dc5;
  const t = String(texto ?? "");
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — PRNG pequeno e reprodutível. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function escolher<T>(lista: readonly T[], r: () => number): T {
  return lista[Math.floor(r() * lista.length) % lista.length];
}

/* ───────────────────────── geo ───────────────────────── */

const PAIS_IDIOMA: Record<string, Idioma> = {
  BR: "pt", PT: "pt", AO: "pt", MZ: "pt",
  US: "en", CA: "en", GB: "en", UK: "en", IE: "en", AU: "en", NZ: "en",
  FR: "fr", BE: "fr", LU: "fr", MC: "fr",
  DE: "de", AT: "de", CH: "de",
};

/** Idioma do leitor pelo país; `padrao` quando o país não decide. */
export function idiomaDoPais(country?: string | null, padrao: Idioma = "pt"): Idioma {
  const c = String(country ?? "").trim().toUpperCase();
  return PAIS_IDIOMA[c] ?? padrao;
}

const TIER1 = new Set(Object.keys(PAIS_IDIOMA).filter((c) => PAIS_IDIOMA[c] !== "pt"));

/**
 * Rede por geo — espelha a decisão do roteador v360:
 *   BR → Shopee BR ou Mercado Livre; Tier-1 → eBay (EPN) ou Booking UK.
 * Não sobrescreve uma rede já decidida pela borda.
 */
export function redeDoGeo(
  country?: string | null,
  sugerida?: string | null,
  cadeiaTier1 = "ebay_epn",
): string {
  const s = String(sugerida ?? "").trim();
  if (s) return s;
  const c = String(country ?? "").trim().toUpperCase();
  if (c === "BR") return "shopee_br";
  if (TIER1.has(c)) return cadeiaTier1;
  return "shopee_br";
}

/* ───────────────────────── link embutido ───────────────────────── */

/**
 * Embute o link de saída no fim de uma frase JÁ PONTUADA.
 *   → recebe a última frase do texto e o conector da língua;
 *   → devolve "… frase pontuada + conector: URL" (link fluido, sem rótulo);
 *   → nunca põe ponto depois da URL, nunca isola a URL em linha de anúncio.
 */
export function embutirLink(frase: string, link: string, conector: string): string {
  const url = String(link ?? "").trim();
  if (!url) return fecharFrase(frase);
  const base = fecharFrase(frase);
  const c = String(conector ?? "").trim();
  if (!c) return `${base} ${url}`;
  const fecho = /[:：]$/.test(c) ? c : c + ":";
  return `${base} ${fecho} ${url}`;
}

/* ───────────────────────── receitas por língua ───────────────────────── */

interface Receita {
  abertura: readonly string[];
  gancho: readonly string[];
  conector: readonly string[];
}

const RECEITAS: Record<Idioma, Receita> = {
  pt: {
    abertura: [
      "Informações úteis sobre {p}",
      "Referência para avaliar {p}",
      "Resumo objetivo sobre {p}",
      "Detalhes para comparar {p}",
    ],
    gancho: [
      "Para a busca por “{k}”, confirme especificações e condições atuais",
      "Se a dúvida envolve “{k}”, compare os dados informados pelo lojista",
      "Sobre “{k}”, verifique compatibilidade, preço e prazo antes de decidir",
    ],
    conector: [
      "Consulte os detalhes atuais no lojista",
      "Confira as condições na página do lojista",
      "Revise as informações diretamente no lojista",
    ],
  },
  en: {
    abertura: [
      "Useful information about {p}",
      "A reference for evaluating {p}",
      "An objective summary of {p}",
      "Details for comparing {p}",
    ],
    gancho: [
      "For “{k}”, confirm the current specifications and terms",
      "If your question concerns “{k}”, compare the merchant-provided details",
      "For “{k}”, verify compatibility, price, and delivery before deciding",
    ],
    conector: [
      "Review the current merchant details",
      "Check the terms on the merchant page",
      "Verify the information directly with the merchant",
    ],
  },
  fr: {
    abertura: [
      "Informations utiles sur {p}",
      "Une référence pour évaluer {p}",
      "Résumé objectif de {p}",
      "Détails pour comparer {p}",
    ],
    gancho: [
      "Pour «\u00A0{k}\u00A0», vérifiez les spécifications et conditions actuelles",
      "Si la question concerne «\u00A0{k}\u00A0», comparez les données du marchand",
      "Pour «\u00A0{k}\u00A0», vérifiez la compatibilité, le prix et la livraison",
    ],
    conector: [
      "Consultez les détails actuels chez le marchand",
      "Vérifiez les conditions sur la page du marchand",
      "Confirmez les informations directement auprès du marchand",
    ],
  },
  de: {
    abertura: [
      "Nützliche Informationen zu {p}",
      "Eine Referenz zur Bewertung von {p}",
      "Sachliche Übersicht zu {p}",
      "Details zum Vergleich von {p}",
    ],
    gancho: [
      "Für „{k}“ bitte aktuelle Spezifikationen und Bedingungen prüfen",
      "Bei Fragen zu „{k}“ die Händlerangaben vergleichen",
      "Für „{k}“ Kompatibilität, Preis und Lieferung vorab prüfen",
    ],
    conector: [
      "Aktuelle Händlerdetails prüfen",
      "Bedingungen auf der Händlerseite prüfen",
      "Informationen direkt beim Händler bestätigen",
    ],
  },
};

function preencher(tpl: string, produto: string, keyword: string): string {
  return tpl.split("{p}").join(produto).split("{k}").join(keyword);
}

/** Frase opcional de oferta — só com número real medido do catálogo. */
export function fraseDeOferta(o?: OfertaConhecida | null, idioma: Idioma = "pt"): string {
  if (!o) return "";
  const p = typeof o.preco === "number" && isFinite(o.preco) ? o.preco : null;
  if (p === null) return "";
  const moeda = limparTermo(o.moeda, 6) || (idioma === "pt" ? "R$" : "");
  const valor = `${moeda ? moeda + " " : ""}${p.toFixed(2).replace(".", ",")}`;
  const d = typeof o.desconto_pct === "number" && isFinite(o.desconto_pct) ? o.desconto_pct : null;
  if (idioma === "pt") return d !== null ? `Preço informado: ${valor}; desconto informado: ${d}%` : `Preço informado: ${valor}`;
  if (idioma === "en") return d !== null ? `Listed price: ${valor}; stated discount: ${d}%` : `Listed price: ${valor}`;
  if (idioma === "fr") return d !== null ? `Prix affiché\u00A0: ${valor}; remise indiquée\u00A0: ${d}\u00A0%` : `Prix affiché\u00A0: ${valor}`;
  return d !== null ? `Angegebener Preis: ${valor}; angegebener Rabatt: ${d}\u00A0%` : `Angegebener Preis: ${valor}`;
}

/* ───────────────────────── composição ───────────────────────── */

/**
 * Monta assistência contextual factual:
 *   1ª linha  — identificação objetiva do produto real;
 *   2ª linha  — orientação ligada à keyword que disparou o match;
 *   3ª linha  — preço/desconto apenas quando medidos;
 *   fecho     — link no fim de frase pontuada, sem experiência pessoal fingida.
 */
export function humanizar(e: EventoHumano): string {
  const produto = limparTermo(e?.produto) || limparTermo(e?.keyword) || "Oferta";
  const keyword = limparTermo(e?.keyword);
  const idioma: Idioma =
    (String(e?.idioma ?? "").toLowerCase().slice(0, 2) as Idioma) ||
    idiomaDoPais(e?.country, "pt");
  const lang: Idioma = (["pt", "en", "fr", "de"] as Idioma[]).includes(idioma)
    ? idioma
    : idiomaDoPais(e?.country, "pt");

  const r = RECEITAS[lang];
  const semente = typeof e?.seed === "number" ? (e.seed >>> 0) : seedDe(`${produto}|${keyword}`);
  const rnd = rng(semente);

  const abertura = capitalizar(
    fecharFrase(preencher(escolher(r.abertura, rnd), produto, keyword)),
  );
  const gancho = keyword && keyword.toLowerCase() !== produto.toLowerCase()
    ? fecharFrase(preencher(escolher(r.gancho, rnd), produto, keyword))
    : "";
  const oferta = fraseDeOferta(e?.oferta, lang);

  const linhas = [abertura];
  if (gancho) linhas.push(gancho);
  if (oferta) linhas.push(oferta);

  // o link entra embutido no FIM da última frase já pontuada — fluido, sem rótulo,
  // e sem repetir a frase (v370.0: corrigido o eco que aparecia no teste)
  const ultima = linhas[linhas.length - 1];
  linhas[linhas.length - 1] = embutirLink(ultima, String(e?.link ?? ""), escolher(r.conector, rnd));
  return linhas.join("\n");
}

export const VERSAO_HUMANIZER = "v3200.0" as const;
