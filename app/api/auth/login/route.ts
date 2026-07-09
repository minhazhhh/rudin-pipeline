import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE, timingSafeEqualStr } from "@/app/lib/auth";

export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json(
      { error: "Server not configured: ADMIN_PASSWORD is not set." },
      { status: 500 },
    );
  }

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";

  if (!timingSafeEqualStr(password, adminPassword)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
