import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

async function scanDuplicates() {
  // CompBuildingUnit: duplicates = same (buildingId, unitName) — keep highest id (lexicographic cuid)
  const allUnits = await prisma.compBuildingUnit.findMany({
    select: { id: true, buildingId: true, unitName: true, unitNumber: true },
  });
  const unitGroups = new Map<string, typeof allUnits>();
  for (const u of allUnits) {
    const key = `${u.buildingId}|||${u.unitName ?? ""}|||${u.unitNumber ?? ""}`;
    if (!unitGroups.has(key)) unitGroups.set(key, []);
    unitGroups.get(key)!.push(u);
  }
  const dupUnitGroups = [...unitGroups.values()].filter((g) => g.length > 1);
  const dupUnitCount = dupUnitGroups.reduce((s, g) => s + g.length - 1, 0);

  // LeaseComp: duplicates = same (building, unit, leaseDate, unitType) — keep latest createdAt
  const allLeaseComps = await prisma.leaseComp.findMany({
    select: { id: true, building: true, unit: true, leaseDate: true, unitType: true, createdAt: true },
  });
  const lcGroups = new Map<string, typeof allLeaseComps>();
  for (const lc of allLeaseComps) {
    const key = `${lc.building}|||${lc.unit ?? ""}|||${lc.leaseDate?.toISOString() ?? ""}|||${lc.unitType ?? ""}`;
    if (!lcGroups.has(key)) lcGroups.set(key, []);
    lcGroups.get(key)!.push(lc);
  }
  const dupLcGroups = [...lcGroups.values()].filter((g) => g.length > 1);
  const dupLcCount = dupLcGroups.reduce((s, g) => s + g.length - 1, 0);

  return {
    compBuildingUnits: {
      total: allUnits.length,
      duplicateRows: dupUnitCount,
      groups: dupUnitGroups.length,
    },
    leaseComps: {
      total: allLeaseComps.length,
      duplicateRows: dupLcCount,
      groups: dupLcGroups.length,
    },
  };
}

// GET /api/admin/data-health — scan for duplicates
export async function GET(req: NextRequest) {
  const { requireAdmin } = await import("@/app/lib/api-auth");
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const result = await scanDuplicates();
  return NextResponse.json(result);
}

// POST /api/admin/data-health — deduplicate; body: { resource: "comp-building-units" | "lease-comps" }
export async function POST(req: NextRequest) {
  const { requireAdmin } = await import("@/app/lib/api-auth");
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource } = await req.json() as { resource: string };

  if (resource === "comp-building-units") {
    const allUnits = await prisma.compBuildingUnit.findMany({
      select: { id: true, buildingId: true, unitName: true, unitNumber: true },
      orderBy: { id: "asc" },
    });
    const seen = new Map<string, string>(); // key -> id to keep (last = highest cuid)
    const toDelete: string[] = [];
    // Group first
    const groups = new Map<string, string[]>();
    for (const u of allUnits) {
      const key = `${u.buildingId}|||${u.unitName ?? ""}|||${u.unitNumber ?? ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(u.id);
    }
    for (const ids of groups.values()) {
      if (ids.length > 1) {
        // Keep the last id (highest), delete the rest
        const sorted = [...ids].sort();
        toDelete.push(...sorted.slice(0, sorted.length - 1));
      }
    }
    if (toDelete.length > 0) {
      await prisma.compBuildingUnit.deleteMany({ where: { id: { in: toDelete } } });
    }
    return NextResponse.json({ deleted: toDelete.length });
  }

  if (resource === "lease-comps") {
    const allLeaseComps = await prisma.leaseComp.findMany({
      select: { id: true, building: true, unit: true, leaseDate: true, unitType: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const groups = new Map<string, typeof allLeaseComps>();
    for (const lc of allLeaseComps) {
      const key = `${lc.building}|||${lc.unit ?? ""}|||${lc.leaseDate?.toISOString() ?? ""}|||${lc.unitType ?? ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(lc);
    }
    const toDelete: string[] = [];
    for (const group of groups.values()) {
      if (group.length > 1) {
        // Keep latest createdAt, delete the rest
        const sorted = [...group].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        toDelete.push(...sorted.slice(1).map((lc) => lc.id));
      }
    }
    if (toDelete.length > 0) {
      await prisma.leaseComp.deleteMany({ where: { id: { in: toDelete } } });
    }
    return NextResponse.json({ deleted: toDelete.length });
  }

  return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
}
