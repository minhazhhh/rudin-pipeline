import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "./auth";

/** Returns a 401 response if the request isn't an authenticated admin, otherwise null. */
export function requireAdmin(req: NextRequest): NextResponse | null {
  const authed = verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
