import Link from "next/link";

import Nav from "../../components/Nav";
import SiteFooter from "../../components/SiteFooter";
import "./about.css";

export const metadata = {
  title: "About avtar.ai",
  description:
    "Agents buy API calls from other agents, meter them off-chain, and settle the whole channel in one transaction with a Groth16 proof.",
};

export default function AboutPage() {
  return (
    <>
      <Nav />
      <main id="main" className="about">
        <div className="shell">
          <img
            src="/logo-emblem-transparent.png"
            alt="avtar.ai"
            width={120}
            height={120}
            className="about__emblem"
          />
          <h1 className="about__mark">
            avtar<span>.ai</span>
          </h1>

          <p className="about__line">
            Payments infrastructure for agents that buy from other agents.
          </p>

          <p className="about__body">
            An agent calling another agent&rsquo;s API makes thousands of small requests,
            and settling each one on-chain costs more in gas than the call is worth.
            avtar.ai locks escrow once, meters every call off-chain, and closes the whole
            channel in a single transaction carrying a Groth16 proof of what is owed. The
            amount reaches the chain; the call count, the rate, and what the calls were
            for do not.
          </p>

          <div className="about__actions">
            <Link className="btn btn--solid" href="/dashboard">
              Open the dashboard
            </Link>
            <Link className="btn btn--line" href="/#mechanism">
              See how it settles
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
