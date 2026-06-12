import { NextResponse, type NextRequest } from "next/server";

// Hides the internal admin pages (/internal/*) from the public.
//
// The gate is ACTIVE whenever INTERNAL_PANEL_KEY is set, and OFF when it is not.
// (We key off the secret's presence rather than NODE_ENV, because this repo's
// root .env leaks NODE_ENV=development into `next start`, which would make a
// NODE_ENV check silently disable the gate in production.)
//
//   - Local dev: leave INTERNAL_PANEL_KEY unset -> pages served normally.
//   - Production: set INTERNAL_PANEL_KEY -> /internal/* returns 404 unless
//     unlocked with the secret via the `internal_access` cookie, or a one-time
//     `?key=...` that sets the cookie and is stripped from the URL.
//
// This is the "invisible to the public" layer, on top of — and independent of —
// the wallet allowlist that guards the admin DATA on the backend
// (adminAuthMiddleware + INTERNAL_ADMIN_WALLETS). A visitor needs BOTH the key to
// see the page AND an allowlisted wallet to load anything.

const COOKIE = "internal_access";
const UNLOCK_MAX_AGE_SECONDS = 60 * 60 * 8; // 8h

export function middleware(req: NextRequest): NextResponse {
  const key = process.env.INTERNAL_PANEL_KEY?.trim();

  // Gate disabled when no key is configured (e.g. local development).
  if (!key) {
    return NextResponse.next();
  }

  // Already unlocked.
  if (req.cookies.get(COOKIE)?.value === key) {
    return NextResponse.next();
  }

  // One-time unlock: /internal/...?key=SECRET -> set cookie, strip the param.
  const provided = req.nextUrl.searchParams.get("key");
  if (provided && provided === key) {
    const url = req.nextUrl.clone();
    url.searchParams.delete("key");
    const res = NextResponse.redirect(url);
    res.cookies.set(COOKIE, key, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/internal",
      maxAge: UNLOCK_MAX_AGE_SECONDS,
    });
    return res;
  }

  // Otherwise: invisible.
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/internal/:path*"],
};
