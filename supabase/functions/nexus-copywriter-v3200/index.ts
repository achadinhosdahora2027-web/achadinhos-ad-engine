// Nexus v3200.0 — internal, side-effect-free factual copy preview.
// No publication, click, media injection, personal endorsement, or human proof.
import {
  composeFactualCopy,
  countryFromCdnHeaders,
  VERSAO_COPILOT,
  type CopyRequest,
} from "../../../edge/jetstream/copilot-v3200.ts";

const START_SECRET = Deno.env.get("NEXUS_V3200_COPY_SECRET") ?? "";
const POLICY_VERSION = Deno.env.get("V3300_POLICY_VERSION") ?? "v3200.0";
const ACTIVATION_PROFILE = Deno.env.get("V3300_ACTIVATION_PROFILE") ?? "v3300.0";
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

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    return response({
      version: VERSAO_COPILOT,
      policy_version: POLICY_VERSION,
      activation_profile: ACTIVATION_PROFILE,
      mode: "factual_product_assistance",
      side_effects: false,
      publication_claimed: false,
      human_or_residential_proven: false,
      continuous_24x7_claimed: false,
    });
  }
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);

  if (!await sameSecret(request.headers.get("x-nexus-v3200-secret") ?? "", START_SECRET)) {
    return response({ error: "unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 65_536) {
    return response({ error: "payload_too_large" }, 413);
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 65_536) {
      return response({ error: "payload_too_large" }, 413);
    }
    const payload = JSON.parse(raw) as CopyRequest;
    const edgeCountry = countryFromCdnHeaders(request.headers);
    const result = composeFactualCopy({
      ...payload,
      country: payload.country ?? edgeCountry.country,
    }, ALLOWED_HOSTS);
    return response({
      ...result,
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
