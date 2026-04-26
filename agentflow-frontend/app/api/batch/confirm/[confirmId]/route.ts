import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ confirmId: string }> },
) {
  const { confirmId } = await params;
  return proxyBackendRequest(
    request,
    `/api/batch/confirm/${encodeURIComponent(confirmId)}`,
  );
}
