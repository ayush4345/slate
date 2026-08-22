import type { PaymentRequirements } from "./x402.js";
import type { ProviderServerConfig } from "./config.js";

export type VerifyResult =
  | { ok: true; settlementTx: string }
  | { ok: false; reason: string };

export interface PaymentVerifier {
  verifyAndSettle(payment: string, requirements: PaymentRequirements): Promise<VerifyResult>;
}

/** Local/demo verifier. Accepts any non-empty X-PAYMENT proof. */
export class MockPaymentVerifier implements PaymentVerifier {
  async verifyAndSettle(payment: string): Promise<VerifyResult> {
    if (typeof payment !== "string" || payment.trim().length === 0) {
      return { ok: false, reason: "missing-payment" };
    }
    return { ok: true, settlementTx: `mock_settle_${Buffer.from(payment).toString("hex").slice(0, 12)}` };
  }
}

/** Real x402 verification via an external facilitator. */
export class FacilitatorPaymentVerifier implements PaymentVerifier {
  constructor(private readonly facilitatorUrl: string) {}

  async verifyAndSettle(payment: string, requirements: PaymentRequirements): Promise<VerifyResult> {
    const base = this.facilitatorUrl.replace(/\/$/, "");
    const body = JSON.stringify({
      x402Version: 1,
      paymentPayload: payment,
      paymentRequirements: requirements,
    });
    try {
      const verifyRes = await fetch(`${base}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const verify = (await verifyRes.json().catch(() => ({}))) as {
        isValid?: boolean;
        invalidReason?: string;
      };
      if (!verifyRes.ok || verify.isValid !== true) {
        return { ok: false, reason: verify.invalidReason ?? `verify-failed-${verifyRes.status}` };
      }
      const settleRes = await fetch(`${base}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const settle = (await settleRes.json().catch(() => ({}))) as {
        success?: boolean;
        txHash?: string;
        errorReason?: string;
      };
      if (!settleRes.ok || settle.success !== true) {
        return { ok: false, reason: settle.errorReason ?? `settle-failed-${settleRes.status}` };
      }
      return { ok: true, settlementTx: settle.txHash ?? "settled" };
    } catch (error) {
      return { ok: false, reason: `facilitator-unreachable: ${(error as Error).message}` };
    }
  }
}

export function createPaymentVerifier(config: ProviderServerConfig): PaymentVerifier {
  return config.mockX402
    ? new MockPaymentVerifier()
    : new FacilitatorPaymentVerifier(config.facilitatorUrl);
}
