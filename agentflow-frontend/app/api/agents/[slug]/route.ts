import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getAgentUpstreamRunUrl(slug: string): string {
  const normalized = slug.toLowerCase();
  const backend = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000",
  );

  const bySlug: Record<string, string> = {
    ascii: `${backend}/agent/ascii/run`,
    research: `${backend}/agent/research/run`,
    analyst: `${backend}/agent/analyst/run`,
    writer: `${backend}/agent/writer/run`,
    swap: `${normalizeBaseUrl(
      process.env.SWAP_AGENT_URL ||
        process.env.NEXT_PUBLIC_SWAP_AGENT_URL ||
        "http://127.0.0.1:3011",
    )}/run`,
    vault: `${normalizeBaseUrl(
      process.env.VAULT_AGENT_URL ||
        process.env.NEXT_PUBLIC_VAULT_AGENT_URL ||
        "http://127.0.0.1:3012",
    )}/run`,
    bridge: `${normalizeBaseUrl(
      process.env.BRIDGE_AGENT_URL ||
        process.env.NEXT_PUBLIC_BRIDGE_AGENT_URL ||
        "http://127.0.0.1:3013",
    )}/run`,
    portfolio: `${normalizeBaseUrl(
      process.env.PORTFOLIO_AGENT_URL ||
        process.env.NEXT_PUBLIC_PORTFOLIO_AGENT_URL ||
        "http://127.0.0.1:3014",
    )}/run`,
    invoice: `${normalizeBaseUrl(
      process.env.INVOICE_AGENT_URL ||
        process.env.NEXT_PUBLIC_INVOICE_AGENT_URL ||
        "http://127.0.0.1:3015",
    )}/run`,
    vision: `${normalizeBaseUrl(
      process.env.VISION_AGENT_URL ||
        process.env.NEXT_PUBLIC_VISION_AGENT_URL ||
        "http://127.0.0.1:3016",
    )}/run`,
    transcribe: `${normalizeBaseUrl(
      process.env.TRANSCRIBE_AGENT_URL ||
        process.env.NEXT_PUBLIC_TRANSCRIBE_AGENT_URL ||
        "http://127.0.0.1:3017",
    )}/run`,
  };

  const target = bySlug[normalized];
  if (!target) {
    throw new Error(`Unknown agent slug: ${slug}`);
  }
  return target;
}

async function proxyAgentRequest(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  let upstreamUrl: string;
  try {
    upstreamUrl = getAgentUpstreamRunUrl(params.slug);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown agent slug" },
      { status: 404 },
    );
  }

  const target = new URL(upstreamUrl);
  if (request.nextUrl.search) {
    target.search = request.nextUrl.search;
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

  const body =
    request.method === "GET" || request.method === "HEAD"
      ? undefined
      : await request.text();

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(target.toString(), {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upstream agent request failed";
    console.error(`[agent proxy] ${params.slug} upstream fetch failed`, error);
    return NextResponse.json(
      {
        error: `Agent upstream unavailable for ${params.slug}`,
        details: message,
        upstream: target.toString(),
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "payment-required", "payment-response"]) {
    const value = upstreamResponse.headers.get(name);
    if (value) {
      responseHeaders.set(name, value);
    }
  }
  responseHeaders.set("cache-control", "no-store");

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  return proxyAgentRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  return proxyAgentRequest(request, context);
}
