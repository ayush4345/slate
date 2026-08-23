export default function Guarantees() {
  return (
      <section className="band" id="guarantees">
        <div className="shell">
          <div className="band__head">
            <h2>What stops the obvious attacks</h2>
            <p className="band__lead">
              Settlement is permissionless: anyone can submit the transaction. That
              is only safe because none of the parties are read from the caller.
            </p>
          </div>
    
          <dl className="guards">
            <div>
              <dt>Nobody can redirect the payout</dt>
              <dd>
                <code>settle</code> takes no addresses. The escrow asks the registry
                who the parties are, so submitting someone else's proof pays them,
                not you.
              </dd>
            </div>
            <div>
              <dt>A proof settles once</dt>
              <dd>
                The nullifier is marked spent before any transfer. Replaying the
                same proof reverts with <code>NullifierAlreadySpent</code>.
              </dd>
            </div>
            <div>
              <dt>The escrow is the ceiling</dt>
              <dd>
                A settlement larger than the deposited balance reverts. The worst
                case for a consumer is losing what they escrowed, which they chose.
              </dd>
            </div>
            <div>
              <dt>The verifier cannot be swapped</dt>
              <dd>
                Verifier and registry are set in the constructor and immutable.
                There is no initializer to front-run and no upgrade path to abuse.
              </dd>
            </div>
            <div>
              <dt>Token whitelist is owner-only</dt>
              <dd>
                The escrow settles in whitelisted ERC-20s only, so a fake token
                cannot be introduced by whoever opens a channel first.
              </dd>
            </div>
          </dl>
        </div>
      </section>
  );
}
