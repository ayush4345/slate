import express from "express";
import type { Express } from "express";
import { realChainFromEnv } from "@slate-base/agent-core";
import type { AgentSession } from "./session.js";
import type { ConsumerServerConfig } from "./config.js";
import { buildAgentSteps } from "./steps.js";
import { ALL_TOOLS, TOOL_PROVIDERS } from "./providers.js";

function providerInfo(config: ConsumerServerConfig) {
  return {
    name: "slate-provider",
    url: config.providerUrl,
  };
}

export interface ConsumerServerDeps {
  config: ConsumerServerConfig;
  session: AgentSession;
}

export function createConsumerServer(deps: ConsumerServerDeps): Express {
  const { config, session } = deps;
  const app = express();

  app.use(express.json({ limit: "256kb" }));
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get("/health", (_req, res) => {
    const real = realChainFromEnv();
    res.json({
      ok: session.ready,
      provider: providerInfo(config),
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
    });
  });

  app.post("/chat", async (req, res) => {
    if (!session.ready) {
      res.status(503).json({ ok: false, error: "agent session not ready" });
      return;
    }

    const body = req.body as { message?: unknown };
    if (typeof body.message !== "string" || body.message.trim().length === 0) {
      res.status(400).json({ ok: false, error: "message is required" });
      return;
    }

    try {
      const result = await session.chat(body.message);
      const provider = providerInfo(config);
      const { payment, ...rest } = result;
      const steps = buildAgentSteps(provider, result.calls, result.answer, payment);
      res.json({ ok: true, provider, steps, payment, ...rest });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post("/settle", async (_req, res) => {
    try {
      const outcome = await session.settle();
      res.json({ ok: true, ...outcome });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.post("/session/new", async (_req, res) => {
    try {
      await session.newSession();
      res.json({
        ok: true,
        provider: providerInfo(config),
        providerTerms: session.getProviderTerms(),
        payment: session.getPaymentSummary(),
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ ok: false, error: msg });
    }
  });

  return app;
}
