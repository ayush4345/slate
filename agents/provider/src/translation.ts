import type { Service } from "@slate-base/agent-core";
import type { HttpClient } from "./http.js";

export interface TranslateRequest {
  text: string;
  from?: string;
  to: string;
}

export interface TranslateResult {
  from: string;
  to: string;
  sourceText: string;
  translatedText: string;
  match?: number;
}

/**
 * Text translation via the keyless MyMemory API. One unit per call.
 */
export class TranslationService implements Service<TranslateRequest, TranslateResult> {
  readonly name = "mymemory-translation";

  constructor(
    private readonly http: HttpClient,
    private readonly unitsPerCall: bigint = 1n,
  ) {
    if (unitsPerCall <= 0n) throw new Error("unitsPerCall must be positive");
  }

  price(_req: TranslateRequest): bigint {
    return this.unitsPerCall;
  }

  async handle(req: TranslateRequest): Promise<TranslateResult> {
    const text = req.text.trim();
    const from = (req.from ?? "en").trim().toLowerCase();
    const to = req.to.trim().toLowerCase();
    if (!text) throw new Error("text is required");
    if (!to) throw new Error("target language (to) is required");

    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}` +
      `&langpair=${encodeURIComponent(from)}|${encodeURIComponent(to)}`;
    const data = await this.http.getJson(url);

    const translated = data?.responseData?.translatedText;
    if (typeof translated !== "string" || translated.length === 0) {
      throw new Error(`translation failed: ${data?.responseDetails ?? "unknown error"}`);
    }

    const match = data?.responseData?.match;
    const result: TranslateResult = { from, to, sourceText: text, translatedText: translated };
    if (typeof match === "number") result.match = match;
    return result;
  }
}
