import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { csvNum, csvBool, csvStr } from "@/app/lib/sync";

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
    if (r.affBandsJson && r.affBandsJson.trim()) {
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

  await prisma.$transaction([prisma.project.deleteMany(), ...data.map((d) => prisma.project.create({ data: d }))]);
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
      `These buildingName values don't exist in Comp Buildings — sync that sheet first: ${missing.join(", ")}`,
    );
  }

  const data = rows.map((r) => {
    const buildingId = idByName.get(csvStr(r.buildingName).trim())!;
    return {
      buildingId,
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
    };
  });

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
      `These buildingName values don't exist in Comp Buildings — sync that sheet first: ${missing.join(", ")}`,
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
