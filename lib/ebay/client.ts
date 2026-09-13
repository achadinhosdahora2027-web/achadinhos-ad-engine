/**
 * client.ts — Cliente da API do eBay Partner Network (v336.0)
 *
 * DESENHO DE HANDSHAKE (sem loop de polling):
 *   O eBay usa OAuth 2.0 client_credentials. O token dura ~2h, então o cliente
 *   faz UM handshake e reaproveita o token em memória até faltarem 5 minutos para
 *   expirar. Não existe polling de segundo em segundo: cada chamada só refaz o
 *   handshake se o token estiver vencido (ou se o servidor devolver 401).
 *
 * FAIL-CLOSED DE CREDENCIAL (regra do operador):
 *   `credentialsVerified` precisa ser true para qualquer chamada sair daqui.
 *   As credenciais de 13/09/2026 NÃO autenticaram (HTTP 401 invalid_client),
 *   então nascem marcadas como não verificadas e o cliente se recusa a usá-las —
 *   em vez de martelar a API e sujar a telemetria.
 *
 * SEGREDO: este arquivo é versionado e público. Ele NUNCA contém Client ID,
 * Client Secret nem token; tudo entra por parâmetro em runtime.
 */

export const EBAY_ENDPOINTS = {
  production: {
    oauth: 'https://api.ebay.com/identity/v1/oauth2/token',
    marketing: 'https://api.ebay.com/buy/marketing/v1_beta/merchandised_product',
    deepLink: 'https://api.ebay.com/buy/marketing/v1_beta/merchandised_product',
  },
  sandbox: {
    oauth: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
    marketing: 'https://api.sandbox.ebay.com/buy/marketing/v1_beta/merchandised_product',
    deepLink: 'https://api.sandbox.ebay.com/buy/marketing/v1_beta/merchandised_product',
  },
} as const;

export type EbayEnv = keyof typeof EBAY_ENDPOINTS;

export interface EbayCredentials {
  clientId: string;
  clientSecret: string;
  /** Resultado de um handshake real, registrado no cofre (verified_at). */
  credentialsVerified: boolean;
}

export interface EbayCallResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  /** Marcador de telemetria fail-closed usado pelo operador. */
  telemetry?: 'Sintonizado em Análise';
  durationMs: number;
}

interface CachedToken { value: string; expiresAt: number; }

/** Cache de token por processo (a Edge reaproveita entre requisições quentes). */
const tokenCache = new Map<string, CachedToken>();

const b64 = (s: string): string => {
  // Deno e Node expõem btoa; fallback para Buffer em ambientes Node antigos.
  if (typeof btoa === 'function') return btoa(s);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (globalThis as any).Buffer.from(s).toString('base64');
};

export class EbayClient {
  private readonly env: EbayEnv;
  private readonly creds: EbayCredentials;
  private readonly fetchImpl: typeof fetch;

  constructor(creds: EbayCredentials, opts: { env?: EbayEnv; fetchImpl?: typeof fetch } = {}) {
    this.creds = creds;
    this.env = opts.env ?? 'production';
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Fingerprint NÃO reversível, só para separar cache por credencial. */
  private get cacheKey(): string {
    const raw = `${this.env}:${this.creds.clientId}`;
    let h = 0;
    for (let i = 0; i < raw.length; i++) h = (h * 31 + raw.charCodeAt(i)) | 0;
    return `ebay:${h}`;
  }

  hasUsableCredentials(): boolean {
    return Boolean(
      this.creds.credentialsVerified &&
      this.creds.clientId && this.creds.clientId.length >= 10 &&
      this.creds.clientSecret && this.creds.clientSecret.length >= 10,
    );
  }

  /** Handshake OAuth (client_credentials). Reaproveita token válido do cache. */
  async getToken(scopes: string[] = ['https://api.ebay.com/oauth/api_scope']): Promise<EbayCallResult<string>> {
    const t0 = Date.now();
    if (!this.hasUsableCredentials()) {
      return {
        ok: false, status: 0, durationMs: Date.now() - t0,
        error: 'credenciais_nao_verificadas',
        telemetry: 'Sintonizado em Análise',
      };
    }
    const cached = tokenCache.get(this.cacheKey);
    if (cached && cached.expiresAt - Date.now() > 300_000) {
      return { ok: true, status: 200, data: cached.value, durationMs: Date.now() - t0 };
    }

    const endpoint = EBAY_ENDPOINTS[this.env].oauth;
    const body = `grant_type=client_credentials&scope=${encodeURIComponent(scopes.join(' '))}`;
    try {
      const res = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${b64(`${this.creds.clientId}:${this.creds.clientSecret}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      const text = await res.text();
      if (!res.ok) {
        return {
          ok: false, status: res.status, durationMs: Date.now() - t0,
          error: text.slice(0, 300), telemetry: 'Sintonizado em Análise',
        };
      }
      const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
      if (!json.access_token) {
        return { ok: false, status: res.status, durationMs: Date.now() - t0, error: 'token_ausente_na_resposta', telemetry: 'Sintonizado em Análise' };
      }
      tokenCache.set(this.cacheKey, {
        value: json.access_token,
        expiresAt: Date.now() + (json.expires_in ?? 7200) * 1000,
      });
      return { ok: true, status: res.status, data: json.access_token, durationMs: Date.now() - t0 };
    } catch (e) {
      return {
        ok: false, status: 0, durationMs: Date.now() - t0,
        error: String((e as Error).message || e), telemetry: 'Sintonizado em Análise',
      };
    }
  }

  /**
   * Mercadorias mais vendidas de uma categoria (Buy Marketing API).
   * Devolve o erro cru em caso de falha — nunca inventa item.
   */
  async merchandisedProducts(categoryId: string, metric: 'BEST_SELLING' | 'CLICK_COUNT' = 'BEST_SELLING'): Promise<EbayCallResult<unknown>> {
    const t0 = Date.now();
    const token = await this.getToken();
    if (!token.ok || !token.data) {
      return { ok: false, status: token.status, durationMs: Date.now() - t0, error: token.error, telemetry: 'Sintonizado em Análise' };
    }
    const url = `${EBAY_ENDPOINTS[this.env].marketing}?category_id=${encodeURIComponent(categoryId)}&metric_name=${metric}`;
    try {
      const res = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token.data}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          Accept: 'application/json',
        },
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, status: res.status, durationMs: Date.now() - t0, error: text.slice(0, 300), telemetry: 'Sintonizado em Análise' };
      }
      return { ok: true, status: res.status, data: JSON.parse(text), durationMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, status: 0, durationMs: Date.now() - t0, error: String((e as Error).message || e), telemetry: 'Sintonizado em Análise' };
    }
  }
}

/**
 * Monta o link de afiliado do eBay (Custom Deep Link).
 * Não depende da API: é o mesmo envelope usado em produção e verificável a olho nu.
 */
export function ebayDeepLink(
  itemUrl: string,
  opts: { campaignId: string; sid?: string; rover?: boolean },
): string | null {
  if (!/^\d{10}$/.test(opts.campaignId)) return null;
  try {
    const u = new URL(itemUrl);
    u.searchParams.set('mkcid', '1');
    u.searchParams.set('mkevt', '1');
    u.searchParams.set('toolid', '10001');
    u.searchParams.set('mkrid', '711-53200-19255-0');
    u.searchParams.set('siteid', '0');
    u.searchParams.set('campid', opts.campaignId);
    if (opts.sid) u.searchParams.set('customid', String(opts.sid).slice(0, 60));
    if (opts.rover) u.searchParams.set('mpre', 'https://www.ebay.com');
    return u.toString();
  } catch {
    return null;
  }
}
