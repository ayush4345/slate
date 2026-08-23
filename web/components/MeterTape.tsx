"use client";

import { useEffect, useState } from "react";

const ROUTES = [
  "POST /v1/search",
  "POST /v1/embed",
  "POST /v1/rerank",
  "POST /v1/extract",
  "POST /v1/summarize",
  "GET  /v1/docs/8821",
  "GET  /v1/usage",
];

const RATE = 0.0001;
const MAX_ROWS = 6;

/** The rows the server renders. The tape reads correctly before hydration and
 *  before any interval has fired. */
const SEED = [
  "POST /v1/search",
  "POST /v1/embed",
  "GET  /v1/docs/8821",
  "POST /v1/rerank",
  "POST /v1/search",
  "POST /v1/extract",
];

export default function MeterTape() {
  const [rows, setRows] = useState<string[]>(SEED);
  const [calls, setCalls] = useState(SEED.length);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer: number;
    // Uneven gaps: real traffic does not arrive on a metronome.
    const tick = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden) {
          const route = ROUTES[Math.floor(Math.random() * ROUTES.length)]!;
          setRows((prev) => [route, ...prev].slice(0, MAX_ROWS));
          setCalls((n) => n + 1);
        }
        tick();
      }, 900 + Math.random() * 1400);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <figure className="tape" aria-labelledby="tape-cap">
      <figcaption id="tape-cap" className="tape__head">
        <span>
          channel <b>0x2a</b>
        </span>
        <span>
          rate <b>{RATE.toFixed(4)} USDC</b> / call
        </span>
      </figcaption>

      <ul className="tape__log">
        {rows.map((route, i) => (
          <li key={`${calls}-${i}`} data-new={i === 0 && calls > SEED.length ? "" : undefined}>
            <span>{route}</span>
            <span>200</span>
            <span>{RATE.toFixed(6)}</span>
          </li>
        ))}
      </ul>

      <hr className="tape__rule" />

      <p className="tape__total">
        <span>{calls} calls metered</span>
        <b>{(calls * RATE).toFixed(6)} USDC</b>
      </p>

      <p className="tape__settle">
        <span>settle()</span>
        <b>{calls > SEED.length ? "still 1 transaction" : "1 transaction, whenever you close"}</b>
      </p>
    </figure>
  );
}
