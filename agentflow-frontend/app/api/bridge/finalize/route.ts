import { NextResponse } from "next/server";
import { proxyBackendRequest } from "@/lib/backendProxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UPSTREAM_FETCH_MS = 55_000;

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getBridgeAgentUrl(): string {
  return normalizeBaseUrl(
    process.env.BRIDGE_AGENT_URL ||
      process.env.NEXT_PUBLIC_BRIDGE_AGENT_URL ||
      "http://127.0.0.1:3021",
  );
}

export async function POST(request: Request) {
  if (request.headers.get("x-agentflow-bridge-rail") !== "eoa") {
    return proxyBackendRequest(request, "/api/bridge/finalize");
  }

  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const paymentSignature = request.headers.get("payment-signature");
  const contentType = request.headers.get("content-type");
  const requestId = request.headers.get("x-agentflow-request-id");

  if (authorization) {
    headers.set("authorization", authorization);
  }
  if (paymentSignature) {
    headers.set("payment-signature", paymentSignature);
  }
  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (requestId) {
    headers.set("x-agentflow-request-id", requestId);
  }

  const ctrl = new AbortController();
  const kill = setTimeout(() => ctrl.abort(), UPSTREAM_FETCH_MS);

  try {
    const upstream = await fetch(`${getBridgeAgentUrl()}/bridge/finalize`, {
      method: "POST",
      headers,
      body: await request.text(),
      cache: "no-store",
      signal: ctrl.signal,
    });

    const responseHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    const paymentRequired = upstream.headers.get("PAYMENT-REQUIRED");
    const paymentResponse = upstream.headers.get("PAYMENT-RESPONSE");

    if (upstreamContentType) responseHeaders.set("Content-Type", upstreamContentType);
    if (paymentRequired) responseHeaders.set("PAYMENT-REQUIRED", paymentRequired);
    if (paymentResponse) responseHeaders.set("PAYMENT-RESPONSE", paymentResponse);
    responseHeaders.set("Cache-Control", "no-store");

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.warn("[bridge/finalize proxy]", error);
    return NextResponse.json({ error: "Bridge finalize proxy failed" }, { status: 502 });
  } finally {
    clearTimeout(kill);
  }
}
