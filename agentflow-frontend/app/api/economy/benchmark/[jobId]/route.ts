import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  return proxyBackendRequest(
    request,
    `/api/economy/benchmark/${encodeURIComponent(jobId)}`,
  );
}
