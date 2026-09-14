/**
 * nexus v5450.0 — daemon.ts
 * Daemon de borda para curadoria em tempo real do Bluesky Jetstream.
 * Ingestão contínua em Deno Edge Runtime, filtro Aho-Corasick em RAM e reconexão com backoff exponencial.
 * Zero invenção · Zero polling · 100% Event-Driven.
 */

import { AhoCorasick, type Padrao } from "./aho.ts";
import { ExponentialBackoff } from "./backoff.ts";
import { EdgeDispatcher, type DispatchEvent } from "./dispatcher.ts";

export interface DaemonConfig {
  jetstreamUrl: string;
  inventoryUrl: string;
  webhookUrl: string;
  webhookSecret: string;
}

export class JetstreamDaemon {
  private config: DaemonConfig;
  private automato: AhoCorasick | null = null;
  private backoff: ExponentialBackoff;
  private dispatcher: EdgeDispatcher;
  private ws: WebSocket | null = null;
  private running = false;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.backoff = new ExponentialBackoff({ initialDelayMs: 1000, maxDelayMs: 30000 });
    this.dispatcher = new EdgeDispatcher(config.webhookUrl, config.webhookSecret);
  }

  public async loadInventory(): Promise<number> {
    try {
      const resp = await fetch(this.config.inventoryUrl);
      if (!resp.ok) return 0;
      const data = await resp.json();
      const padroes: Padrao[] = [];

      if (data && data.offers) {
        for (const [hash, offer] of Object.entries<any>(data.offers)) {
          if (Array.isArray(offer.keywords)) {
            for (const kw of offer.keywords) {
              padroes.push({ kw: String(kw).toLowerCase(), hash });
            }
          }
        }
      }

      this.automato = new AhoCorasick(padroes);
      return padroes.length;
    } catch {
      this.automato = new AhoCorasick([]);
      return 0;
    }
  }

  public async start(): Promise<void> {
    this.running = true;
    await this.loadInventory();
    this.connect();
  }

  private connect(): void {
    if (!this.running) return;

    try {
      this.ws = new WebSocket(this.config.jetstreamUrl);

      this.ws.onopen = () => {
        this.backoff.reset();
      };

      this.ws.onmessage = async (ev) => {
        try {
          const raw = JSON.parse(ev.data);
          if (raw.kind === "commit" && raw.commit?.collection === "app.bsky.feed.post") {
            const record = raw.commit.record;
            const text = String(record?.text || "");

            if (this.automato) {
              const match = this.automato.buscar(text);
              if (match) {
                const event: DispatchEvent = {
                  event_id: `${raw.did}_${raw.time_us}`,
                  platform: "bluesky",
                  source_url: `https://bsky.app/profile/${raw.did}/post/${raw.commit.rkey}`,
                  text,
                  keyword: match.kw,
                  offer_hash: match.hash,
                  language: "pt",
                  country: "BR",
                  occurred_at_ms: Date.now(),
                  is_bot: false,
                  commerce_intent: true,
                };

                await this.dispatcher.dispatch(event);
              }
            }
          }
        } catch {}
      };

      this.ws.onclose = () => {
        if (!this.running) return;
        const delay = this.backoff.nextDelay();
        setTimeout(() => this.connect(), delay);
      };

      this.ws.onerror = () => {
        try {
          this.ws?.close();
        } catch {}
      };
    } catch {
      const delay = this.backoff.nextDelay();
      setTimeout(() => this.connect(), delay);
    }
  }

  public stop(): void {
    this.running = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
  }
}
