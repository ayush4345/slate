# slate-base

Base (Ethereum L2) contracts for Slate — metered agent-to-agent API calls,
settled once per channel with a Groth16 proof.

Agents meter thousands of API calls off-chain against an escrowed balance,
then close the whole channel in a single transaction: one Groth16 proof
establishes what is owed, the escrow pays the provider and refunds the rest.
Usage volume and pricing never go on-chain.

## Layout

A pnpm workspace. Each package is one layer, and they depend downwards:
`web` and `agents/*` → `agent-core` → `onchain-setup` → `proving-setup`.

| Path | What |
|---|---|
| `packages/onchain-setup/evm/` | The Foundry project — contracts, tests, deploy scripts. |
| `packages/onchain-setup/src/` | Generated ABIs and where the stack is deployed. |
| `packages/proving-setup/src/` | Pure: snarkjs output → verifier calldata, and address packing. |
| `packages/agent-core/src/` | Opens channels, meters calls, quotes them over x402, settles. |
| `agents/provider/` | Demo provider: weather, crypto price, translation over HTTP. |
| `agents/consumer/` | Demo consumer: picks tools, meters calls, settles once. |
| `web/` | Next.js landing page and channel dashboard. |

Inside the Foundry project:

| Path | What |
|---|---|
| `src/Verifier.sol` | **Generated** — `snarkjs zkey export solidityverifier`. Do not hand-edit. |
| `src/SlateEscrow.sol` | Escrow: deposit → verify proof → check nullifier → pay out. |
| `src/SlateAgentRegistry.sol` | Pinned channel terms, checked at settlement. |
| `src/SignalAddress.sol` | Encodes an EVM address into the circuit's hi/lo field pair. |
| `sdk/` | TypeScript client, Foundry ABIs, and the read path. |

## Base Sepolia

Chain id `84532`. Deployed with `script/Deploy.s.sol`.

