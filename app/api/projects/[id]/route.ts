import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireAdmin } from "@/app/lib/api-auth";
import { projectSchema } from "@/app/lib/schemas";

export async function PUT(req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { affBands, ...rest } = parsed.data;
  const project = await prisma.project.update({
    where: { id },
    data: { ...rest, affBands: affBands ?? Prisma.JsonNull },
  });
  return NextResponse.json(project);
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
