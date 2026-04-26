import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(
  request: Request,
  { params }: { params: { id: string } },
) {
  const id = encodeURIComponent(params.id);
  return proxyBackendRequest(request, `/api/pay/contacts/${id}`);
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  const id = encodeURIComponent(params.id);
  return proxyBackendRequest(request, `/api/pay/contacts/${id}`);
}
