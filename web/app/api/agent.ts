/**
 * The consumer agent is a separate process, so the browser never talks to it
 * directly: these routes proxy, which keeps the agent's port and any future
 * credentials on the server side and sidesteps CORS.
 */
const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:4022";

export async function proxy(path: string, init?: RequestInit): Promise<Response> {
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
    // A stopped agent is the normal case during development, so say which
    // address failed rather than surfacing a bare fetch error.
    return Response.json(
      { ok: false, error: `agent unreachable at ${AGENT_URL}. Start it with: pnpm --filter @avtar/agent-consumer serve` },
      { status: 503 },
    );
  }
}
