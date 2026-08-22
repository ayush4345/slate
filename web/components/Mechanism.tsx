export default function Mechanism() {
  return (
      <section className="band band--ink" id="mechanism">
        <div className="shell">
          <div className="band__head">
            <h2>Three moves, and only one of them touches the chain</h2>
            <p className="band__lead">
              The escrow and the registry are set before any calls happen, so the
              proof has terms to be checked against. Everything between is HTTP.
            </p>
          </div>
    
          <ol className="steps">
            <li>
              <h3>Open the channel</h3>
              <p>
                The consumer approves USDC, registers the channel terms (rate,
                payee, token, public key), and deposits escrow. The registry pins
                those terms; the escrow holds the money and caps the payout.
              </p>
            </li>
            <li>
              <h3>Meter over x402</h3>
              <p>
                The provider answers the first request with a <code>402</code>
                quoting its rate. Every call after that is metered locally against
                the escrowed balance. No transaction, no signature per call.
              </p>
            </li>
            <li>
              <h3>Prove and settle</h3>
              <p>
                One call to <code>settle(a, b, c, publicSignals)</code>. The
                verifier checks the proof, the registry confirms the parties, a
                nullifier stops a replay, and the escrow pays the provider and
                refunds the rest.
              </p>
            </li>
          </ol>
    
          <div className="diagram-wrap">
          <svg className="diagram" viewBox="0 0 800 232" role="img"
               aria-label="Consumer and provider exchange many metered calls off chain, then one settlement transaction reaches the escrow on Base.">
            <rect className="box" x="1" y="16" width="188" height="52" rx="4"/>
            <text className="is-strong" x="16" y="40">consumer agent</text>
            <text x="16" y="56">escrow: 10.000000 USDC</text>
    
            <rect className="box" x="611" y="16" width="188" height="52" rx="4"/>
            <text className="is-strong" x="626" y="40">provider agent</text>
            <text x="626" y="56">rate: 0.0001 / call</text>
    
            <path className="flow flow--meter" d="M195 34 H605" strokeDasharray="3 5"/>
            <path className="flow flow--meter" d="M597 28 L605 34 L597 40"/>
            <path className="flow flow--meter" d="M605 56 H195" strokeDasharray="3 5"/>
            <path className="flow flow--meter" d="M203 50 L195 56 L203 62"/>
            <text x="330" y="24">request, 402, pay, repeat</text>
            <text x="330" y="80">n calls, none on chain</text>
    
            <path className="flow" d="M95 68 V150" strokeDasharray="3 5"/>
            <path className="flow flow--settle" d="M95 150 H400"/>
            <path className="flow flow--settle" d="M392 144 L400 150 L392 156"/>
            <text x="150" y="142">one transaction</text>
    
            <rect className="box" x="400" y="124" width="399" height="92" rx="4"/>
            <text className="is-strong" x="416" y="148">Base</text>
            <text x="416" y="170">Groth16Verifier.verifyProof(...)   →  true</text>
            <text x="416" y="188">SlateAgentRegistry.validateForSettlement(...)</text>
            <text x="416" y="206">SlateEscrow  →  pay provider, refund depositor</text>
          </svg>
          </div>
        </div>
      </section>
  );
}
