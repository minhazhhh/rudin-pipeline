import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";

// GET /api/snapshots?resource=X — list snapshots (no data blob, newest first)
export async function GET(req: NextRequest) {
  const resource = req.nextUrl.searchParams.get("resource");
  if (!resource) return NextResponse.json({ error: "resource required" }, { status: 400 });

  const snaps = await prisma.snapshot.findMany({
    where: { resource },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, resource: true, label: true, createdAt: true },
  });
  return NextResponse.json(snaps);
}

// POST /api/snapshots — create snapshot
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource, label, data } = await req.json() as {
    resource: string;
    label: string;
    data: object[];
  };
  if (!resource || !label || !Array.isArray(data)) {
    return NextResponse.json({ error: "resource, label, and data[] required" }, { status: 400 });
  }

  const snap = await prisma.snapshot.create({ data: { resource, label, data } });

  // Prune oldest beyond 20
  const all = await prisma.snapshot.findMany({
    where: { resource },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (all.length > 20) {
    const toDelete = all.slice(20).map((s) => s.id);
    await prisma.snapshot.deleteMany({ where: { id: { in: toDelete } } });
  }

  return NextResponse.json({ id: snap.id });
}
