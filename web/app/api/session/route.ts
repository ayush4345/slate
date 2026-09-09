import { proxy } from "../agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Settle-then-reopen is the agent's job; this only asks for a fresh one. */
export async function POST() {
  return proxy("/session/new", { method: "POST", body: "{}" });
}
