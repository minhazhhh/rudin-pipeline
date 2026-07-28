import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { compBuildingStatSchema } from "@/app/lib/schemas";

export async function GET() {
  const stats = await prisma.compBuildingStat.findMany({
    include: { building: { select: { name: true } } },
  });
  return NextResponse.json(stats);
}

async function resolveBuildingId(buildingName: string): Promise<string | null> {
  const building = await prisma.compBuilding.findFirst({ where: { name: buildingName.trim() } });
  return building?.id ?? null;
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);

  // Accept buildingName (from the admin table) and resolve to buildingId
  if (body?.buildingName) {
    const id = await resolveBuildingId(body.buildingName);
    if (!id) return NextResponse.json({ error: `Building "${body.buildingName}" not found` }, { status: 400 });
    body.buildingId = id;
  }

  const parsed = compBuildingStatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const stat = await prisma.compBuildingStat.create({ data: parsed.data });
  // Return with buildingName so the table row stays consistent
  return NextResponse.json({ ...stat, buildingName: body.buildingName }, { status: 201 });
}
