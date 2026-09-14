// Nexus v3500.0 — internal reactive-core status and route-readiness adapter.
// It does not open permanent sockets, decrypt affiliate URLs, redirect, or place ads.
const VERSION = "v3500.0";
const SECRET = Deno.env.get("NEXUS_V3500_EDGE_SECRET") ?? "";
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
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
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") return json({
    version: VERSION, mode: "internal_reactive_core_status_and_route_readiness",
    logged_outbox: true, commit_time_notify_hint: true, notify_is_durable: false,
    source_table_polling_added: false, bounded_satellite_reach_observed: 13,
    permanent_24x7_claimed: false, continuous_runtime_provisioned: false,
    rfc6455_bounded_sessions_preserved: true, cpu_multithreading_claimed: false,
    cdn_country_is_human_or_city_proof: false, public_redirect_deployed: false,
    kv_fallback_deployed: false, sub_1ms_guaranteed: false,
    sub_50ms_fallback_guaranteed: false, lossless_commission_guaranteed: false,
    placements_modified: false, affiliate_url_returned: false,
    clicks_performed: false, impressions_created: false, sales_claimed: false,
  });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!await sameSecret(request.headers.get("x-nexus-v3500-secret") ?? "", SECRET)) return json({ error: "unauthorized" }, 401);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 32_768) return json({ error: "payload_too_large" }, 413);
  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 32_768) return json({ error: "payload_too_large" }, 413);
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) { return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "json_invalid", affiliate_url: null }, 422); }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "service_binding_unavailable", affiliate_url: null }, 503);
  const mode = String(payload.mode ?? "status");
  const rpc = mode === "route_readiness" ? "nexus_v3500_route_readiness" : mode === "status" ? "nexus_v3500_operator_status" : "";
  if (!rpc) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "mode_invalid", affiliate_url: null }, 422);
  const countryHeaders: Record<string, string> = {};
  const cf = request.headers.get("cf-ipcountry")?.trim().toUpperCase() ?? "";
  const vercel = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase() ?? "";
  if (cf) countryHeaders["CF-IPCountry"] = cf;
  if (vercel) countryHeaders["x-vercel-ip-country"] = vercel;
  const body = mode === "route_readiness" ? {
    p_headers: countryHeaders,
    p_network: typeof payload.network === "string" ? payload.network.slice(0, 32) : "",
    p_locale: typeof payload.locale === "string" ? payload.locale.slice(0, 35) : null,
    p_intent: typeof payload.intent === "string" ? payload.intent.slice(0, 32) : null,
  } : {};
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${rpc}`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !result) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "database_rpc_unavailable", affiliate_url: null }, 503);
    delete result.affiliate_url; delete result.click_url; delete result.tracking_url; delete result.destination_url;
    return json({ ...result, affiliate_url: null, redirect_performed: false, click_recorded: false, impression_recorded: false, sale_claimed: false }, result.estado === "Sintonizado em Análise" ? 422 : 200);
  } catch (_) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "edge_or_database_exception", affiliate_url: null }, 503);
  }
});
