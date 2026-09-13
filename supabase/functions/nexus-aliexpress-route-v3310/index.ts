// Nexus v3310.0 — internal AliExpress vault resolver adapter.
//
// This function has no publication, ad-placement, click, or redirect side effect.
// It forwards only recognized CDN country headers to the service-role-only SQL
// resolver. The SQL resolver decrypts the operator-supplied campaign URL.

const VERSION = "v3310.0";
const POLICY_VERSION = "v3200.0";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

Deno.serve(async (request: Request): Promise<Response> => {
  // Supabase's managed proxy host is not treated as caller identity. Access is
  // enforced by platform JWT verification plus the independent internal secret.
  if (request.method === "GET") {
    return json({
      version: VERSION,
      policy_version: POLICY_VERSION,
      mode: "internal_vault_resolver",
      network_id: 5,
      network: "AliExpress Global",
      side_effects: false,
      redirect_performed: false,
      click_recorded: false,
      price_adapted: false,
      tracking_identifiers_appended: false,
      cdn_country_is_human_proof: false,
      sub_1ms_guaranteed: false,
      fallback_anti_404_deployed: false,
      sub_50ms_fallback_guaranteed: false,
    });
  }

  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("NEXUS_V3310_EDGE_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-nexus-v3310-secret") ?? "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  const cfCountry = request.headers.get("cf-ipcountry")?.trim() ?? "";
  const vercelCountry = request.headers.get("x-vercel-ip-country")?.trim() ?? "";
  if (!cfCountry && !vercelCountry) {
    return json({
      version: VERSION,
      estado: "Sintonizado em Análise",
      motivo: "cdn_country_unavailable",
      affiliate_url: null,
      human_or_residential_proven: false,
    }, 422);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({
      version: VERSION,
      estado: "Sintonizado em Análise",
      motivo: "service_binding_unavailable",
      affiliate_url: null,
    }, 503);
  }

  const trustedHeaders: Record<string, string> = {};
  if (cfCountry) trustedHeaders["CF-IPCountry"] = cfCountry;
  if (vercelCountry) trustedHeaders["x-vercel-ip-country"] = vercelCountry;

  try {
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/nexus_v3310_route_aliexpress`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ p_headers: trustedHeaders }),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object") {
      return json({
        version: VERSION,
        estado: "Sintonizado em Análise",
        motivo: "database_resolver_unavailable",
        affiliate_url: null,
        database_http_status: response.status,
      }, 503);
    }
    const route = body as Record<string, unknown>;
    return json(route, route.estado === "ok" ? 200 : 422);
  } catch (_error) {
    return json({
      version: VERSION,
      estado: "Sintonizado em Análise",
      motivo: "database_resolver_exception",
      affiliate_url: null,
    }, 503);
  }
});
