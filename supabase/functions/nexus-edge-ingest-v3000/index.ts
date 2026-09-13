// Nexus v3000.0 — bounded, resumable RFC 6455 ingestion session.
//
// Radical-truth boundary:
// - Supabase Edge workers have a finite lifetime. This function opens a bounded
//   session and uses EdgeRuntime.waitUntil(); it is not a permanent 24x7 process.
// - Promise.allSettled provides asynchronous concurrency, not CPU threads.
// - Social-feed metadata can support a conservative human-likely gate; it cannot
//   prove a residential browser or residential IP.
// - No source-table polling, setInterval, KV, Shadow DOM, or media injection.

import { verifyEvent } from "npm:nostr-tools@2.25.2";
import { AhoCorasick, normalizar, type Padrao } from "../../../edge/jetstream/aho.ts";
import { VERSAO_COMPOSE } from "../../../edge/jetstream/compose.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const VERSION = "v3000.0";
const EXPECTED_KEYWORDS = 17_605;
const MAX_SESSION_MS = Math.min(
  Math.max(Number(Deno.env.get("V3000_SESSION_MS") ?? 330_000), 10_000),
  350_000,
);
const MAX_IN_FLIGHT = 64;
const MAX_EVENTS = 4_000;
const INVENTORY_URL = Deno.env.get("V3000_INVENTORY_URL") ??
  "https://raw.githubusercontent.com/achadinhosdahora2027-web/achadinhos-ad-engine/main/data/shopee-offer-links.json";
const JETSTREAM_URL = Deno.env.get("V3000_JETSTREAM_URL") ??
  "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post";
