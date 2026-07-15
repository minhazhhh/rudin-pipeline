import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { csvNum, csvBool, csvStr } from "@/app/lib/sync";
import { RESOURCE_FIELDS } from "@/app/lib/column-mapper";

export const RESOURCES = [
  "projects",
  "comp-buildings",
  "comp-building-stats",
  "comp-building-quarter-stats",
  "overall-stats",
  "type-stats",
  "trend",
  "lease-comps",
  "comp-building-units",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const SHEET_URL_FIELD: Record<Resource, string> = {
  projects: "projectsSheetUrl",
  "comp-buildings": "compBuildingsSheetUrl",
  "comp-building-stats": "compBuildingStatsSheetUrl",
  "comp-building-quarter-stats": "compBuildingQuarterStatsSheetUrl",
  "overall-stats": "overallStatsSheetUrl",
  "type-stats": "typeStatsSheetUrl",
  trend: "trendSheetUrl",
  "lease-comps": "",
  "comp-building-units": "",
};

// Resources that can be exactly recognized by their own literal column-key template
// (the CSV each per-table page's admin export produces). "lease-comps" is deliberately
// excluded — it has no such template; it's only ever reached via the lease-level detector
// in lease-import.ts, which works off fuzzy header aliases instead of exact keys.
const EXACT_RESOURCES: Resource[] = RESOURCES.filter((r) => r !== "lease-comps");

// Recognizes a parsed sheet as one of the app's own exact per-table templates by literal
// column-key match (not the fuzzy alias matching column-mapper.ts uses for the manual-mapping
// wizard). Requires every required field for a resource to be present as a row key, then picks
// whichever resource explains the most of the row's actual keys — so a superset like
// "comp-building-quarter-stats" (which also requires "quarter"/"unitType") isn't confused with
// "trend" just because both share those two required keys.
export function detectExactResource(rows: Record<string, string>[]): Resource | null {
  if (!rows.length) return null;
  const keys = new Set(Object.keys(rows[0]));
  let best: { resource: Resource; score: number } | null = null;
  for (const resource of EXACT_RESOURCES) {
    const fields = RESOURCE_FIELDS[resource];
    const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);
    if (!requiredKeys.every((k) => keys.has(k))) continue;
    const fieldKeySet = new Set(fields.map((f) => f.key));
    const matched = [...keys].filter((k) => fieldKeySet.has(k)).length;
    if (!best || matched > best.score) best = { resource, score: matched };
  }
  return best ? best.resource : null;
}

export async function syncResource(resource: Resource, rows: Record<string, string>[]): Promise<number> {
  switch (resource) {
    case "projects":
      return syncProjects(rows);
    case "comp-buildings":
      return syncCompBuildings(rows);
    case "comp-building-stats":
      return syncCompBuildingStats(rows);
    case "comp-building-quarter-stats":
      return syncCompBuildingQuarterStats(rows);
    case "overall-stats":
      return syncOverallStats(rows);
    case "type-stats":
      return syncTypeStats(rows);
    case "trend":
      return syncTrend(rows);
    case "lease-comps":
      throw new Error("lease-comps cannot be synced from a sheet URL — use the Comps Import wizard.");
    case "comp-building-units":
      throw new Error("comp-building-units cannot be synced from a sheet URL — use the Comps Import wizard.");
  }
}

async function syncProjects(rows: Record<string, string>[]): Promise<number> {
  const data = rows.map((r) => {
    let affBands: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull;
    if (r.affBandsJson?.trim()) {
      try {
        affBands = JSON.parse(r.affBandsJson);
      } catch {
        throw new Error(`Invalid affBandsJson for project "${r.name}": ${r.affBandsJson}`);
      }
    }
    return {
      name: csvStr(r.name),
      borough: csvStr(r.borough),
      status: csvStr(r.status),
      category: csvStr(r.category),
      units: csvNum(r.units),
      sqft: csvNum(r.sqft),
      deliveryLabel: csvStr(r.deliveryLabel),
      sponsor: csvStr(r.sponsor),
      lender: csvStr(r.lender),
      lat: csvNum(r.lat) ?? 0,
      lng: csvNum(r.lng) ?? 0,
      isRudin: csvBool(r.isRudin),
      imageUrl: csvStr(r.imageUrl),
      affPct: csvNum(r.affPct),
      mktU: csvNum(r.mktU),
      affU: csvNum(r.affU),
      avgSf: csvNum(r.avgSf),
      affBands,
      compBuildingName: r.compBuildingName?.trim() || null,
    };
  });
  await prisma.$transaction([
    prisma.project.deleteMany(),
    ...data.map((d) => prisma.project.create({ data: d })),
  ]);
  return data.length;
}

async function syncCompBuildings(rows: Record<string, string>[]): Promise<number> {
  const data = rows.map((r) => ({
    name: csvStr(r.name),
    propertyType: csvStr(r.propertyType),
    lat: csvNum(r.lat),
    lng: csvNum(r.lng),
    underwritten: csvBool(r.underwritten),
    note: r.note?.trim() || null,
    totalN: csvNum(r.totalN),
  }));
  await prisma.$transaction([
    prisma.compBuildingStat.deleteMany(),
    prisma.compBuilding.deleteMany(),
    ...data.map((d) => prisma.compBuilding.create({ data: d })),
  ]);
  return data.length;
}

