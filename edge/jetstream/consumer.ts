/**
 * nexus v360.0 — SOVEREIGN MULTI-NETWORK STREAM CORE · consumidor de borda
 * edge/jetstream/consumer.ts
 *
 * Regime: EVENT-DRIVEN. Uma única conexão WebSocket persistente (RFC 6455) com o
 * barramento do Bluesky Jetstream. ZERO polling: não existe setInterval, não
 * existe consulta periódica a API de terceiros. O que existe é reconexão com
 * backoff quando a conexão cai (o que também é evento, não polling).
 *
 * Fluxo de um evento:
 *   frame JSON  →  filtro em RAM (Aho-Corasick, 17.605 keywords medidas)
 *               →  triagem de automação (is_bot) no servidor
 *               →  roteador geográfico (mestre: BR → nacional; Tier-1 → eBay/Booking)
 *               →  composição textual (compose.ts)
 *               →  webhook POST assinado HMAC-SHA256 para o mestre
 *               →  a fila UNLOGGED do mestre + flush de 10 s entregam ao grupo.
 *
 * Fail-closed: qualquer erro de rede/timeout NÃO derruba o processo e NÃO
 * inventa dado — grava telemetria "Sintonizado em Análise" e segue.
 *
 * Type-check: `deno check edge/jetstream/consumer.ts` (ou `npx tsc --noEmit`).
 * NÃO está em produção: o produtor vivo hoje é workers/jetstream-consumer.js
 * (GitHub Actions). Este arquivo é a versão de borda para deploy posterior.
 */

import { AhoCorasick, type Casamento, type Padrao } from "./aho.ts";
import { compor, linkDoShortener } from "./compose.ts";

/* ───────────────────────────── configuração ────────────────────────────── */

const CFG = {
  /** barramento público do Bluesky (WebSocket persistente) */
  jetstream: Deno.env.get("JETSTREAM_URL") ?? "wss://jetstream2.us-east.bsky.network/subscribe",
  /** inventário de keywords/ofertas (mesmo arquivo que o produtor usa) */
  inventario: Deno.env.get("INVENTORY_URL") ?? "https://raw.githubusercontent.com/achadinhosdahora2027-web/achadinhos-ad-engine/main/data/shopee-offer-links.json",
  /** mestre: recebe o webhook assinado */
  webhook: Deno.env.get("NEXUS_WEBHOOK_URL") ?? "",
  /** segredo HMAC-SHA256 do webhook (nunca em texto no repositório) */
  segredo: Deno.env.get("NEXUS_WEBHOOK_SECRET") ?? "",
  /** shortener do clique */
  shortener: Deno.env.get("NEXUS_SHORTENER") ?? "https://achadinhos-ad-engine.vercel.app/api/ads/go",
  /** coleções seguidas do Jetstream (posts e reposts) */
  colecoes: ["app.bsky.feed.post"],
};

/* ─────────────────────────── estado em memória ─────────────────────────── */

interface Estado {
  automato: AhoCorasick | null;
  padroesCarregados: number;
  conectadoEm: number | null;
  eventos: number;
  casamentos: number;
  botsFiltrados: number;
  webhooksOk: number;
  webhooksErro: number;
  ultimoErro: string | null;
}

const estado: Estado = {
  automato: null, padroesCarregados: 0, conectadoEm: null,
  eventos: 0, casamentos: 0, botsFiltrados: 0, webhooksOk: 0, webhooksErro: 0, ultimoErro: null,
};

function sintonizado(job: string, host: string | null, msg: string): void {
  // telemetria local — nunca lança, nunca derruba o stream
  try {
    const linha = JSON.stringify({ v: "v360.0", job, host, msg: String(msg).slice(0, 200), em: new Date().toISOString() });
    console.error("[sintonizado] " + linha);
  } catch { /* silêncio proposital */ }
}

/* ─────────────────────── carga do inventário (uma vez) ─────────────────── */

async function carregarPadroes(): Promise<Padrao[]> {
  const r = await fetch(CFG.inventario, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`inventario http ${r.status}`);
  const inv = await r.json() as { keywords?: Record<string, string> };
  const kws = inv.keywords ?? {};
  const padroes: Padrao[] = Object.entries(kws).map(([kw, hash]) => ({ kw, hash })).filter((p) => !!p.kw);
  if (!padroes.length) throw new Error("inventario sem keywords");
  return padroes;
}

/* ────────────────── triagem de automação (server-side) ─────────────────── */
/**
 * O feed do Jetstream é um fluxo público de TODAS as publicações — ele não traz
 * Accept-Language (isso é cabeçalho de navegador e continua sendo aplicado no
 * shortener, no clique). Aqui a triagem usa o que o feed realmente oferece:
 * idioma declarado no registro, tipo de conta e marcas de automação no handle.
 */
const HANDLE_BOT = /(bot|feed|cron|rss|auto|mirror|bridge|relay|aggregator)\b/i;

export function classificarAutomacao(rec: {
  handle?: string; langs?: string[]; texto?: string; temFacets?: boolean;
}): { is_bot: boolean; motivo: string } {
  const handle = rec.handle ?? "";
  if (HANDLE_BOT.test(handle)) return { is_bot: true, motivo: "handle_de_automacao" };
  if (!rec.langs || rec.langs.length === 0) return { is_bot: true, motivo: "sem_idioma_declarado" };
  const texto = rec.texto ?? "";
  if (!texto.trim()) return { is_bot: true, motivo: "texto_vazio" };
  if (texto.length > 280 * 4) return { is_bot: true, motivo: "texto_fora_de_limite_humano" };
  if (/\b(?:deal|promo)\s*(?:bot|feed)\b/i.test(texto)) return { is_bot: true, motivo: "texto_de_robo" };
  return { is_bot: false, motivo: "residencial_humano" };
}

