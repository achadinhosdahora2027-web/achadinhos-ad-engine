/**
 * Nexus v3200.0 — deterministic factual copy orchestrator.
 *
 * This module composes a preview only. It does not publish, click, inject media,
 * infer a human/residential visitor, or claim an unverified price/discount.
 */
import { compor, type EventoComposicao } from "./compose.ts";
import type { Idioma, OfertaConhecida } from "./humanizer.ts";

export const VERSAO_COPILOT = "v3200.0" as const;
const SUPPORTED_LANGUAGES = new Set<Idioma>(["pt", "en", "fr", "de"]);

export interface CopyRequest {
  event_id: string;
  produto: string;
  keyword: string;
  link: string;
  idioma?: string | null;
  country?: string | null;
  rede?: string | null;
  oferta_verificada?: OfertaConhecida | null;
  seed?: number | null;
}

export interface CopyResult {
  ok: true;
  version: typeof VERSAO_COPILOT;
  text: string;
  disclosure: "#publi" | "#ad";
  publication_claimed: false;
  personal_experience_claimed: false;
  human_or_residential_proven: false;
  timezone_inferred_from_country: false;
}

function clean(value: unknown, max: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalizeLanguage(value: unknown): Idioma | undefined {
  const language = clean(value, 5).toLowerCase().slice(0, 2) as Idioma;
  return SUPPORTED_LANGUAGES.has(language) ? language : undefined;
}

function allowedHttpsLink(raw: unknown, allowedHosts: ReadonlySet<string>): string {
  const value = clean(raw, 2_048);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_link");
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.has(host)) {
    throw new Error("link_not_allowed");
  }
  url.hash = "";
  return url.toString();
}

export function countryFromCdnHeaders(headers: Headers): {
  country: string | null;
  source: "cf-ipcountry" | "x-vercel-ip-country" | "none";
} {
  const cf = clean(headers.get("cf-ipcountry"), 8).toUpperCase();
  const vercel = clean(headers.get("x-vercel-ip-country"), 8).toUpperCase();
  const selected = cf || vercel;
  return {
    country: /^[A-Z]{2}$/.test(selected) && !["XX", "T1"].includes(selected) ? selected : null,
    source: cf ? "cf-ipcountry" : vercel ? "x-vercel-ip-country" : "none",
  };
}

export function composeFactualCopy(
  request: CopyRequest,
  allowedHosts: ReadonlySet<string>,
): CopyResult {
  const eventId = clean(request?.event_id, 200);
  const produto = clean(request?.produto, 90);
  const keyword = clean(request?.keyword, 90);
  const country = clean(request?.country, 2).toUpperCase();
  const idioma = normalizeLanguage(request?.idioma);
  if (eventId.length < 12 || !produto || !keyword) throw new Error("invalid_copy_intent");

  const link = allowedHttpsLink(request?.link, allowedHosts);
  const input: EventoComposicao = {
    produto,
    keyword,
    link,
    idioma,
    country: /^[A-Z]{2}$/.test(country) ? country : undefined,
    rede: clean(request?.rede, 40) || undefined,
    oferta: request?.oferta_verificada ?? null,
    seed: typeof request?.seed === "number" ? request.seed : null,
  };
  const text = compor(input);
  const lines = text.split("\n");
  const linkLine = lines.findIndex((line) => line.includes(link));
  if (linkLine < 1 || !/^(#publi|#ad)$/.test(lines[linkLine - 1].trim())) {
    throw new Error("disclosure_invariant_failed");
  }
  const disclosure = lines[linkLine - 1].trim() as "#publi" | "#ad";
  return {
    ok: true,
    version: VERSAO_COPILOT,
    text,
    disclosure,
    publication_claimed: false,
    personal_experience_claimed: false,
    human_or_residential_proven: false,
    timezone_inferred_from_country: false,
  };
}
