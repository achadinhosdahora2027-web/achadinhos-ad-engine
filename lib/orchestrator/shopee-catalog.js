"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveShopeeOffer = resolveShopeeOffer;
exports.inventarioCompleto = inventarioCompleto;
/**
 * shopee-catalog.ts — resolução de oferta no inventário Shopee BR (v340.0)
 *
 * FONTE: data/shopee-offer-links.json — 1.141 ofertas REAIS exportadas do painel
 * de afiliados (940 produtos + 200 lojas + 1 categoria), comissão média 11,56% e
 * máxima de 83%. Nada aqui é inventado: se a keyword não casa com nenhuma oferta
 * do inventário, a função devolve null e quem chamou decide o fallback.
 *
 * O casamento é o mesmo do gateway (ver api/ads/go.js): keyword exata → contida →
 * n-grama → conjunto de termos. É essa resolução que permite a TRAVA NACIONAL BR
 * entregar a oferta certa em vez de um link genérico.
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let cache = null;
let cacheEm = 0;
function inventario() {
    const agora = Date.now();
    if (cache && agora - cacheEm < 300000)
        return cache;
    const candidatos = [
        path.join(process.cwd(), 'data/shopee-offer-links.json'),
        path.join(__dirname, '../../data/shopee-offer-links.json'),
        '/var/task/data/shopee-offer-links.json',
    ];
    for (const p of candidatos) {
        try {
            const j = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (j && j.offers && Object.keys(j.offers).length) {
                cache = j.offers;
                cacheEm = agora;
                return cache;
            }
        }
        catch {
            /* tenta o próximo caminho */
        }
    }
    cache = {};
    cacheEm = agora;
    return cache;
}
const norm = (s) => String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
/**
 * Resolve a melhor oferta para a consulta. Ordem: hash direto → keyword exata →
 * keyword contida → n-grama (2–4 termos) → conjunto de termos. Devolve null se
 * nada casar (nunca inventa oferta).
 */
function resolveShopeeOffer(consulta) {
    const inv = inventario();
    const chaves = Object.keys(inv);
    if (!chaves.length)
        return null;
    const hashDireto = String(consulta.offer || consulta.oferta || '').trim();
    if (hashDireto && inv[hashDireto])
        return inv[hashDireto];
    const termo = norm(consulta.q || consulta.kw || consulta.keyword || '');
    if (!termo || termo.length < 3)
        return null;
    let melhor = null;
    let melhorPeso = 0;
    for (const k of chaves) {
        const o = inv[k];
        const ti = norm(o.n || '');
        if (!ti)
            continue;
        let peso = 0;
        const tiCompacto = ti.replace(/ /g, '');
        const termoCompacto = termo.replace(/ /g, '');
        if (ti === termo)
            peso = 4000;
        else if (ti.includes(termo))
            peso = 2000 + termo.length;
        /* forma compacta: 'powerbank' (uma palavra) casa com 'Power Bank' e vice-versa.
           É normalização de escrita, não invenção de oferta. */
        else if (tiCompacto.includes(termoCompacto) && termoCompacto.length >= 6)
            peso = 1500 + termoCompacto.length;
        else {
            const tokens = termo.split(' ').filter((t) => t.length >= 3);
            if (tokens.length >= 2) {
                const casados = tokens.filter((t) => ti.includes(t)).length;
                if (casados >= 2)
                    peso = 1000 * casados + (o.c || 0);
            }
        }
        if (peso > melhorPeso) {
            melhorPeso = peso;
            melhor = o;
        }
    }
    return melhor;
}
/** Inventário completo (para auditoria/contagem — não para roteamento). */
function inventarioCompleto() {
    return inventario();
}