const NOSTR_RELAYS = (Deno.env.get("V3000_NOSTR_RELAYS") ??
  "wss://nos.lol,wss://relay.damus.io")
  .split(",").map((x) => x.trim()).filter((x) => /^wss:\/\//.test(x)).slice(0, 4);
// On a satellite these must point to the Nexus master, not to the satellite's
// built-in SUPABASE_URL. The local values are only a master-project fallback.
const MASTER_URL = String(Deno.env.get("NEXUS_MASTER_URL") ?? Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
const MASTER_KEY = Deno.env.get("NEXUS_MASTER_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const INGEST_HMAC = Deno.env.get("NEXUS_INGEST_HMAC") ?? "";
const START_SECRET = Deno.env.get("NEXUS_V3000_START_SECRET") ?? "";

interface Inventory {
  keywords?: Record<string, string>;
  offers?: Record<string, unknown>;
}
interface MatchEvent {
  event_id: string;
  platform: "bluesky" | "nostr";
  relay_url: string;
  actor_ref: string;
  source_url: string;
  text: string;
  keyword: string;
  offer_hash: string;
  content_sha256: string;
  human_score: number;
  classification: "human_likely";
  is_bot: false;
  commerce_intent: true;
  language: "pt" | "en" | "fr" | "de";
  country: null;
  occurred_at_ms: number;
  signature?: string;
}
interface SessionStats {
  started_at: string;
  ended_at?: string;
  patterns: number;
  frames: number;
  matched: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  rpc_errors: number;
  triggers_queued: number;
  reconnects: number;
  sockets: Record<string, string>;
  last_error: string | null;
}

const COMMERCE = /\b(buy|buying|purchase|price|prices|deal|discount|coupon|shop|shopping|order|recommend|looking for|compare|worth buying|in stock|comprar|comprei|preço|precos|preços|oferta|promoção|promocao|cupom|desconto|procurando|recomendam|vale a pena|acheter|prix|promo|réduction|kaufen|preis|angebot|rabatt)\b/i;
const BOT = /(?:^|[._-])(bot|feed|cron|rss|auto|mirror|bridge|relay|aggregator)(?:$|[._-])/i;
const UNSAFE = /(date[ -]?rape|rape drug|flunitrazepam|rohypnol|fentanyl|methamphetamine|child porn|buy cocaine|comprar coca[ií]na|arma ilegal)/i;
const ALLOWED_LANGS = new Set(["pt", "en", "fr", "de"]);

let cachedAutomaton: AhoCorasick | null = null;
let activeSession: Promise<SessionStats> | null = null;
let lastStats: SessionStats | null = null;

function sintonizado(stats: SessionStats, source: string, error: unknown): void {
  const message = String(error instanceof Error ? error.message : error).slice(0, 240);
  stats.last_error = `${source}: ${message}`;
  console.error(JSON.stringify({ version: VERSION, state: "Sintonizado em Análise", source, message }));
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(INGEST_HMAC),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function signingMaterial(event: MatchEvent): string {
  return [event.event_id,event.platform,event.keyword,event.offer_hash,
    event.content_sha256,event.occurred_at_ms].join("|");
}

function languageOf(values: unknown): MatchEvent["language"] | null {
  const list = Array.isArray(values) ? values : [values];
  for (const raw of list) {
    const code = String(raw ?? "").toLowerCase().slice(0, 2);
    if (ALLOWED_LANGS.has(code)) return code as MatchEvent["language"];
  }
  return null;
}

function likelyHuman(actor: string, text: string, language: MatchEvent["language"] | null): boolean {
  return actor.length >= 8 && !BOT.test(actor) && text.length >= 20 && text.length <= 1_200 &&
    !!language && COMMERCE.test(text) && !UNSAFE.test(text);
}

async function automaton(): Promise<AhoCorasick> {
  if (cachedAutomaton) return cachedAutomaton;
  const response = await fetch(INVENTORY_URL, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`inventory_http_${response.status}`);
  const inventory = await response.json() as Inventory;
  const entries = Object.entries(inventory.keywords ?? {});
  if (entries.length !== EXPECTED_KEYWORDS) {
    throw new Error(`keyword_count_${entries.length}_expected_${EXPECTED_KEYWORDS}`);
  }
  const patterns: Padrao[] = entries.map(([kw, hash]) => ({ kw: normalizar(kw), hash }))
    .filter((x) => x.kw.length >= 3 && x.kw.length <= 160);
  if (patterns.length !== EXPECTED_KEYWORDS) throw new Error("keyword_normalization_drift");
  cachedAutomaton = new AhoCorasick(patterns);
  return cachedAutomaton;
}

async function rpc(name: string, body: Record<string, unknown>, timeoutMs = 1_900): Promise<Record<string, unknown>> {
  if (!MASTER_URL || !MASTER_KEY) throw new Error("master_rpc_not_configured");
  const response = await fetch(`${MASTER_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: MASTER_KEY, Authorization: `Bearer ${MASTER_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name}_http_${response.status}:${text.slice(0, 120)}`);
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

async function dispatch(event: MatchEvent, stats: SessionStats): Promise<void> {
  event.signature = await hmac(signingMaterial(event));
  let receipt: Record<string, unknown>;
  try {
    receipt = await rpc("nexus_v1510_ingest_event", { p_event: event });
  } catch (error) {
    stats.rpc_errors++; sintonizado(stats, "ingest", error); return;
  }
  if (receipt.duplicate === true) stats.duplicates++;
  else if (receipt.accepted === true) stats.accepted++;
  else { stats.rejected++; return; }

  const eventHash = await sha256(signingMaterial(event));
  const channels = ["instagram_story", "bluesky_reply", "c2_channel"];
  const settled = await Promise.allSettled(channels.map(async (channel) => {
    const signature = await hmac(`${event.event_id}|${channel}|${eventHash}`);
    return await rpc("nexus_v1510_queue_content_trigger", {
      p_event_id: event.event_id, p_channel: channel, p_signature: signature,
    }, 900);
  }));
  stats.triggers_queued += settled.filter((x) => x.status === "fulfilled" && x.value.ok === true).length;
  for (const result of settled) {
    if (result.status === "rejected") {
      stats.rpc_errors++;
      sintonizado(stats,"queue_content_trigger",result.reason);
    }
  }
}

function toEvent(base: Omit<MatchEvent,"content_sha256"|"signature">): Promise<MatchEvent> {
  return sha256(base.text).then((content_sha256) => ({ ...base, content_sha256 }));
}

async function handleJetstream(raw: string, ac: AhoCorasick, stats: SessionStats): Promise<void> {
  let frame: Record<string, unknown>;
  try { frame = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
  const commit = frame.commit as Record<string, unknown> | undefined;
  const record = commit?.record as Record<string, unknown> | undefined;
  if (frame.kind!=="commit" || commit?.operation!=="create" || commit?.collection!=="app.bsky.feed.post") return;
  const text = String(record?.text ?? "").trim();
  const actor = String(frame.did ?? "");
  const language = languageOf(record?.langs);
  if (!likelyHuman(actor,text,language)) { stats.rejected++; return; }
  const match = ac.buscar(text); if (!match) return;
  const rkey = String(commit?.rkey ?? ""); if (!rkey) return;
  stats.matched++;
  await dispatch(await toEvent({
    event_id:`bluesky:${actor}:${rkey}`,platform:"bluesky",relay_url:new URL(JETSTREAM_URL).origin.replace("https:","wss:"),
    actor_ref:actor,source_url:`https://bsky.app/profile/${encodeURIComponent(actor)}/post/${encodeURIComponent(rkey)}`,
    text:text.slice(0,1_200),keyword:match.kw,offer_hash:match.hash,human_score:0.84,
    classification:"human_likely",is_bot:false,commerce_intent:true,language:language!,country:null,
    occurred_at_ms:frame.time_us ? Math.floor(Number(frame.time_us)/1_000) : Date.now(),
  }),stats);
}

async function handleNostr(raw: string, relay: string, ac: AhoCorasick, stats: SessionStats): Promise<void> {
  let frame: unknown[]; try { frame=JSON.parse(raw) as unknown[]; } catch { return; }
  if (!Array.isArray(frame) || frame[0]!=="EVENT") return;
  const note=frame[2] as Record<string,unknown> | undefined;
  if (!note || note.kind!==1 || !verifyEvent(note as never)) { stats.rejected++; return; }
  const text=String(note.content ?? "").trim(); const actor=String(note.pubkey ?? "");
  const tags=Array.isArray(note.tags) ? note.tags as unknown[][] : [];
  const langTag=tags.find((t)=>Array.isArray(t)&&t[0]==="l");
  const language=languageOf(langTag?.[1]);
  if (!likelyHuman(actor,text,language)) { stats.rejected++; return; }
  const match=ac.buscar(text); if (!match) return;
  const id=String(note.id ?? ""); if (!id) return;
  stats.matched++;
  await dispatch(await toEvent({
    event_id:`nostr:${id}`,platform:"nostr",relay_url:relay,actor_ref:actor,
    source_url:`https://njump.me/${id}`,text:text.slice(0,1_200),keyword:match.kw,offer_hash:match.hash,
    human_score:0.90,classification:"human_likely",is_bot:false,commerce_intent:true,
    language:language!,country:null,occurred_at_ms:Number(note.created_at)*1_000,
  }),stats);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer=setTimeout(resolve,ms);
    signal.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true});
  });
}

