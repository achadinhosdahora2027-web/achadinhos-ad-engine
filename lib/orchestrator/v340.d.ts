/**
 * =============================================================================
 * v340.0 — SOVEREIGN GEO-TARGETING CORE & DYNAMIC PARAM RESOLVER SUITE
 * Orquestrador molecular de roteamento geográfico, suborigem dinâmica e mídia
 * programática. Fonte única das regras que o gateway (api/ads/go.js), a borda
 * Cloudflare (functions/go.js) e o banco (nexus_route_resolve_dynamic) aplicam.
 *
 * REGRAS (todas verificadas contra produção em 13/09/2026):
 *   1. País do visitante vem do IP REAL: x-vercel-ip-country → cf-ipcountry →
 *      x-country-code. O parâmetro de URL só vale como dica explícita de borda
 *      (geoforce=1) ou teste. Antes ele sequestrava a rota (linha 167 do go.js).
 *   2. TRAVA NACIONAL BR: brasileiro humano (is_bot=false) nunca sai para
 *      merchant em moeda estrangeira — recebe Shopee Brasil rastreada (catálogo
 *      real, até 83% de comissão) ou https://meli.la. Bot não consome a trava:
 *      rastreador não compra e não deve queimar cota de parceiro.
 *   3. SWAP EXCLUSIVO TIER-1 (US, CA, GB, DE, FR): Booking UK (15734754) e eBay
 *      Partner Network (campid 5339193749). Fora do núcleo, não há desvio.
 *   4. SUBORIGEM DINÂMICA: o slot deixa de ser constante ('header', 'health') e
 *      passa a ser <keyword-real>_<arquitetura-do-UA> (mop_desktop,
 *      powerbank_mobile). A string '_health_desktop' é proibida por regra.
 *   5. FAIL-CLOSED: qualquer erro devolve a rota de menor risco e libera o
 *      visitante em 0 ms, com o marcador 'Sintonizado em Análise' na telemetria.
 * =============================================================================
 */
export declare const VERSAO = "v340.0";
/** Núcleo do swap internacional — estritamente cinco países. */
export declare const TIER1_CORE: readonly ["US", "CA", "GB", "DE", "FR"];
/** Merchants que cobram em moeda estrangeira do visitante brasileiro. */
export declare const MOEDA_ESTRANGEIRA: readonly ["booking", "booking_uk", "booking_latam", "ebay", "ebay_us", "amazon", "amazon_us", "aliexpress", "udemy", "nordvpn", "economybookings", "brunoyam"];
export declare const SLOTS_SINTETICOS: readonly ["_health_desktop", "health", "_health", "health_desktop"];
export declare const HOSTS_MOEDA_ESTRANGEIRA: RegExp;
export declare const HOSTS_CJ_INTERNACIONAIS: RegExp;
/** Links verificados em produção (fallback de menor risco). */
export declare const LINKS: {
    readonly shopeeBR: "https://s.shopee.com.br/4qFb586XtN";
    readonly meliLa: "https://meli.la/1U3rtgV";
    readonly bookingUK: "https://www.jdoqocy.com/click-{PID}-15734754";
    readonly ebayEPN: "https://www.ebay.com/deals?campid=5339193749&toolid=10001&mkevt=1&mkcid=1&mkrid=711-53200-19255-0";
};
export type Arquitetura = 'desktop' | 'mobile' | 'tablet' | 'bot' | 'desconhecido';
export type DecisaoGeo = 'br_lock_moeda_estrangeira' | 'br_nacional' | 'tier1_swap_exclusivo' | 'regional' | 'sintonizado_em_analise';
export interface EntradaRota {
    /** Cabeçalhos da requisição (nomes em minúsculas). */
    headers: Record<string, string | undefined>;
    brand?: string;
    keyword?: string | null;
    /** Dica de borda (Cloudflare → motor): país do visitante medido no IP real. */
    geoHint?: string | null;
    geoforce?: boolean;
    offerHash?: string | null;
}
export interface SaidaRota {
    versao: string;
    country: string;
    brand: string;
    decisao: DecisaoGeo;
    isBot: boolean;
    bloqueouMoedaEstrangeira: boolean;
    tier1: boolean;
    slotDinamico: string;
    slotOrigem: string | null;
    arquitetura: Arquitetura;
    link: string | null;
    failClosed: boolean;
    motivo: string;
}
/** Segregação de bot/crawler por user-agent (mesma régua do gateway). */
export declare function classifyBot(userAgent: string | undefined): boolean;
export declare function arquiteturaUA(userAgent: string | undefined): Arquitetura;
export declare function slugKeyword(texto: string | null | undefined): string;
/** Slot dinâmico: keyword real + arquitetura. Sintético nunca é produzido. */
export declare function slotDinamico(keyword: string | null | undefined, userAgent: string | undefined): string;
/** Resolve o país pelo IP REAL, com o parâmetro de URL em papel subordinado. */
export declare function resolverCountry(e: EntradaRota): {
    country: string;
    fonte: string;
};
export declare function destinoMoedaEstrangeira(url: string | null | undefined): boolean;
/**
 * Anexa identificação e parâmetros de rastreio ao link do lojista.
 * `sid` é a tag do destino (grupo/site) — é ela que aparece em utm_content.
 */
export declare function marcarLink(url: string, sid: string, country: string): string;
/**
 * Resolve a rota final de um clique. PURA em relação à rede: recebe tudo por
 * parâmetro e devolve a decisão — por isso é testável sem subir servidor.
 */
export declare function resolverRota(entrada: EntradaRota, campanhaId?: string, pidCj?: string): SaidaRota;
export interface PlanoMidia {
    host: string;
    popunder: string | null;
    socialbar: string | null;
    binding: string;
    metodo: 'createElement';
}
/**
 * Plano de injeção de Adsterra/Monetag DEDICADO ao host. Host desconhecido ou
 * tag pendente devolve null — fail-closed: tag de host A nunca serve em host B
 * (mismatch = descarte pelo ads.txt e comissão perdida).
 */
export declare function planoMidia(host: string, mapa: Record<string, {
    pop?: string | null;
    sb?: string | null;
}>): PlanoMidia;
/** Tag de script para injeção assíncrona em createElement (sem document.write). */
export declare function scriptCreateElement(tag: string | null, zona?: string | null): string;
