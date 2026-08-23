import { publicClientForChain, ToolboxService } from "@slate-base/agent-core";
import type { HttpClient } from "./http.js";
import { WeatherService } from "./weather.js";
import { CryptoPriceService } from "./crypto.js";
import { TranslationService } from "./translation.js";
import { TransactionPreflightService, type PreflightRpcFactory } from "./preflight.js";

/** A tool the provider offers, described for an LLM consumer. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "get_weather",
    description: "Current weather for a place (temperature, wind, conditions). One paid call.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "Place name, e.g. 'Tokyo' or 'Paris, France'" },
      },
      required: ["location"],
    },
  },
  {
    name: "get_crypto_price",
    description: "Current crypto spot price and 24h change. One paid call.",
    parameters: {
      type: "object",
      properties: {
        coin: {
          type: "string",
          description: "CoinGecko coin id, e.g. 'bitcoin', 'ethereum', 'stellar'",
        },
        vs: { type: "string", description: "Quote currency, e.g. 'usd' (default), 'eur'" },
      },
      required: ["coin"],
    },
  },
  {
    name: "translate_text",
    description: "Translate text into a target language. One paid call.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to translate" },
        to: { type: "string", description: "Target language ISO 639-1 code, e.g. 'fr', 'ja'" },
        from: { type: "string", description: "Source language code, default 'en'" },
      },
      required: ["text", "to"],
    },
  },
  {
    name: "preflight_base_transaction",
    description:
      "Simulate a Base transaction against pending state and report execution, gas, and decoded token-call risks. This is advisory only; it never broadcasts a transaction. Two paid units.",
    parameters: {
      type: "object",
      properties: {
        chainId: {
          type: "integer",
          enum: [8453, 84532],
          description: "Base chain ID: 8453 (mainnet) or 84532 (Sepolia)",
        },
        from: { type: "string", description: "20-byte sender address (0x-prefixed hex)" },
        to: { type: "string", description: "20-byte transaction recipient address (0x-prefixed hex)" },
        data: {
          type: "string",
          description: "Optional even-length 0x-prefixed calldata; defaults to 0x",
        },
        value: {
          type: "string",
          pattern: "^\\d+$",
          description: "Optional native-token value in wei as a non-negative decimal integer; defaults to 0",
        },
      },
      required: ["chainId", "from", "to"],
      additionalProperties: false,
    },
  },
];

/**
 * Build the toolbox this provider serves. Keys MUST match {@link TOOL_SPECS}
 * names. Everything meters over one channel, so any mix of tools settles
 * with one proof.
 */
function rpcForChain(chainId: number): ReturnType<PreflightRpcFactory> {
  const client = publicClientForChain(chainId);
  return {
    call: (request) => client.call(request),
    estimateGas: (request) => client.estimateGas(request),
  };
}

export function buildToolbox(http: HttpClient, preflightRpcForChain: PreflightRpcFactory = rpcForChain): ToolboxService {
  return new ToolboxService({
    get_weather: new WeatherService(http, 1n),
    get_crypto_price: new CryptoPriceService(http, 1n),
    translate_text: new TranslationService(http, 1n),
    preflight_base_transaction: new TransactionPreflightService(preflightRpcForChain),
  });
}
