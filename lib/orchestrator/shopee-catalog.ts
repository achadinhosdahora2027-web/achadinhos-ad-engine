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
import * as fs from 'fs';
import * as path from 'path';

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

interface Inventario {
  generated_at?: string;
  counts?: Record<string, unknown>;
  offers?: Record<string, OfertaShopee>;
}

let cache: Record<string, OfertaShopee> | null = null;
let cacheEm = 0;

function inventario(): Record<string, OfertaShopee> {
  const agora = Date.now();
  if (cache && agora - cacheEm < 300_000) return cache;
  const candidatos = [
    path.join(process.cwd(), 'data/shopee-offer-links.json'),
    path.join(__dirname, '../../data/shopee-offer-links.json'),
    '/var/task/data/shopee-offer-links.json',
  ];
  for (const p of candidatos) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Inventario;
      if (j && j.offers && Object.keys(j.offers).length) {
        cache = j.offers;
        cacheEm = agora;
        return cache;
      }
    } catch {
      /* tenta o próximo caminho */
    }
  }
  cache = {};
  cacheEm = agora;
  return cache;
}

const norm = (s: string): string =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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
export function resolveShopeeOffer(consulta: ConsultaOferta): OfertaShopee | null {
  const inv = inventario();
  const chaves = Object.keys(inv);
  if (!chaves.length) return null;

  const hashDireto = String(consulta.offer || consulta.oferta || '').trim();
  if (hashDireto && inv[hashDireto]) return inv[hashDireto];

  const termo = norm(consulta.q || consulta.kw || consulta.keyword || '');
  if (!termo || termo.length < 3) return null;

  let melhor: OfertaShopee | null = null;
  let melhorPeso = 0;
  for (const k of chaves) {
    const o = inv[k];
    const ti = norm(o.n || '');
    if (!ti) continue;
    let peso = 0;
    const tiCompacto = ti.replace(/ /g, '');
    const termoCompacto = termo.replace(/ /g, '');
    if (ti === termo) peso = 4000;
    else if (ti.includes(termo)) peso = 2000 + termo.length;
    /* forma compacta: 'powerbank' (uma palavra) casa com 'Power Bank' e vice-versa.
       É normalização de escrita, não invenção de oferta. */
    else if (tiCompacto.includes(termoCompacto) && termoCompacto.length >= 6) peso = 1500 + termoCompacto.length;
    else {
      const tokens = termo.split(' ').filter((t) => t.length >= 3);
      if (tokens.length >= 2) {
        const casados = tokens.filter((t) => ti.includes(t)).length;
        if (casados >= 2) peso = 1000 * casados + (o.c || 0);
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
export function inventarioCompleto(): Record<string, OfertaShopee> {
  return inventario();
}
