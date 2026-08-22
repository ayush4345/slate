# slate-base

Base (Ethereum L2) contracts for Slate — metered agent-to-agent API calls,
settled once per channel with a Groth16 proof.

Agents meter thousands of API calls off-chain against an escrowed balance,
then close the whole channel in a single transaction: one Groth16 proof
establishes what is owed, the escrow pays the provider and refunds the rest.
Usage volume and pricing never go on-chain.

## Layout

| Path | What |
|---|---|
| `src/Verifier.sol` | **Generated** — `snarkjs zkey export solidityverifier`. Do not hand-edit. |
| `src/SlateEscrow.sol` | Escrow: deposit → verify proof → check nullifier → pay out. |
| `src/SlateAgentRegistry.sol` | Pinned channel terms, checked at settlement. |
| `src/SignalAddress.sol` | Encodes an EVM address into the circuit's hi/lo field pair. |
| `sdk/` | TypeScript client, Foundry ABIs, and the read path. |

## Regenerating the verifier

The circuit and proving key live with the proving stack; only the generated
verifier belongs here.

```sh
snarkjs zkey export solidityverifier \
  ../slate/packages/proving-setup/settlement_final.zkey \
  src/Verifier.sol
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

`cd sdk && pnpm test:e2e` spawns anvil and runs two loops:

1. Deploy the committed contracts, open a channel, exercise the read path.
2. Build a local proving key from the settlement r1cs, deploy a matching
   verifier, then open → meter → prove → settle.

The committed `Verifier.sol` was generated from `settlement_final.zkey`, which
is not in git. The full loop therefore uses a local key in `sdk/.cache/`
(`pnpm prove:setup`) so proving does not depend on a missing artifact. It does
not replace the committed verifier.

To poke at a node by hand instead:

```sh
anvil
forge script script/DeployLocal.s.sol:DeployLocal --rpc-url http://127.0.0.1:8545 \
  --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

`DeployLocal` mints mock USDC to the deployer and whitelists it.

## TypeScript SDK

`sdk/` talks to these contracts over `viem`. ABIs are generated from
`forge inspect` (`pnpm generate:abi` in `sdk/`). Regenerating is required
whenever a contract's ABI changes — `sdk` tests compare the committed files
to a fresh inspect.

## Develop

```sh
forge build
forge test
cd sdk && pnpm test && pnpm test:e2e
```

`forge lint` reports naming warnings on `src/Verifier.sol`; it is codegen,
leave it alone.
