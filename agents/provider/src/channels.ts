import { ProviderMeter } from "@slate-base/agent-core";

export interface OpenChannelInput {
  channelId: bigint;
  rate: bigint;
  escrow: bigint;
}

export class ChannelRegistry {
  readonly #meters = new Map<string, ProviderMeter>();

  open(input: OpenChannelInput): void {
    const key = input.channelId.toString();
    if (this.#meters.has(key)) return;
    this.#meters.set(key, new ProviderMeter(input.channelId, input.rate, input.escrow));
  }

  get(channelId: string): ProviderMeter | undefined {
    return this.#meters.get(channelId);
  }

  has(channelId: string): boolean {
    return this.#meters.has(channelId);
  }

  close(channelId: string): void {
    this.#meters.delete(channelId);
  }
}
