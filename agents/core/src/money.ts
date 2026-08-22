/**
 * Parse a non-negative decimal string into integer base units at `decimals`
 * precision. Default is 6 (Base USDC).
 */
export function parseUnits(value: string, decimals = 6): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid decimal amount: ${value}`);
  }
  const parts = trimmed.split(".");
  const whole = parts[0] ?? "0";
  const fractional = (parts[1] ?? "").padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fractional || "0");
}

/** Format integer base units back into a trimmed decimal string. */
export function formatUnits(value: bigint, decimals = 6): string {
  if (value < 0n) throw new Error("amount must be non-negative");
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fractional = value % base;
  if (fractional === 0n) return whole.toString();
  return `${whole.toString()}.${fractional.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}
