/**
 * nexus v370.0 — humanizer.ts  (Edge v205 / Matrix v370.0)
 *
 * Compositor cognitivo hyper-humanizado. Regras declaradas pelo operador:
 *   • o texto mimetiza um usuário residencial nativo — PT-BR claro e
 *     EN/FR/DE perfeitos para o Tier-1;
 *   • o link de saída entra embutido, oculto e fluido no FIM de uma frase
 *     já pontuada (conector + dois-pontos + URL), nunca em linha de grito,
 *     nunca com rótulo "clique aqui";
 *   • o idioma vem do geo (`x-vercel-ip-country`) — a rede também;
 *   • nada aqui inventa preço, desconto ou comissão: valor só aparece se o
 *     chamador passar o número medido do catálogo;
 *   • o caixa de display NÃO é tocado: `go.js v128.9` permanece byte a byte —
 *     este módulo só produz texto.
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
  emoji: readonly string[];
}

const RECEITAS: Record<Idioma, Receita> = {
  pt: {
    abertura: [
      "Achei esse {p} e vim dividir aqui",
      "Olha o que apareceu pra mim: {p}",
      "Entrou na minha lista: {p}",
      "Fica de olho nesse {p}",
    ],
    gancho: [
      "Tava na busca de “{k}” e caiu esse na mão",
      "Quem procurava “{k}” vai gostar desse",
      "Veio no meio da minha busca por “{k}”",
    ],
    conector: ["Guardei aqui", "O link tá aqui", "Deixei separado aqui"],
    emoji: ["🛒", "👀", "🔥", "🙂"],
  },
  en: {
    abertura: [
      "Found this one and had to share: {p}",
      "This popped up for me: {p}",
      "Adding this to my list: {p}",
      "Keeping an eye on {p}",
    ],
    gancho: [
      "Was looking through “{k}” and this came up",
      "Came up while I was digging for “{k}”",
      "Spotted this while checking “{k}”",
    ],
    conector: ["Saved the link here", "The link is here", "Kept it here"],
    emoji: ["🛒", "👀", "🔥", "🙂"],
  },
  fr: {
    abertura: [
      "Je suis tombé sur ce {p} et je partage",
      "Ça vient de tomber devant moi\u00A0: {p}",
      "J'ai ajouté à ma liste\u00A0: {p}",
      "À surveiller, ce {p}",
    ],
    gancho: [
      "Je cherchais «\u00A0{k}\u00A0» et je suis tombé dessus",
      "Trouvé en furetant dans «\u00A0{k}\u00A0»",
      "C'est sorti pendant que je regardais «\u00A0{k}\u00A0»",
    ],
    conector: ["J'ai gardé le lien ici", "Le lien est ici", "Je l'ai mis de côté ici"],
    emoji: ["🛒", "👀", "🔥", "🙂"],
  },
  de: {
    abertura: [
      "Bin über dieses {p} gestolpert und teile es",
      "Ist mir gerade aufgefallen\u00A0: {p}",
      "Steht jetzt auf meiner Liste\u00A0: {p}",
      "Behalte das im Blick\u00A0: {p}",
    ],
    gancho: [
      "War bei „{k}“ unterwegs und das kam dazwischen",
      "Beim Suchen von „{k}“ aufgetaucht",
      "Ist mir beim Stöbern nach „{k}“ begegnet",
    ],
    conector: ["Link hab ich hier", "Hier ist der Link", "Hab's hier abgelegt"],
    emoji: ["🛒", "👀", "🔥", "🙂"],
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
  if (idioma === "pt") return d !== null ? `Saiu por ${valor} (${d}% abaixo)` : `Saiu por ${valor}`;
  if (idioma === "en") return d !== null ? `Listed at ${valor} (${d}% off)` : `Listed at ${valor}`;
  if (idioma === "fr") return d !== null ? `Affiché à ${valor} (${d}\u00A0% en moins)` : `Affiché à ${valor}`;
  return d !== null ? `Gelistet für ${valor} (${d}\u00A0% günstiger)` : `Gelistet für ${valor}`;
}

/* ───────────────────────── composição ───────────────────────── */

/**
 * Monta a mensagem hyper-humanizada:
 *   1ª linha  — abertura natural (produto real);
 *   2ª linha  — gancho opcional com a keyword que disparou o match;
 *   3ª linha  — oferta real, se houver número medido;
 *   fecho     — link embutido no fim de frase pontuada (conector + ":" + URL).
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

  // emoji discreto: só em ~1 de cada 3 mensagens (comportamento de gente, não de robô)
  const comEmoji = rnd() < 0.34;
  const primeira = comEmoji && !ehEmojiFinal(abertura)
    ? `${abertura} ${escolher(r.emoji, rnd)}`
    : abertura;

  const linhas = [primeira];
  if (gancho) linhas.push(gancho);
  if (oferta) linhas.push(oferta);

  // o link entra embutido no FIM da última frase já pontuada — fluido, sem rótulo,
  // e sem repetir a frase (v370.0: corrigido o eco que aparecia no teste)
  const ultima = linhas[linhas.length - 1];
  linhas[linhas.length - 1] = embutirLink(ultima, String(e?.link ?? ""), escolher(r.conector, rnd));
  return linhas.join("\n");
}

export const VERSAO_HUMANIZER = "v370.0" as const;
