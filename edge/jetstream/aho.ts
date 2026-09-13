/**
 * nexus v360 — autômato Aho-Corasick em RAM (multi-padrão, tempo linear).
 *
 * Medição: o inventário tem 17.605 keywords lógicas (data/shopee-offer-links.json,
 * counts.keywords_unique). Casamento por regex sobre 17 mil padrões custaria
 * O(padrões × texto); o autômato custa O(texto), que é o que permite decidir no
 * mesmo milissegundo do evento do stream.
 *
 * Sem dependências externas — roda igual em Deno, Node 20+ e no runtime de Edge.
 */

export interface Padrao {
  /** palavra-chave normalizada (minúscula, sem acento) */
  kw: string;
  /** hash da oferta no inventário */
  hash: string;
}

export interface Casamento {
  kw: string;
  hash: string;
  /** índice do caractere final do casamento dentro do texto analisado */
  fim: number;
}

interface No {
  next: Map<string, number>;
  fail: number;
  out: Padrao[];
}

/** Normaliza como o produtor faz: minúsculas e sem diacríticos. */
export function normalizar(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export class AhoCorasick {
  private nos: No[] = [{ next: new Map(), fail: 0, out: [] }];
  readonly tamanho: number;

  constructor(padroes: Padrao[]) {
    // mais longos primeiro: o casamento mais específico vence
    const ordenados = [...padroes].sort((a, b) => b.kw.length - a.kw.length);
    for (const p of ordenados) {
      if (!p.kw) continue;
      let u = 0;
      for (const ch of p.kw) {
        let v = this.nos[u].next.get(ch);
        if (v === undefined) {
          v = this.nos.length;
          this.nos.push({ next: new Map(), fail: 0, out: [] });
          this.nos[u].next.set(ch, v);
        }
        u = v;
      }
      this.nos[u].out.push(p);
    }
    this.tamanho = padroes.length;
    this.construirFalhas();
  }

  private construirFalhas(): void {
    const fila: number[] = [];
    for (const [ch, v] of this.nos[0].next) {
      this.nos[v].fail = 0;
      fila.push(v);
      void ch;
    }
    while (fila.length) {
      const u = fila.shift() as number;
      for (const [ch, v] of this.nos[u].next) {
        let f = this.nos[u].fail;
        while (f !== 0 && !this.nos[f].next.has(ch)) f = this.nos[f].fail;
        const cand = this.nos[f].next.has(ch) ? (this.nos[f].next.get(ch) as number) : 0;
        this.nos[v].fail = cand === v ? 0 : cand;
        this.nos[v].out = this.nos[v].out.concat(this.nos[this.nos[v].fail].out);
        fila.push(v);
      }
    }
  }

  /** Retorna o casamento MAIS LONGO (o mais específico) do texto. */
  buscar(texto: string): Casamento | null {
    const t = normalizar(texto);
    let cur = 0;
    let melhor: Casamento | null = null;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      while (cur !== 0 && !this.nos[cur].next.has(ch)) cur = this.nos[cur].fail;
      if (this.nos[cur].next.has(ch)) cur = this.nos[cur].next.get(ch) as number;
      for (const m of this.nos[cur].out) {
        if (!melhor || m.kw.length > melhor.kw.length) melhor = { kw: m.kw, hash: m.hash, fim: i };
      }
    }
    return melhor;
  }
}
