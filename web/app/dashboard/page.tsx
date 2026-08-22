import Nav from "../../components/Nav";
import ChannelSummary from "../../components/dashboard/ChannelSummary";
import { loadChannel } from "./data";
import "./dashboard.css";

// Chain state changes between requests; never serve a cached channel.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Channel dashboard — Slate on Base",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const { channel } = await searchParams;
  const parsed = channel && /^\d+$/.test(channel) ? BigInt(channel) : 42n;
  const view = await loadChannel(parsed);

  return (
    <>
      <Nav variant="app" />
      <main id="main" className="dash">
        <div className="shell">
          <div className="dash__head">
            <div>
              <h1>Channel {view.channelId.toString()}</h1>
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
                defaultValue={view.channelId.toString()}
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

          <ChannelSummary view={view} />
        </div>
      </main>
    </>
  );
}
