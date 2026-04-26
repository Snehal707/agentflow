import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function getDcwAgentUpstreamRunUrl(slug: string): string {
  const normalized = slug.toLowerCase();
  const backend = normalizeBaseUrl(
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000",
  );

  const bySlug: Record<string, string> = {
    swap: `${backend}/api/dcw/agents/swap/run`,
    vault: `${backend}/api/dcw/agents/vault/run`,
    portfolio: `${backend}/api/dcw/agents/portfolio/run`,
    vision: `${backend}/api/dcw/agents/vision/run`,
    transcribe: `${backend}/api/dcw/agents/transcribe/run`,
  };

  const target = bySlug[normalized];
  if (!target) {
    throw new Error(`Unknown DCW agent slug: ${slug}`);
  }
  return target;
}

async function proxyDcwAgentRequest(
  request: NextRequest,
  { params }: { params: { slug: string } },
) {
  let upstreamUrl: string;
  try {
    upstreamUrl = getDcwAgentUpstreamRunUrl(params.slug);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown DCW agent slug" },
      { status: 404 },
    );
  }

  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");
  const requestId = request.headers.get("x-agentflow-request-id");

  if (authorization) {
    headers.set("authorization", authorization);
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
    upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upstream DCW agent request failed";
    console.error(`[dcw agent proxy] ${params.slug} upstream fetch failed`, error);
    return NextResponse.json(
      {
        error: `DCW agent upstream unavailable for ${params.slug}`,
        details: message,
        upstream: upstreamUrl,
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  const contentTypeHeader = upstreamResponse.headers.get("content-type");
  if (contentTypeHeader) {
    responseHeaders.set("content-type", contentTypeHeader);
  }
  responseHeaders.set("cache-control", "no-store");

  return new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export async function POST(
  request: NextRequest,
  context: { params: { slug: string } },
) {
  return proxyDcwAgentRequest(request, context);
}
