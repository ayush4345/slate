import Nav from "../../components/Nav";
import AgentConsole from "../../components/dashboard/AgentConsole";
import ChannelSummary from "../../components/dashboard/ChannelSummary";
import { proxy } from "../api/agent";
import { loadChannel, shortId } from "./data";
import "./dashboard.css";

// Chain state changes between requests; never serve a cached channel.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Channel dashboard — Slate on Base",
};

/** The channel the consumer agent has open, or 0 when there is none. */
async function liveChannelId(): Promise<bigint> {
  try {
    const response = await proxy("/health");
    const body = (await response.json()) as { channel?: { channelId?: string } };
    const id = body.channel?.channelId;
    return id && /^\d+$/.test(id) ? BigInt(id) : 0n;
  } catch {
    return 0n;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const { channel } = await searchParams;
  // No id in the URL means "whatever the agent is metering right now". Channel
  // ids are random field elements, so there is no sensible constant to guess.
  const parsed = channel && /^\d+$/.test(channel) ? BigInt(channel) : await liveChannelId();
  const view = await loadChannel(parsed);

  return (
    <>
      <Nav variant="app" />
      <main id="main" className="dash">
        <div className="shell">
          <div className="dash__head">
            <div>
              <h1 title={view.channelId.toString()}>
                {view.channelId === 0n ? "No channel selected" : `Channel ${shortId(view.channelId)}`}
              </h1>
              <p className="dash__sub">
                Read straight from the escrow and the registry. Nothing here needs a
                key: the page only reads.
              </p>
            </div>
            <form className="dash__pick" action="/dashboard">
              <label htmlFor="channel">Channel id</label>
              <input
                id="channel"
                name="channel"
                inputMode="numeric"
                pattern="\d+"
                defaultValue={view.channelId === 0n ? "" : view.channelId.toString()}
              />
              <button className="btn btn--line" type="submit">
                Load channel
              </button>
            </form>
          </div>

          {!view.live && (
            <p className="dash__banner" role="status">
              <b>Sample data.</b> {view.note}
            </p>
          )}

          <div className="dash__grid">
            <AgentConsole explorer={view.deployment.explorer} />
          </div>

          <ChannelSummary view={view} />
        </div>
      </main>
    </>
  );
}
