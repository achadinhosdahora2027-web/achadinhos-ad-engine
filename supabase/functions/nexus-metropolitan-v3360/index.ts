// Nexus v3360.0 — internal metropolitan intent/data adapter.
// No public page, redirect, click, impression, or affiliate URL is produced.
const VERSION = "v3360.0";
const SECRET = Deno.env.get("NEXUS_V3360_EDGE_SECRET") ?? "";
const COUNTRIES = ["US", "CN", "HK", "MO", "RU", "UA", "DE", "BR", "GB", "JP", "IN"];
const LOCALES = ["en-US", "es-US", "zh-CN", "zh-HK", "zh-MO", "pt-MO", "ru-RU", "uk-UA", "ru-UA", "de-DE", "pt-BR", "en-GB", "ja-JP", "en-IN"];
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, max-age=0", "x-content-type-options": "nosniff" } });
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
  if (request.method === "GET") return json({ version: VERSION, mode: "internal_metropolitan_intent_data_adapter", source_rows: 853, delta_rows: 816, v3340_overlap_not_duplicated: 37, countries: COUNTRIES, locales: LOCALES, city_pages_published: false, seo_indexing_enabled: false, redirect_endpoint_deployed: false, affiliate_url_returned: false, side_effects: false, clicks_performed: false, impressions_created: false, sales_claimed: false, city_inferred_from_cdn: false, human_or_residential_proven: false });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!await sameSecret(request.headers.get("x-nexus-v3360-secret") ?? "", SECRET)) return json({ error: "unauthorized" }, 401);
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 32_768) return json({ error: "payload_too_large" }, 413);
  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 32_768) return json({ error: "payload_too_large" }, 413);
    payload = JSON.parse(raw);
  } catch (_) { return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "json_invalid", affiliate_url: null }, 422); }
  const destination = typeof payload.destination === "string" ? payload.destination.trim() : "";
  const admin = typeof payload.admin_area === "string" ? payload.admin_area.trim() : null;
  const locale = typeof payload.locale === "string" ? payload.locale.trim() : "";
  const intent = typeof payload.intent_text === "string" ? payload.intent_text.trim() : "";
  if (destination.length < 2 || destination.length > 120 || locale.length < 2 || locale.length > 20 || intent.length < 3 || intent.length > 500 || payload.user_supplied_destination !== true) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "payload_invalid_or_untrusted_context", affiliate_url: null }, 422);
  const cf = request.headers.get("cf-ipcountry")?.trim() ?? "";
  const vercel = request.headers.get("x-vercel-ip-country")?.trim() ?? "";
  if (!cf && !vercel) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "cdn_country_unavailable", affiliate_url: null, city_inferred_from_cdn: false }, 422);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "service_binding_unavailable", affiliate_url: null }, 503);
  const headers: Record<string, string> = {};
  if (cf) headers["CF-IPCountry"] = cf;
  if (vercel) headers["x-vercel-ip-country"] = vercel;
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/nexus_v3360_resolve_city`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ p_headers: headers, p_destination: destination, p_admin_area: admin, p_locale: locale, p_intent_text: intent, p_user_supplied_destination: true }), signal: AbortSignal.timeout(4000) });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !body) return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "database_resolver_unavailable", affiliate_url: null }, 503);
    // Defense in depth: this adapter cannot return a tracking URL even if the
    // database response shape drifts in a future release.
    delete body.affiliate_url; delete body.click_url; delete body.tracking_url;
    return json({ ...body, affiliate_url: null, redirect_performed: false, click_recorded: false }, body.estado === "ok" ? 200 : 422);
  } catch (_) { return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "edge_or_database_exception", affiliate_url: null }, 503); }
});
