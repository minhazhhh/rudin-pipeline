import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { requireAdmin } from "@/app/lib/api-auth";
import { projectSchema } from "@/app/lib/schemas";

export async function GET() {
  const projects = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { affBands, ...rest } = parsed.data;
  const project = await prisma.project.create({
    data: { ...rest, affBands: affBands ?? Prisma.JsonNull },
  });
  return NextResponse.json(project, { status: 201 });
}
