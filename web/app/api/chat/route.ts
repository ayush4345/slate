import { proxy } from "../agent";

export async function POST(request: Request) {
  return proxy("/chat", { method: "POST", body: await request.text() });
}
