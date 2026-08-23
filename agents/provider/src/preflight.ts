import type { Service } from "@slate-base/agent-core";

type Address = `0x${string}`;
type Hex = `0x${string}`;

export interface PreflightRequest {
  chainId: number;
  from: string;
  to: string;
  data?: string;
  value?: string;
}

export interface PreflightRpcRequest {
  account: Address;
  to: Address;
  data: Hex;
  value: bigint;
  blockTag: "pending";
}

export interface PreflightRpc {
  call(request: PreflightRpcRequest): Promise<unknown>;
  estimateGas(request: PreflightRpcRequest): Promise<bigint>;
}

export type PreflightRpcFactory = (chainId: number) => PreflightRpc;

export type PreflightEvidence = {
  kind: "simulation" | "gas" | "approval" | "transfer" | "balance" | "calldata";
  severity: "info" | "warn" | "error";
  message: string;
};

export type DecodedTransaction =
  | { kind: "approve"; token: Address; owner: Address; spender: Address; amount: string; unlimited: boolean }
  | { kind: "transfer"; token: Address; from: Address; to: Address; amount: string }
  | { kind: "transferFrom"; token: Address; owner: Address; spender: Address; to: Address; amount: string };

export interface PreflightResult {
  simulationStatus: "success" | "revert" | "error";
  gasEstimate?: string;
  verdict: "safe" | "caution" | "block";
  decoded?: DecodedTransaction;
  evidence: PreflightEvidence[];
}

const SUPPORTED_CHAINS = new Set([8453, 84532]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x(?:[0-9a-fA-F]{2})*$/;
const WEI = /^\d+$/;
const MAX_UINT256 = 2n ** 256n - 1n;

function isDeterministicRevert(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  while (current !== null && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      name?: unknown;
      code?: unknown;
      data?: unknown;
      cause?: unknown;
    };
    if (
      candidate.name === "ExecutionRevertedError" ||
      (candidate.code === 3 && typeof candidate.data === "string" && /^0x[0-9a-fA-F]*$/.test(candidate.data))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function addressWord(word: string): Address | undefined {
  if (!/^0{24}[0-9a-fA-F]{40}$/.test(word)) return undefined;
  return `0x${word.slice(-40)}` as Address;
}

function amountWord(word: string): string | undefined {
  if (!/^[0-9a-fA-F]{64}$/.test(word)) return undefined;
  return BigInt(`0x${word}`).toString();
}

function decodeErc20(data: Hex, from: Address, token: Address): DecodedTransaction | undefined {
  const selector = data.slice(2, 10).toLowerCase();
  const words = data.slice(10);

  if (selector === "095ea7b3" && words.length === 128) {
    const spender = addressWord(words.slice(0, 64));
    const amount = amountWord(words.slice(64, 128));
    if (spender && amount) {
      return { kind: "approve", token, owner: from, spender, amount, unlimited: BigInt(amount) === MAX_UINT256 };
    }
  }
  if (selector === "a9059cbb" && words.length === 128) {
    const to = addressWord(words.slice(0, 64));
    const amount = amountWord(words.slice(64, 128));
    if (to && amount) return { kind: "transfer", token, from, to, amount };
  }
  if (selector === "23b872dd" && words.length === 192) {
    const owner = addressWord(words.slice(0, 64));
    const to = addressWord(words.slice(64, 128));
    const amount = amountWord(words.slice(128, 192));
    if (owner && to && amount) return { kind: "transferFrom", token, owner, spender: from, to, amount };
  }
  return undefined;
}

/**
 * Simulates an allowlisted Base transaction without broadcasting it.
 */
export class TransactionPreflightService implements Service<PreflightRequest, PreflightResult> {
  readonly name = "transaction-preflight";

  constructor(private readonly rpcForChain: PreflightRpcFactory) {}

  price(_request: PreflightRequest): bigint {
    return 2n;
  }

  async handle(request: PreflightRequest): Promise<PreflightResult> {
    const { chainId } = request;
    if (!SUPPORTED_CHAINS.has(chainId)) throw new Error(`unsupported chain: ${chainId}`);
    if (!ADDRESS.test(request.from)) throw new Error("invalid from address");
    if (!ADDRESS.test(request.to)) throw new Error("invalid to address");
    const data = request.data ?? "0x";
    if (!HEX.test(data)) throw new Error("invalid calldata");
    const value = request.value ?? "0";
    if (!WEI.test(value)) throw new Error("invalid wei value");

    const rpcRequest: PreflightRpcRequest = {
      account: request.from as Address,
      to: request.to as Address,
      data: data as Hex,
      value: BigInt(value),
      blockTag: "pending",
    };
    const rpc = this.rpcForChain(chainId);
    const decoded = decodeErc20(rpcRequest.data, rpcRequest.account, rpcRequest.to);

    try {
      await rpc.call(rpcRequest);
    } catch (error) {
      if (isDeterministicRevert(error)) {
        return {
          simulationStatus: "revert",
          verdict: "block",
          evidence: [{ kind: "simulation", severity: "error", message: "Simulation reverted." }],
        };
      }
      return {
        simulationStatus: "error",
        verdict: "caution",
        evidence: [{ kind: "simulation", severity: "error", message: "Simulation RPC failed." }],
      };
    }

    const evidence: PreflightEvidence[] = [
      { kind: "simulation", severity: "info", message: "Pending-state simulation succeeded." },
    ];
    let gasEstimate: string | undefined;
    let verdict: PreflightResult["verdict"] = "safe";
    try {
      gasEstimate = (await rpc.estimateGas(rpcRequest)).toString();
      evidence.push({ kind: "gas", severity: "info", message: `Estimated gas: ${gasEstimate}.` });
    } catch {
      verdict = "caution";
      evidence.push({ kind: "gas", severity: "warn", message: "Gas estimation failed." });
    }

    if (decoded?.kind === "approve") {
      evidence.push({
        kind: "approval",
        severity: decoded.unlimited ? "warn" : "info",
        message: decoded.unlimited ? "Unlimited ERC-20 approval detected." : "ERC-20 approval decoded.",
      });
      if (decoded.unlimited) verdict = "caution";
    } else if (decoded?.kind === "transfer" || decoded?.kind === "transferFrom") {
      evidence.push({ kind: "transfer", severity: "info", message: `ERC-20 ${decoded.kind} decoded.` });
    } else if (rpcRequest.data === "0x") {
      evidence.push({ kind: "calldata", severity: "info", message: "No calldata supplied." });
    } else {
      verdict = "caution";
      evidence.push({ kind: "calldata", severity: "warn", message: "Unknown calldata; it was not decoded." });
    }
    evidence.push({
      kind: "simulation",
      severity: "info",
      message: "Safe means non-reverting simulation, not an execution or security guarantee.",
    });

    return {
      simulationStatus: "success",
      ...(gasEstimate === undefined ? {} : { gasEstimate }),
      verdict,
      ...(decoded === undefined ? {} : { decoded }),
      evidence,
    };
  }
}
