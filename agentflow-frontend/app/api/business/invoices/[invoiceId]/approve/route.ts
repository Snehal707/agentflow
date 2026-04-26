import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: { invoiceId: string } },
) {
  const invoiceId = encodeURIComponent(context.params.invoiceId);
  return proxyBackendRequest(request, `/api/business/invoices/${invoiceId}/approve`);
}
