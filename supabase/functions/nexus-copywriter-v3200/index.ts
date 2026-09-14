// Nexus v3200.0 policy / v4310.0 bounded activation — factual copy preview plus
// concurrent multi-provider AI suggestion. Deterministic compose output remains
// canonical. No publication, click, redirect, media injection, persistent
// WebSocket loop, personal endorsement, secret return, or residential proof.
import {
  composeFactualCopy,
  countryFromCdnHeaders,
  VERSAO_COPILOT,
  type CopyRequest,
} from "./copilot-v3200.ts";

const START_SECRET = Deno.env.get("NEXUS_V3200_COPY_SECRET") ?? "";
const AI_PREVIEW_SECRET = Deno.env.get("NEXUS_V3350_AI_PREVIEW_SECRET") ?? "";
const V3755_COPY_SECRET = Deno.env.get("NEXUS_V3755_COPY_SECRET") ?? "";
const V4310_COPY_SECRET = Deno.env.get("NEXUS_V4310_COPY_SECRET") ?? "";
const MATRIX_VERSION = "v4310.0";
const POLICY_VERSION = Deno.env.get("V3350_POLICY_VERSION") ?? "v3200.0";
const ACTIVATION_PROFILE = Deno.env.get("V3350_ACTIVATION_PROFILE") ?? "v3350.0";
const ALLOWED_HOSTS = new Set(
  (Deno.env.get("V3200_ALLOWED_LINK_HOSTS") ??
    "achadinhos-ad-engine.vercel.app,www.aquitemachadinhos.com.br,aquitemachadinhos.com.br,www.solvegrid.com.br,solvegrid.com.br,nexusplataforma.ia.br,www.nexusplataforma.ia.br")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

type PoolRequest = CopyRequest & { ai_pool?: boolean; ai_locale?: string | null };
type Provider = {
  key: "groq" | "openrouter_liquid" | "openrouter_gemma4" | "openrouter_nemotron";
  env: string;
  url: string;
  model: string;
  catalogPriceZeroVerified: boolean;
};

// v4310: Groq remains the preferred accepted result. Only OpenRouter IDs
// observed in the live zero-price catalog are called. Price and availability
// are observations, never billing or uptime guarantees.
const PROVIDERS: Provider[] = [
  { key: "groq", env: "GROQ_API_KEY", url: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-20b", catalogPriceZeroVerified: false },
  { key: "openrouter_liquid", env: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/chat/completions", model: "liquid/lfm-2.5-2.6b:free", catalogPriceZeroVerified: true },
  { key: "openrouter_gemma4", env: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/chat/completions", model: "google/gemma-4-26b-a4b-it:free", catalogPriceZeroVerified: true },
  { key: "openrouter_nemotron", env: "OPENROUTER_API_KEY", url: "https://openrouter.ai/api/v1/chat/completions", model: "nvidia/nemotron-3.5-lightning:free", catalogPriceZeroVerified: true },
];
const REQUESTED_UNAVAILABLE_MODELS = ["meta-llama/llama-3-8b-instruct:free", "google/gemma-2-9b-it:free"] as const;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: RESPONSE_HEADERS });
}

async function sameSecret(provided: string, expected: string): Promise<boolean> {
  if (provided.length < 32 || expected.length < 32) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let difference = aa.length ^ bb.length;
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}

function cleanPromptField(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function expectedAssistanceSentence(locale: string, product: string, keyword: string): string {
  switch (locale.toLowerCase().split("-")[0]) {
    case "pt": return `Para ${product}, confirme as especificações e condições atuais sobre ${keyword}.`;
    case "es": return `Para ${product}, verifica las especificaciones y condiciones actuales sobre ${keyword}.`;
    case "fr": return `Pour ${product}, vérifiez les spécifications et conditions actuelles concernant ${keyword}.`;
    case "it": return `Per ${product}, verifica le specifiche e le condizioni attuali su ${keyword}.`;
    case "de": return `Prüfen Sie für ${product} die aktuellen Spezifikationen und Bedingungen zu ${keyword}.`;
    default: return `For ${product}, verify current specifications and conditions about ${keyword}.`;
  }
}

function normalizedSentence(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function safeSuggestion(value: unknown, expected: string): string | null {
  const raw = String(value ?? "");
  if (/https?:\/\/|[\r\n]/i.test(raw)) return null;
  const text = cleanPromptField(raw, 280);
  const safetyText = text.normalize("NFKD").replace(/\p{M}+/gu, "");
  const forbidden = /[#%$€£]|\d|\b(?:offer|deal|sale|discount|save|buy now|limited|hurry|urgent|guaranteed|affiliate|commission|i bought|i use|my experience|oferta|promocao|desconto|economize|compre agora|limitad[oa]|ultima chance|garantid[oa]|afiliad[oa]|comissao|eu comprei|eu uso|minha experiencia|rebaja|descuento|compra ahora|garantizad[oa]|comision|offre|remise|achetez maintenant|garanti[e]?|affilie|sconto|acquista ora|garantit[oa]|affiliat[oa]|angebot|rabatt|jetzt kaufen|garantiert|partnerlink|ich kaufte|meine erfahrung)\b/i;
  if (text.length < 8 || forbidden.test(safetyText)) return null;
  // No free-form model claim is accepted: the output must remain inside the
  // exact generic verification envelope derived solely from supplied fields.
  if (normalizedSentence(text) !== normalizedSentence(expected)) return null;
  return text;
}

async function aiSuggestion(payload: PoolRequest, country: string | null): Promise<Record<string, unknown>> {
  const locale = cleanPromptField(payload.ai_locale ?? payload.idioma ?? "en", 12) || "en";
  const facts = {
    product: cleanPromptField(payload.produto, 90),
    keyword: cleanPromptField(payload.keyword, 90),
    country: cleanPromptField(payload.country ?? country ?? "unknown", 2).toUpperCase(),
    locale,
  };
  const expected = expectedAssistanceSentence(facts.locale, facts.product, facts.keyword);
  const prompt = [
    "Return exactly the sentence between BEGIN and END, without labels, quotes, or extra text.",
    "Do not add or change any fact, URL, hashtag, price, discount, urgency, endorsement, personal experience, buyer claim, or affiliate claim.",
    `Locale: ${facts.locale}. Country routing hint: ${facts.country}. BEGIN ${expected} END`,
  ].join(" ");
  const calls = PROVIDERS.map(async (provider) => {
    const token = Deno.env.get(provider.env) ?? "";
    if (!token) return { provider, attempt: { provider: provider.key, state: "missing_secret" }, suggestion: null as string | null };
    try {
      const requestHeaders: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "Nexus-v4310-copy-preview/1.0",
      };
      if (provider.url.includes("openrouter.ai")) {
        requestHeaders["HTTP-Referer"] = "https://aquitem-21j.pages.dev";
        requestHeaders["X-Title"] = "Nexus v4310 Bounded Factual Copy";
      }
      const messages = [
        { role: "system", content: "You produce neutral factual preview copy only." },
        { role: "user", content: prompt },
      ];
      const requestBody = provider.key === "groq"
        ? { model: provider.model, messages, temperature: 0, max_completion_tokens: 220, reasoning_effort: "low" }
        : { model: provider.model, messages, temperature: 0, max_tokens: 90 };
      const result = await fetch(provider.url, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) return { provider, attempt: { provider: provider.key, model: provider.model, http: result.status, state: "rejected" }, suggestion: null };
      const body = await result.json().catch(() => null) as Record<string, unknown> | null;
      const choices = body && Array.isArray(body.choices) ? body.choices : [];
      const first = choices[0] as Record<string, unknown> | undefined;
      const message = first && typeof first.message === "object" && first.message ? first.message as Record<string, unknown> : null;
      const suggestion = safeSuggestion(message?.content, expected);
      return suggestion
        ? { provider, attempt: { provider: provider.key, model: provider.model, http: result.status, state: "ok" }, suggestion }
        : { provider, attempt: { provider: provider.key, model: provider.model, http: result.status, state: "unsafe_shape_rejected" }, suggestion: null };
    } catch (_error) {
      return { provider, attempt: { provider: provider.key, model: provider.model, state: "network_or_timeout" }, suggestion: null };
    }
  });
  const settled = await Promise.allSettled(calls);
  const results = settled.map((item, index) => item.status === "fulfilled" ? item.value : {
    provider: PROVIDERS[index], attempt: { provider: PROVIDERS[index].key, model: PROVIDERS[index].model, state: "promise_rejected" }, suggestion: null,
  });
  const attempts = results.map((item) => item.attempt);
  const accepted = results.find((item) => item.provider.key === "groq" && item.suggestion) ??
    results.find((item) => item.suggestion);
  if (accepted?.suggestion) {
    return {
      state: "ok",
      provider: accepted.provider.key,
      model: accepted.provider.model,
      suggestion: accepted.suggestion,
      attempts,
      fanout: "Promise.allSettled",
      groq_result_preferred: true,
      openrouter_catalog_price_zero_models_verified: PROVIDERS.filter((p) => p.catalogPriceZeroVerified).map((p) => p.model),
      requested_unavailable_models: REQUESTED_UNAVAILABLE_MODELS,
      selected_provider_catalog_price_zero_verified: accepted.provider.catalogPriceZeroVerified,
      cost_zero_guaranteed: false,
      availability_guaranteed: false,
      permanent_websocket_runtime: false,
      continuous_24x7_proven: false,
      deterministic_copy_remains_canonical: true,
      publication_claimed: false,
    };
  }
  return {
    state: "Sintonizado em Análise",
    provider: null,
    suggestion: null,
    attempts,
    fanout: "Promise.allSettled",
    groq_result_preferred: true,
    requested_unavailable_models: REQUESTED_UNAVAILABLE_MODELS,
    cost_zero_guaranteed: false,
    availability_guaranteed: false,
    permanent_websocket_runtime: false,
    continuous_24x7_proven: false,
    deterministic_copy_remains_canonical: true,
    publication_claimed: false,
  };
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    return response({
      version: VERSAO_COPILOT,
      matrix_version: MATRIX_VERSION,
      policy_version: POLICY_VERSION,
      activation_profile: ACTIVATION_PROFILE,
      mode: "factual_product_assistance_with_optional_ai_preview",
      ai_pool_priority: PROVIDERS.map((p) => p.key),
      ai_pool_models: PROVIDERS.map((p) => ({ provider: p.key, model: p.model, catalog_price_zero_verified: p.catalogPriceZeroVerified })),
      requested_unavailable_models: REQUESTED_UNAVAILABLE_MODELS,
      ai_pool_fanout: "Promise.allSettled",
      groq_result_preferred: true,
      cost_zero_guaranteed: false,
      availability_guaranteed: false,
      permanent_websocket_runtime: false,
      websocket_reconnect_loop_installed: false,
      ai_pool_key_based: true,
      keyless_service: false,
      deterministic_copy_remains_canonical: true,
      side_effects: false,
      publication_claimed: false,
      human_or_residential_proven: false,
      continuous_24x7_claimed: false,
      instant_failover_guaranteed: false,
    });
  }
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  const suppliedInternalSecret = request.headers.get("x-nexus-v3200-secret") ?? "";
  const authenticated = await sameSecret(suppliedInternalSecret, START_SECRET) ||
    await sameSecret(suppliedInternalSecret, AI_PREVIEW_SECRET) ||
    await sameSecret(suppliedInternalSecret, V3755_COPY_SECRET) ||
    await sameSecret(suppliedInternalSecret, V4310_COPY_SECRET);
  if (!authenticated) return response({ error: "unauthorized" }, 401);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 65_536) return response({ error: "payload_too_large" }, 413);

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65_536) return response({ error: "payload_too_large" }, 413);
    const payload = JSON.parse(raw) as PoolRequest;
    const edgeCountry = countryFromCdnHeaders(request.headers);
    const result = composeFactualCopy({
      ...payload,
      country: payload.country ?? edgeCountry.country,
    }, ALLOWED_HOSTS);
    let pool: Record<string, unknown> = {
      state: "disabled",
      provider: null,
      suggestion: null,
      deterministic_copy_remains_canonical: true,
    };
    if (payload.ai_pool === true) {
      try {
        pool = await aiSuggestion(payload, edgeCountry.country);
      } catch (_error) {
        pool = {
          state: "Sintonizado em Análise",
          provider: null,
          suggestion: null,
          deterministic_copy_remains_canonical: true,
        };
      }
    }
    return response({
      ...result,
      ai_pool: pool,
      matrix_version: MATRIX_VERSION,
      policy_version: POLICY_VERSION,
      activation_profile: ACTIVATION_PROFILE,
      geo_source: payload.country ? "signed_payload" : edgeCountry.source,
      cdn_country_is_routing_hint: true,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_request";
    return response({
      error: reason.slice(0, 120),
      state: "Sintonizado em Análise",
      publication_claimed: false,
    }, 422);
  }
});
