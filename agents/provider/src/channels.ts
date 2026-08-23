import { ProviderMeter } from "@slate-base/agent-core";

export interface OpenChannelInput {
  channelId: bigint;
  rate: bigint;
  escrow: bigint;
  callToken: string;
}

export class ChannelRegistry {
  readonly #channels = new Map<string, { meter: ProviderMeter; callToken: string }>();

  open(input: OpenChannelInput): void {
    const key = input.channelId.toString();
    if (this.#channels.has(key)) return;
    this.#channels.set(key, {
      meter: new ProviderMeter(input.channelId, input.rate, input.escrow),
      callToken: input.callToken,
    });
  }

  get(channelId: string): ProviderMeter | undefined {
    return this.#channels.get(channelId)?.meter;
  }

  isAuthorized(channelId: string, callToken: string | undefined): boolean {
    return callToken !== undefined && this.#channels.get(channelId)?.callToken === callToken;
  }

  has(channelId: string): boolean {
    return this.#channels.has(channelId);
  }

  close(channelId: string): void {
    this.#channels.delete(channelId);
  }
}
