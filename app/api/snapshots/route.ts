import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";

export async function GET(req: NextRequest) {
  const resource = req.nextUrl.searchParams.get("resource");
  const snapshots = await prisma.snapshot.findMany({
    where: resource ? { resource } : undefined,
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, resource: true, label: true, createdAt: true },
  });
  return NextResponse.json(snapshots);
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  if (!body?.resource || !body?.label || !Array.isArray(body?.data)) {
    return NextResponse.json({ error: "resource, label, and data[] required" }, { status: 400 });
  }

  const snap = await prisma.snapshot.create({
    data: { resource: body.resource, label: body.label, data: body.data },
  });
  return NextResponse.json(snap, { status: 201 });
}
