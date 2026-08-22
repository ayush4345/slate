"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Health {
  ok?: boolean;
  provider?: { name?: string; url?: string };
  providerTerms?: { rate?: string; payTo?: string; asset?: string; network?: string } | null;
  brain?: string;
  settlementMode?: string;
  settlementNote?: string;
  payment?: Payment;
  error?: string;
}

interface Payment {
  turnCalls?: number;
  sessionCalls?: number;
  sessionBillable?: string;
  tokenSymbol?: string;
}

interface Turn {
  id: number;
  question: string;
  answer: string;
  calls?: number;
  pending?: boolean;
  failed?: boolean;
}

interface SettleStep {
  kind: string;
  label: string;
  detail?: string;
}

interface Settlement {
  ok?: boolean;
  settled?: boolean;
  reason?: string;
  error?: string;
  steps?: SettleStep[];
  settleTx?: string;
  settlementAmount?: string;
  tokenSymbol?: string;
}

type Busy = null | "chat" | "settle" | "session";

/** The agent reports billable amounts in the token's base units. */
function formatUnits6(raw: string | undefined): string {
  if (raw === undefined) return "0";
  let value: bigint;
  try {
    value = BigInt(raw);
  } catch {
    return raw;
  }
  const whole = value / 1_000_000n;
  const frac = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as T;
}

/**
 * Drives the consumer agent: ask it something, watch the meter move, then
 * settle. Every call here goes through this app's own /api routes, which proxy
 * to the agent process.
 */
export default function AgentConsole() {
  const [health, setHealth] = useState<Health | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const nextId = useRef(1);

  const refreshHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setHealth((await res.json()) as Health);
    } catch {
      setHealth({ error: "could not reach this app's own API route" });
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const ask = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const message = question.trim();
      if (!message || busy) return;

      const id = nextId.current++;
      setQuestion("");
      setBusy("chat");
      setTurns((prev) => [...prev, { id, question: message, answer: "", pending: true }]);

      const data = await post<{ ok?: boolean; answer?: string; error?: string; payment?: Payment }>(
        "/api/chat",
        { message },
      );

      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                pending: false,
                failed: !data.ok,
                answer: data.ok ? (data.answer ?? "") : (data.error ?? "the agent did not answer"),
                ...(data.payment?.turnCalls !== undefined ? { calls: data.payment.turnCalls } : {}),
              }
            : turn,
        ),
      );
      setBusy(null);
      void refreshHealth();
    },
    [busy, question, refreshHealth],
  );

  const settle = useCallback(async () => {
    if (busy) return;
    setBusy("settle");
    setSettlement(await post<Settlement>("/api/settle"));
    setBusy(null);
    void refreshHealth();
  }, [busy, refreshHealth]);

  const newSession = useCallback(async () => {
    if (busy) return;
    setBusy("session");
    await post("/api/session");
    setTurns([]);
    setSettlement(null);
    setBusy(null);
    void refreshHealth();
  }, [busy, refreshHealth]);

  const reachable = health?.ok !== undefined || health?.payment !== undefined;
  const metered = health?.payment;

  return (
    <section className="panel panel--wide console" aria-labelledby="p-agent">
      <h2 id="p-agent" className="panel__head">
        Agent session
      </h2>

      {!reachable ? (
        <p className="panel__empty">{health?.error ?? "Looking for the consumer agent…"}</p>
      ) : (
        <>
          <dl className="console__strip">
            <div>
              <dt>Provider</dt>
              <dd>{health?.provider?.url ?? "unknown"}</dd>
            </div>
            <div>
              <dt>Rate</dt>
              <dd>
                {health?.providerTerms?.rate
                  ? `${health.providerTerms.rate} per call`
                  : "not advertised yet"}
              </dd>
            </div>
            <div>
              <dt>Brain</dt>
              <dd>{health?.brain === "openai" ? "OpenAI" : "stub router"}</dd>
            </div>
            <div>
              <dt>Settlement</dt>
              <dd>{health?.settlementMode === "base" ? "on Base" : "mock"}</dd>
            </div>
            <div>
              <dt>Metered</dt>
              <dd className="is-num">
                {metered?.sessionCalls ?? 0} calls · {formatUnits6(metered?.sessionBillable)}{" "}
                {metered?.tokenSymbol ?? "USDC"}
              </dd>
            </div>
          </dl>

          <ol className="console__log">
            {turns.length === 0 && (
              <li className="console__hint">
                Ask for the weather, a crypto price, or a translation. Each answer costs one
                metered call.
              </li>
            )}
            {turns.map((turn) => (
              <li key={turn.id}>
                <p className="console__q">{turn.question}</p>
                <p className={turn.failed ? "console__a is-failed" : "console__a"}>
                  {turn.pending ? "…" : turn.answer}
                </p>
                {turn.calls !== undefined && (
                  <p className="console__meta">{turn.calls} call(s) metered</p>
                )}
              </li>
            ))}
          </ol>

          <form className="console__ask" onSubmit={ask}>
            <label className="sr-only" htmlFor="ask">
              Ask the agent
            </label>
            <input
              id="ask"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="What is the weather in Lisbon?"
              disabled={busy !== null}
            />
            <button className="btn btn--solid" type="submit" disabled={busy !== null}>
              {busy === "chat" ? "Asking…" : "Ask"}
            </button>
            <button className="btn btn--line" type="button" onClick={settle} disabled={busy !== null}>
              {busy === "settle" ? "Settling…" : "Settle channel"}
            </button>
            <button
              className="btn btn--line"
              type="button"
              onClick={newSession}
              disabled={busy !== null}
            >
              New session
            </button>
          </form>

          {settlement && (
            <div className="console__settle">
              <p className="console__meta">
                {settlement.settled
                  ? `Settled ${formatUnits6(settlement.settlementAmount)} ${settlement.tokenSymbol ?? "USDC"}`
                  : (settlement.reason ?? settlement.error ?? "Settlement did not complete")}
              </p>
              {settlement.steps && (
                <ol className="console__steps">
                  {settlement.steps.map((step, i) => (
                    <li key={`${step.kind}-${i}`} data-kind={step.kind}>
                      <b>{step.label}</b>
                      {step.detail && <span>{step.detail}</span>}
                    </li>
                  ))}
                </ol>
              )}
              {settlement.settleTx && <p className="console__tx">{settlement.settleTx}</p>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