| Contract | Address |
|---|---|
| SlateEscrow | [`0x58216D0178C18014BdD60Ae1B29068e53CBe25ad`](https://sepolia.basescan.org/address/0x58216D0178C18014BdD60Ae1B29068e53CBe25ad) |
| SlateAgentRegistry | [`0x7518B46ADA50ECb7A59F55825526C668F4e3EBfe`](https://sepolia.basescan.org/address/0x7518B46ADA50ECb7A59F55825526C668F4e3EBfe) |
| Groth16Verifier | [`0x09eAa12EEf85a4Fcb1715E9E85d388836c6b1111`](https://sepolia.basescan.org/address/0x09eAa12EEf85a4Fcb1715E9E85d388836c6b1111) |
| USDC (whitelisted) | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e) |

```
BASE_CHAIN_ID=84532
BASE_RPC_URL=https://base-sepolia-rpc.publicnode.com
SLATE_ESCROW_ADDRESS=0x58216D0178C18014BdD60Ae1B29068e53CBe25ad
SLATE_REGISTRY_ADDRESS=0x7518B46ADA50ECb7A59F55825526C668F4e3EBfe
```

`SETTLEMENT_TOKEN` is omitted on purpose: it defaults to the USDC above.

A settlement was verified against this deployment in
[`0x93b0f7e8…55c5fc`](https://sepolia.basescan.org/tx/0x93b0f7e855298950766bfe2d721b8efce2326ff456b4f5403dff8bb04455c5fc).

**The verifier and the proving key are a pair.** This escrow takes its verifier
at construction and never lets it change, so a proof built with a different
`settlement_final.zkey` fails with `InvalidProof()`. Redeploying after
regenerating the key means redeploying the whole stack, and the addresses
above stop being the ones to use.

`https://sepolia.base.org` load-balances across nodes that do not always agree
on an account's transaction count, which surfaces as `nonce too low` mid-way
through opening a channel. The public node above has been steadier.

Redeploy:

```sh
cd packages/onchain-setup/evm
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://sepolia.base.org \
  --broadcast \
  --private-key $EVM_PRIVATE_KEY
```

## Regenerating the verifier

The circuit and proving key live with the proving stack; only the generated
verifier belongs here.

```sh
snarkjs zkey export solidityverifier \
  settlement_final.zkey \
  packages/onchain-setup/evm/src/Verifier.sol
```

It exposes `verifyProof(uint[2], uint[2][2], uint[2], uint[13])`. The 13
public signals are, in order:

```
0  channel_id          5  consumer_pubkey_x    9  provider_hi
1  rate_commitment     6  consumer_pubkey_y   10  provider_lo
2  escrow_amount       7  depositor_hi        11  token_hi
3  settlement_amount   8  depositor_lo        12  token_lo
4  nullifier
```

Build proof calldata with `snarkjs.groth16.exportSolidityCallData` — it
already emits the G2 c1/c0 ordering this verifier expects. Do not hand-pack
it.

## Local anvil

`pnpm test:e2e` spawns anvil and runs two loops:

1. Deploy the committed contracts, open a channel, exercise the read path.
2. Build a local proving key from the settlement r1cs, deploy a matching
   verifier, then open → meter → prove → settle.

The committed `Verifier.sol` was generated from `settlement_final.zkey`, which
is not in git. The full loop therefore uses a local key in `.cache/`
(`pnpm --filter @slate-base/onchain-setup prove:setup`) so proving does not
depend on a missing artifact. It does not replace the committed verifier.

To poke at a node by hand instead:

```sh
anvil
cd packages/onchain-setup/evm
forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 \
  --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

`DeployLocal` mints mock USDC to the deployer and whitelists it.

## TypeScript

The packages talk to these contracts over `viem`. ABIs are generated from
`forge inspect` (`pnpm generate:abi`). Regenerating is required whenever a
contract's ABI changes — `onchain-setup`'s tests compare the committed files
to a fresh inspect.

## x402

`packages/agent-core/src/x402.ts` builds the `402` a provider answers with, and the `X-PAYMENT`
header a consumer retries with. Payment verification is a seam:
`MockPaymentVerifier` by default, `FacilitatorPaymentVerifier` against a real
facilitator when `MOCK_X402=false`.

Anvil has no facilitator, so local runs stay on the mock.

## Running the app

Three processes. The consumer opens its channel against the provider at
startup, so start them in this order.

```sh
pnpm install
pnpm build

pnpm serve:provider    # :4021  the metered API
pnpm serve:consumer    # :4022  the agent that buys calls and settles
pnpm serve:web         # :3000  the dashboard
```

Then open **http://localhost:3000/dashboard**.

### Environment

Offline, everything mocked, one variable is enough:

```
X402_PAY_TO=0x…            # no safe default: an unset payee advertises nowhere
```

Settling on Base Sepolia needs a funded key and the deployed addresses:

```
EVM_PRIVATE_KEY=0x…        # funds escrow, submits settlement, pays gas
BASE_CHAIN_ID=84532
BASE_RPC_URL=https://base-sepolia-rpc.publicnode.com
SLATE_ESCROW_ADDRESS=0x58216D0178C18014BdD60Ae1B29068e53CBe25ad
SLATE_REGISTRY_ADDRESS=0x7518B46ADA50ECb7A59F55825526C668F4e3EBfe
X402_PAY_TO=0x…
```

The depositor needs testnet USDC ([faucet.circle.com](https://faucet.circle.com),
Base Sepolia) and a little ETH for gas. The provider is only paid, so it needs
neither. `EVM_PRIVATE_KEY` is the switch: unset, settlement is mocked and the
rest can stay blank; set, the two addresses become required and a missing one
throws at startup. `SLATE_MOCK=true` forces mock back on without removing the
key. Setting `OPENAI_API_KEY` swaps the offline keyword router for real tool
selection. Full list in [`.env.example`](./.env.example).

Both agents read the repo-root `.env`. The web app does not: Next reads
`web/.env.local`, which needs the chain and contract addresses to show live
data, plus `AGENT_URL` if the consumer is not on `http://localhost:4022`.

### What the dashboard shows

`/` is the landing page. `/dashboard` is the working surface:

- **Agent session** — provider, advertised rate, brain, settlement mode, the
  live channel, and the running meter. Ask it something and each answer costs
  one metered call, tagged with the provider agent that served it. **Settle
  channel** generates the proof and submits it; the transaction links to
  Basescan. Settling closes the channel, so the next question needs **New
  session**.
- **Channel terms, Escrow, Deployment** — read straight from the registry and
  the escrow. No key is involved: the page only reads. With no `?channel=` it
  follows whatever the agent has open.
- **Settlement inputs** — which of the thirteen signals the channel already
  fixes, and which two the proof supplies.

Without the deployed addresses the three lower panels show labelled sample
data rather than an empty shell.

### Without the browser

```sh
pnpm demo                                        # in-process, no HTTP
pnpm demo -- "Weather in Tokyo and the price of ETH"

curl -X POST localhost:4022/chat -H 'content-type: application/json' \
  -d '{"message":"weather in Lisbon"}'
curl -X POST localhost:4022/settle
```

The consumer serves `/health`, `/chat`, `/settle`, and `/session/new`; the web
app proxies those under `/api/*` so the browser never talks to the agent
directly.

## Develop

```sh
pnpm install
pnpm test                              # every package
pnpm test:e2e                          # spawns anvil
pnpm --filter @slate-base/web build    # type-checks the app

cd packages/onchain-setup/evm && forge test
```

`forge lint` reports naming warnings on `src/Verifier.sol`; it is codegen,
leave it alone.
