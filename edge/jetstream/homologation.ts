/**
 * nexus v365.0 — homologação final (edge): paridade de mídias do intersticial + yield.
 *
 * Regra fixada no catálogo do mestre (tabela nexus_v365_media_directive):
 *   • A paridade 'X-Adsterra-Binding: pop=bound;sb=bound' é exigida NA ROTA DO
 *     INTERSTICIAL (/api/ads/go), onde os scripts createElement carregam de forma
 *     síncrona. As páginas estáticas de cidade permanecem leves, sem script de
 *     anúncio concorrente e sem binding nelas.
 *   • O yield da Adsterra usa o campo REAL da API v3: 'impression' (singular,
 *     medido em 13/09/2026). O leitor aceita 'impressions' (plural) como
 *     fallback de bases antigas, com COALESCE — nunca soma os dois.
 */

export interface VereditoParidade {
  rota: string;
  http: number;
  binding: string | null;
  createElement: number;
  bytes: number;
  veredito: string;
}

export const BINDING_EXIGIDO = "pop=bound;sb=bound";

/** Mede a rota do intersticial como um visitante humano faria. */
export async function checarParidade(
  base: string, timeoutMs = 12000,
): Promise<VereditoParidade> {
  const url = `${base.replace(/\/$/, "")}/api/ads/go?brand=shopee&site=v365_parity&slot=header&geo=BR`;
  try {
    const r = await fetch(url, {
      headers: {
        "Accept-Language": "pt-BR,pt;q=0.9",
        "Sec-Fetch-User": "?1",
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) Chrome/131 Mobile Safari/537.36",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const html = await r.text();
    const binding = r.headers.get("x-adsterra-binding");
    const createElement = html.split("createElement").length - 1;
    const ok = r.status === 200 && binding === BINDING_EXIGIDO && createElement > 0;
    return {
      rota: "/api/ads/go", http: r.status, binding, createElement, bytes: html.length,
      veredito: ok ? "VERDE: intersticial serve as midias com binding correto"
        : r.status === 200 ? "AMARELO: intersticial 200 mas binding/tags fora do esperado"
        : "VERMELHO: intersticial nao respondeu 200",
    };
  } catch (e) {
    return {
      rota: "/api/ads/go", http: 0, binding: null, createElement: 0, bytes: 0,
      veredito: `VERMELHO: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    };
  }
}

export interface LinhaYield {
  dia: string;
  impression: number;
  clicks: number;
  revenue: number;
}

interface ItemAdsterra {
  date?: string;
  impression?: number | string;
  impressions?: number | string;   // fallback de bases antigas
  clicks?: number | string;
  revenue?: number | string;
}

function inteiro(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function decimal(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normaliza a resposta da API v3. O campo canônico é 'impression' (singular);
 * 'impressions' só entra quando o singular está ausente (COALESCE, nunca soma).
 */
export function normalizarYield(json: unknown): LinhaYield[] {
  const itens = (json as { items?: ItemAdsterra[] })?.items ?? [];
  return itens.map((it) => ({
    dia: String(it.date ?? ""),
    impression: it.impression !== undefined && it.impression !== null
      ? inteiro(it.impression)
      : inteiro(it.impressions),
    clicks: inteiro(it.clicks),
    revenue: decimal(it.revenue),
  })).filter((l) => l.dia.length > 0);
}