async function syncCompBuildingStats(rows: Record<string, string>[]): Promise<number> {
  const buildingNames = [...new Set(rows.map((r) => csvStr(r.buildingName).trim()).filter(Boolean))];
  const existing = await prisma.compBuilding.findMany({
    where: { name: { in: buildingNames } },
    select: { id: true, name: true },
  });
  const idByName = new Map(existing.map((b) => [b.name, b.id]));
  const missing = buildingNames.filter((n) => !idByName.has(n));
  if (missing.length) {
    throw new Error(
      `These building names don't exist in Comp Buildings — add them first: ${missing.join(", ")}`
    );
  }
  const data = rows.map((r) => ({
    buildingId: idByName.get(csvStr(r.buildingName).trim())!,
    unitType: csvStr(r.unitType),
    avgRent: csvNum(r.avgRent),
    medRent: csvNum(r.medRent),
    minRent: csvNum(r.minRent),
    maxRent: csvNum(r.maxRent),
    nRent: csvNum(r.nRent),
    avgPsf: csvNum(r.avgPsf),
    medPsf: csvNum(r.medPsf),
    minPsf: csvNum(r.minPsf),
    maxPsf: csvNum(r.maxPsf),
    nPsf: csvNum(r.nPsf),
    avgSf: csvNum(r.avgSf),
    medSf: csvNum(r.medSf),
    minSf: csvNum(r.minSf),
    maxSf: csvNum(r.maxSf),
    nSf: csvNum(r.nSf),
  }));
  await prisma.$transaction([
    prisma.compBuildingStat.deleteMany(),
    ...data.map((d) => prisma.compBuildingStat.create({ data: d })),
  ]);
  return data.length;
}

async function syncCompBuildingQuarterStats(rows: Record<string, string>[]): Promise<number> {
  const buildingNames = [...new Set(rows.map((r) => csvStr(r.buildingName).trim()).filter(Boolean))];
  const existing = await prisma.compBuilding.findMany({
    where: { name: { in: buildingNames } },
    select: { id: true, name: true },
  });
  const idByName = new Map(existing.map((b) => [b.name, b.id]));
  const missing = buildingNames.filter((n) => !idByName.has(n));
  if (missing.length) {
    throw new Error(
      `These building names don't exist in Comp Buildings — add them first: ${missing.join(", ")}`
    );
  }
  const data = rows.map((r) => ({
    buildingId: idByName.get(csvStr(r.buildingName).trim())!,
    quarter: csvStr(r.quarter),
    quarterOrder: csvNum(r.quarterOrder) ?? 0,
    unitType: csvStr(r.unitType),
    avgRent: csvNum(r.avgRent),
    avgPsf: csvNum(r.avgPsf),
    n: csvNum(r.n) ?? 0,
  }));
  await prisma.$transaction([
    prisma.compBuildingQuarterStat.deleteMany(),
    ...data.map((d) => prisma.compBuildingQuarterStat.create({ data: d })),
  ]);
  return data.length;
}

async function syncOverallStats(rows: Record<string, string>[]): Promise<number> {
  const data = rows.map((r) => ({
    unitType: csvStr(r.unitType),
    avgRent: csvNum(r.avgRent),
    medRent: csvNum(r.medRent),
    minRent: csvNum(r.minRent),
    maxRent: csvNum(r.maxRent),
    nRent: csvNum(r.nRent),
    avgPsf: csvNum(r.avgPsf),
    medPsf: csvNum(r.medPsf),
    minPsf: csvNum(r.minPsf),
    maxPsf: csvNum(r.maxPsf),
    nPsf: csvNum(r.nPsf),
    avgSf: csvNum(r.avgSf),
    medSf: csvNum(r.medSf),
    minSf: csvNum(r.minSf),
    maxSf: csvNum(r.maxSf),
    nSf: csvNum(r.nSf),
  }));
  await prisma.$transaction([
    prisma.overallUnitStat.deleteMany(),
    ...data.map((d) => prisma.overallUnitStat.create({ data: d })),
  ]);
  return data.length;
}

async function syncTypeStats(rows: Record<string, string>[]): Promise<number> {
  const data = rows.map((r) => ({
    propertyType: csvStr(r.propertyType),
    unitType: csvStr(r.unitType),
    avgRent: csvNum(r.avgRent),
    medRent: csvNum(r.medRent),
    minRent: csvNum(r.minRent),
    maxRent: csvNum(r.maxRent),
    nRent: csvNum(r.nRent),
    avgPsf: csvNum(r.avgPsf),
    medPsf: csvNum(r.medPsf),
    minPsf: csvNum(r.minPsf),
    maxPsf: csvNum(r.maxPsf),
    nPsf: csvNum(r.nPsf),
  }));
  await prisma.$transaction([
    prisma.typeUnitStat.deleteMany(),
    ...data.map((d) => prisma.typeUnitStat.create({ data: d })),
  ]);
  return data.length;
}

async function syncTrend(rows: Record<string, string>[]): Promise<number> {
  const data = rows.map((r) => ({
    quarter: csvStr(r.quarter),
    quarterOrder: csvNum(r.quarterOrder) ?? 0,
    unitType: csvStr(r.unitType),
    avgRent: csvNum(r.avgRent) ?? 0,
    avgPsf: csvNum(r.avgPsf),
  }));
  await prisma.$transaction([
    prisma.trendPoint.deleteMany(),
    ...data.map((d) => prisma.trendPoint.create({ data: d })),
  ]);
  return data.length;
}
