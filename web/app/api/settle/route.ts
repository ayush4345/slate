import { proxy } from "../agent";

export async function POST() {
  return proxy("/settle", { method: "POST", body: "{}" });
}
