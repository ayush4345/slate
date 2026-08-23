/** The thirteen public signals, in circuit order. A pair is one fact split
 *  across two field elements, so it is written once and spans both rows. */
const SIGNALS: { name: string; fixes?: string; pair?: boolean }[] = [
  { name: "channel_id", fixes: "Which registered channel this settles" },
  { name: "rate_commitment", fixes: "The price both sides agreed to, hidden" },
  { name: "escrow_amount", fixes: "The ceiling the escrow will pay" },
  { name: "settlement_amount", fixes: "What the provider is owed" },
  { name: "nullifier", fixes: "Spent on use, so no proof settles twice" },
  { name: "consumer_pubkey", fixes: "Who signed the metered vouchers" },
  { name: "depositor", fixes: "Who gets the refund" },
  { name: "provider", fixes: "Who gets paid" },
  { name: "token", fixes: "Which ERC-20 moves" },
];

export default function SignalLedger() {
  return (
    <section className="band" id="onchain">
      <div className="shell">
        <div className="band__head">
          <h2>What the chain actually sees</h2>
          <p className="band__lead">
            Field elements, in this order. The amount owed is in there. How
            many calls produced it is not, and neither is what any of them were for.
          </p>
        </div>

        <div className="ledger-wrap">
          <table className="ledger">
            <caption>
              Public signals of the settlement circuit, as passed to{" "}
              <code>verifyProof</code>.
            </caption>
            <thead>
              <tr>
                <th scope="col">Index</th>
                <th scope="col">Signal</th>
                <th scope="col">What it fixes</th>
              </tr>
            </thead>
            <tbody>
              {SIGNALS.map((signal, i) => (
                <tr key={signal.name} className={signal.fixes ? undefined : "is-pair"}>
                  <th scope="row">{i}</th>
                  <td>{signal.name}</td>
                  {signal.fixes && (
                    <td rowSpan={signal.pair ? 2 : 1}>{signal.fixes}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* <div className="offchain">
          <h3>Addresses are split in half on purpose</h3>
          <p>
            BN254 field elements cannot hold a full address, so each one enters the
            circuit as a high and low pair. Solidity and TypeScript pack them
            identically and a shared test vector pins both, so a mismatch fails in CI
            rather than at settlement.
          </p>
        </div> */}
      </div>
    </section>
  );
}
