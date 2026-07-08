import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { overallUnitStatSchema } from "@/app/lib/schemas";

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/overall-stats/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = overallUnitStatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const stat = await prisma.overallUnitStat.update({ where: { id }, data: parsed.data });
  return NextResponse.json(stat);
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/overall-stats/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  await prisma.overallUnitStat.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
