import express from "express";
import type { Express } from "express";
import { parseUnits } from "@slate-base/agent-core";
import type { ToolboxService, ToolCall } from "@slate-base/agent-core";
import type { ProviderServerConfig } from "./config.js";
import {
  build402Body,
  buildTerms,
  FacilitatorPaymentVerifier,
  DEFAULT_FACILITATOR_URL,
  MockPaymentVerifier,
  readPaymentHeader,
  type PaymentVerifier,
} from "@slate-base/agent-core";
import { ChannelRegistry } from "./channels.js";
import { TOOL_SPECS } from "./tools.js";

export interface ProviderServerDeps {
  config: ProviderServerConfig;
  toolbox: ToolboxService;
  verifier?: PaymentVerifier;
  registry?: ChannelRegistry;
}

/**
 * Provider x402 HTTP server.
 *
 *   POST /agent/open              → 402 with advertised rate / payTo / asset
 *   POST /agent/open + X-PAYMENT  → open a metered channel
 *   POST /channels/:id/call       → price, serve, advance the meter
 *   POST /channels/:id/finalize   → release the in-memory meter
 *   GET  /.well-known/agent-card.json
 */
export function createProviderServer(deps: ProviderServerDeps): Express {
  const { config, toolbox } = deps;
  const terms = buildTerms(config.terms);
  const verifier =
    deps.verifier ??
    (config.mockX402
      ? new MockPaymentVerifier()
      : new FacilitatorPaymentVerifier(config.facilitatorUrl ?? DEFAULT_FACILITATOR_URL));
  const registry = deps.registry ?? new ChannelRegistry();
  const rate = parseUnits(terms.rate);

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/.well-known/agent-card.json", (_req, res) => {
    res.json({
      name: "slate-provider",
      description: "Metered multi-tool provider, settled via Slate ZK payment channels on Base.",
      x402: { open: "/agent/open", requirements: terms },
      tools: TOOL_SPECS,
    });
  });

  app.post("/agent/open", async (req, res) => {
    const payment = readPaymentHeader(req.headers as Record<string, unknown>);
    if (payment === null) {
      res.status(402).json(build402Body(config.terms));
      return;
    }

    const verified = await verifier.verifyAndSettle(payment, terms);
    if (!verified.ok) {
      res
        .status(402)
        .json({ ...build402Body(config.terms), error: `payment rejected: ${verified.reason}` });
      return;
    }

    const body = req.body as { channelId?: string; escrow?: string };
    if (typeof body.channelId !== "string" || typeof body.escrow !== "string") {
      res.status(400).json({ ok: false, error: "invalid open payload" });
      return;
    }

    registry.open({
      channelId: BigInt(body.channelId),
      rate,
      escrow: BigInt(body.escrow),
    });
    res.json({
      ok: true,
      channelId: body.channelId,
      rate: terms.rate,
      payTo: terms.payTo,
      asset: terms.asset,
      settlementTx: verified.settlementTx,
    });
  });

  app.post("/channels/:id/call", async (req, res) => {
    const channelId = String(req.params.id);
    const meter = registry.get(channelId);
    if (meter === undefined) {
      res.status(404).json({ served: false, reason: "unknown-channel" });
      return;
    }

    const body = req.body as { payload?: unknown };
    const payload = body.payload as ToolCall | undefined;
    if (payload === undefined || typeof payload.tool !== "string") {
      res.status(400).json({ served: false, reason: "invalid-payload" });
      return;
    }

    let cost: bigint;
    try {
      cost = toolbox.price(payload);
    } catch (error) {
      res.json({ served: false, reason: error instanceof Error ? error.message : "unknown-tool" });
      return;
    }

    const preview = meter.preview(cost);
    if (!preview.accepted) {
      res.json({
        served: false,
        reason: preview.reason,
        cumulativeUnits: meter.cumulativeUnits.toString(),
        billable: meter.billable.toString(),
      });
      return;
    }

    let result: unknown;
    try {
      result = await toolbox.handle(payload);
    } catch (error) {
      res.status(502).json({
        served: false,
        reason: `tool-error: ${(error as Error).message}`,
      });
      return;
    }

    meter.commit(cost);
    res.json({
      served: true,
      result,
      cumulativeUnits: meter.cumulativeUnits.toString(),
      billable: meter.billable.toString(),
    });
  });

  app.post("/channels/:id/finalize", (req, res) => {
    const channelId = String(req.params.id);
    const finalUnits = registry.get(channelId)?.cumulativeUnits.toString() ?? "0";
    registry.close(channelId);
    res.json({ ok: true, finalUnits });
  });

  return app;
}
