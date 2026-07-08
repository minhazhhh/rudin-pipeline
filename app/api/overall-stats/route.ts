import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { overallUnitStatSchema } from "@/app/lib/schemas";

export async function GET() {
  const stats = await prisma.overallUnitStat.findMany();
  return NextResponse.json(stats);
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = overallUnitStatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const stat = await prisma.overallUnitStat.create({ data: parsed.data });
  return NextResponse.json(stat, { status: 201 });
}
