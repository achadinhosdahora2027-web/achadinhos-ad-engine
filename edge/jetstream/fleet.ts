/**
 * nexus v365.0 — cliente da frota (edge) · publica o evento assinado nos 13 nós.
 *
 * Contrato medido em 13/09/2026:
 *   • endpoint de cada satélite = https://<project_ref>.supabase.co/rest/v1/nexus_satellite_mentions
 *   • o satélite responde 201 quando aceita e 409/23505 quando já tem a mesma source_url
 *     (deduplicação é do próprio satélite — não é falha de rede);
 *   • credencial: service_role key CIFRADA (KMS do cofre). Este módulo NUNCA guarda
 *     chave em texto: recebe-as já resolvidas por uma função de leitura do cofre.
 *   • teto por nó: 3/min e 40/h (mesmo porteiro do Telegram — v360_tg_gate).
 */

export interface NoFrota {
  node: string;
  projectRef: string;
  /** service_role key já resolvida em memória, no instante do envio */
  credencial: string;
  regiao?: string;
}

export interface EventoStream {
  tipo: string;
  keyword: string;
  produto: string;
  casa: string;
  country: string;
  platform?: string;
  link: string;
}

export interface ResultadoNo {
  node: string;
  http: number;
  veredito: "espelhado" | "duplicado" | "falha" | "contido";
  detalhe?: string;
}

/** URL canônica do endpoint de espelhamento (deriva do project_ref). */
export function urlDoNo(no: NoFrota): string {
  return `https://${no.projectRef}.supabase.co/rest/v1/nexus_satellite_mentions`;
}

/** HMAC-SHA256 em hex — mesma assinatura que o mestre emite em X-Nexus-Signature-256. */
export async function assinarHex(corpo: string, segredo: string): Promise<string> {
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpo));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Corpo no formato que os satélites realmente aceitam (colunas medidas). */
export function corpoDoEvento(e: EventoStream): Record<string, string> {
  return {
    source_url: e.link,
    target_keyword: e.keyword,
    platform: e.platform ?? "bluesky",
    author_handle: e.casa,
    mention_text: e.produto.slice(0, 900),
    language: e.country.toUpperCase() === "BR" ? "pt" : "en",
  };
}

class Porteiro {
  private marcas = new Map<string, number[]>();
  constructor(private maxMinuto = 3, private maxHora = 40) {}
  /** true = pode passar; false = contido (não inventa envio) */
  pode(node: string, agora = Date.now()): boolean {
    const hist = (this.marcas.get(node) ?? []).filter((t) => agora - t < 3_600_000);
    const noMinuto = hist.filter((t) => agora - t < 60_000).length;
    this.marcas.set(node, hist);
    if (noMinuto >= this.maxMinuto || hist.length >= this.maxHora) return false;
    hist.push(agora);
    return true;
  }
}

export interface OpcoesFrota {
  segredoHmac: string;
  maxMinuto?: number;
  maxHora?: number;
  timeoutMs?: number;
}

/**
 * Despacha o evento para toda a frota, respeitando o porteiro por nó.
 * Nunca lança: nó que falha entra como "falha" no resultado (fail-closed).
 */
export async function despacharFrota(
  nos: NoFrota[], evento: EventoStream, opt: OpcoesFrota,
): Promise<ResultadoNo[]> {
  const corpo = JSON.stringify(corpoDoEvento(evento));
  const assinatura = await assinarHex(corpo, opt.segredoHmac);
  const porteiro = new Porteiro(opt.maxMinuto ?? 3, opt.maxHora ?? 40);
  const saida: ResultadoNo[] = [];

  for (const no of nos) {
    if (!porteiro.pode(no.node)) { saida.push({ node: no.node, http: 0, veredito: "contido" }); continue; }
    try {
      const r = await fetch(urlDoNo(no), {
        method: "POST",
        headers: {
          apikey: no.credencial,
          Authorization: `Bearer ${no.credencial}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
          "X-Nexus-Event": evento.tipo,
          "X-Nexus-Node": no.node,
          "X-Nexus-Signature-256": `sha256=${assinatura}`,
        },
        body: corpo,
        signal: AbortSignal.timeout(opt.timeoutMs ?? 12000),
      });
      if (r.status === 201 || r.status === 200) { saida.push({ node: no.node, http: r.status, veredito: "espelhado" }); continue; }
      const texto = (await r.text()).slice(0, 200);
      const duplicado = r.status === 409 || texto.includes("23505");
      saida.push({
        node: no.node, http: r.status,
        veredito: duplicado ? "duplicado" : "falha",
        detalhe: texto,
      });
    } catch (e) {
      saida.push({ node: no.node, http: 0, veredito: "falha", detalhe: String((e as Error)?.message ?? e) });
    }
  }
  return saida;
}

/** Resumo para telemetria — nenhuma invenção: conta o que voltou. */
export function resumirFrota(rs: ResultadoNo[]): Record<string, number> {
  const c = { espelhado: 0, duplicado: 0, falha: 0, contido: 0 } as Record<string, number>;
  for (const r of rs) c[r.veredito] += 1;
  c.total = rs.length;
  return c;
}
