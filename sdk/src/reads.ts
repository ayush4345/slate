import type { Address, PublicClient } from "viem";

import { escrowAbi, registryAbi, verifierAbi } from "./abi.js";
import type { PublicSignals, Settlement } from "./settlement.js";

type Signals13 = readonly [
  bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint, bigint, bigint, bigint, bigint, bigint,
];

function asSignals13(signals: PublicSignals): Signals13 {
  return signals as unknown as Signals13;
}

/**
 * Read-only view of a deployed settlement stack. Every call an agent needs to
 * inspect a channel without sending a transaction.
 */
export interface ReadsConfig {
  publicClient: PublicClient;
  escrow: Address;
  registry: Address;
}

/** The record `SlateAgentRegistry.getChannel` returns. */
export interface Channel {
  rateCommitment: bigint;
  consumerPubkeyX: bigint;
  consumerPubkeyY: bigint;
  depositor: Address;
  provider: Address;
  token: Address;
  open: boolean;
  exists: boolean;
}

/** A depositor's internal escrow balance for `token`, in base units. */
export async function escrowGetBalance(
  config: ReadsConfig,
  depositor: Address,
  token: Address,
): Promise<bigint> {
  return config.publicClient.readContract({
    address: config.escrow,
    abi: escrowAbi,
    functionName: "balanceOf",
    args: [depositor, token],
  });
}

/** Verifier address baked into the escrow at construction. */
export async function escrowGetVerifier(config: ReadsConfig): Promise<Address> {
  return config.publicClient.readContract({
    address: config.escrow,
    abi: escrowAbi,
    functionName: "verifier",
  });
}

/** Registry address baked into the escrow at construction. */
export async function escrowGetRegistry(config: ReadsConfig): Promise<Address> {
  return config.publicClient.readContract({
    address: config.escrow,
    abi: escrowAbi,
    functionName: "registry",
  });
}

/** Registered channel record. Reverts `ChannelNotFound` when missing. */
export async function registryGetChannel(
  config: ReadsConfig,
  channelId: bigint,
): Promise<Channel> {
  return config.publicClient.readContract({
    address: config.registry,
    abi: registryAbi,
    functionName: "getChannel",
    args: [channelId],
  });
}

/** Whether a channel record exists for `channelId`. */
export async function registryHasChannel(
  config: ReadsConfig,
  channelId: bigint,
): Promise<boolean> {
  return config.publicClient.readContract({
    address: config.registry,
    abi: registryAbi,
    functionName: "hasChannel",
    args: [channelId],
  });
}

/**
 * Call the generated Groth16 verifier. Looks the verifier up from the escrow
 * when `verifier` is omitted.
 */
export async function verifierVerify(
  config: ReadsConfig,
  settlement: Settlement,
  verifier?: Address,
): Promise<boolean> {
  const address = verifier ?? (await escrowGetVerifier(config));
  return config.publicClient.readContract({
    address,
    abi: verifierAbi,
    functionName: "verifyProof",
    args: [settlement.proof.a, settlement.proof.b, settlement.proof.c, asSignals13(settlement.publicSignals)],
  });
}