async function socketLoop(
  label: string,url: string,signal: AbortSignal,stats: SessionStats,
  onOpen: (ws: WebSocket)=>void, onMessage: (raw: string)=>Promise<void>,
): Promise<void> {
  let backoff=1_000;
  const relayOrigin=new URL(url).origin.replace(/^http/,"ws");
  while (!signal.aborted && stats.frames<MAX_EVENTS) {
    await new Promise<void>((resolve) => {
      const ws=new WebSocket(url); stats.sockets[label]="connecting";
      const tasks=new Set<Promise<void>>();
      const close=()=>{try{ws.close(1000,"bounded_session_end");}catch{/* closed */}};
      signal.addEventListener("abort",close,{once:true});
      ws.onopen=()=>{
        stats.sockets[label]="open";backoff=1_000;
        console.log(JSON.stringify({version:VERSION,event:"socket_open",label,relay_origin:relayOrigin}));
        try{onOpen(ws);}catch(e){sintonizado(stats,label,e);close();}
      };
      ws.onmessage=(message)=>{
        if (stats.frames>=MAX_EVENTS) { close(); return; }
        if (tasks.size>=MAX_IN_FLIGHT) { stats.rejected++; return; }
        stats.frames++;
        const task=onMessage(String(message.data)).catch((e)=>sintonizado(stats,label,e)).finally(()=>tasks.delete(task));
        tasks.add(task);
      };
      ws.onerror=()=>{stats.sockets[label]="error";};
      ws.onclose=(event)=>{
        signal.removeEventListener("abort",close);stats.sockets[label]="closed";
        console.log(JSON.stringify({version:VERSION,event:"socket_close",label,relay_origin:relayOrigin,
          code:event.code,clean:event.wasClean}));
        void Promise.allSettled(tasks).finally(resolve);
      };
    });
    if (signal.aborted) break;
    stats.reconnects++;
    await delay(backoff+Math.floor(Math.random()*250),signal);
    backoff=Math.min(backoff*2,30_000);
  }
}

