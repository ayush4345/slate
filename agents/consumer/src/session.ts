import { randomBytes } from "node:crypto";
import {
  MockChainClient,
  ServiceChannel,
  type MeteredServiceChannel,
  parseUnits,
  pinChannelTerms,
  proveSettlement,
  realChainFromEnv,
  RemoteChannel,
  type Address,
  type ChainClient,
  type ChannelTerms,
  type ProviderTerms,
  type ToolCall,
  type ToolResult,
  type ToolboxService,
} from "@avtar/agent-core";
import { TOOL_SPECS } from "@avtar/agent-provider";
import { ServiceAgent } from "./agent.js";
import type { AgentBrain, AgentRunResult, ProviderSettlement, TurnPayment } from "./agent.js";
import { StubAgentBrain } from "./stub-agent.js";
import { OpenAiAgentBrain } from "./openai-agent.js";
import type { ConsumerServerConfig } from "./config.js";
import { TOOL_PROVIDERS } from "./providers.js";

function randField(): bigint {
  return BigInt("0x" + randomBytes(31).toString("hex"));
}

type ToolStats = { sessionCalls: number; sessionBillable: bigint };

export interface AgentSessionDependencies {
  channel?: MeteredServiceChannel<ToolCall, ToolResult>;
  brain?: AgentBrain;
  /** In-process provider toolbox — skips HTTP x402 and meters locally. */
  toolbox?: ToolboxService;
}

export interface ChatResult extends AgentRunResult {
  payment: TurnPayment;
}

export interface SettleStep {
  kind: "proof" | "verify" | "transfer" | "done" | "skipped";
  label: string;
  detail?: string;
}

export interface SettleOutcome {
  settled: boolean;
  reason?: string;
  steps: SettleStep[];
  settleTx?: string;
  totalUnits?: string;
  settlementAmount?: string;
  escrow?: string;
  tokenSymbol: string;
}

/**
 * One metered session against a provider.
 *
 * Opens a channel (remote HTTP or in-process toolbox), serves chat turns,
 * and settles once. On Base when `EVM_PRIVATE_KEY` is set; otherwise mock.
 */
export class AgentSession {
  #channel: MeteredServiceChannel<ToolCall, ToolResult> | undefined;
  #chain: ChainClient | undefined;
  #terms: ChannelTerms | undefined;
  #advertised: ProviderTerms | undefined;
  #depositor: Address | undefined;
  #provider: Address | undefined;
  #token: Address | undefined;
  #ready = false;
  #busy = false;
  #sessionBillable = 0n;
  #sessionCalls = 0;
  #byTool = new Map<string, ToolStats>();
  #tokenSymbol: string;

  constructor(
    private readonly config: ConsumerServerConfig,
    private readonly dependencies: AgentSessionDependencies = {},
  ) {
    this.#tokenSymbol = process.env.SETTLEMENT_TOKEN_SYMBOL ?? "USDC";
  }

  get ready(): boolean {
    return this.#ready;
  }

