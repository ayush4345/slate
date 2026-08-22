import assert from "node:assert/strict";
import { test } from "node:test";

import type { Service } from "./service.js";
import { ToolboxService } from "./toolbox.js";

class EchoService implements Service<{ n: number }, { n: number }> {
  readonly name = "echo";
  price(): bigint {
    return 1n;
  }
  async handle(req: { n: number }): Promise<{ n: number }> {
    return req;
  }
}

test("ToolboxService routes and prices by tool name", async () => {
  const box = new ToolboxService({ echo: new EchoService() });
  assert.deepEqual(box.toolNames(), ["echo"]);
  assert.equal(box.price({ tool: "echo", args: { n: 1 } }), 1n);
  assert.deepEqual(await box.handle({ tool: "echo", args: { n: 7 } }), {
    tool: "echo",
    result: { n: 7 },
  });
  assert.throws(() => box.price({ tool: "missing", args: {} }), /unknown tool/);
});
