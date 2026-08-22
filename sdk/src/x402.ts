import { getAddress, type Address } from "viem";

import { SlateClientError } from "./client.js";
import { defaultToken } from "./env.js";

/**
 * x402 terms for a metered channel on Base.
 *
 * The provider advertises what it charges in the `402`, the consumer reads it
 * and opens a channel on those terms. What is advertised has to match what the
 * escrow can actually honour — the proof binds `payTo` and `asset`, and the
 * escrow only pays whitelisted tokens — so the terms are validated as addresses
 * here rather than trusted as strings.
 */

/** x402 network identifiers. A chain with no facilitator has no name here. */
export const X402_NETWORKS = { 8453: "base", 84532: "base-sepolia" } as const;

export type X402Network = (typeof X402_NETWORKS)[keyof typeof X402_NETWORKS];

/** The x402 name for a chain id. Throws for chains no facilitator settles on. */
export function x402Network(chainId: number): X402Network {
  const network = X402_NETWORKS[chainId as keyof typeof X402_NETWORKS];
  if (!network) {
    throw new SlateClientError(
      `chain ${chainId} has no x402 network (${Object.values(X402_NETWORKS).join(", ")}); ` +
        "run with a mock verifier instead",
    );
  }
  return network;
}

export interface X402Config {
  network: X402Network;
  /** ERC-20 accepted for payment. Must be whitelisted on the escrow. */
  asset: Address;
  /** Where the escrow pays the provider. Bound into every proof. */
  payTo: Address;
  /** Per-unit price in the token's decimal units, e.g. "0.0001". */
  rate: string;
  /** Ceiling advertised in the terms, in the token's base units. */
  maxAmount: bigint;
  /** Path the terms are quoted for. */
  resource?: string;
}

/** The `accepts[0]` entry of a 402 response. */
export interface X402Terms {
  scheme: "exact";
  network: X402Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Address;
  asset: Address;
  /**
   * Extension: the per-unit rate. The provider is the source of truth for its
   * own price, so the consumer takes this as the channel rate rather than
   * proposing one.
   */
  rate: string;
  maxTimeoutSeconds: number;
}

export interface PaymentRequired {
  x402Version: 1;
  accepts: X402Terms[];
  error: string;
}

export function buildTerms(config: X402Config): X402Terms {
  if (config.maxAmount <= 0n) {
    throw new SlateClientError(`maxAmount must be positive, received ${config.maxAmount}`);
  }
  if (!/^\d+(\.\d+)?$/.test(config.rate)) {
    throw new SlateClientError(`rate must be a decimal amount, received "${config.rate}"`);
  }
  return {
    scheme: "exact",
    network: config.network,
    maxAmountRequired: config.maxAmount.toString(),
    resource: config.resource ?? "/agent/open",
    description: "Open a metered channel; escrowed funds pay per call at the advertised rate.",
    mimeType: "application/json",
    payTo: getAddress(config.payTo),
    asset: getAddress(config.asset),
    rate: config.rate,
    maxTimeoutSeconds: 120,
  };
}

export function build402Body(config: X402Config): PaymentRequired {
  return {
    x402Version: 1,
    accepts: [buildTerms(config)],
    error: "x402 payment is required to open a metered channel.",
  };
}

export interface PaymentPayload {
  x402Version: 1;
  scheme: "exact";
  network: X402Network;
  payload: { authorization: string };
}

/** Base64 `X-PAYMENT` header value. */
export function encodePayment(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** Decode an `X-PAYMENT` header, rejecting anything malformed. */
export function decodePayment(header: string): PaymentPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new SlateClientError("X-PAYMENT is not base64-encoded JSON");
  }
  const payload = parsed as Partial<PaymentPayload>;
  if (payload?.scheme !== "exact" || typeof payload.payload?.authorization !== "string") {
    throw new SlateClientError("X-PAYMENT is missing an `exact` scheme authorization");
  }
  return payload as PaymentPayload;
}

