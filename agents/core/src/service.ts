/**
 * A metered service that a provider agent sells per call.
 *
 * Pricing is in the same atomic "units" the channel meters
 * (`settlement_amount = total_units * rate`).
 */
export interface Service<Req, Res> {
  /** Stable identifier, surfaced in results and the agent card. */
  readonly name: string;
  /**
   * Price of a request, in units. The provider prices independently — it
   * never trusts a consumer-claimed cost. Must be > 0.
   */
  price(req: Req): bigint;
  /**
   * Perform the work. Only ever called after the meter accepts the call.
   */
  handle(req: Req): Promise<Res>;
}
