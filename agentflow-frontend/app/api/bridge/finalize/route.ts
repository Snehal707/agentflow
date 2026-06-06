import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  const headers = new Headers();

  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (
      lower === "content-type" ||
      lower === "authorization" ||
      lower === "x-payment" ||
      lower === "x-payment-response" ||
      lower === "payment" ||
      lower.startsWith("x-")
    ) {
      headers.set(key, value);
    }
  });

  const upstream = await fetch(`${getBridgeAgentUrl()}/bridge/finalize`, {
    method: "POST",
    headers,
    body: await request.text(),
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  const contentType = upstream.headers.get("content-type");
  const paymentRequired = upstream.headers.get("PAYMENT-REQUIRED");
  const paymentResponse = upstream.headers.get("PAYMENT-RESPONSE");

  if (contentType) responseHeaders.set("Content-Type", contentType);
  if (paymentRequired) responseHeaders.set("PAYMENT-REQUIRED", paymentRequired);
  if (paymentResponse) responseHeaders.set("PAYMENT-RESPONSE", paymentResponse);
  responseHeaders.set("Cache-Control", "no-store");

  return new NextResponse(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers: responseHeaders,
  });
}
