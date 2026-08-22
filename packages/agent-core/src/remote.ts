import type { CallOutcome, CloseResult, MeteredServiceChannel } from "./channel.js";
import type { ToolCall, ToolResult } from "./toolbox.js";
import { encodePayment, type X402Network } from "./x402.js";

/** Terms the provider advertised in its 402 Payment Required body. */
export interface ProviderTerms {
  rate: string;
  payTo: string;
  asset: string;
  network: string;
}

export interface RemoteOpenInput {
  providerUrl: string;
  channelId: bigint;
  escrow: bigint;
  /** The authorization the provider's verifier checks. Wrapped in an x402
   *  envelope before it is sent; callers pass the proof, not the header. */
  payment: string;
  consumerPublicKey?: { x: bigint; y: bigint };
}

/**
 * Discover the provider's advertised rate / payTo / asset from a bare
 * `POST /agent/open` (HTTP 402).
 */
export async function discoverProviderTerms(providerUrl: string): Promise<ProviderTerms> {
  const res = await fetch(joinUrl(providerUrl, "/agent/open"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = (await res.json().catch(() => ({}))) as {
    accepts?: Array<{ rate?: string; payTo?: string; asset?: string; network?: string }>;
  };
  const accept = body.accepts?.[0];
  if (res.status !== 402 || accept?.rate === undefined || accept.payTo === undefined || accept.asset === undefined) {
    throw new Error(`provider at ${providerUrl} did not advertise x402 terms`);
  }
  return {
    rate: accept.rate,
    payTo: accept.payTo,
    asset: accept.asset,
    network: accept.network ?? "base-sepolia",
  };
}

/**
 * HTTP client for a remote provider. Same `call` / `close` surface as
 * {@link ServiceChannel}, so the consumer agent is transport-agnostic.
 */
export class RemoteChannel implements MeteredServiceChannel<ToolCall, ToolResult> {
  #units = 0n;

  private constructor(
    readonly providerUrl: string,
    readonly channelId: bigint,
    readonly rate: bigint,
    readonly escrow: bigint,
    readonly advertised: ProviderTerms,
  ) {}

  static async open(input: RemoteOpenInput): Promise<RemoteChannel> {
    const advertised = await discoverProviderTerms(input.providerUrl);
    const res = await fetch(joinUrl(input.providerUrl, "/agent/open"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-PAYMENT": encodePayment({
          x402Version: 1,
          scheme: "exact",
          network: advertised.network as X402Network,
          payload: { authorization: input.payment },
        }),
      },
      body: JSON.stringify({
        channelId: input.channelId.toString(),
        escrow: input.escrow.toString(),
        consumerPublicKey: input.consumerPublicKey
          ? { x: input.consumerPublicKey.x.toString(), y: input.consumerPublicKey.y.toString() }
          : { x: "0", y: "0" },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok !== true) {
      throw new Error(body.error ?? `open failed (${res.status})`);
    }
    return new RemoteChannel(
      input.providerUrl,
      input.channelId,
      parseAdvertisedRate(advertised.rate),
      input.escrow,
      advertised,
    );
  }

  async call(req: ToolCall): Promise<CallOutcome<ToolCall, ToolResult>> {
    const res = await fetch(joinUrl(this.providerUrl, `/channels/${this.channelId}/call`), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: req }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      served?: boolean;
      result?: ToolResult;
      reason?: string;
      cumulativeUnits?: string;
      billable?: string;
    };

    const served = body.served === true;
    const cumulativeUnits = body.cumulativeUnits !== undefined ? BigInt(body.cumulativeUnits) : undefined;
    if (served && cumulativeUnits !== undefined) this.#units = cumulativeUnits;

    const out: CallOutcome<ToolCall, ToolResult> = {
      served,
      request: req,
      cost: served ? 1n : 0n,
    };
    if (body.result !== undefined) out.result = body.result;
    if (body.reason !== undefined) out.reason = body.reason;
    if (cumulativeUnits !== undefined) out.cumulativeUnits = cumulativeUnits;
    if (body.billable !== undefined) out.billable = BigInt(body.billable);
    return out;
  }

  async close(): Promise<CloseResult> {
    const res = await fetch(joinUrl(this.providerUrl, `/channels/${this.channelId}/finalize`), {
      method: "POST",
    });
    const body = (await res.json().catch(() => ({}))) as { finalUnits?: string };
    const totalUnits = body.finalUnits !== undefined ? BigInt(body.finalUnits) : this.#units;
    return {
      totalUnits,
      settlementAmount: totalUnits * this.rate,
      escrow: this.escrow,
    };
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}${path}`;
}

function parseAdvertisedRate(value: string): bigint {
  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const fractional = (parts[1] ?? "").padEnd(6, "0").slice(0, 6);
  return BigInt(whole || "0") * 1_000_000n + BigInt(fractional || "0");
}
