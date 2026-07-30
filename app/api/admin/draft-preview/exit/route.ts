import { NextRequest, NextResponse } from "next/server";
import { draftMode } from "next/headers";

// GET — disable draft mode and redirect to dashboard (linked from the preview banner)
export async function GET(req: NextRequest) {
  const dm = await draftMode();
  dm.disable();
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(`${origin}/`);
}
