"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINKS = exports.HOSTS_CJ_INTERNACIONAIS = exports.HOSTS_MOEDA_ESTRANGEIRA = exports.SLOTS_SINTETICOS = exports.MOEDA_ESTRANGEIRA = exports.TIER1_CORE = exports.VERSAO = void 0;
exports.classifyBot = classifyBot;
exports.arquiteturaUA = arquiteturaUA;
exports.slugKeyword = slugKeyword;
exports.slotDinamico = slotDinamico;
exports.resolverCountry = resolverCountry;
exports.destinoMoedaEstrangeira = destinoMoedaEstrangeira;
exports.marcarLink = marcarLink;
exports.resolverRota = resolverRota;
exports.planoMidia = planoMidia;
exports.scriptCreateElement = scriptCreateElement;
exports.VERSAO = 'v340.0';
/** Núcleo do swap internacional — estritamente cinco países. */
exports.TIER1_CORE = ['US', 'CA', 'GB', 'DE', 'FR'];
/** Merchants que cobram em moeda estrangeira do visitante brasileiro. */
exports.MOEDA_ESTRANGEIRA = [
    'booking', 'booking_uk', 'booking_latam', 'ebay', 'ebay_us', 'amazon', 'amazon_us',
    'aliexpress', 'udemy', 'nordvpn', 'economybookings', 'brunoyam',
];
exports.SLOTS_SINTETICOS = ['_health_desktop', 'health', '_health', 'health_desktop'];
exports.HOSTS_MOEDA_ESTRANGEIRA = /(^|\.)(booking\.com|ebay\.(com|co\.uk|de|fr|it|es|ca|com\.au)|amazon\.(com|co\.uk|de|fr|es|it|ca)|aliexpress\.com|udemy\.com|nordvpn\.com|economybookings\.com|brunoyam\.com)$/i;
exports.HOSTS_CJ_INTERNACIONAIS = /(kqzyfj|jdoqocy|dpbolvw|anrdoezrs|tkqlhce)\.(com|net)/i;
/** Links verificados em produção (fallback de menor risco). */
exports.LINKS = {
    shopeeBR: 'https://s.shopee.com.br/4qFb586XtN',
    meliLa: 'https://meli.la/1U3rtgV',
    bookingUK: 'https://www.jdoqocy.com/click-{PID}-15734754',
    ebayEPN: 'https://www.ebay.com/deals?campid=5339193749&toolid=10001&mkevt=1&mkcid=1&mkrid=711-53200-19255-0',
};
/* ────────────────────────────── utilitários ─────────────────────────────── */
/** Segregação de bot/crawler por user-agent (mesma régua do gateway). */
function classifyBot(userAgent) {
    const ua = String(userAgent || '');
    if (!ua || ua.length < 20)
        return true;
    return /bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|go-http|okhttp|libwww|httpclient|facebookexternalhit|whatsapp|telegrambot|skytab|claude|gptbot|ccbot|anthropic|perplexity|bytespider|amazonbot|applebot|semrush|ahrefs|mj12|dotbot|petalbot|dataforseo|lighthouse|pagespeed|pingdom|uptimerobot|monitor|synthetic|mention_c/i.test(ua);
}
function arquiteturaUA(userAgent) {
    const s = String(userAgent || '').toLowerCase();
    if (!s || s.length < 20)
        return 'desconhecido';
    if (/bot|crawl|spider|slurp|headless|preview|scan|curl|wget|python|java|okhttp|libwww|httpclient|monitor|synthetic|lighthouse|pagespeed/.test(s))
        return 'bot';
    if (/ipad|tablet/.test(s))
        return 'tablet';
    if (/mobile|android|iphone/.test(s))
        return 'mobile';
    return 'desktop';
}
function slugKeyword(texto) {
    return String(texto || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
}
/** Slot dinâmico: keyword real + arquitetura. Sintético nunca é produzido. */
function slotDinamico(keyword, userAgent) {
    const arch = arquiteturaUA(userAgent);
    const kw = slugKeyword(keyword);
    if (!kw || /^[0-9]+$/.test(kw) || exports.SLOTS_SINTETICOS.includes(kw)) {
        return `sem_keyword_${arch}`;
    }
    return `${kw}_${arch}`;
}
/** Resolve o país pelo IP REAL, com o parâmetro de URL em papel subordinado. */
function resolverCountry(e) {
    const h = e.headers || {};
    const hint = String(e.geoHint || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
    /* 1) DICA DE BORDA: quando quem chama é a nossa Pages Function, o
       x-vercel-ip-country é o IP da Cloudflare (não do leitor) — medido em
       produção: todo mundo saía como US. A dica medida no IP real vence. */
    if (hint && e.geoforce)
        return { country: hint, fonte: 'dica_borda' };
    const doIp = h['x-vercel-ip-country'] || h['cf-ipcountry'] || h['x-country-code'];
    if (doIp && doIp.length >= 2)
        return { country: doIp.toUpperCase().slice(0, 2), fonte: 'ip_real' };
    if (hint)
        return { country: hint, fonte: 'parametro_sem_ip' };
    return { country: 'BR', fonte: 'default_br' };
}
function destinoMoedaEstrangeira(url) {
    if (!url)
        return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (exports.HOSTS_CJ_INTERNACIONAIS.test(host))
            return true;
        return exports.HOSTS_MOEDA_ESTRANGEIRA.test(host);
    }
    catch {
        return false;
    }
}
/**
 * Anexa identificação e parâmetros de rastreio ao link do lojista.
 * `sid` é a tag do destino (grupo/site) — é ela que aparece em utm_content.
 */
function marcarLink(url, sid, country) {
    try {
        const u = new URL(url);
        u.searchParams.set('sid', sid);
        u.searchParams.set('aff_sub', sid);
        u.searchParams.set('aff_sub2', country);
        u.searchParams.set('subid', sid);
        u.searchParams.set('subid1', country);
        if (u.hostname.includes('shopee'))
            u.searchParams.set('sub_id', sid);
        if (u.hostname.includes('ebay'))
            u.searchParams.set('customid', sid);
        return u.toString();
    }
    catch {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}sid=${encodeURIComponent(sid)}&aff_sub=${encodeURIComponent(sid)}`;
    }
}
/* ─────────────────────────── resolvedor principal ───────────────────────── */
const shopee_catalog_1 = require("./shopee-catalog");
/**
 * Resolve a rota final de um clique. PURA em relação à rede: recebe tudo por
 * parâmetro e devolve a decisão — por isso é testável sem subir servidor.
 */
function resolverRota(entrada, campanhaId = '5339193749', pidCj = '101859672') {
    const ua = entrada.headers?.['user-agent'];
    const isBot = classifyBot(ua);
    const arquitetura = arquiteturaUA(ua);
    const slotOrigem = null;
    const { country, fonte } = resolverCountry(entrada);
    try {
        const slot = slotDinamico(entrada.keyword, ua);
        let brand = String(entrada.brand || 'auto').toLowerCase();
        /* ── 1) TRAVA NACIONAL BR ──────────────────────────────────────────── */
        if (country === 'BR' && !isBot) {
            /* Só bloqueia quando a marca resolvida é de moeda estrangeira. 'auto' não
               é bloqueado: ele JÁ resolve para Shopee no bloco BR (nenhuma invenção). */
            const precisaBloquear = exports.MOEDA_ESTRANGEIRA.includes(brand);
            const oferta = entrada.keyword ? (0, shopee_catalog_1.resolveShopeeOffer)({ q: entrada.keyword }) : null;
            if (precisaBloquear) {
                const link = oferta?.u || exports.LINKS.meliLa;
                return {
                    versao: exports.VERSAO, country, brand: oferta ? 'shopee' : 'mercadolivre',
                    decisao: 'br_lock_moeda_estrangeira', isBot, bloqueouMoedaEstrangeira: true,
                    tier1: false, slotDinamico: slot, slotOrigem, arquitetura,
                    link: marcarLink(link, `br_${slot}`, country), failClosed: false,
                    motivo: `ip_real(${fonte}): ${brand} bloqueado para BR humano`,
                };
            }
            const linkBr = oferta?.u || exports.LINKS.shopeeBR;
            return {
                versao: exports.VERSAO, country, brand: oferta ? 'shopee' : brand || 'shopee',
                decisao: 'br_nacional', isBot, bloqueouMoedaEstrangeira: false, tier1: false,
                slotDinamico: slot, slotOrigem, arquitetura,
                link: marcarLink(linkBr, `br_${slot}`, country), failClosed: false,
                motivo: `ip_real(${fonte}): moeda nativa garantida`,
            };
        }
        /* ── 2) SWAP TIER-1 EXCLUSIVO ──────────────────────────────────────── */
        if (exports.TIER1_CORE.includes(country)) {
            if (brand === 'auto' || !brand)
                brand = 'ebay';
            if (brand === 'booking')
                brand = 'booking_uk';
            const link = brand === 'ebay' && !entrada.offerHash
                ? exports.LINKS.ebayEPN.replace(/campid=\d+/, `campid=${campanhaId}`)
                : brand === 'booking_uk'
                    ? exports.LINKS.bookingUK.replace('{PID}', pidCj)
                    : null;
            return {
                versao: exports.VERSAO, country, brand, decisao: 'tier1_swap_exclusivo', isBot,
                bloqueouMoedaEstrangeira: false, tier1: true, slotDinamico: slot, slotOrigem,
                arquitetura, link: link ? marcarLink(link, `t1_${slot}`, country) : null,
                failClosed: false, motivo: `Tier-1 núcleo (${exports.TIER1_CORE.join('/')})`,
            };
        }
        /* ── 3) DEMAIS PAÍSES: rota regional, sem swap indevido ────────────── */
        return {
            versao: exports.VERSAO, country, brand: brand === 'auto' || !brand ? 'aliexpress' : brand,
            decisao: 'regional', isBot, bloqueouMoedaEstrangeira: false, tier1: false,
            slotDinamico: slot, slotOrigem, arquitetura, link: null, failClosed: false,
            motivo: 'fora do núcleo Tier-1: sem desvio internacional',
        };
    }
    catch (e) {
        /* ── 4) FAIL-CLOSED: 0 ms para o visitante, marcador na telemetria ──── */
        return {
            versao: exports.VERSAO, country, brand: 'mercadolivre', decisao: 'sintonizado_em_analise',
            isBot, bloqueouMoedaEstrangeira: false, tier1: false,
            slotDinamico: slotDinamico(entrada.keyword, ua), slotOrigem, arquitetura,
            link: exports.LINKS.meliLa, failClosed: true, motivo: String(e?.message || e).slice(0, 160),
        };
    }
}
/**
 * Plano de injeção de Adsterra/Monetag DEDICADO ao host. Host desconhecido ou
 * tag pendente devolve null — fail-closed: tag de host A nunca serve em host B
 * (mismatch = descarte pelo ads.txt e comissão perdida).
 */
function planoMidia(host, mapa) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    const reg = mapa[h] || {};
    const popunder = reg.pop || null;
    const socialbar = reg.sb || null;
    return {
        host: h, popunder, socialbar,
        binding: `pop=${popunder ? 'bound' : 'none'};sb=${socialbar ? 'bound' : 'none'}`,
        metodo: 'createElement',
    };
}
/** Tag de script para injeção assíncrona em createElement (sem document.write). */
function scriptCreateElement(tag, zona = null) {
    if (!tag)
        return '';
    const z = zona ? `s.setAttribute('data-zone','${zona}');` : '';
    return `(function(){try{var s=document.createElement('script');s.src='${tag}';s.async=true;s.setAttribute('data-cfasync','false');${z}(document.head||document.documentElement).appendChild(s)}catch(e){}})();`;
}
