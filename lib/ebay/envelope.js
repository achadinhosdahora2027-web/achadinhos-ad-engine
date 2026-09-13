"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.EBAY_CAMPAIGN_ID_FALLBACK = exports.EBAY_EPN_PARAMS = exports.EBAY_EXCLUDED_HOSTS = exports.EBAY_TIER1 = void 0;
exports.isEbayUrl = isEbayUrl;
exports.envelopeEbay = envelopeEbay;
exports.campaignIdFromEnv = campaignIdFromEnv;
/** Países onde o eBay paga em moeda forte e o link vale a pena. */
exports.EBAY_TIER1 = new Set([
    'US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE',
    'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'PT', 'PL',
]);
/** Marketplaces que NÃO pertencem à campanha EBAY_US (comissão não se aplica). */
exports.EBAY_EXCLUDED_HOSTS = new Set([
    'ebay.com.br', 'ebay.com.ar', 'ebay.com.mx', 'ebay.com.au',
]);
/** Parâmetros públicos do EPN (o Campaign ID em si vem do cofre). */
exports.EBAY_EPN_PARAMS = {
    mkcid: '1',
    mkevt: '1',
    toolid: '10001',
    mkrid: '711-53200-19255-0',
    siteid: '0',
};
/** Último Campaign ID verificado na interface do EPN (fallback explícito). */
exports.EBAY_CAMPAIGN_ID_FALLBACK = '5339193749';
/** O link é do eBay e pertence à nossa campanha? */
function isEbayUrl(raw) {
    try {
        const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
        if (exports.EBAY_EXCLUDED_HOSTS.has(host))
            return false; // ebay.com.br não é EBAY_US
        return /(^|\.)ebay\.[a-z.]{2,6}$/.test(host);
    }
    catch {
        return false;
    }
}
/**
 * Envelopa um link cru do eBay com o Campaign ID.
 * Devolve null quando NÃO se aplica (país fora do Tier-1, host excluído ou
 * campanha com formato inválido) — a decisão de fallback fica com quem chamou.
 */
function envelopeEbay(raw, opts) {
    const country = String(opts.country || '').toUpperCase().slice(0, 2);
    if (!country)
        return null;
    if (!exports.EBAY_TIER1.has(country))
        return null; // Brasil: fora do bloco internacional
    if (!isEbayUrl(raw))
        return null;
    const campaignId = String(opts.campaignId || opts.forceCampaignId || exports.EBAY_CAMPAIGN_ID_FALLBACK);
    if (!/^\d{10}$/.test(campaignId))
        return null; // campanha inválida não é aplicada
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return null;
    }
    for (const [k, v] of Object.entries(exports.EBAY_EPN_PARAMS))
        url.searchParams.set(k, v);
    url.searchParams.set('campid', campaignId);
    if (opts.sid)
        url.searchParams.set('customid', String(opts.sid).slice(0, 60));
    return { url: url.toString(), campaignId, applied: true, reason: `tier1_${country}` };
}
/** Lê o Campaign ID do ambiente com validação de formato. */
function campaignIdFromEnv(env) {
    const v = env && env.EBAY_CAMPAIGN_ID;
    return v && /^\d{10}$/.test(v) ? v : exports.EBAY_CAMPAIGN_ID_FALLBACK;
}
