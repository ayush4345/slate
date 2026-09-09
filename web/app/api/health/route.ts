import { proxy } from "../agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return proxy("/health");
}
