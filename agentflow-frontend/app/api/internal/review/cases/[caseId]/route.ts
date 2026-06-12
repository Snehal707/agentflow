import { proxyBackendRequest } from "@/lib/backendProxy";
import { isInternalMemoryMonitorEnabled } from "@/lib/internalAccess";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: { caseId: string } },
) {
  if (!isInternalMemoryMonitorEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const caseId = encodeURIComponent(context.params.caseId);
  return proxyBackendRequest(request, `/api/internal/review/cases/${caseId}`);
}
