import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { draftMode } from "next/headers";

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  const preview = await prisma.importPreview.findFirst({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(preview ?? null);
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  let body: { resources: Record<string, Record<string, string>[]>; fileName: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Clear any existing import preview
  await prisma.importPreview.deleteMany();
  const preview = await prisma.importPreview.create({
    data: { resources: body.resources as object, fileName: body.fileName },
  });

  // Enable draft mode so the dashboard knows to use preview data
  const dm = await draftMode();
  dm.enable();

  return NextResponse.json({ ok: true, id: preview.id });
}

export async function DELETE(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  await prisma.importPreview.deleteMany();

  const dm = await draftMode();
  dm.disable();

  return NextResponse.json({ ok: true });
}
