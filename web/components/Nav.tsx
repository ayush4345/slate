import Link from "next/link";

/** Section links only exist on the landing page, so the dashboard gets a
 *  shorter bar rather than links that scroll to nothing. */
export default function Nav({ variant = "site" }: { variant?: "site" | "app" }) {
  return (
    <header className="nav">
      <div className="shell nav__row">
        <Link className="wordmark" href="/">
          <b>avtar</b>
          <span>.ai</span>
        </Link>
        <nav className="nav__links" aria-label="Sections">
          {variant === "site" ? (
            <>
              <a href="#mechanism">Mechanism</a>
              <a href="#onchain" data-secondary>
                On chain
              </a>
              <a href="#guarantees" data-secondary>
                Guarantees
              </a>
              <Link href="/dashboard">Dashboard</Link>
            </>
          ) : (
            <>
              <Link href="/">Overview</Link>
              <a href="https://github.com/ayush4345/slate-base">GitHub</a>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
