"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
const ESCROW = 10;
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

type Phase = "metering" | "settling" | "settled";

/** What settling actually does, in order. Shown one line at a time. */
const STEPS = [
  "building the 13-signal circuit input",
  "generating Groth16 proof",
  "verifyProof(a, b, c, signals) → true",
  "nullifier spent · settlement ≤ escrow",
  "transfer → provider · refund → depositor",
];

const usd = (n: number) => n.toFixed(6);

export default function MeterTape() {
  const [rows, setRows] = useState<string[]>(SEED);
  const [calls, setCalls] = useState(SEED.length);
  const [phase, setPhase] = useState<Phase>("metering");
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };

  // Metering runs until the reader settles. Uneven gaps: real traffic does not
  // arrive on a metronome.
  useEffect(() => {
    if (phase !== "metering") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let timer: number;
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
  }, [phase]);

  const settle = useCallback(() => {
    setPhase("settling");
    setStep(0);

    // Reduced motion gets the outcome, not the sequence.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(STEPS.length);
      setPhase("settled");
      return;
    }

    STEPS.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setStep(i + 1), 700 * (i + 1)));
    });
    timers.current.push(
      window.setTimeout(() => setPhase("settled"), 700 * (STEPS.length + 1)),
    );
  }, []);

  const reset = useCallback(() => {
    clearTimers();
    setRows(SEED);
    setCalls(SEED.length);
    setStep(0);
    setPhase("metering");
  }, []);

  useEffect(() => clearTimers, []);

  const owed = calls * RATE;

  return (
    <figure className="tape" aria-labelledby="tape-cap">
      <figcaption id="tape-cap" className="tape__head">
        <span>
          channel <b>0x2a</b>
        </span>
        <span>
          escrow <b>{usd(ESCROW)} USDC</b>
        </span>
      </figcaption>

      <ul className="tape__log">
        {rows.map((route, i) => (
          <li key={`${calls}-${i}`} data-new={i === 0 && calls > SEED.length ? "" : undefined}>
            <span>{route}</span>
            <span>200</span>
            <span>{usd(RATE)}</span>
          </li>
        ))}
      </ul>

      <hr className="tape__rule" />

      <p className="tape__total">
        <span>{calls} calls metered</span>
        <b>{usd(owed)} USDC</b>
      </p>

      {phase === "metering" && (
        <div className="tape__settle">
          <span>none of it on chain yet</span>
          <button type="button" className="tape__btn" onClick={settle}>
            settle()
          </button>
        </div>
      )}

      {phase !== "metering" && (
        <div className="tape__steps" aria-live="polite">
          <ol>
            {STEPS.slice(0, step).map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ol>

          {phase === "settled" && (
            <>
              <p className="tape__pay">
                <span>provider paid</span>
                <b>{usd(owed)} USDC</b>
              </p>
              <p className="tape__pay">
                <span>depositor refunded</span>
                <b>{usd(ESCROW - owed)} USDC</b>
              </p>
              <div className="tape__settle">
                <span>
                  {calls} calls · <b>1 transaction</b>
                </span>
                <button type="button" className="tape__btn" onClick={reset}>
                  meter again
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </figure>
  );
}
