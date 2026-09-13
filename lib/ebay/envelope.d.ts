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
export type CountryCode = string;
/** Países onde o eBay paga em moeda forte e o link vale a pena. */
export declare const EBAY_TIER1: ReadonlySet<CountryCode>;
/** Marketplaces que NÃO pertencem à campanha EBAY_US (comissão não se aplica). */
export declare const EBAY_EXCLUDED_HOSTS: ReadonlySet<string>;
/** Parâmetros públicos do EPN (o Campaign ID em si vem do cofre). */
export declare const EBAY_EPN_PARAMS: {
    readonly mkcid: "1";
    readonly mkevt: "1";
    readonly toolid: "10001";
    readonly mkrid: "711-53200-19255-0";
    readonly siteid: "0";
};
/** Último Campaign ID verificado na interface do EPN (fallback explícito). */
export declare const EBAY_CAMPAIGN_ID_FALLBACK = "5339193749";
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
export declare function isEbayUrl(raw: string): boolean;
/**
 * Envelopa um link cru do eBay com o Campaign ID.
 * Devolve null quando NÃO se aplica (país fora do Tier-1, host excluído ou
 * campanha com formato inválido) — a decisão de fallback fica com quem chamou.
 */
export declare function envelopeEbay(raw: string, opts: EnvelopeOptions): EnvelopeResult | null;
/** Lê o Campaign ID do ambiente com validação de formato. */
export declare function campaignIdFromEnv(env: Record<string, unknown> | undefined): string;
