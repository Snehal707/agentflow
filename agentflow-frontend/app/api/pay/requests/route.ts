import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return proxyBackendRequest(request, "/api/pay/requests");
}
