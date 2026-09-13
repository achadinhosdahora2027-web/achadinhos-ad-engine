export interface OfertaShopee {
    /** hash da oferta no inventário */
    hash: string;
    /** título do produto/loja */
    n: string;
    /** loja anunciante */
    s: string;
    /** link curto rastreado (s.shopee.com.br/...) */
    u: string;
    /** comissão em % */
    c: number;
    /** preço em BRL, quando houver */
    p?: number;
    /** id do item na Shopee */
    i?: string;
    k?: string;
}
export interface ConsultaOferta {
    q?: string;
    kw?: string;
    keyword?: string;
    offer?: string;
    oferta?: string;
}
/**
 * Resolve a melhor oferta para a consulta. Ordem: hash direto → keyword exata →
 * keyword contida → n-grama (2–4 termos) → conjunto de termos. Devolve null se
 * nada casar (nunca inventa oferta).
 */
export declare function resolveShopeeOffer(consulta: ConsultaOferta): OfertaShopee | null;
/** Inventário completo (para auditoria/contagem — não para roteamento). */
export declare function inventarioCompleto(): Record<string, OfertaShopee>;
