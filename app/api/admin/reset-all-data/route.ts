import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/api-auth";
import { prisma } from "@/app/lib/prisma";

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  // Delete in dependency order (children before parents)
  await prisma.compBuildingUnit.deleteMany();
  await prisma.compBuildingQuarterStat.deleteMany();
  await prisma.compBuildingStat.deleteMany();
  await prisma.leaseComp.deleteMany();
  await prisma.compBuilding.deleteMany();
  await prisma.overallUnitStat.deleteMany();
  await prisma.typeUnitStat.deleteMany();
  await prisma.trendPoint.deleteMany();
  await prisma.project.deleteMany();

  return NextResponse.json({ ok: true, message: "All imported data cleared." });
}
