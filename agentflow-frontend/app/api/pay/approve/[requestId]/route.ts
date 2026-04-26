import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { requestId: string } },
) {
  const id = encodeURIComponent(params.requestId);
  return proxyBackendRequest(request, `/api/pay/approve/${id}`);
}
