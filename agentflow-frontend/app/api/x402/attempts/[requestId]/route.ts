import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { requestId: string } },
) {
  const requestId = encodeURIComponent(params.requestId);
  return proxyBackendRequest(request, `/api/x402/attempts/${requestId}`);
}
