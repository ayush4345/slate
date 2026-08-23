import type { Service } from "@avtar/agent-core";
import type { HttpClient } from "./http.js";

export interface CryptoPriceRequest {
  coin: string;
  vs?: string;
}

export interface CryptoPriceResult {
  coin: string;
  vs: string;
  price: number;
  change24hPct?: number;
}

/**
 * Crypto spot price via the keyless CoinGecko `/simple/price` API. One unit per call.
 */
export class CryptoPriceService implements Service<CryptoPriceRequest, CryptoPriceResult> {
  readonly name = "coingecko-crypto-price";

  constructor(
    private readonly http: HttpClient,
    private readonly unitsPerCall: bigint = 1n,
  ) {
    if (unitsPerCall <= 0n) throw new Error("unitsPerCall must be positive");
  }

  price(_req: CryptoPriceRequest): bigint {
    return this.unitsPerCall;
  }

  async handle(req: CryptoPriceRequest): Promise<CryptoPriceResult> {
    const coin = req.coin.trim().toLowerCase();
    const vs = (req.vs ?? "usd").trim().toLowerCase();
    if (!coin) throw new Error("coin is required");

    const url =
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}` +
      `&vs_currencies=${encodeURIComponent(vs)}&include_24hr_change=true`;
    const data = await this.http.getJson(url);

    const row = data?.[coin];
    if (!row || row[vs] === undefined) {
      throw new Error(`price not found for ${coin} in ${vs}`);
    }

    const change = row[`${vs}_24h_change`];
    const result: CryptoPriceResult = { coin, vs, price: Number(row[vs]) };
    if (change !== undefined) result.change24hPct = Number(change);
    return result;
  }
}
