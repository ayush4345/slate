import { randomBytes } from "node:crypto";

import type { Settlement } from "@slate-base/proving-setup";

import { SlateClient } from "./client.js";
import { slateClientFromEnv } from "./env.js";
import { pinChannelTerms, proveSettlement } from "./prove.js";

export type Address = `0x${string}`;

export interface OpenChannelInput {
  channelId: bigint;
  rateCommitment: bigint;
  consumerPublicKey: { x: bigint; y: bigint };
  provider: Address;
  token: Address;
  escrow: bigint;
}

export interface ChainClient {
  openChannel(input: OpenChannelInput): Promise<{ openTx: string }>;
  settle(settlement?: Settlement): Promise<{ settleTx: string }>;
}

export class MockChainClient implements ChainClient {
  async openChannel(): Promise<{ openTx: string }> {
    return { openTx: `mock_open_${randomBytes(4).toString("hex")}` };
  }

  async settle(): Promise<{ settleTx: string }> {
    return { settleTx: `mock_settle_${randomBytes(4).toString("hex")}` };
  }
}

export class RealChainClient implements ChainClient {
  constructor(private readonly client: SlateClient) {}

  async openChannel(input: OpenChannelInput): Promise<{ openTx: string }> {
    const opened = await this.client.openChannel(input);
    const last = opened.transactions.at(-1);
    if (last === undefined) throw new Error("openChannel sent no transactions");
    return { openTx: last };
  }

  async settle(settlement?: Settlement): Promise<{ settleTx: string }> {
    if (settlement === undefined) throw new Error("settlement proof is required");
    return { settleTx: await this.client.settle(settlement) };
  }
}

export interface RealChainSetup {
  chain: RealChainClient;
  depositor: Address;
  provider: Address;
  token: Address;
  label: string;
}

/** `null` when `EVM_PRIVATE_KEY` is unset — callers fall back to {@link MockChainClient}. */
export function realChainFromEnv(env: NodeJS.ProcessEnv = process.env): RealChainSetup | null {
  const setup = slateClientFromEnv(env);
  if (!setup) return null;
  return {
    chain: new RealChainClient(setup.client),
    depositor: setup.depositor,
    provider: setup.provider,
    token: setup.token,
    label: setup.label,
  };
}

export { SlateClient };
