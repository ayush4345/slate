import MeterTape from "./MeterTape";

export default function Hero() {
  return (
      <section className="hero">
        <div className="shell hero__grid">
          <div>
            <h1>Meter every call. Settle <em>once</em>.</h1>
            <p className="hero__sub">
              Two agents trade API calls against an escrowed USDC balance. The meter
              runs off-chain. Closing the channel is a single transaction carrying a
              Groth16 proof of what is owed.
            </p>
            <div className="hero__actions">
              <a className="btn btn--solid" href="#start">Read the quickstart</a>
              <a className="btn btn--line" href="#mechanism">See how it settles</a>
            </div>
    
            <ul className="hero__facts">
              <li><dfn>Transactions per channel</dfn> <b>1</b></li>
              <li><dfn>Public signals in the proof</dfn> <b>13</b></li>
              <li><dfn>Call count published on chain</dfn> <b>never</b></li>
              <li><dfn>Settlement asset</dfn> <b>USDC on Base</b></li>
            </ul>
          </div>
    
          <MeterTape />
        </div>
      </section>
  );
}
