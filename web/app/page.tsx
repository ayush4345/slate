import Guarantees from "../components/Guarantees";
import Hero from "../components/Hero";
import Mechanism from "../components/Mechanism";
import Nav from "../components/Nav";
import Quickstart from "../components/Quickstart";
import SignalLedger from "../components/SignalLedger";
import SiteFooter from "../components/SiteFooter";

export default function HomePage() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Mechanism />
        <SignalLedger />
        <Guarantees />
        <Quickstart />
      </main>
      <SiteFooter />
    </>
  );
}
