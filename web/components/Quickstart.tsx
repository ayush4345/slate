/** The code blocks are written as text so nothing in them can be mistaken for
 *  JSX. Braces and quotes appear exactly as a reader would type them. */
const INSTALL = `# contracts, SDK, and a local anvil run
gh repo clone ayush4345/slate-base
pnpm install
pnpm test
pnpm test:e2e`;

const OPEN = `const setup = slateClientFromEnv()!;

await setup.client.openChannel({
  channelId: 42n,
  rateCommitment,
  consumerPublicKey,
  provider: setup.provider,
  token: setup.token,
  escrow: 10_000_000n, // 10 USDC
});`;

const SETTLE = `// snarkjs output, straight in
const settlement =
  toSettlement(proof, signals);

// say which signal disagrees, before gas
const problems = await client
  .explainSettlement(settlement);
if (problems.length) {
  throw new Error(problems[0]);
}

await client.settle(settlement);`;

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <div className="snippet">
      <h3>{title}</h3>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function Quickstart() {
  return (
    <section className="band" id="start">
      <div className="shell">
        <div className="band__head">
          <h2>Open a channel in about twenty lines</h2>
          <p className="band__lead">
            The SDK needs a key and two deployed addresses. USDC on Base Sepolia is
            the default token, so there is nothing else to configure.
          </p>
        </div>

        <div className="start__grid">
          <Snippet title="install" code={INSTALL} />
          <Snippet title="open" code={OPEN} />
          <Snippet title="settle" code={SETTLE} />
        </div>
      </div>
    </section>
  );
}
