# slate-base

Base (Ethereum L2) contracts for Slate — metered agent-to-agent API calls,
settled once per channel with a Groth16 proof.

Agents meter thousands of API calls off-chain against an escrowed balance,
then close the whole channel in a single transaction: one Groth16 proof
establishes what is owed, the escrow pays the provider and refunds the rest.
Usage volume and pricing never go on-chain.

## Layout

A pnpm workspace. Each package is one layer, and they depend downwards:
`agent-core` → `onchain-setup` → `proving-setup`.

| Path | What |
|---|---|
| `packages/onchain-setup/evm/` | The Foundry project — contracts, tests, deploy scripts. |
| `packages/onchain-setup/src/` | Generated ABIs and where the stack is deployed. |
| `packages/proving-setup/src/` | Pure: snarkjs output → verifier calldata, and address packing. |
| `packages/agent-core/src/` | Opens channels, reads them back, quotes them over x402, settles. |

Inside the Foundry project:

| Path | What |
|---|---|
| `src/Verifier.sol` | **Generated** — `snarkjs zkey export solidityverifier`. Do not hand-edit. |
| `src/SlateEscrow.sol` | Escrow: deposit → verify proof → check nullifier → pay out. |
| `src/SlateAgentRegistry.sol` | Pinned channel terms, checked at settlement. |
| `src/SignalAddress.sol` | Encodes an EVM address into the circuit's hi/lo field pair. |

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

Partial end-to-end: deploy, open a channel, exercise the read path. It does not
prove a real settlement — that is the full loop.

`pnpm test:e2e` spawns its own anvil. To poke at a node by hand instead:

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

## Develop

```sh
pnpm install
pnpm test                              # every package
pnpm test:e2e                          # spawns anvil

cd packages/onchain-setup/evm && forge test
```

`forge lint` reports naming warnings on `src/Verifier.sol`; it is codegen,
leave it alone.
