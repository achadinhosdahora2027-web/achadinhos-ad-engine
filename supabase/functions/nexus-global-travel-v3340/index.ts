// Nexus v3340.0 — internal multilingual travel-intent data adapter.
// It performs local gte-small inference and calls a service-role-only SQL RPC.
// It never redirects, records clicks, follows affiliate links, or claims humanity.

declare const Supabase: {
  ai: {
    Session: new (model: string) => {
      run: (text: string, options: { mean_pool: boolean; normalize: boolean }) => Promise<Float32Array>;
    };
  };
};

const VERSION = "v3340.0";
const POLICY_VERSION = "v3200.0";
const MODEL = "gte-small";
const DIMS = 384;

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
  if (request.method === "GET") {
    return json({
      version: VERSION,
      policy_version: POLICY_VERSION,
      mode: "internal_multilingual_travel_intent_data_adapter",
      countries: ["US", "CA", "ES", "FR", "IT", "GB"],
      locales: ["en-US", "en-CA", "fr-CA", "es-ES", "fr-FR", "it-IT", "en-GB"],
      lexicon_rows: 92,
      embedding_model: MODEL,
      embedding_dimensions: DIMS,
      cosine_operator: "<=>",
      side_effects: false,
      redirect_performed: false,
      click_recorded: false,
      shortener_modified: false,
      cloudflare_pages_deployed: false,
      high_frequency_throughput_proven: false,
      sub_1ms_guaranteed: false,
      fallback_anti_404_deployed: false,
      sub_50ms_fallback_guaranteed: false,
    });
  }
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const expectedSecret = Deno.env.get("NEXUS_V3340_EDGE_SECRET") ?? "";
  const suppliedSecret = request.headers.get("x-nexus-v3340-secret") ?? "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) return json({ error: "unauthorized" }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "json_invalid" }, 422);
  }
  const destination = typeof payload.destination === "string" ? payload.destination.trim() : "";
  const intentText = typeof payload.intent_text === "string" ? payload.intent_text.trim() : "";
  const locale = typeof payload.locale === "string" ? payload.locale.trim() : null;
  const preferredNetwork = typeof payload.preferred_network === "string"
    ? payload.preferred_network.trim()
    : null;
  if (destination.length < 2 || destination.length > 100 || intentText.length < 3 || intentText.length > 500) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "payload_invalid" }, 422);
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
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "service_binding_unavailable" }, 503);
  }

  try {
    const session = new Supabase.ai.Session(MODEL);
    const raw = await session.run(intentText, { mean_pool: true, normalize: true });
    const vector = Array.from(raw as unknown as Float32Array) as number[];
    if (vector.length !== DIMS || vector.some((x) => !Number.isFinite(x))) {
      return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "embedding_invalid" }, 503);
    }
    const trustedHeaders: Record<string, string> = {};
    if (cfCountry) trustedHeaders["CF-IPCountry"] = cfCountry;
    if (vercelCountry) trustedHeaders["x-vercel-ip-country"] = vercelCountry;

    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/nexus_v3340_resolve_travel`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          p_headers: trustedHeaders,
          p_destination: destination,
          p_intent_text: intentText,
          p_intent_embedding: JSON.stringify(vector),
          p_locale: locale,
          p_preferred_network: preferredNetwork,
        }),
        signal: AbortSignal.timeout(5000),
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object") {
      return json({
        version: VERSION,
        estado: "Sintonizado em Análise",
        motivo: "database_resolver_unavailable",
        database_http_status: response.status,
      }, 503);
    }
    const route = body as Record<string, unknown>;
    return json(route, route.estado === "ok" ? 200 : 422);
  } catch (_error) {
    return json({ version: VERSION, estado: "Sintonizado em Análise", motivo: "edge_or_database_exception" }, 503);
  }
});
