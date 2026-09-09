import { realChainFromEnv } from "@avtar/agent-core";
import { buildToolbox, FetchHttpClient } from "@avtar/agent-provider";
import {
  AgentSession,
  ALL_TOOLS,
  TOOL_PROVIDERS,
  buildAgentSteps,
  readConsumerServerConfig,
} from "@avtar/agent-consumer";

type GlobalAgent = {
  session?: AgentSession;
  init?: Promise<AgentSession>;
};

function globalStore(): GlobalAgent {
  const g = globalThis as typeof globalThis & { __avtarAgent?: GlobalAgent };
  if (!g.__avtarAgent) g.__avtarAgent = {};
  return g.__avtarAgent;
}

function providerInfo() {
  return {
    name: "avtar-provider",
    url: "embedded://provider",
  };
}

/**
 * In-process consumer + provider for Vercel. Session lives on globalThis so
 * warm isolates reuse the open channel across Ask → Settle.
 */
export async function getEmbeddedSession(): Promise<AgentSession> {
  const store = globalStore();
  if (store.session?.ready) return store.session;
  if (store.init) return store.init;

  store.init = (async () => {
    const config = readConsumerServerConfig({
      ...process.env,
      PROVIDER_URL: process.env.PROVIDER_URL ?? "embedded://provider",
      CORS_ORIGIN: process.env.CORS_ORIGIN ?? "*",
    });
    const toolbox = buildToolbox(new FetchHttpClient());
    const session = new AgentSession(config, { toolbox });
    await session.initialize();
    store.session = session;
    return session;
  })();

  try {
    return await store.init;
  } finally {
    store.init = undefined;
  }
}

export async function embeddedHealth(): Promise<Response> {
  try {
    const session = await getEmbeddedSession();
    const real = realChainFromEnv();
    return Response.json({
      ok: session.ready,
      provider: providerInfo(),
      providerTerms: session.getProviderTerms(),
      tools: ALL_TOOLS,
      providers: Object.entries(TOOL_PROVIDERS).map(([tool, meta]) => ({
        tool,
        id: meta.id,
        label: meta.label,
      })),
      brain: process.env.OPENAI_API_KEY ? "openai" : "stub",
      settlementMode: real ? "base" : "mock",
      settlementNote: real
        ? "Calls are metered off-chain; one ZK proof settles on Base when the consumer stops."
        : "Mock mode — set EVM_PRIVATE_KEY for on-chain Base settlement.",
      payment: session.getPaymentSummary(),
      channel: session.getChannel(),
      mode: "embedded",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: msg, mode: "embedded" }, { status: 503 });
  }
}

export async function embeddedChat(bodyText: string): Promise<Response> {
  try {
    const session = await getEmbeddedSession();
    if (!session.ready) {
      return Response.json({ ok: false, error: "agent session not ready" }, { status: 503 });
    }
    const body = JSON.parse(bodyText || "{}") as { message?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      return Response.json({ ok: false, error: "message is required" }, { status: 400 });
    }
    const result = await session.chat(body.message);
    const provider = providerInfo();
    const { payment, ...rest } = result;
    const steps = buildAgentSteps(provider, result.calls, result.answer, payment);
    return Response.json({ ok: true, provider, steps, payment, ...rest });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function embeddedSettle(): Promise<Response> {
  try {
    const session = await getEmbeddedSession();
    const outcome = await session.settle();
    return Response.json({ ok: true, ...outcome });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function embeddedNewSession(): Promise<Response> {
  try {
    const store = globalStore();
    const session = await getEmbeddedSession();
    await session.newSession();
    store.session = session;
    return Response.json({
      ok: true,
      provider: providerInfo(),
      providerTerms: session.getProviderTerms(),
      payment: session.getPaymentSummary(),
      channel: session.getChannel(),
      mode: "embedded",
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
