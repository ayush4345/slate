import { formatUnits6, shortAddress, type ChannelView } from "../../app/dashboard/data";

const SIGNALS = [
  "channel_id",
  "rate_commitment",
  "escrow_amount",
  "settlement_amount",
  "nullifier",
  "consumer_pubkey_x",
  "consumer_pubkey_y",
  "depositor_hi",
  "depositor_lo",
  "provider_hi",
  "provider_lo",
  "token_hi",
  "token_lo",
];

/** Which signals the chain already fixes, and which the proof still has to
 *  supply. The unknown ones are the point: they are what settlement decides. */
const KNOWN_AT_OPEN = new Set([0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12]);

export default function ChannelSummary({ view }: { view: ChannelView }) {
  const { channel, deployment } = view;

  return (
    <div className="dash__grid">
      <section className="panel" aria-labelledby="p-terms">
        <h2 id="p-terms" className="panel__head">
          Channel terms
        </h2>
        {channel ? (
          <dl className="rows">
            <div>
              <dt>Channel</dt>
              <dd className="is-num">{view.channelId.toString()}</dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>
                <span className={channel.open ? "pill pill--open" : "pill"}>
                  {channel.open ? "open" : "closed"}
                </span>
              </dd>
            </div>
            <div>
              <dt>Depositor</dt>
              <dd className="is-num" title={channel.depositor}>
                {shortAddress(channel.depositor)}
              </dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd className="is-num" title={channel.provider}>
                {shortAddress(channel.provider)}
              </dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd className="is-num" title={channel.token}>
                {shortAddress(channel.token)}
              </dd>
            </div>
            <div>
              <dt>Rate commitment</dt>
              <dd className="is-num">0x{channel.rateCommitment.toString(16)}</dd>
            </div>
          </dl>
        ) : (
          <p className="panel__empty">
            No channel registered under id {view.channelId.toString()}. Open one with{" "}
            <code>client.openChannel(...)</code>, then reload.
          </p>
        )}
      </section>

      <section className="panel" aria-labelledby="p-escrow">
        <h2 id="p-escrow" className="panel__head">
          Escrow
        </h2>
        <p className="figure">
          <span className="figure__n">{formatUnits6(view.escrowBalance)}</span>
          <span className="figure__u">USDC locked</span>
        </p>
        <p className="panel__note">
          This is the ceiling. A settlement larger than the balance reverts, so the
          worst case for the depositor is the amount they chose to lock.
        </p>
      </section>

      <section className="panel" aria-labelledby="p-deploy">
        <h2 id="p-deploy" className="panel__head">
          Deployment
        </h2>
        <dl className="rows">
          <div>
            <dt>Chain</dt>
            <dd className="is-num">
              {deployment.chainName} ({deployment.chainId})
            </dd>
          </div>
          <div>
            <dt>Escrow</dt>
            <dd className="is-num" title={deployment.escrow}>
              {shortAddress(deployment.escrow)}
            </dd>
          </div>
          <div>
            <dt>Registry</dt>
            <dd className="is-num" title={deployment.registry}>
              {shortAddress(deployment.registry)}
            </dd>
          </div>
          <div>
            <dt>Verifier</dt>
            <dd className="is-num" title={deployment.verifier}>
              {shortAddress(deployment.verifier)}
            </dd>
          </div>
        </dl>
        <p className="panel__note">
          Verifier and registry are read back from the escrow itself, not from
          configuration, so a misconfigured page shows the mismatch.
        </p>
      </section>

      <section className="panel panel--wide" aria-labelledby="p-signals">
        <h2 id="p-signals" className="panel__head">
          Settlement inputs
        </h2>
        <p className="panel__note">
          Eleven of the thirteen signals are already fixed by the channel. Only the
          amount owed and its nullifier come from the proof.
        </p>
        <ol className="signals">
          {SIGNALS.map((name, i) => (
            <li key={name} data-pending={KNOWN_AT_OPEN.has(i) ? undefined : ""}>
              <span className="signals__i">{i}</span>
              <span className="signals__n">{name}</span>
              <span className="signals__s">{KNOWN_AT_OPEN.has(i) ? "fixed" : "from proof"}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
