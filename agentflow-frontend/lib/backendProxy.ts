import { NextResponse } from "next/server";

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

export function getBackendUrl(path: string): string {
  const base =
    process.env.BACKEND_URL?.trim() ||
    process.env.NEXT_PUBLIC_BACKEND_URL?.trim() ||
    "http://localhost:4000";

  return `${normalizeBaseUrl(base)}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function proxyBackendRequest(
  request: Request,
  path: string,
): Promise<NextResponse> {
  const method = request.method;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const authorization = request.headers.get("authorization");

  if (contentType) {
    headers.set("content-type", contentType);
  }
  if (authorization) {
    headers.set("authorization", authorization);
  }

  const body =
    method === "GET" || method === "HEAD" ? undefined : await request.text();

  try {
    const upstream = await fetch(getBackendUrl(path), {
      method,
      headers,
      body,
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const upstreamContentType = upstream.headers.get("content-type");
    const upstreamDisposition = upstream.headers.get("content-disposition");
    const upstreamCacheControl = upstream.headers.get("cache-control");

    if (upstreamContentType) {
      responseHeaders.set("Content-Type", upstreamContentType);
    }
    if (upstreamDisposition) {
      responseHeaders.set("Content-Disposition", upstreamDisposition);
    }
    responseHeaders.set("Cache-Control", upstreamCacheControl || "no-store");

    if (method === "HEAD") {
      return new NextResponse(null, {
        status: upstream.status,
        headers: responseHeaders,
      });
    }

    const payload = await upstream.arrayBuffer();
    responseHeaders.set("Content-Length", String(payload.byteLength));

    return new NextResponse(payload, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : `Backend request failed for ${path}`,
      },
      { status: 502 },
    );
  }
}
