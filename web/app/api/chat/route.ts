import { proxy } from "../agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return proxy("/chat", { method: "POST", body: await request.text() });
}
