// Nexus v3600.0 — internal travel-matrix adapter and bounded local embedding helper.
// No redirect, click, publication, permanent socket, timezone inference or URL return.
declare const Supabase: {
  ai: { Session: new (model: string) => { run: (text: string, options: { mean_pool: boolean; normalize: boolean }) => Promise<Float32Array> } };
};
const VERSION = "v3600.0";
const MODEL = "gte-small";
const DIMS = 384;
const SECRET = Deno.env.get("NEXUS_V3600_EDGE_SECRET") ?? "";
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff",
  }});
}
async function sameSecret(a: string, b: string): Promise<boolean> {
  if (a.length < 32 || b.length < 32) return false;
  const e = new TextEncoder();
  const [aa, bb] = await Promise.all([crypto.subtle.digest("SHA-256", e.encode(a)), crypto.subtle.digest("SHA-256", e.encode(b))]);
  const x = new Uint8Array(aa), y = new Uint8Array(bb); let d = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) d |= x[i] ^ y[i];
  return d === 0;
}
function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
async function embed(text: string): Promise<number[]> {
  const session = new Supabase.ai.Session(MODEL);
  const raw = await session.run(text, { mean_pool: true, normalize: true });
  const vector = Array.from(raw as unknown as Float32Array) as number[];
  if (vector.length !== DIMS || vector.some((v) => !Number.isFinite(v))) throw new Error("embedding_invalid");
  return vector;
}
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") return json({
    version: VERSION, mode: "internal_metadata_only_travel_matrix",
    matrix_destinations: 20, embedding_model: MODEL, embedding_dimensions: DIMS,
    deterministic_copy_policy: "v3200.0", disclosure_own_line_before_link: true,
    placements_modified: false, affiliate_url_returned: false, redirect_performed: false,
    click_recorded: false, publication_claimed: false, timezone_inferred_from_country: false,
    human_or_residential_proven: false, continuous_24x7_claimed: false,
    sub_1ms_guaranteed: false, fallback_deployed: false, sub_50ms_fallback_guaranteed: false,
    traffic_share_scope: "dated_third_party_web_traffic_hint_not_user_distribution",
  });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!await sameSecret(request.headers.get("x-nexus-v3600-secret") ?? "", SECRET)) return json({ error: "unauthorized" }, 401);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 65_536) return json({ error: "payload_too_large" }, 413);
  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65_536) return json({ error: "payload_too_large" }, 413);
    payload = JSON.parse(raw);
  } catch (_) { return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "json_invalid", affiliate_url: null }, 422); }
  const mode = clean(payload.mode, 32);
  try {
    if (mode === "release_embedding_batch") {
      const texts = Array.isArray(payload.texts) ? payload.texts.map((x) => clean(x, 300)) : [];
      if (texts.length < 1 || texts.length > 20 || texts.some((x) => x.length < 10)) return json({ error: "embedding_batch_invalid" }, 422);
      const vectors = await Promise.all(texts.map(embed));
      return json({ version: VERSION, model: MODEL, dimensions: DIMS, vectors, side_effects: false });
    }
    if (mode !== "resolve") return json({ error: "mode_invalid" }, 422);
    const destination = clean(payload.destination, 100);
    const intent = clean(payload.intent_text, 500);
    const locale = clean(payload.locale, 35) || null;
    const network = clean(payload.preferred_network, 32) || null;
    if (destination.length < 2 || intent.length < 3) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "payload_invalid", affiliate_url: null }, 422);
    const cf = clean(request.headers.get("cf-ipcountry"), 8).toUpperCase();
    const vercel = clean(request.headers.get("x-vercel-ip-country"), 8).toUpperCase();
    const trustedHeaders: Record<string, string> = {};
    if (cf) trustedHeaders["CF-IPCountry"] = cf;
    if (vercel) trustedHeaders["x-vercel-ip-country"] = vercel;
    if (!cf && !vercel) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "cdn_country_unavailable", affiliate_url: null }, 422);
    const [vector] = await Promise.all([embed(intent)]);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "service_binding_unavailable", affiliate_url: null }, 503);
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/nexus_v3600_resolve_travel`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ p_headers: trustedHeaders, p_destination: destination, p_intent_text: intent,
        p_intent_embedding: JSON.stringify(vector), p_locale: locale, p_preferred_network: network }),
      signal: AbortSignal.timeout(4000),
    });
    const route = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !route) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "database_resolver_unavailable", affiliate_url: null }, 503);
    delete route.affiliate_url; delete route.click_url; delete route.destination_url; delete route.tracking_url;
    return json({ ...route, affiliate_url: null, redirect_performed: false, click_recorded: false, publication_claimed: false }, route.estado === "ok" ? 200 : 422);
  } catch (_) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "edge_or_database_exception", affiliate_url: null }, 503);
  }
});
