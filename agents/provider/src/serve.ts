// pnpm --filter @slate-base/agent-provider serve
// Env: PORT, RATE, X402_NETWORK, X402_ASSET, X402_PAY_TO, X402_MAX_AMOUNT,
//      MOCK_X402 (default true), X402_FACILITATOR_URL.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { readProviderServerConfig } from "./config.js";
import { FetchHttpClient } from "./http.js";
import { buildToolbox } from "./tools.js";
import { createProviderServer } from "./server.js";

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
loadEnv({ path: envPath, override: true });

const config = readProviderServerConfig();
const toolbox = buildToolbox(new FetchHttpClient());
const app = createProviderServer({ config, toolbox });

app.listen(config.port, () => {
  console.log(`slate-base provider listening on http://localhost:${config.port}`);
  console.log(`  payment mode:  ${config.mockX402 ? "MOCK verifier" : `facilitator @ ${config.facilitatorUrl ?? "default"}`}`);
  console.log(`  network/asset: ${config.terms.network}  ${config.terms.asset}`);
  console.log(`  payTo / rate:  ${config.terms.payTo}  ${config.terms.rate}`);
  console.log(`  tools:         ${toolbox.toolNames().join(", ")}`);
  console.log(`  open channel:  POST /agent/open   (402 → X-PAYMENT → open)`);
  console.log(`  agent card:    GET  /.well-known/agent-card.json`);
});
