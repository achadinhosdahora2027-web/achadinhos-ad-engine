// Nexus v3380.0 — internal status adapter for the encrypted CJ global backlog.
// It never decrypts or returns a URL and performs no redirect, click, or impression.
const VERSION = "v3380.0";
const SECRET = Deno.env.get("NEXUS_V3380_GLOBAL_EDGE_SECRET") ?? "";
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
  }});
}
async function sameSecret(a: string, b: string): Promise<boolean> {
  if (a.length < 32 || b.length < 32) return false;
  const encoder = new TextEncoder();
  const [aa, bb] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(a)), crypto.subtle.digest("SHA-256", encoder.encode(b))]);
  const x = new Uint8Array(aa), y = new Uint8Array(bb); let difference = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") return json({
    version: VERSION, mode: "internal_encrypted_cj_global_backlog_status",
    encrypted_backlog_only: true, bulk_routes_activated: 0,
    country_target_is_city_serviceability_proof: false,
    cf_country_proves_city_or_humanity: false,
    public_redirect_deployed: false, geo_swap_deployed: false,
    sub_1ms_guaranteed: false, sub_50ms_fallback_guaranteed: false,
    affiliate_url_returned: false, clicks_performed: false,
    impressions_created: false, sales_claimed: false,
  });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!await sameSecret(request.headers.get("x-nexus-v3380-global-secret") ?? "", SECRET)) return json({ error: "unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "service_binding_unavailable", affiliate_url: null }, 503);
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/nexus_v3380_cj_global_status`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: "{}", signal: AbortSignal.timeout(4000),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "database_status_unavailable", affiliate_url: null }, 503);
    delete body.affiliate_url; delete body.click_url; delete body.tracking_url; delete body.destination_url;
    return json({ ...body, affiliate_url: null, redirect_performed: false, click_recorded: false, impression_recorded: false, sale_claimed: false });
  } catch (_) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "edge_or_database_exception", affiliate_url: null }, 503);
  }
});