/* ────────────────────── webhook assinado (HMAC-SHA256) ─────────────────── */

async function assinar(corpo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(CFG.segredo),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function despacharWebhook(evento: Record<string, unknown>): Promise<boolean> {
  if (!CFG.webhook || !CFG.segredo) { sintonizado("v360-webhook", null, "webhook nao configurado"); return false; }
  const corpo = JSON.stringify(evento);
  const assinatura = await assinar(corpo);
  try {
    const r = await fetch(CFG.webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Nexus-Event": String(evento.tipo ?? "stream_match"),
        "X-Nexus-Signature-256": "sha256=" + assinatura,
      },
      body: corpo,
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) { estado.webhooksOk++; return true; }
    estado.webhooksErro++; sintonizado("v360-webhook", null, `http ${r.status}`);
    return false;
  } catch (e) {
    estado.webhooksErro++; sintonizado("v360-webhook", null, String((e as Error)?.message ?? e));
    return false;
  }
}

/* ───────────────────────── tratador de um frame ────────────────────────── */

interface FrameJetstream {
  did?: string;
  time_us?: number;
  kind?: string;
  commit?: {
    rev?: string; operation?: string; collection?: string; rkey?: string;
    record?: { text?: string; langs?: string[]; facets?: unknown[]; $type?: string };
  };
  account?: { handle?: string };
}

export async function tratarFrame(bruto: string, casa: string): Promise<void> {
  estado.eventos++;
  let f: FrameJetstream;
  try { f = JSON.parse(bruto) as FrameJetstream; } catch { return; }
  if (f.kind !== "commit" || f.commit?.operation !== "create") return;
  if (!CFG.colecoes.includes(String(f.commit?.collection ?? ""))) return;

  const rec = f.commit.record ?? {};
  const texto = String(rec.text ?? "");
  if (!texto) return;

  const triagem = classificarAutomacao({
    handle: f.account?.handle ?? f.did ?? "",
    langs: rec.langs, texto, temFacets: Array.isArray(rec.facets),
  });
  if (triagem.is_bot) { estado.botsFiltrados++; return; }

  const auto = estado.automato;
  if (!auto) { sintonizado("v360-stream", null, "automato ausente"); return; }
  const m: Casamento | null = auto.buscar(texto);
  if (!m) return;
  estado.casamentos++;

  const pais = Deno.env.get("PAIS_PADRAO") ?? "BR";
  const evento = {
    tipo: "stream_match",
    casa,
    keyword: m.kw,
    oferta: m.hash,
    produto: (texto.slice(Math.max(0, m.fim - m.kw.length - 40), m.fim + 20) || m.kw).trim(),
    country: pais,
    did: f.did ?? null,
    rkey: f.commit?.rkey ?? null,
    link: linkDoShortener(CFG.shortener, {
      brand: "shopee", site: casa, slot: "jetstream_v330", geo: pais, offer: m.hash, kw: m.kw,
    }),
    texto_post: compor({ produto: m.kw, keyword: m.kw, link: "", idioma: "pt" }),
    em: new Date().toISOString(),
  };
  await despacharWebhook(evento);
}

/* ───────────────────────── conexão persistente ─────────────────────────── */

let backoff = 1000;
const MAX_BACKOFF = 60000;

function urlAssinatura(): string {
  const u = new URL(CFG.jetstream);
  for (const c of CFG.colecoes) u.searchParams.append("wantedCollections", c);
  u.searchParams.set("wantedDids", "");   // vazio = todas as casas do cluster
  return u.toString();
}

export function conectar(casa: string): void {
  const ws = new WebSocket(urlAssinatura());
  ws.onopen = () => {
    estado.conectadoEm = Date.now();
    backoff = 1000;                       // conexão boa → backoff volta ao mínimo
    console.log(`[v360] stream conectado (${casa}) · padroes=${estado.padroesCarregados}`);
  };
  ws.onmessage = (ev) => { void tratarFrame(String(ev.data), casa); };
  ws.onerror = () => { estado.ultimoErro = "erro de websocket"; };
  ws.onclose = () => {
    // RFC 6455: conexão encerrada → reconexão com backoff exponencial (evento,
    // não polling: não há requisição periódica enquanto a conexão está viva).
    const espera = Math.min(backoff, MAX_BACKOFF);
    sintonizado("v360-stream", casa, `desconectado; reconecto em ${espera}ms`);
    setTimeout(() => conectar(casa), espera);
    backoff = Math.min(backoff * 2, MAX_BACKOFF);
  };
}

/* ─────────────────────────────── entrada ───────────────────────────────── */

export async function iniciar(): Promise<void> {
  try {
    const padroes = await carregarPadroes();
    estado.automato = new AhoCorasick(padroes);
    estado.padroesCarregados = padroes.length;
    console.log(`[v360] automato em RAM: ${padroes.length} padroes`);
  } catch (e) {
    sintonizado("v360-stream", null, `falha ao carregar inventario: ${String((e as Error)?.message ?? e)}`);
    // fail-closed: sem mapa de keywords, não sai postando às cegas
    return;
  }
  for (const casa of (Deno.env.get("CASAS") ?? "bsky_cluster").split(",")) {
    conectar(casa.trim());
  }
}

if (import.meta.main) { void iniciar(); }
