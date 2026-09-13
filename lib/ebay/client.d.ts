/**
 * client.ts — Cliente da API do eBay Partner Network (v336.0)
 *
 * DESENHO DE HANDSHAKE (sem loop de polling):
 *   O eBay usa OAuth 2.0 client_credentials. O token dura ~2h, então o cliente
 *   faz UM handshake e reaproveita o token em memória até faltarem 5 minutos para
 *   expirar. Não existe polling de segundo em segundo: cada chamada só refaz o
 *   handshake se o token estiver vencido (ou se o servidor devolver 401).
 *
 * FAIL-CLOSED DE CREDENCIAL (regra do operador):
 *   `credentialsVerified` precisa ser true para qualquer chamada sair daqui.
 *   As credenciais de 13/09/2026 NÃO autenticaram (HTTP 401 invalid_client),
 *   então nascem marcadas como não verificadas e o cliente se recusa a usá-las —
 *   em vez de martelar a API e sujar a telemetria.
 *
 * SEGREDO: este arquivo é versionado e público. Ele NUNCA contém Client ID,
 * Client Secret nem token; tudo entra por parâmetro em runtime.
 */
export declare const EBAY_ENDPOINTS: {
    readonly production: {
        readonly oauth: "https://api.ebay.com/identity/v1/oauth2/token";
        readonly marketing: "https://api.ebay.com/buy/marketing/v1_beta/merchandised_product";
        readonly deepLink: "https://api.ebay.com/buy/marketing/v1_beta/merchandised_product";
    };
    readonly sandbox: {
        readonly oauth: "https://api.sandbox.ebay.com/identity/v1/oauth2/token";
        readonly marketing: "https://api.sandbox.ebay.com/buy/marketing/v1_beta/merchandised_product";
        readonly deepLink: "https://api.sandbox.ebay.com/buy/marketing/v1_beta/merchandised_product";
    };
};
export type EbayEnv = keyof typeof EBAY_ENDPOINTS;
export interface EbayCredentials {
    clientId: string;
    clientSecret: string;
    /** Resultado de um handshake real, registrado no cofre (verified_at). */
    credentialsVerified: boolean;
}
export interface EbayCallResult<T> {
    ok: boolean;
    status: number;
    data?: T;
    error?: string;
    /** Marcador de telemetria fail-closed usado pelo operador. */
    telemetry?: 'Sintonizado em Análise';
    durationMs: number;
}
export declare class EbayClient {
    private readonly env;
    private readonly creds;
    private readonly fetchImpl;
    constructor(creds: EbayCredentials, opts?: {
        env?: EbayEnv;
        fetchImpl?: typeof fetch;
    });
    /** Fingerprint NÃO reversível, só para separar cache por credencial. */
    private get cacheKey();
    hasUsableCredentials(): boolean;
    /** Handshake OAuth (client_credentials). Reaproveita token válido do cache. */
    getToken(scopes?: string[]): Promise<EbayCallResult<string>>;
    /**
     * Mercadorias mais vendidas de uma categoria (Buy Marketing API).
     * Devolve o erro cru em caso de falha — nunca inventa item.
     */
    merchandisedProducts(categoryId: string, metric?: 'BEST_SELLING' | 'CLICK_COUNT'): Promise<EbayCallResult<unknown>>;
}
/**
 * Monta o link de afiliado do eBay (Custom Deep Link).
 * Não depende da API: é o mesmo envelope usado em produção e verificável a olho nu.
 */
export declare function ebayDeepLink(itemUrl: string, opts: {
    campaignId: string;
    sid?: string;
    rover?: boolean;
}): string | null;