  getProviderTerms(): { rate?: string; address?: string; asset?: string } {
    const out: { rate?: string; address?: string; asset?: string } = {};
    if (this.#advertised?.rate !== undefined) out.rate = this.#advertised.rate;
    if (this.#advertised?.payTo !== undefined) out.address = this.#advertised.payTo;
    if (this.#advertised?.asset !== undefined) out.asset = this.#advertised.asset;
    return out;
  }

  getChannel(): { channelId?: string; depositor?: string; token?: string; escrow?: string } {
    const out: { channelId?: string; depositor?: string; token?: string; escrow?: string } = {};
    if (this.#terms !== undefined) {
      out.channelId = this.#terms.channelId.toString();
      out.escrow = this.#terms.escrow.toString();
    }
    if (this.#depositor !== undefined) out.depositor = this.#depositor;
    if (this.#token !== undefined) out.token = this.#token;
    return out;
  }

  getPaymentSummary(): TurnPayment {
    return {
      turnCalls: 0,
      turnBillable: "0",
      sessionCalls: this.#sessionCalls,
      sessionBillable: this.#sessionBillable.toString(),
      tokenSymbol: this.#tokenSymbol,
      providers: this.#allSessionProviders(),
    };
  }

  async initialize(): Promise<void> {
    if (this.dependencies.channel !== undefined) {
      this.#channel = this.dependencies.channel;
      this.#resetMeter();
      this.#ready = true;
      return;
    }

    this.#resetMeter();

    const escrow = parseUnits(this.config.escrow);
    const real = realChainFromEnv();
    const chain: ChainClient = real?.chain ?? new MockChainClient();

    const channelId = randField();
    const rateBlind = randField();
    const channelSecret = randField();
    const consumerPrivateKey = randomBytes(32);

    let advertised: ProviderTerms;
    let rate: bigint;

    if (this.dependencies.toolbox !== undefined) {
      rate = parseUnits(this.config.rate);
      const payTo =
        (process.env.X402_PAY_TO as Address | undefined) ??
        (process.env.PROVIDER_ADDRESS as Address | undefined) ??
        real?.provider;
      if (payTo === undefined) {
        throw new Error("X402_PAY_TO or PROVIDER_ADDRESS is required for embedded agent mode");
      }
      const asset =
        (process.env.X402_ASSET as Address | undefined) ??
        (process.env.SETTLEMENT_TOKEN as Address | undefined) ??
        real?.token ??
        payTo;
      advertised = {
        rate: this.config.rate,
        payTo,
        asset,
        network: process.env.X402_NETWORK ?? "base-sepolia",
      };
      const terms: ChannelTerms = {
        channelId,
        rate,
        rateBlind,
        escrow,
        channelSecret,
        consumerPrivateKey,
      };
      this.#channel = new ServiceChannel(terms, this.dependencies.toolbox);
      this.#terms = terms;
    } else {
      const callToken = randomBytes(32).toString("base64url");
      advertised = await RemoteChannel.open({
        providerUrl: this.config.providerUrl,
        channelId,
        escrow,
        callToken,
        payment: this.config.paymentSignature,
      }).then((channel) => {
        this.#channel = channel;
        return channel.advertised;
      });
      rate = parseUnits(advertised.rate);
      this.#terms = {
        channelId,
        rate,
        rateBlind,
        escrow,
        channelSecret,
        consumerPrivateKey,
      };
    }

    const terms = this.#terms!;
    const depositor = real?.depositor ?? ("0x0000000000000000000000000000000000000001" as Address);
    const provider = (advertised.payTo as Address | undefined) ?? real?.provider ?? depositor;
    const token = (advertised.asset as Address | undefined) ?? real?.token ?? depositor;

    if (real) {
      const pinned = await pinChannelTerms({
        channelId: terms.channelId,
        channelSecret,
        rate,
        rateBlind,
        escrowAmount: escrow,
        depositor,
        provider,
        token,
        consumerPrivateKey,
      });
      await chain.openChannel({
        channelId: terms.channelId,
        rateCommitment: pinned.rateCommitment,
        consumerPublicKey: pinned.consumerPublicKey,
        provider,
        token,
        escrow,
      });
    } else {
      await chain.openChannel({
        channelId: terms.channelId,
        rateCommitment: randField(),
        consumerPublicKey: { x: randField(), y: randField() },
        provider,
        token,
        escrow,
      });
    }

    this.#chain = chain;
    this.#advertised = advertised;
    this.#depositor = depositor;
    this.#provider = provider;
    this.#token = token;
    this.#ready = true;
  }

  async chat(message: string): Promise<ChatResult> {
    if (!this.#ready || this.#channel === undefined) {
      throw new Error("session not ready");
    }
    if (this.#busy) throw new Error("session busy");

    this.#busy = true;
    try {
      const useOpenAi = Boolean(process.env.OPENAI_API_KEY);
      const brain = this.dependencies.brain ?? (useOpenAi ? new OpenAiAgentBrain() : new StubAgentBrain());
      const result = await new ServiceAgent(this.#channel, brain, TOOL_SPECS).run(message.trim());

      const served = result.calls.filter((c) => c.served);
      const rate = this.#channel.rate;
      const turnStats = new Map<string, ToolStats>();

      for (const call of served) {
        const cost = call.cost ?? 0n;
        const turn = turnStats.get(call.tool) ?? { sessionCalls: 0, sessionBillable: 0n };
        turn.sessionCalls += 1;
        turn.sessionBillable += cost * rate;
        turnStats.set(call.tool, turn);

        const prev = this.#byTool.get(call.tool) ?? { sessionCalls: 0, sessionBillable: 0n };
        prev.sessionCalls += 1;
        prev.sessionBillable += cost * rate;
        this.#byTool.set(call.tool, prev);
      }

      const turnCalls = served.length;
      const turnBillable = [...turnStats.values()].reduce(
        (total, stats) => total + stats.sessionBillable,
        0n,
      );
      this.#sessionBillable += turnBillable;
      this.#sessionCalls += turnCalls;

      return {
        ...result,
        payment: {
          turnCalls,
          turnBillable: turnBillable.toString(),
          sessionCalls: this.#sessionCalls,
          sessionBillable: this.#sessionBillable.toString(),
          tokenSymbol: this.#tokenSymbol,
          providers: this.#buildProviderSettlements(turnStats),
        },
      };
    } finally {
      this.#busy = false;
    }
  }

  async settle(): Promise<SettleOutcome> {
    const tokenSymbol = this.#tokenSymbol;
    if (this.#terms === undefined || this.#chain === undefined || this.#channel === undefined) {
      return {
        settled: false,
        reason: "no active channel to settle",
        steps: [{ kind: "skipped", label: "No active channel", detail: "Open a session first." }],
        tokenSymbol,
      };
    }

    const closed = await this.#channel.close();
    if (closed.totalUnits === 0n) {
      this.#teardown();
      return {
        settled: false,
        reason: "no accepted vouchers — nothing to settle",
        steps: [
          { kind: "skipped", label: "Nothing to settle", detail: "No metered calls were made this session." },
        ],
        tokenSymbol,
      };
    }

    const steps: SettleStep[] = [];
    try {
      const real =
        this.#depositor !== undefined &&
        this.#provider !== undefined &&
        this.#token !== undefined &&
        realChainFromEnv() !== null;

      if (real && this.#depositor && this.#provider && this.#token) {
        const { settlement } = await proveSettlement({
          channelId: this.#terms.channelId,
          channelSecret: this.#terms.channelSecret,
          rate: this.#terms.rate,
          rateBlind: this.#terms.rateBlind,
          totalUnits: closed.totalUnits,
          escrowAmount: this.#terms.escrow,
          depositor: this.#depositor,
          provider: this.#provider,
          token: this.#token,
          consumerPrivateKey: this.#terms.consumerPrivateKey,
        });
        steps.push({
          kind: "proof",
          label: "Groth16 settlement proof generated",
          detail: `${closed.totalUnits} unit(s) · 13-signal circuit input`,
        });
        const settled = await this.#chain.settle(settlement);
        steps.push({
          kind: "verify",
          label: "Proof verified on-chain",
          detail: "pairing check · settlement ≤ escrow · nullifier unspent",
        });
        steps.push({
          kind: "transfer",
          label: "Split transfer executed",
          detail: "settlement → provider, remaining escrow refunded to depositor",
        });
        steps.push({ kind: "done", label: "Settlement complete", detail: settled.settleTx });
        this.#teardown();
        return {
          settled: true,
          steps,
          settleTx: settled.settleTx,
          totalUnits: closed.totalUnits.toString(),
          settlementAmount: closed.settlementAmount.toString(),
          escrow: closed.escrow.toString(),
          tokenSymbol,
        };
      }

      const settled = await this.#chain.settle();
      steps.push({
        kind: "proof",
        label: "Mock settlement (no EVM_PRIVATE_KEY)",
        detail: `${closed.totalUnits} unit(s) metered off-chain`,
      });
      steps.push({ kind: "done", label: "Settlement complete", detail: settled.settleTx });
      this.#teardown();
      return {
        settled: true,
        steps,
        settleTx: settled.settleTx,
        totalUnits: closed.totalUnits.toString(),
        settlementAmount: closed.settlementAmount.toString(),
        escrow: closed.escrow.toString(),
        tokenSymbol,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      steps.push({ kind: "skipped", label: "Settlement failed", detail: reason });
      return { settled: false, reason, steps, tokenSymbol };
    }
  }

  async newSession(): Promise<void> {
    this.#resetMeter();
    if (this.#ready) this.#teardown();
    await this.initialize();
  }

  #resetMeter(): void {
    this.#sessionBillable = 0n;
    this.#sessionCalls = 0;
    this.#byTool.clear();
  }

  #teardown(): void {
    this.#ready = false;
    this.#channel = undefined;
    this.#terms = undefined;
    this.#chain = undefined;
    this.#advertised = undefined;
    this.#depositor = undefined;
    this.#provider = undefined;
    this.#token = undefined;
    this.#resetMeter();
  }

  async shutdown(): Promise<void> {
    await this.settle();
  }

  #buildProviderSettlements(turnStats: Map<string, ToolStats>): ProviderSettlement[] {
    const providers: ProviderSettlement[] = [];
    for (const [tool, meta] of Object.entries(TOOL_PROVIDERS)) {
      const turn = turnStats.get(tool) ?? { sessionCalls: 0, sessionBillable: 0n };
      const stats = this.#byTool.get(tool) ?? { sessionCalls: 0, sessionBillable: 0n };
      providers.push({
        providerId: meta.id,
        providerLabel: meta.label,
        tool,
        turnCalls: turn.sessionCalls,
        turnBillable: turn.sessionBillable.toString(),
        sessionCalls: stats.sessionCalls,
        sessionBillable: stats.sessionBillable.toString(),
      });
    }
    return providers.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel));
  }

  #allSessionProviders(): ProviderSettlement[] {
    const providers: ProviderSettlement[] = [];
    for (const [tool, meta] of Object.entries(TOOL_PROVIDERS)) {
      const stats = this.#byTool.get(tool) ?? { sessionCalls: 0, sessionBillable: 0n };
      providers.push({
        providerId: meta.id,
        providerLabel: meta.label,
        tool,
        turnCalls: 0,
        turnBillable: "0",
        sessionCalls: stats.sessionCalls,
        sessionBillable: stats.sessionBillable.toString(),
      });
    }
    return providers.sort((a, b) => a.providerLabel.localeCompare(b.providerLabel));
  }
}
