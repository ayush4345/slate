import { createPublicClient, http, type Address } from "viem";

import {
  escrowGetRegistry,
  escrowGetVerifier,
  escrowGetBalance,
  registryGetChannel,
  registryHasChannel,
  type Channel,
} from "@avtar/agent-core";
import { CHAINS_BY_ID, DEFAULT_RPC_URLS, defaultToken } from "@avtar/onchain-setup";
import { baseSepolia } from "viem/chains";

export interface Deployment {
  chainName: string;
  chainId: number;
  /** Block explorer root, for linking transactions. Empty on a local chain. */
  explorer: string;
  escrow: Address;
  registry: Address;
  verifier: Address;
  token: Address;
}

export interface ChannelView {
  /** False when the page is showing a fixture because nothing is deployed. */
  live: boolean;
  channelId: bigint;
  exists: boolean;
  deployment: Deployment;
  channel: Channel | null;
  escrowBalance: bigint;
  /** Why the page is not live, when it is not. */
  note?: string;
}

const DEMO: Omit<ChannelView, "channelId"> = {
  live: false,
  exists: true,
  deployment: {
    chainName: "Base Sepolia",
    chainId: baseSepolia.id,
    explorer: baseSepolia.blockExplorers.default.url,
    escrow: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    registry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    verifier: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    token: defaultToken(baseSepolia.id)!,
  },
  channel: {
    rateCommitment: 0xc0ffeen,
    consumerPubkeyX: 111n,
    consumerPubkeyY: 222n,
    depositor: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    provider: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    token: defaultToken(baseSepolia.id)!,
    open: true,
    exists: true,
  },
  escrowBalance: 10_000_000n,
  note: "Set SLATE_ESCROW_ADDRESS and SLATE_REGISTRY_ADDRESS to read a deployed channel.",
};

/**
 * Read a channel straight from the chain.
 *
 * Reads only, so the page never needs a key. When the deployment addresses are
 * missing the dashboard shows a labelled fixture rather than an empty shell:
 * the layout is the same either way, so what is wired is obvious.
 */
export async function loadChannel(channelId: bigint): Promise<ChannelView> {
  const escrow = process.env.SLATE_ESCROW_ADDRESS as Address | undefined;
  const registry = process.env.SLATE_REGISTRY_ADDRESS as Address | undefined;
  if (!escrow || !registry) return { ...DEMO, channelId };

  const chainId = process.env.BASE_CHAIN_ID ? Number(process.env.BASE_CHAIN_ID) : baseSepolia.id;
  const chain = CHAINS_BY_ID.get(chainId) ?? baseSepolia;
  const rpcUrl =
    process.env.BASE_RPC_URL ?? DEFAULT_RPC_URLS[chain.id] ?? chain.rpcUrls.default.http[0]!;

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const reads = { publicClient, escrow, registry };

  try {
    const exists = await registryHasChannel(reads, channelId);
    const [verifier, registryOnEscrow] = await Promise.all([
      escrowGetVerifier(reads),
      escrowGetRegistry(reads),
    ]);
    const channel = exists ? await registryGetChannel(reads, channelId) : null;
    const token = channel?.token ?? defaultToken(chain.id) ?? escrow;
    // With no channel there is no depositor to ask about, unless one is
    // configured: the escrow keys balances by (depositor, token).
    const fallbackDepositor = process.env.DEPOSITOR_ADDRESS as Address | undefined;
    const escrowBalance = channel
      ? await escrowGetBalance(reads, channel.depositor, channel.token)
      : fallbackDepositor
        ? await escrowGetBalance(reads, fallbackDepositor, token)
        : 0n;

    return {
      live: true,
      channelId,
      exists,
      deployment: {
        chainName: chain.name,
        chainId: chain.id,
        explorer: chain.blockExplorers?.default.url ?? "",
        escrow,
        registry: registryOnEscrow,
        verifier,
        token,
      },
      channel,
      escrowBalance,
    };
  } catch (error) {
    // An unreachable RPC is worth saying out loud. Rendering zeroes as if they
    // were real balances would be worse than showing the fixture.
    return {
      ...DEMO,
      channelId,
      note: `Could not reach ${rpcUrl}: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

/** USDC and most settlement tokens are 6 decimals. */
export function formatUnits6(value: bigint): string {
  const whole = value / 1_000_000n;
  const frac = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${frac}`;
}

/** Channel ids are full field elements, so they are shown abbreviated. */
export function shortId(value: bigint | string): string {
  const text = value.toString();
  return text.length <= 16 ? text : `${text.slice(0, 8)}…${text.slice(-6)}`;
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
