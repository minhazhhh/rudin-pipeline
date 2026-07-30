import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { normalizeQuarter } from "@/app/api/comps-import/route";

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

async function scanQuarterFormats() {
  const QUARTER_RE = /^Q\d\s+\d{4}$/i;
  const lcRows = await prisma.leaseComp.findMany({ select: { id: true, quarter: true } });
  const badLc = lcRows.filter((r) => r.quarter && !QUARTER_RE.test(r.quarter));
  const bqRows = await prisma.compBuildingQuarterStat.findMany({ select: { id: true, quarter: true } });
  const badBq = bqRows.filter((r) => !QUARTER_RE.test(r.quarter));
  const tpRows = await prisma.trendPoint.findMany({ select: { id: true, quarter: true } });
  const badTp = tpRows.filter((r) => !QUARTER_RE.test(r.quarter));
  return {
    leaseComps: { total: lcRows.length, badFormats: badLc.length },
    compBuildingQuarterStats: { total: bqRows.length, badFormats: badBq.length },
    trendPoints: { total: tpRows.length, badFormats: badTp.length },
  };
}

// GET /api/admin/data-health — scan for duplicates + bad quarter formats
export async function GET(req: NextRequest) {
  const { requireAdmin } = await import("@/app/lib/api-auth");
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const [dupes, quarters] = await Promise.all([scanDuplicates(), scanQuarterFormats()]);
  return NextResponse.json({ ...dupes, quarterFormats: quarters });
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

  if (resource === "fix-quarter-formats") {
    const QUARTER_RE = /^Q\d\s+\d{4}$/i;
    let fixed = 0;

    // Fix LeaseComp.quarter
    const lcRows = await prisma.leaseComp.findMany({ select: { id: true, quarter: true } });
    for (const r of lcRows) {
      if (!r.quarter || QUARTER_RE.test(r.quarter)) continue;
      const norm = normalizeQuarter(r.quarter);
      if (norm !== r.quarter) {
        await prisma.leaseComp.update({ where: { id: r.id }, data: { quarter: norm } });
        fixed++;
      }
    }

    // Fix CompBuildingQuarterStat.quarter — these rows have a composite unique key,
    // so we need to handle potential collisions: if the normalised quarter already exists
    // for the same building+unitType, delete the duplicate instead of updating.
    const bqRows = await prisma.compBuildingQuarterStat.findMany({
      select: { id: true, quarter: true, quarterOrder: true, buildingId: true, unitType: true },
    });
    for (const r of bqRows) {
      if (QUARTER_RE.test(r.quarter)) continue;
      const norm = normalizeQuarter(r.quarter);
      if (norm === r.quarter) continue;
      const collision = await prisma.compBuildingQuarterStat.findUnique({
        where: { buildingId_quarter_unitType: { buildingId: r.buildingId, quarter: norm, unitType: r.unitType } },
      });
      if (collision) {
        await prisma.compBuildingQuarterStat.delete({ where: { id: r.id } });
      } else {
        const newOrder = norm.match(/Q(\d)\s+(\d{4})/i)
          ? parseInt(norm.replace(/Q(\d)\s+(\d{4})/i, "$2")) * 10 + parseInt(norm.replace(/Q(\d)\s+(\d{4})/i, "$1"))
          : r.quarterOrder;
        await prisma.compBuildingQuarterStat.update({ where: { id: r.id }, data: { quarter: norm, quarterOrder: newOrder } });
      }
      fixed++;
    }

    // Fix TrendPoint.quarter
    const tpRows = await prisma.trendPoint.findMany({ select: { id: true, quarter: true, unitType: true } });
    for (const r of tpRows) {
      if (QUARTER_RE.test(r.quarter)) continue;
      const norm = normalizeQuarter(r.quarter);
      if (norm === r.quarter) continue;
      const collision = await prisma.trendPoint.findUnique({
        where: { quarter_unitType: { quarter: norm, unitType: r.unitType } },
      });
      if (collision) {
        await prisma.trendPoint.delete({ where: { id: r.id } });
      } else {
        const newOrder = norm.match(/Q(\d)\s+(\d{4})/i)
          ? parseInt(norm.replace(/Q(\d)\s+(\d{4})/i, "$2")) * 10 + parseInt(norm.replace(/Q(\d)\s+(\d{4})/i, "$1"))
          : 0;
        await prisma.trendPoint.update({ where: { id: r.id }, data: { quarter: norm, quarterOrder: newOrder } });
      }
      fixed++;
    }

    return NextResponse.json({ fixed });
  }

  return NextResponse.json({ error: "Unknown resource" }, { status: 400 });
}
