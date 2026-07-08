import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/app/lib/auth";

export async function GET(req: NextRequest) {
  const authed = verifySessionToken(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  return NextResponse.json({ authed });
}
