import { NextRequest, NextResponse } from "next/server";
import { draftMode } from "next/headers";
import { requireAdmin } from "@/app/lib/api-auth";

// POST — enable draft preview mode (sets the __prerender_bypass cookie)
export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const dm = await draftMode();
  dm.enable();
  return NextResponse.json({ ok: true, isEnabled: true });
}

// DELETE — disable draft preview mode
export async function DELETE(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;
  const dm = await draftMode();
  dm.disable();
  return NextResponse.json({ ok: true, isEnabled: false });
}
