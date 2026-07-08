import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { compBuildingSchema } from "@/app/lib/schemas";

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/comp-buildings/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = compBuildingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const building = await prisma.compBuilding.update({ where: { id }, data: parsed.data });
  return NextResponse.json(building);
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/comp-buildings/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  await prisma.compBuilding.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
