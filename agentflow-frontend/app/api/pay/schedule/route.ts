import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const u = new URL(request.url);
  return proxyBackendRequest(request, `/api/pay/schedule${u.search}`);
}

export async function POST(request: Request) {
  return proxyBackendRequest(request, "/api/pay/schedule");
}
