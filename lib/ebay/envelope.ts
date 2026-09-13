/**
 * envelope.ts — Envelopamento de links do eBay Partner Network (v335.2/v336.0)
 *
 * Regra de negócio (verificada em produção):
 *  • Tráfego Tier-1 (EUA, Reino Unido, Alemanha, França e afins) que clica em link
 *    CRU do eBay recebe o Campaign ID no fim da URL de produto.
 *  • Tráfego do Brasil NÃO entra no bloco internacional: segue para a Shopee
 *    Brasil com o link curto trackeado (comissão até 83%). Por isso
 *    `envelopeEbay` devolve null fora do Tier-1 — fail-closed, sem inventar destino.
 *  • O Campaign ID não é escrito aqui: vem do cofre em runtime. Este arquivo é
 *    versionado e público, então nunca contém segredo.
 */

export type CountryCode = string; // ISO-3166-1 alfa-2 maiúsculo

/** Países onde o eBay paga em moeda forte e o link vale a pena. */
export const EBAY_TIER1: ReadonlySet<CountryCode> = new Set([
  'US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE',
  'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'PT', 'PL',
]);

/** Marketplaces que NÃO pertencem à campanha EBAY_US (comissão não se aplica). */
export const EBAY_EXCLUDED_HOSTS: ReadonlySet<string> = new Set([
  'ebay.com.br', 'ebay.com.ar', 'ebay.com.mx', 'ebay.com.au',
]);

/** Parâmetros públicos do EPN (o Campaign ID em si vem do cofre). */
export const EBAY_EPN_PARAMS = {
  mkcid: '1',
  mkevt: '1',
  toolid: '10001',
  mkrid: '711-53200-19255-0',
  siteid: '0',
} as const;

/** Último Campaign ID verificado na interface do EPN (fallback explícito). */
export const EBAY_CAMPAIGN_ID_FALLBACK = '5339193749';

export interface EnvelopeOptions {
  country: CountryCode;
  sid?: string;
  campaignId?: string;
  forceCampaignId?: string;
}

export interface EnvelopeResult {
  url: string;
  campaignId: string;
  applied: boolean;
  reason: string;
}

/** O link é do eBay e pertence à nossa campanha? */
export function isEbayUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    if (EBAY_EXCLUDED_HOSTS.has(host)) return false; // ebay.com.br não é EBAY_US
    return /(^|\.)ebay\.[a-z.]{2,6}$/.test(host);
  } catch {
    return false;
  }
}

/**
 * Envelopa um link cru do eBay com o Campaign ID.
 * Devolve null quando NÃO se aplica (país fora do Tier-1, host excluído ou
 * campanha com formato inválido) — a decisão de fallback fica com quem chamou.
 */
export function envelopeEbay(raw: string, opts: EnvelopeOptions): EnvelopeResult | null {
  const country = String(opts.country || '').toUpperCase().slice(0, 2);
  if (!country) return null;
  if (!EBAY_TIER1.has(country)) return null; // Brasil: fora do bloco internacional
  if (!isEbayUrl(raw)) return null;

  const campaignId = String(opts.campaignId || opts.forceCampaignId || EBAY_CAMPAIGN_ID_FALLBACK);
  if (!/^\d{10}$/.test(campaignId)) return null; // campanha inválida não é aplicada

  let url: URL;
  try { url = new URL(raw); } catch { return null; }

  for (const [k, v] of Object.entries(EBAY_EPN_PARAMS)) url.searchParams.set(k, v);
  url.searchParams.set('campid', campaignId);
  if (opts.sid) url.searchParams.set('customid', String(opts.sid).slice(0, 60));

  return { url: url.toString(), campaignId, applied: true, reason: `tier1_${country}` };
}

/** Lê o Campaign ID do ambiente com validação de formato. */
export function campaignIdFromEnv(env: Record<string, unknown> | undefined): string {
  const v = env && (env.EBAY_CAMPAIGN_ID as string | undefined);
  return v && /^\d{10}$/.test(v) ? v : EBAY_CAMPAIGN_ID_FALLBACK;
}
