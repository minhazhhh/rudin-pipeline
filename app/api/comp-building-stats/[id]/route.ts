import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { compBuildingStatSchema } from "@/app/lib/schemas";

async function resolveBuildingId(buildingName: string): Promise<string | null> {
  const building = await prisma.compBuilding.findFirst({ where: { name: buildingName.trim() } });
  return building?.id ?? null;
}

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/comp-building-stats/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);

  // Accept buildingName (from the admin table) and resolve to buildingId
  if (body?.buildingName) {
    const buildingId = await resolveBuildingId(body.buildingName);
    if (!buildingId) return NextResponse.json({ error: `Building "${body.buildingName}" not found` }, { status: 400 });
    body.buildingId = buildingId;
  }

  const parsed = compBuildingStatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const stat = await prisma.compBuildingStat.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ ...stat, buildingName: body.buildingName });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/comp-building-stats/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  await prisma.compBuildingStat.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