async function runSession(): Promise<SessionStats> {
  const stats: SessionStats={started_at:new Date().toISOString(),patterns:0,frames:0,matched:0,accepted:0,
    duplicates:0,rejected:0,rpc_errors:0,triggers_queued:0,reconnects:0,sockets:{},last_error:null};
  console.log(JSON.stringify({version:VERSION,event:"session_start",max_session_ms:MAX_SESSION_MS}));
  try {
    const ac=await automaton(); stats.patterns=ac.tamanho;
    console.log(JSON.stringify({version:VERSION,event:"automaton_loaded",patterns:stats.patterns}));
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort("bounded_session_end"),MAX_SESSION_MS);
    const loops=[socketLoop("jetstream",JETSTREAM_URL,controller.signal,stats,()=>{},(raw)=>handleJetstream(raw,ac,stats))];
    for (const relay of NOSTR_RELAYS) {
      const sub=`v3000-${(await sha256(relay)).slice(0,12)}`;
      loops.push(socketLoop(new URL(relay).hostname,relay,controller.signal,stats,
        (ws)=>ws.send(JSON.stringify(["REQ",sub,{kinds:[1],since:Math.floor(Date.now()/1_000)-30}])),
        (raw)=>handleNostr(raw,relay,ac,stats)));
    }
    await Promise.allSettled(loops); clearTimeout(timer);
  } catch (error) { sintonizado(stats,"session",error); }
  stats.ended_at=new Date().toISOString(); lastStats=stats;
  console.log(JSON.stringify({version:VERSION,event:"session_complete",stats}));
  return stats;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
  if (request.method==="GET") return new Response(JSON.stringify({version:VERSION,compose:VERSAO_COMPOSE,
    runtime:"bounded_resumable_session",max_session_ms:MAX_SESSION_MS,active:!!activeSession,last:lastStats,
    permanent_24x7_claimed:false,residential_human_claimed:false}),{headers});
  if (request.method!=="POST") return new Response(JSON.stringify({error:"method_not_allowed"}),{status:405,headers});
  if (!START_SECRET || request.headers.get("x-nexus-secret")!==START_SECRET) {
    return new Response(JSON.stringify({error:"unauthorized"}),{status:401,headers});
  }
  if (!MASTER_URL || !MASTER_KEY || INGEST_HMAC.length<32) {
    return new Response(JSON.stringify({error:"runtime_not_configured",state:"Sintonizado em Análise"}),{status:503,headers});
  }
  if (!activeSession) activeSession=runSession().finally(()=>{activeSession=null;});
  EdgeRuntime.waitUntil(activeSession);
  return new Response(JSON.stringify({accepted:true,version:VERSION,max_session_ms:MAX_SESSION_MS,
    permanent_24x7_claimed:false}),{status:202,headers});
});
