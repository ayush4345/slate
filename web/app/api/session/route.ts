import { proxy } from "../agent";

/** Settle-then-reopen is the agent's job; this only asks for a fresh one. */
export async function POST() {
  return proxy("/session/new", { method: "POST", body: "{}" });
}
