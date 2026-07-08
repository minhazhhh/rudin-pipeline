import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { trendPointSchema } from "@/app/lib/schemas";

export async function GET() {
  const points = await prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } });
  return NextResponse.json(points);
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = trendPointSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const point = await prisma.trendPoint.create({ data: parsed.data });
  return NextResponse.json(point, { status: 201 });
}
