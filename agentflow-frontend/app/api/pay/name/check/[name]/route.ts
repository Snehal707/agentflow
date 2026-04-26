import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: { name: string } },
) {
  const name = encodeURIComponent(params.name ?? "");
  return proxyBackendRequest(request, `/api/pay/name/check/${name}`);
}
