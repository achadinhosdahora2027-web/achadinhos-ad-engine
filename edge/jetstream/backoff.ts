/**
 * nexus v5450.0 — Backoff com jitter exponencial para conexões resilientes de borda.
 * Conformidade com RFC 6455 e ciclo de vida Deno Edge Runtime.
 */

export interface BackoffConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitterRatio: number;
}

const DEFAULT_CONFIG: BackoffConfig = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  factor: 2.0,
  jitterRatio: 0.25,
};

export class ExponentialBackoff {
  private attempts = 0;
  private currentDelay: number;
  private readonly config: BackoffConfig;

  constructor(config: Partial<BackoffConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentDelay = this.config.initialDelayMs;
  }

  public nextDelay(): number {
    const jitter = (Math.random() * 2 - 1) * this.config.jitterRatio * this.currentDelay;
    const delayWithJitter = Math.max(0, Math.round(this.currentDelay + jitter));
    this.currentDelay = Math.min(this.currentDelay * this.config.factor, this.config.maxDelayMs);
    this.attempts++;
    return Math.min(delayWithJitter, this.config.maxDelayMs);
  }

  public reset(): void {
    this.attempts = 0;
    this.currentDelay = this.config.initialDelayMs;
  }

  public getAttempts(): number {
    return this.attempts;
  }
}
