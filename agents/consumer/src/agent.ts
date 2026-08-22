import type { MeteredServiceChannel, ToolCall, ToolResult } from "@slate-base/agent-core";
import type { ToolSpec } from "@slate-base/agent-provider";

export interface AgentDecision {
  calls?: Array<{ tool: string; args: Record<string, unknown> }>;
  answer?: string;
}

export interface AgentBrain {
  decide(goal: string, tools: ToolSpec[], gathered: ToolResult[]): Promise<AgentDecision>;
}

export interface CallRecord {
  tool: string;
  args: Record<string, unknown>;
  served: boolean;
  result?: unknown;
  reason?: string;
  billable?: string;
  cumulativeUnits?: string;
}

export interface AgentRunResult {
  answer: string;
  calls: CallRecord[];
}

export interface ProviderSettlement {
  providerId: string;
  providerLabel: string;
  tool: string;
  turnCalls: number;
  turnBillable: string;
  sessionCalls: number;
  sessionBillable: string;
}

export interface TurnPayment {
  turnCalls: number;
  turnBillable: string;
  sessionCalls: number;
  sessionBillable: string;
  tokenSymbol: string;
  providers: ProviderSettlement[];
}

/**
 * Tool-using consumer. Asks the brain which tools to buy, meters each call
 * on one channel, and repeats until it has an answer. The whole session
 * settles with one proof regardless of which mix of tools ran.
 */
export class ServiceAgent {
  constructor(
    private readonly channel: MeteredServiceChannel<ToolCall, ToolResult>,
    private readonly brain: AgentBrain,
    private readonly tools: ToolSpec[],
    private readonly maxRounds = 4,
  ) {}

  async run(goal: string): Promise<AgentRunResult> {
    const gathered: ToolResult[] = [];
    const calls: CallRecord[] = [];

    for (let round = 0; round < this.maxRounds; round++) {
      const decision = await this.brain.decide(goal, this.tools, gathered);
      if (decision.answer !== undefined) {
        return { answer: decision.answer, calls };
      }

      const toolCalls = decision.calls ?? [];
      if (toolCalls.length === 0) break;

      for (const tc of toolCalls) {
        const out = await this.channel.call({ tool: tc.tool, args: tc.args });
        const record: CallRecord = {
          tool: tc.tool,
          args: tc.args,
          served: out.served,
        };
        if (out.reason !== undefined) record.reason = out.reason;
        if (out.served && out.result) {
          record.result = out.result.result;
          gathered.push(out.result);
        }
        if (out.billable !== undefined) record.billable = out.billable.toString();
        if (out.cumulativeUnits !== undefined) record.cumulativeUnits = out.cumulativeUnits.toString();
        calls.push(record);

        if (!out.served && out.reason === "ceiling-exceeded") {
          const final = await this.brain.decide(goal, this.tools, gathered);
          return { answer: final.answer ?? "(escrow exhausted)", calls };
        }
      }
    }

    const final = await this.brain.decide(goal, this.tools, gathered);
    return { answer: final.answer ?? "(no answer)", calls };
  }
}
