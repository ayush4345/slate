/**
 * Turning a snarkjs proof into something the on-chain verifier accepts, and
 * packing addresses the way the circuit binds them.
 *
 * Everything here is pure — no network, no signer — so it is the part worth
 * testing exhaustively.
 */

/** Number of public signals the settlement circuit exposes. */
export const PUBLIC_SIGNAL_COUNT = 13;

/**
 * Where each public signal sits. The first five vary per settlement; the rest
 * are fixed for a channel's lifetime and are what the registry pins at open
 * time.
 */
export const SIGNAL = {
  channelId: 0,
  rateCommitment: 1,
  escrowAmount: 2,
  settlementAmount: 3,
  nullifier: 4,
  consumerPubkeyX: 5,
  consumerPubkeyY: 6,
  depositorHi: 7,
  depositorLo: 8,
  providerHi: 9,
  providerLo: 10,
  tokenHi: 11,
  tokenLo: 12,
} as const;

/** A groth16 proof as snarkjs writes it, with coordinates as decimal strings. */
export interface SnarkjsProof {
  pi_a: readonly string[];
  pi_b: readonly (readonly string[])[];
  pi_c: readonly string[];
  protocol?: string;
  curve?: string;
}

/** The same proof in the argument shape the generated verifier declares. */
export interface ProofCalldata {
  a: readonly [bigint, bigint];
  b: readonly [readonly [bigint, bigint], readonly [bigint, bigint]];
  c: readonly [bigint, bigint];
}

export type PublicSignals = readonly bigint[] & { length: 13 };

export interface Settlement {
  proof: ProofCalldata;
  publicSignals: PublicSignals;
}

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

function field(value: string | bigint, label: string): bigint {
  try {
    return typeof value === "bigint" ? value : BigInt(String(value).trim());
  } catch {
    throw new SettlementError(`${label} is not an integer: "${String(value)}"`);
  }
}

/**
 * Reshape a snarkjs proof into verifier calldata.
 *
 * The only subtlety is G2. snarkjs stores each Fp2 coordinate as `[c0, c1]`,
 * real part first; the verifier reads them imaginary part first. So each inner
 * pair is reversed here — get this backwards and the proof simply fails to
 * verify, with nothing to indicate why.
 */
export function proofToCalldata(proof: SnarkjsProof): ProofCalldata {
  const { pi_a: a, pi_b: b, pi_c: c } = proof;

  if (a.length < 2) throw new SettlementError("pi_a must have two coordinates");
  if (c.length < 2) throw new SettlementError("pi_c must have two coordinates");
  if (b.length < 2 || b[0]!.length < 2 || b[1]!.length < 2) {
    throw new SettlementError("pi_b must be a 2x2 of coordinates");
  }

  return {
    a: [field(a[0]!, "pi_a[0]"), field(a[1]!, "pi_a[1]")],
    b: [
      [field(b[0]![1]!, "pi_b[0][1]"), field(b[0]![0]!, "pi_b[0][0]")],
      [field(b[1]![1]!, "pi_b[1][1]"), field(b[1]![0]!, "pi_b[1][0]")],
    ],
    c: [field(c[0]!, "pi_c[0]"), field(c[1]!, "pi_c[1]")],
  };
}

/** Validate and widen snarkjs public signals to the fixed-length tuple. */
export function toPublicSignals(signals: readonly (string | bigint)[]): PublicSignals {
  if (signals.length !== PUBLIC_SIGNAL_COUNT) {
    throw new SettlementError(
      `expected ${PUBLIC_SIGNAL_COUNT} public signals, received ${signals.length}`,
    );
  }
  return signals.map((value, i) => field(value, `publicSignals[${i}]`)) as unknown as PublicSignals;
}

/** Assemble a settlement from raw snarkjs output. */
export function toSettlement(
  proof: SnarkjsProof,
  signals: readonly (string | bigint)[],
): Settlement {
  return { proof: proofToCalldata(proof), publicSignals: toPublicSignals(signals) };
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Split an address into the (hi, lo) field pair the circuit binds — the top and
 * bottom 16 bytes of its 32-byte left-padded form. Mirrors `SignalAddress.sol`;
 * the two must agree or settlement reverts on an address mismatch.
 */
export function addressToFieldPair(address: string): readonly [bigint, bigint] {
  if (!ADDRESS_RE.test(address)) {
    throw new SettlementError(`expected a 0x-prefixed 20-byte address, received "${address}"`);
  }
  const value = BigInt(address);
  return [value >> 128n, value & ((1n << 128n) - 1n)];
}

/** Rebuild an address from its (hi, lo) pair. */
export function fieldPairToAddress(hi: bigint, lo: bigint): `0x${string}` {
  if (hi < 0n || lo < 0n || hi >= 1n << 32n || lo >= 1n << 128n) {
    throw new SettlementError(`(${hi}, ${lo}) is not a field pair for a 20-byte address`);
  }
  return `0x${((hi << 128n) | lo).toString(16).padStart(40, "0")}`;
}

/** The parties a settlement's signals claim to be about. */
export function partiesFromSignals(signals: PublicSignals): {
  depositor: `0x${string}`;
  provider: `0x${string}`;
  token: `0x${string}`;
} {
  return {
    depositor: fieldPairToAddress(signals[SIGNAL.depositorHi]!, signals[SIGNAL.depositorLo]!),
    provider: fieldPairToAddress(signals[SIGNAL.providerHi]!, signals[SIGNAL.providerLo]!),
    token: fieldPairToAddress(signals[SIGNAL.tokenHi]!, signals[SIGNAL.tokenLo]!),
  };
}
