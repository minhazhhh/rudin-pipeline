import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { z } from "zod";

const urlField = z
  .union([z.literal(""), z.string().url()])
  .nullable()
  .optional()
  .transform((v) => (v ? v : null));

const syncConfigSchema = z.object({
  projectsSheetUrl: urlField,
  compBuildingsSheetUrl: urlField,
  compBuildingStatsSheetUrl: urlField,
  compBuildingQuarterStatsSheetUrl: urlField,
  overallStatsSheetUrl: urlField,
  typeStatsSheetUrl: urlField,
  trendSheetUrl: urlField,
});

export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const config = await prisma.syncConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const body = await req.json().catch(() => null);
  const parsed = syncConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const config = await prisma.syncConfig.upsert({
    where: { id: 1 },
    create: { id: 1, ...parsed.data },
    update: parsed.data,
  });
  return NextResponse.json(config);
}
