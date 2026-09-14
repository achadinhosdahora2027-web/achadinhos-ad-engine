/**
 * nexus v5450.0 — dispatcher.ts
 * Despachante de borda assíncrono para os nós satélites e banco mestre.
 * Assinatura HMAC-SHA256, telemetria e respeito estrito a timeouts de 4000ms.
 */

export interface DispatchEvent {
  event_id: string;
  platform: string;
  source_url: string;
  text: string;
  keyword: string;
  offer_hash: string;
  language: string;
  country: string | null;
  occurred_at_ms: number;
  is_bot: boolean;
  commerce_intent: boolean;
}

export interface DispatchResult {
  ok: boolean;
  event_id: string;
  status: string;
  dispatched_at: string;
  error?: string;
}

export class EdgeDispatcher {
  private webhookUrl: string;
  private secretKey: string;

  constructor(webhookUrl: string, secretKey: string) {
    this.webhookUrl = webhookUrl;
    this.secretKey = secretKey;
  }

  public async signPayload(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.secretKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      encoder.encode(payload)
    );
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  public async dispatch(event: DispatchEvent): Promise<DispatchResult> {
    if (!this.webhookUrl) {
      return {
        ok: false,
        event_id: event.event_id,
        status: "skipped_no_webhook",
        dispatched_at: new Date().toISOString(),
      };
    }

    try {
      const payloadStr = JSON.stringify(event);
      const signature = await this.signPayload(payloadStr);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Nexus-Signature": signature,
          "X-Nexus-Version": "v5450.0",
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return {
        ok: response.ok,
        event_id: event.event_id,
        status: response.ok ? "delivered" : `http_${response.status}`,
        dispatched_at: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        event_id: event.event_id,
        status: "exception_fail_closed",
        dispatched_at: new Date().toISOString(),
        error: errorMsg,
      };
    }
  }
}