/** Pull the payment header out of a request, case-insensitively. */
export function readPaymentHeader(headers: Record<string, unknown>): string | null {
  const key = Object.keys(headers).find((name) => name.toLowerCase() === "x-payment");
  const value = key === undefined ? undefined : headers[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface PaymentVerifier {
  verify(header: string, terms: X402Terms): Promise<boolean>;
}

/** Accepts any well-formed header. For offline runs and local chains. */
export class MockPaymentVerifier implements PaymentVerifier {
  async verify(header: string, terms: X402Terms): Promise<boolean> {
    const payment = decodePayment(header);
    return payment.network === terms.network;
  }
}

/**
 * Defers to an x402 facilitator's `/verify`. Coinbase runs one for Base; the
 * URL is the only thing that changes between it and any other.
 */
export class FacilitatorPaymentVerifier implements PaymentVerifier {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async verify(header: string, terms: X402Terms): Promise<boolean> {
    const response = await this.fetchImpl(`${this.url.replace(/\/$/, "")}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        x402Version: 1,
        paymentPayload: decodePayment(header),
        paymentRequirements: terms,
      }),
    });
    if (!response.ok) {
      throw new SlateClientError(`facilitator ${this.url} answered ${response.status}`);
    }
    const body = (await response.json()) as { isValid?: boolean };
    return body.isValid === true;
  }
}

/** The public facilitator for Base Sepolia. */
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

/**
 * Read the provider's advertised terms from the environment.
 *
 * `payTo` has no safe default: an unset payee would advertise somewhere the
 * escrow will not pay. `asset` falls back to USDC for the chain.
 *
 * Env: `X402_ASSET`, `X402_PAY_TO`, `RATE`, `X402_MAX_AMOUNT`, `X402_NETWORK`.
 */
function requireDefaultToken(chainId: number): Address {
  const token = defaultToken(chainId);
  if (!token) {
    throw new SlateClientError(`X402_ASSET is required on chain ${chainId}: no USDC default`);
  }
  return token;
}

export function x402ConfigFromEnv(chainId: number, env: NodeJS.ProcessEnv = process.env): X402Config {
  const address = (name: string): Address => {
    const raw = env[name];
    if (!raw) throw new SlateClientError(`${name} is required to advertise x402 terms`);
    try {
      return getAddress(raw);
    } catch {
      throw new SlateClientError(`${name} must be a 20-byte address, received "${raw}"`);
    }
  };

  const network = (env.X402_NETWORK as X402Network | undefined) ?? x402Network(chainId);
  if (!Object.values(X402_NETWORKS).includes(network)) {
    throw new SlateClientError(`X402_NETWORK "${network}" is not an x402 network`);
  }

  return {
    network,
    asset: env.X402_ASSET ? address("X402_ASSET") : requireDefaultToken(chainId),
    payTo: address("X402_PAY_TO"),
    rate: env.RATE ?? "0.0001",
    maxAmount: BigInt(env.X402_MAX_AMOUNT ?? "100000000"),
  };
}

/** Whether to trust a facilitator or accept anything. Mock unless told otherwise. */
export function paymentVerifierFromEnv(env: NodeJS.ProcessEnv = process.env): PaymentVerifier {
  if ((env.MOCK_X402 ?? "true") !== "false") return new MockPaymentVerifier();
  return new FacilitatorPaymentVerifier(env.X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL);
}

/**
 * Read a provider's terms by making an unpaid request and reading `accepts[0]`
 * from the `402`. Returns null when the endpoint is not x402-gated.
 */
export async function discoverTerms(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<X402Terms | null> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ probe: true }),
  });
  if (response.status !== 402) return null;
  const body = (await response.json().catch(() => ({}))) as Partial<PaymentRequired>;
  return body.accepts?.[0] ?? null;
}

/**
 * Request, and on a `402` retry once carrying payment. One retry only: a
 * provider that answers 402 twice is refusing this payment, not asking again.
 */
export async function fetchWithPayment(
  url: string,
  options: {
    init?: RequestInit;
    network: X402Network;
    authorization: string;
    fetchImpl?: typeof fetch;
  },
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const first = await fetchImpl(url, options.init);
  if (first.status !== 402) return first;

  const header = encodePayment({
    x402Version: 1,
    scheme: "exact",
    network: options.network,
    payload: { authorization: options.authorization },
  });

  const headers = new Headers(options.init?.headers);
  headers.set("X-PAYMENT", header);
  return fetchImpl(url, { ...options.init, headers });
}
