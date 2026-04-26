import { NextResponse } from "next/server";

/** Fast probe for dev/ops — avoids compiling the full `/` shell on first request. */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "agentflow-frontend",
    ts: new Date().toISOString(),
  });
}
