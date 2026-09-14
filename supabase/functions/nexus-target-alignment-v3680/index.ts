// Nexus v3680.0 — internal exact-zone, metadata-only target alignment adapter.
// No URL return, redirect, click, impression, publication, conversion, residency,
// humanity, buyer-intent, continuous-runtime, latency or fallback claim is made.
const VERSION = "v3680.0";
const SECRET = Deno.env.get("NEXUS_V3680_EDGE_SECRET") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

async function sameSecret(candidate: string, configured: string): Promise<boolean> {
  if (candidate.length < 32 || configured.length < 32) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
  ]);
  const a = new Uint8Array(left), b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

function clean(value: unknown, maximum: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    return json({
      version: VERSION,
      mode: "internal_exact_zone_metadata_only",
      target_rows: 27,
      category_country_policies: 10,
      encrypted_shopee_source_rows: 701,
      affiliate_url_returned: false,
      redirect_performed: false,
      click_recorded: false,
      impression_recorded: false,
      publication_claimed: false,
      sale_or_conversion_claimed: false,
      cdn_country_is_routing_hint_only: true,
      explicit_zone_required: true,
      explicit_category_is_buyer_intent_proof: false,
      is_bot_false_is_humanity_proof: false,
      human_or_residential_proven: false,
      disclosure_own_line_before_link: true,
      placements_modified: false,
      database_topology: "single_master_no_catalog_replication",
      satellite_gateway_supported: true,
      continuous_24x7_proven: false,
      sub_1ms_guaranteed: false,
      fallback_deployed: false,
      sub_50ms_fallback_guaranteed: false,
    });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!await sameSecret(request.headers.get("x-nexus-v3680-secret") ?? "", SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) return json({ error: "payload_too_large" }, 413);
  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 16_384) return json({ error: "payload_too_large" }, 413);
    payload = JSON.parse(raw);
  } catch (_) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "json_invalid", affiliate_url: null }, 422);
  }

  const category = clean(payload.category, 64);
  const explicitZone = clean(payload.explicit_zone, 120);
  const locale = clean(payload.locale, 35) || null;
  if (!category || !explicitZone) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "explicit_category_and_zone_required", affiliate_url: null }, 422);
  }

  // Country values are accepted only from infrastructure headers. They remain
  // hints and are never converted into city, residence, timezone or humanity.
  const cf = clean(request.headers.get("cf-ipcountry"), 8).toUpperCase();
  const vercel = clean(request.headers.get("x-vercel-ip-country"), 8).toUpperCase();
  const trustedHeaders: Record<string, string> = {};
  if (cf) trustedHeaders["CF-IPCountry"] = cf;
  if (vercel) trustedHeaders["x-vercel-ip-country"] = vercel;
  if (!cf && !vercel) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "cdn_country_unavailable", affiliate_url: null }, 422);
  }

  try {
    // Satellites use the existing protected master binding; the catalog is not
    // replicated. The master also has these bindings, with local variables as a
    // fail-safe compatibility path.
    const url = Deno.env.get("NEXUS_MASTER_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("NEXUS_MASTER_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) {
      return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "service_binding_unavailable", affiliate_url: null }, 503);
    }
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/nexus_v3680_resolve_target`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        p_headers: trustedHeaders,
        p_category: category,
        p_explicit_zone: explicitZone,
        p_locale: locale,
      }),
      signal: AbortSignal.timeout(4000),
    });
    const route = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !route) {
      return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "database_resolver_unavailable", affiliate_url: null }, 503);
    }
    // Defense in depth: link-shaped fields are stripped even though the SQL
    // contract never returns them.
    delete route.affiliate_url;
    delete route.click_url;
    delete route.destination_url;
    delete route.tracking_url;
    delete route.final_url;
    return json({
      ...route,
      affiliate_url: null,
      redirect_performed: false,
      click_recorded: false,
      impression_recorded: false,
      publication_claimed: false,
      sale_or_conversion_claimed: false,
      human_or_residential_proven: false,
    }, route.estado === "ok" ? 200 : 422);
  } catch (_) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "edge_or_database_exception", affiliate_url: null }, 503);
  }
});
