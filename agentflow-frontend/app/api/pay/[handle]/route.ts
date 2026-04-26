import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { handle: string } },
) {
  return proxyBackendRequest(request, `/api/pay/${params.handle}`);
}

export async function POST(
  request: Request,
  { params }: { params: { handle: string } },
) {
  return proxyBackendRequest(request, `/api/pay/${params.handle}/execute`);
}
