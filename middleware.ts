import { NextRequest, NextResponse } from "next/server";

// Kept in sync with app/lib/auth.ts, but reimplemented with Web Crypto (subtle)
// instead of node:crypto so this works regardless of which runtime Vercel picks
// for middleware (Edge or Node).
const SESSION_COOKIE_NAME = "admin_session";

async function hmacHex(secret: string, value: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [role, expiresStr, sig] = parts;

  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) return false;

  const payload = `${role}.${expiresStr}`;
  const expected = await hmacHex(secret, payload);
  if (sig !== expected) return false;

  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;

  return role === "admin";
}

// Gate every /admin page behind a valid session. Without this, admin pages
// (which fetch and render data directly as server components) were reachable
// by anyone who knew the URL — only the underlying write APIs were protected,
// not the pages themselves.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authed = await verifySessionToken(token);

  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
