import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { slug: string } },
) {
  return proxyBackendRequest(
    request,
    `/api/agent-store/agent/${encodeURIComponent(params.slug)}/stats`,
  );
}
