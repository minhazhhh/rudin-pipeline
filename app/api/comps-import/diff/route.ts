import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

type InRow = Record<string, string>;

// Returns the string "key" used to match an incoming row against an existing DB record.
// Must align with the upsert logic in comps-import/route.ts.
function rowKey(resource: string, row: InRow): string | null {
  switch (resource) {
    case "projects":
      return row.name?.trim() || null;
    case "comp-buildings":
      return row.name?.trim() || null;
    case "comp-building-stats":
      return row.buildingName?.trim() && row.unitType?.trim()
        ? `${row.buildingName.trim()}|||${row.unitType.trim()}`
        : null;
    case "comp-building-quarter-stats":
      return row.buildingName?.trim() && row.quarter?.trim() && row.unitType?.trim()
        ? `${row.buildingName.trim()}|||${row.quarter.trim()}|||${row.unitType.trim()}`
        : null;
    case "overall-stats":
      return row.unitType?.trim() || null;
    case "type-stats":
      return row.propertyType?.trim() && row.unitType?.trim()
        ? `${row.propertyType.trim()}|||${row.unitType.trim()}`
        : null;
    case "trend":
      return row.quarter?.trim() && row.unitType?.trim()
        ? `${row.quarter.trim()}|||${row.unitType.trim()}`
        : null;
    case "lease-comps":
      // No unique key — every lease comp row is treated as new
      return null;
    default:
      return null;
  }
}

async function getExistingKeys(resource: string): Promise<Set<string>> {
  const keys = new Set<string>();
  switch (resource) {
    case "projects": {
      const rows = await prisma.project.findMany({ select: { name: true } });
      rows.forEach((r) => keys.add(r.name));
      break;
    }
    case "comp-buildings": {
      const rows = await prisma.compBuilding.findMany({ select: { name: true } });
      rows.forEach((r) => keys.add(r.name));
      break;
    }
    case "comp-building-stats": {
      const rows = await prisma.compBuildingStat.findMany({ select: { unitType: true, building: { select: { name: true } } } });
      rows.forEach((r) => keys.add(`${r.building.name}|||${r.unitType}`));
      break;
    }
    case "comp-building-quarter-stats": {
      const rows = await prisma.compBuildingQuarterStat.findMany({ select: { quarter: true, unitType: true, building: { select: { name: true } } } });
      rows.forEach((r) => keys.add(`${r.building.name}|||${r.quarter}|||${r.unitType}`));
      break;
    }
    case "overall-stats": {
      const rows = await prisma.overallUnitStat.findMany({ select: { unitType: true } });
      rows.forEach((r) => keys.add(r.unitType));
      break;
    }
    case "type-stats": {
      const rows = await prisma.typeUnitStat.findMany({ select: { propertyType: true, unitType: true } });
      rows.forEach((r) => keys.add(`${r.propertyType}|||${r.unitType}`));
      break;
    }
    case "trend": {
      const rows = await prisma.trendPoint.findMany({ select: { quarter: true, unitType: true } });
      rows.forEach((r) => keys.add(`${r.quarter}|||${r.unitType}`));
      break;
    }
    // lease-comps: no unique key, always all-new
  }
  return keys;
}

// POST /api/comps-import/diff
// Body: { resource: string, rows: InRow[] }
// Returns: { newCount, updateCount, sampleUpdates: InRow[], noKeyCount }
export async function POST(req: NextRequest) {
  const { resource, rows } = await req.json() as { resource: string; rows: InRow[] };
  if (!resource || !Array.isArray(rows)) {
    return NextResponse.json({ error: "resource and rows[] required" }, { status: 400 });
  }

  const existingKeys = await getExistingKeys(resource);

  let newCount = 0, updateCount = 0, noKeyCount = 0;
  const sampleUpdates: InRow[] = [];
  const updateKeys: string[] = [];

  for (const row of rows) {
    const key = rowKey(resource, row);
    if (key === null) {
      noKeyCount++;
      continue;
    }
    if (existingKeys.has(key)) {
      updateCount++;
      updateKeys.push(key);
      if (sampleUpdates.length < 10) sampleUpdates.push(row);
    } else {
      newCount++;
    }
  }

  return NextResponse.json({ newCount, updateCount, noKeyCount, sampleUpdates, updateKeys, totalExisting: existingKeys.size });
}
