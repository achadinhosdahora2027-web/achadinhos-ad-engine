/**
 * nexus v420.0 — composição textual + divulgação legal isolada.
 *
 * O texto continua saindo do `humanizer.ts` e mantém as regras de idioma,
 * pontuação e zero invenção. v420 acrescenta uma única garantia estrutural:
 * `#publi` (PT) ou `#ad` (Tier-1) ocupa linha própria imediatamente antes da
 * linha que contém o link de ação.
 */

import {
  capitalizar,
  embutirLink,
  fecharFrase,
  humanizar,
  idiomaDoPais,
  limparTermo,
  redeDoGeo,
  type EventoHumano,
  type Idioma,
  type OfertaConhecida,
} from "./humanizer.ts";

export { capitalizar, embutirLink, fecharFrase, humanizar, limparTermo };
export type { EventoHumano, Idioma, OfertaConhecida };

export interface EventoComposicao {
  /** idioma do leitor: 'pt' | 'en' | 'fr' | 'de' (do geo_route; default pt) */
  idioma?: string;
  /** nome real do produto */
  produto: string;
  /** keyword que disparou o match */
  keyword: string;
  /** link do shortener já com site/slot/offer/kw */
  link: string;
  /** rede decidida pelo roteador geográfico (v360/v370) */
  rede?: string;
  /** país do leitor (`x-vercel-ip-country`) */
  country?: string;
  /** números reais medidos do catálogo (opcional; nunca estimados) */
  oferta?: OfertaConhecida | null;
  /** semente determinística opcional */
  seed?: number | null;
}

/** Divulgação obrigatória isolada. PT-BR usa #publi; Tier-1 usa #ad. */
export function rotuloDivulgacao(idioma: Idioma): "#publi" | "#ad" {
  return idioma === "pt" ? "#publi" : "#ad";
}

/**
 * Insere a divulgação em linha própria imediatamente antes da linha que contém
 * o link de ação. Se o compositor não devolver o link recebido, falha fechado:
 * não tenta adivinhar outra URL nem cria uma divulgação fora de contexto.
 */
export function isolarDivulgacao(texto: string, link: string, idioma: Idioma): string {
  const url = String(link ?? "").trim();
  if (!url) return texto;
  const linhas = String(texto ?? "").split("\n");
  const indice = linhas.findIndex((linha) => linha.includes(url));
  if (indice < 0) return texto;
  const rotulo = rotuloDivulgacao(idioma);
  if (indice > 0 && /^(#publi|#ad)$/i.test(linhas[indice - 1].trim())) {
    linhas[indice - 1] = rotulo;
  } else {
    linhas.splice(indice, 0, rotulo);
  }
  return linhas.join("\n");
}

/**
 * Monta a mensagem v420. Delega ao humanizer, preserva a assinatura v360 e
 * aplica a divulgação legal sem misturá-la ao texto nem ao URL.
 */
export function compor(e: EventoComposicao): string {
  const idioma: Idioma = ((): Idioma => {
    const dito = String(e?.idioma ?? "").toLowerCase().slice(0, 2);
    if (dito === "pt" || dito === "en" || dito === "fr" || dito === "de") return dito;
    return idiomaDoPais(e?.country, "pt");
  })();

  const texto = humanizar({
    produto: e?.produto,
    keyword: e?.keyword,
    link: e?.link,
    idioma,
    country: e?.country,
    rede: redeDoGeo(e?.country, e?.rede),
    oferta: e?.oferta ?? null,
    seed: e?.seed ?? null,
  });
  return isolarDivulgacao(texto, e?.link, idioma);
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

export const VERSAO_COMPOSE = "v420.0" as const;
