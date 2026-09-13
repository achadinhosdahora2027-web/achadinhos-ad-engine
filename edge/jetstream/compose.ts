/**
 * nexus v370.0 — composição textual (compose).
 *
 * v370 mudou UMA coisa: o texto passou a sair do `humanizer.ts`
 * (compositor cognitivo hyper-humanizado: PT-BR claro, EN/FR/DE Tier-1,
 * link embutido no fim de frase pontuada). Nada mais mudou:
 *
 *   • o link embutido continua sendo o do shortener (intersticial), com as
 *     mídias programáticas decididas por host no momento do clique — a
 *     fiação do `/api/ads/go` (go.js v128.9) permanece SEM alteração de código;
 *   • frases fechadas com pontuação rígida e NUNCA ponto depois de emoji;
 *   • nada aqui inventa preço, desconto ou comissão: só o que veio medido.
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

/**
 * Monta a mensagem v370. Delega ao humanizer e mantém a assinatura v360
 * (os chamadores antigos seguem funcionando sem mudança).
 */
export function compor(e: EventoComposicao): string {
  const idioma: Idioma = ((): Idioma => {
    const dito = String(e?.idioma ?? "").toLowerCase().slice(0, 2);
    if (dito === "pt" || dito === "en" || dito === "fr" || dito === "de") return dito;
    return idiomaDoPais(e?.country, "pt");
  })();

  return humanizar({
    produto: e?.produto,
    keyword: e?.keyword,
    link: e?.link,
    idioma,
    country: e?.country,
    rede: redeDoGeo(e?.country, e?.rede),
    oferta: e?.oferta ?? null,
    seed: e?.seed ?? null,
  });
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

export const VERSAO_COMPOSE = "v370.0" as const;
