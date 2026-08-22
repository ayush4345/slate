import assert from "node:assert/strict";
import { test } from "node:test";

import { ServiceChannel, type ChannelTerms } from "./channel.js";
import type { Service } from "./service.js";

class UnitService implements Service<string, string> {
  readonly name = "unit";
  constructor(private readonly failOn?: string) {}
  price(): bigint {
    return 1n;
  }
  async handle(req: string): Promise<string> {
    if (req === this.failOn) throw new Error("boom");
    return req.toUpperCase();
  }
}

function terms(escrow = 300n): ChannelTerms {
  return {
    channelId: 1n,
    rate: 100n,
    rateBlind: 2n,
    escrow,
    channelSecret: 3n,
    consumerPrivateKey: new Uint8Array(32),
  };
}

test("ServiceChannel meters served calls and ignores failed ones", async () => {
  const channel = new ServiceChannel(terms(), new UnitService("bad"));
  const ok = await channel.call("hi");
  assert.equal(ok.served, true);
  assert.equal(ok.result, "HI");
  assert.equal(ok.cumulativeUnits, 1n);
  assert.equal(ok.billable, 100n);

  const failed = await channel.call("bad");
  assert.equal(failed.served, false);
  assert.match(String(failed.reason), /boom/);
  assert.equal(channel.cumulativeUnits, 1n);

  const closed = await channel.close();
  assert.equal(closed.totalUnits, 1n);
  assert.equal(closed.settlementAmount, 100n);
});

test("ServiceChannel refuses once escrow would be exceeded", async () => {
  const channel = new ServiceChannel(terms(100n), new UnitService());
  assert.equal((await channel.call("a")).served, true);
  const refused = await channel.call("b");
  assert.equal(refused.served, false);
  assert.equal(refused.reason, "ceiling-exceeded");
});
