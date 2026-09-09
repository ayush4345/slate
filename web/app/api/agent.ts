import {
  embeddedChat,
  embeddedHealth,
  embeddedNewSession,
  embeddedSettle,
} from "../../lib/agent-runtime";

/**
 * On Vercel (or AGENT_MODE=embedded), run consumer+provider in-process so
 * OPENAI_API_KEY from Vercel env powers the dashboard. Locally, default to
 * proxying a separate consumer unless AGENT_MODE=embedded.
 */
function useEmbedded(): boolean {
  if (process.env.AGENT_MODE === "embedded") return true;
  if (process.env.AGENT_MODE === "proxy") return false;
  return Boolean(process.env.VERCEL);
}

const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:4022";

export async function proxy(path: string, init?: RequestInit): Promise<Response> {
  if (useEmbedded()) {
    if (path === "/health" && (!init?.method || init.method === "GET")) {
      return embeddedHealth();
    }
    if (path === "/chat" && init?.method === "POST") {
      return embeddedChat(typeof init.body === "string" ? init.body : "{}");
    }
    if (path === "/settle" && init?.method === "POST") {
      return embeddedSettle();
    }
    if (path === "/session/new" && init?.method === "POST") {
      return embeddedNewSession();
    }
    return Response.json({ ok: false, error: `unknown embedded path ${path}` }, { status: 404 });
  }

  try {
    const upstream = await fetch(`${AGENT_URL}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return Response.json(
      {
        ok: false,
        error: `agent unreachable at ${AGENT_URL}. Start it with: pnpm --filter @avtar/agent-consumer serve`,
      },
      { status: 503 },
    );
  }
}
