import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  MockChainClient,
  ServiceChannel,
  formatUnits,
  parseUnits,
  pinChannelTerms,
  proveSettlement,
  realChainFromEnv,
  type Address,
  type ChannelTerms,
  type ChainClient,
} from "@slate-base/agent-core";
import { FetchHttpClient, buildToolbox, TOOL_SPECS } from "@slate-base/agent-provider";
import { ServiceAgent } from "./agent.js";
import { StubAgentBrain } from "./stub-agent.js";
import { OpenAiAgentBrain } from "./openai-agent.js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
const envLoad = loadEnv({ path: envPath, override: true });
if (envLoad.error) {
  console.log(`env: no .env found at ${envPath} (${envLoad.error.message})`);
} else {
  const keys = Object.keys(envLoad.parsed ?? {});
  console.log(
    `env: loaded ${keys.length} var(s) from ${envPath}` +
      (keys.includes("EVM_PRIVATE_KEY") ? " — Base (EVM_PRIVATE_KEY)" : " — no EVM_PRIVATE_KEY (mock mode)"),
  );
}

function randField(): bigint {
  return BigInt("0x" + randomBytes(31).toString("hex"));
}

async function main(): Promise<void> {
  const goal =
    process.argv.slice(2).join(" ") ||
    "What's the weather in Tokyo, the price of ETH in USD, and translate 'good morning' into Japanese?";

  const symbol = process.env.SETTLEMENT_TOKEN_SYMBOL ?? "USDC";
  const rate = parseUnits(process.env.RATE ?? "0.0001");
  const escrow = parseUnits(process.env.ESCROW ?? "0.01");

  const real = realChainFromEnv();
  if (!real) {
    console.log("note: MOCK mode — set EVM_PRIVATE_KEY for on-chain Base settlement.");
  }
  const chain: ChainClient = real?.chain ?? new MockChainClient();
  const mode = real ? "REAL Base (EVM)" : "mock (offline)";

  const depositor = real?.depositor ?? ("0x0000000000000000000000000000000000000001" as Address);
  const provider = real?.provider ?? depositor;
  const token = real?.token ?? depositor;

  const terms: ChannelTerms = {
    channelId: randField(),
    rate,
    rateBlind: randField(),
    escrow,
    channelSecret: randField(),
    consumerPrivateKey: randomBytes(32),
  };

  const http = new FetchHttpClient();
  const toolbox = buildToolbox(http);
  const channel = new ServiceChannel(terms, toolbox);

  console.log("═══ OPEN CHANNEL ═══");
  console.log(`  settlement chain:  ${mode}`);
  if (real) console.log(`  addresses:         ${real.label}`);
  console.log(`  services offered:  ${toolbox.toolNames().join(", ")}`);
  console.log(`  rate (PRIVATE):    ${formatUnits(rate)} ${symbol} / call`);
  console.log(`  escrow (public):   ${formatUnits(escrow)} ${symbol}`);

  if (real) {
    const pinned = await pinChannelTerms({
      channelId: terms.channelId,
      channelSecret: terms.channelSecret,
      rate,
      rateBlind: terms.rateBlind,
      escrowAmount: escrow,
      depositor,
      provider,
      token,
      consumerPrivateKey: terms.consumerPrivateKey,
    });
    const opened = await chain.openChannel({
      channelId: terms.channelId,
      rateCommitment: pinned.rateCommitment,
      consumerPublicKey: pinned.consumerPublicKey,
      provider,
      token,
      escrow,
    });
    console.log(`  rate commitment:   ${pinned.rateCommitment.toString().slice(0, 16)}…`);
    console.log(`  open tx:           ${opened.openTx}`);
  } else {
    const opened = await chain.openChannel({
      channelId: terms.channelId,
      rateCommitment: randField(),
      consumerPublicKey: { x: randField(), y: randField() },
      provider,
      token,
      escrow,
    });
    console.log(`  open tx:           ${opened.openTx}`);
  }

  const useOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const brain = useOpenAi ? new OpenAiAgentBrain() : new StubAgentBrain();
  console.log(`\n═══ METER (off-chain) — ${useOpenAi ? "OpenAI" : "stub"} tool-using agent ═══`);
  console.log(`  goal: ${goal}`);

  const { answer, calls } = await new ServiceAgent(channel, brain, TOOL_SPECS).run(goal);
  for (const c of calls) {
    const detail = c.served ? JSON.stringify(c.result) : (c.reason ?? "refused");
    console.log(
      `  ${c.served ? "paid+served" : "skipped   "}  ${c.tool.padEnd(16)} ${JSON.stringify(c.args)} → ${detail}`,
    );
  }
  console.log(`  answer: ${answer}`);

  console.log(`\n═══ SETTLE — one on-chain settlement (${mode}) ═══`);
  const served = calls.filter((c) => c.served).length;
  const closed = await channel.close();

  let settleTx: string;
  if (real && closed.totalUnits > 0n) {
    const { settlement } = await proveSettlement({
      channelId: terms.channelId,
      channelSecret: terms.channelSecret,
      rate,
      rateBlind: terms.rateBlind,
      totalUnits: closed.totalUnits,
      escrowAmount: escrow,
      depositor,
      provider,
      token,
      consumerPrivateKey: terms.consumerPrivateKey,
    });
    settleTx = (await chain.settle(settlement)).settleTx;
  } else {
    settleTx = (await chain.settle()).settleTx;
  }

  console.log(`  paid calls (PRIVATE):    ${served}  across ${new Set(calls.filter((c) => c.served).map((c) => c.tool)).size} service(s)`);
  console.log(`  settled to provider:     ${formatUnits(closed.settlementAmount)} ${symbol}`);
  console.log(`  refunded to consumer:    ${formatUnits(escrow - closed.settlementAmount)} ${symbol}`);
  console.log(`  settle tx:               ${settleTx}`);
  if (real) {
    console.log(`\n  view on explorer: https://sepolia.basescan.org/tx/${settleTx}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
