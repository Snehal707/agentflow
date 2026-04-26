import { networkInterfaces } from "os";
import { NextResponse } from "next/server";

function isPrivateIpv4(address: string): boolean {
  return (
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function detectLanIpv4(): string | null {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (isPrivateIpv4(entry.address)) {
        return entry.address;
      }
    }
  }
  return null;
}

export async function GET(request: Request) {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    process.env.PUBLIC_APP_URL?.trim() ||
    "";

  if (configured) {
    return NextResponse.json({
      url: configured.replace(/\/+$/, ""),
      source: "env",
      reachableFromPhone: !/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(configured),
    });
  }

  const requestUrl = new URL(request.url);
  const forwardedHost =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    requestUrl.host;
  const forwardedProto =
    request.headers.get("x-forwarded-proto") ||
    requestUrl.protocol.replace(":", "") ||
    "http";

  const currentOrigin = `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, "");
  if (!/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(currentOrigin)) {
    return NextResponse.json({
      url: currentOrigin,
      source: "request",
      reachableFromPhone: true,
    });
  }

  const portMatch = forwardedHost.match(/:(\d+)$/);
  const port = portMatch?.[1] || (forwardedProto === "https" ? "443" : "80");
  const lanIp = detectLanIpv4();
  if (lanIp) {
    return NextResponse.json({
      url: `${forwardedProto}://${lanIp}:${port}`,
      source: "lan",
      reachableFromPhone: true,
    });
  }

  return NextResponse.json({
    url: currentOrigin,
    source: "localhost",
    reachableFromPhone: false,
  });
}
