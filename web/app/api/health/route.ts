import { proxy } from "../agent";

export const dynamic = "force-dynamic";

export async function GET() {
  return proxy("/health");
}
