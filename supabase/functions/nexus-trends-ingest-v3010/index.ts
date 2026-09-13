// Nexus v3010.0 — bounded Google Trends RSS BR staging worker.
// Public trends are staged on the master; canonical keywords stay read-only.
import { XMLParser } from "npm:fast-xml-parser@5.11.1";

const VERSION = "v3010.0";
const FEED_URL = "https://trends.google.com/trending/rss?geo=BR";
const MAX_ITEMS = 20;
const MASTER_URL = String(Deno.env.get("NEXUS_MASTER_URL") ?? "").replace(/\/$/, "");
const MASTER_KEY = Deno.env.get("NEXUS_MASTER_SERVICE_ROLE_KEY") ?? "";
const START_SECRET = Deno.env.get("NEXUS_V3010_TRENDS_SECRET") ?? "";

interface TrendItem {
  term: string;
  approx_traffic: string | null;
  published_at: string | null;
  link: string | null;
  raw: Record<string, unknown>;
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function text(value: unknown, max: number): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim().slice(0, max);
  }
  return "";
}

function isoDate(value: unknown): string | null {
  const raw = text(value, 120);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseFeed(xml: string): TrendItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rss = parsed.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const rawItems = arrayOf(channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return rawItems.slice(0, MAX_ITEMS).map((raw) => ({
    term: text(raw.title, 200),
    approx_traffic: text(raw.approx_traffic, 40) || null,
    published_at: isoDate(raw.pubDate),
    link: text(raw.link, 500) || null,
    raw,
  })).filter((item) => item.term.length >= 2);
}

async function stage(items: TrendItem[], fetchedAt: string): Promise<Record<string, unknown>> {
  if (!MASTER_URL || !MASTER_KEY) throw new Error("master_rpc_not_configured");
  const response = await fetch(`${MASTER_URL}/rest/v1/rpc/nexus_v3010_stage_trends`, {
    method: "POST",
    headers: {
      apikey: MASTER_KEY,
      Authorization: `Bearer ${MASTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_items: items, p_geo: "BR", p_fetched_at: fetchedAt }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`stage_http_${response.status}:${body.slice(0, 160)}`);
  const parsed = body ? JSON.parse(body) as Record<string, unknown> : {};
  if (parsed.ok !== true) throw new Error(`stage_rejected:${body.slice(0, 160)}`);
  return parsed;
}

Deno.serve(async (request: Request): Promise<Response> => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (request.method === "GET") {
    return new Response(JSON.stringify({
      version: VERSION,
      source: FEED_URL,
      geo: "BR",
      max_items: MAX_ITEMS,
      canonical_keywords_modified: false,
      permanent_runtime_claimed: false,
    }), { headers });
  }
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  }
  if (!START_SECRET || request.headers.get("x-nexus-v3010-secret") !== START_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  }
  if (!MASTER_URL || !MASTER_KEY) {
    return new Response(JSON.stringify({ error: "runtime_not_configured", state: "Sintonizado em Análise" }),
      { status: 503, headers });
  }

  try {
    const fetchedAt = new Date().toISOString();
    const feed = await fetch(FEED_URL, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!feed.ok) throw new Error(`feed_http_${feed.status}`);
    const xml = await feed.text();
    if (xml.length < 100 || xml.length > 1_000_000) throw new Error(`feed_size_${xml.length}`);
    const items = parseFeed(xml);
    if (items.length < 1 || items.length > MAX_ITEMS) throw new Error(`feed_items_${items.length}`);
    const result = await stage(items, fetchedAt);
    console.log(JSON.stringify({ version: VERSION, event: "trends_staged", geo: "BR",
      feed_items: items.length, inserted: result.inserted, duplicates: result.duplicates,
      keyword_matches: result.keyword_matches, canonical_keywords_modified: false }));
    return new Response(JSON.stringify({ ok: true, version: VERSION, feed_items: items.length, result }),
      { status: 201, headers });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 240);
    console.error(JSON.stringify({ version: VERSION, state: "Sintonizado em Análise", message }));
    return new Response(JSON.stringify({ ok: false, state: "Sintonizado em Análise" }),
      { status: 503, headers });
  }
});
