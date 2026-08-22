import type { Service } from "./service.js";

/** Why a provider refused a metered call. */
export type RejectReason = "unknown-tool" | "ceiling-exceeded" | "tool-error" | string;

/** Fixed parameters of one metered channel. */
export interface ChannelTerms {
  channelId: bigint;
  /** Per-unit rate in token base units. PRIVATE — only the commitment goes on-chain. */
  rate: bigint;
  rateBlind: bigint;
  /** Escrow ceiling in token base units. Public on-chain. */
  escrow: bigint;
  channelSecret: bigint;
  /** 32-byte Baby Jubjub voucher key. */
  consumerPrivateKey: Uint8Array;
}

/** The outcome of one metered call (request → pay → serve). */
export interface CallOutcome<Req, Res> {
  served: boolean;
  request: Req;
  result?: Res;
  reason?: RejectReason;
  cost: bigint;
  cumulativeUnits?: bigint;
  /** cumulativeUnits * rate so far, in token base units. */
  billable?: bigint;
}

export interface CloseResult {
  totalUnits: bigint;
  settlementAmount: bigint;
  escrow: bigint;
}

/** Shared surface for in-process and HTTP-backed metered clients. */
export interface MeteredServiceChannel<Req, Res> {
  readonly channelId: bigint;
  readonly rate: bigint;
  readonly escrow: bigint;
  call(req: Req): Promise<CallOutcome<Req, Res>>;
  close(): Promise<CloseResult>;
}

/**
 * In-process meter: the consumer and provider share one {@link Service}.
 * Units advance only after a successful `handle`, so a failed tool bills nothing.
 */
export class ServiceChannel<Req, Res> implements MeteredServiceChannel<Req, Res> {
  #units = 0n;

  constructor(
    readonly terms: ChannelTerms,
    private readonly service: Service<Req, Res>,
  ) {
    if (terms.rate <= 0n) throw new Error("rate must be positive");
    if (terms.escrow <= 0n) throw new Error("escrow must be positive");
  }

  get channelId(): bigint {
    return this.terms.channelId;
  }

  get rate(): bigint {
    return this.terms.rate;
  }

  get escrow(): bigint {
    return this.terms.escrow;
  }

  get cumulativeUnits(): bigint {
    return this.#units;
  }

  async call(req: Req): Promise<CallOutcome<Req, Res>> {
    let cost: bigint;
    try {
      cost = this.service.price(req);
    } catch (error) {
      return {
        served: false,
        request: req,
        reason: error instanceof Error ? error.message : "unknown-tool",
        cost: 0n,
      };
    }
    if (cost <= 0n) {
      return { served: false, request: req, reason: "unknown-tool", cost: 0n };
    }

    const next = this.#units + cost;
    if (next * this.terms.rate > this.terms.escrow) {
      return {
        served: false,
        request: req,
        reason: "ceiling-exceeded",
        cost,
        cumulativeUnits: this.#units,
        billable: this.#units * this.terms.rate,
      };
    }

    try {
      const result = await this.service.handle(req);
      this.#units = next;
      return {
        served: true,
        request: req,
        result,
        cost,
        cumulativeUnits: this.#units,
        billable: this.#units * this.terms.rate,
      };
    } catch (error) {
      return {
        served: false,
        request: req,
        reason: `tool-error: ${error instanceof Error ? error.message : String(error)}`,
        cost,
        cumulativeUnits: this.#units,
        billable: this.#units * this.terms.rate,
      };
    }
  }

  async close(): Promise<CloseResult> {
    return {
      totalUnits: this.#units,
      settlementAmount: this.#units * this.terms.rate,
      escrow: this.terms.escrow,
    };
  }
}

/**
 * Provider-side unit counter. Preview the next total, then {@link commit}
 * only after the tool actually served.
 */
export class ProviderMeter {
  #units = 0n;

  constructor(
    readonly channelId: bigint,
    readonly rate: bigint,
    readonly escrow: bigint,
  ) {}

  get cumulativeUnits(): bigint {
    return this.#units;
  }

  get billable(): bigint {
    return this.#units * this.rate;
  }

  preview(units: bigint): { accepted: boolean; reason?: RejectReason; next: bigint } {
    if (units <= 0n) return { accepted: false, reason: "underpaid", next: this.#units };
    const next = this.#units + units;
    if (next * this.rate > this.escrow) {
      return { accepted: false, reason: "ceiling-exceeded", next: this.#units };
    }
    return { accepted: true, next };
  }

  commit(units: bigint): void {
    const check = this.preview(units);
    if (!check.accepted) {
      throw new Error(check.reason ?? "meter refused");
    }
    this.#units += units;
  }
}
