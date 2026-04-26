import { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 900;

export async function GET(request: NextRequest) {
  return proxyBackendRequest(request, "/api/economy");
}

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, "/api/economy/benchmark");
}
