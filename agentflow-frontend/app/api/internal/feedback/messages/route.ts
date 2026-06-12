import { proxyBackendRequest } from "@/lib/backendProxy";
import { isInternalMemoryMonitorEnabled } from "@/lib/internalAccess";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isInternalMemoryMonitorEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return proxyBackendRequest(request, "/api/internal/feedback/messages");
}
