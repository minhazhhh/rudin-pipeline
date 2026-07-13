import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { RESOURCES, Resource } from "@/app/lib/sync-resources";
import { csvNum, csvBool, csvStr } from "@/app/lib/sync";

type ImportRow = Record<string, string>;
type ImportMode = "replace" | "upsert";

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  let body: { resource: string; rows: ImportRow[]; mode: ImportMode };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { resource: resourceParam, rows, mode } = body;

  if (!RESOURCES.includes(resourceParam as Resource)) {
    return NextResponse.json({ error: `Unknown resource "${resourceParam}"` }, { status: 400 });
  }
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "rows must be an array." }, { status: 400 });
  }
  if (mode !== "replace" && mode !== "upsert") {
    return NextResponse.json({ error: 'mode must be "replace" or "upsert".' }, { status: 400 });
  }

  const resource = resourceParam as Resource;

  try {
    const count = await importResource(resource, rows, mode);
    await prisma.syncConfig.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } });
    return NextResponse.json({ ok: true, resource, rowsImported: count, mode });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

async function importResource(resource: Resource, rows: ImportRow[], mode: ImportMode): Promise<number> {
  switch (resource) {
    case "projects": return importProjects(rows, mode);
    case "comp-buildings": return importCompBuildings(rows, mode);
    case "comp-building-stats": return importCompBuildingStats(rows, mode);
    case "comp-building-quarter-stats": return importCompBuildingQuarterStats(rows, mode);
    case "overall-stats": return importOverallStats(rows, mode);
    case "type-stats": return importTypeStats(rows, mode);
    case "trend": return importTrend(rows, mode);
    case "lease-comps": return importLeaseComps(rows, mode);
  }
}

async function importProjects(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const data = rows.map((r) => {
    let affBands = undefined;
    if (r.affBandsJson?.trim()) {
      try { affBands = JSON.parse(r.affBandsJson); }
      catch { throw new Error(`Invalid affBandsJson for project "${r.name}": ${r.affBandsJson}`); }
    }
    return {
      name: csvStr(r.name), borough: csvStr(r.borough), status: csvStr(r.status),
      category: csvStr(r.category), units: csvNum(r.units), sqft: csvNum(r.sqft),
      deliveryLabel: csvStr(r.deliveryLabel), sponsor: csvStr(r.sponsor), lender: csvStr(r.lender),
      lat: csvNum(r.lat) ?? 0, lng: csvNum(r.lng) ?? 0, isRudin: csvBool(r.isRudin),
      imageUrl: csvStr(r.imageUrl), affPct: csvNum(r.affPct), mktU: csvNum(r.mktU),
      affU: csvNum(r.affU), avgSf: csvNum(r.avgSf), affBands: affBands ?? undefined,
      compBuildingName: r.compBuildingName?.trim() || null,
    };
  });
  if (mode === "replace") {
    await prisma.$transaction([prisma.project.deleteMany(), ...data.map((d) => prisma.project.create({ data: d }))]);
  } else {
    for (const d of data) {
      const existing = await prisma.project.findFirst({ where: { name: d.name } });
      if (existing) await prisma.project.update({ where: { id: existing.id }, data: d });
      else await prisma.project.create({ data: d });
    }
  }
  return data.length;
}

async function importCompBuildings(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const data = rows.map((r) => ({
    name: csvStr(r.name), propertyType: csvStr(r.propertyType),
    lat: csvNum(r.lat), lng: csvNum(r.lng), underwritten: csvBool(r.underwritten),
    note: r.note?.trim() || null, totalN: csvNum(r.totalN),
  }));
  if (mode === "replace") {
    await prisma.$transaction([prisma.compBuildingStat.deleteMany(), prisma.compBuilding.deleteMany(), ...data.map((d) => prisma.compBuilding.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.compBuilding.upsert({ where: { name: d.name }, update: d, create: d });
  }
  return data.length;
}

async function importCompBuildingStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const buildingNames = [...new Set(rows.map((r) => csvStr(r.buildingName).trim()).filter(Boolean))];
  const existing = await prisma.compBuilding.findMany({ where: { name: { in: buildingNames } }, select: { id: true, name: true } });
  const idByName = new Map(existing.map((b: { id: string; name: string }) => [b.name, b.id]));
  const missing = buildingNames.filter((n) => !idByName.has(n));
  if (missing.length) throw new Error(`These building names don't exist in Comp Buildings — add them first: ${missing.join(", ")}`);
  const data = rows.map((r) => {
    const buildingId = idByName.get(csvStr(r.buildingName).trim())!;
    return { buildingId, unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent), medRent: csvNum(r.medRent), minRent: csvNum(r.minRent), maxRent: csvNum(r.maxRent), nRent: csvNum(r.nRent), avgPsf: csvNum(r.avgPsf), medPsf: csvNum(r.medPsf), minPsf: csvNum(r.minPsf), maxPsf: csvNum(r.maxPsf), nPsf: csvNum(r.nPsf), avgSf: csvNum(r.avgSf), medSf: csvNum(r.medSf), minSf: csvNum(r.minSf), maxSf: csvNum(r.maxSf), nSf: csvNum(r.nSf) };
  });
  if (mode === "replace") {
    await prisma.$transaction([prisma.compBuildingStat.deleteMany(), ...data.map((d) => prisma.compBuildingStat.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.compBuildingStat.upsert({ where: { buildingId_unitType: { buildingId: d.buildingId, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

async function importCompBuildingQuarterStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const buildingNames = [...new Set(rows.map((r) => csvStr(r.buildingName).trim()).filter(Boolean))];
  const existing = await prisma.compBuilding.findMany({ where: { name: { in: buildingNames } }, select: { id: true, name: true } });
  const idByName = new Map(existing.map((b: { id: string; name: string }) => [b.name, b.id]));
  const missing = buildingNames.filter((n) => !idByName.has(n));
  if (missing.length) throw new Error(`These building names don't exist in Comp Buildings — add them first: ${missing.join(", ")}`);
  const data = rows.map((r) => ({ buildingId: idByName.get(csvStr(r.buildingName).trim())!, quarter: csvStr(r.quarter), quarterOrder: csvNum(r.quarterOrder) ?? 0, unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent), avgPsf: csvNum(r.avgPsf), n: csvNum(r.n) ?? 0 }));
  if (mode === "replace") {
    await prisma.$transaction([prisma.compBuildingQuarterStat.deleteMany(), ...data.map((d) => prisma.compBuildingQuarterStat.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.compBuildingQuarterStat.upsert({ where: { buildingId_quarter_unitType: { buildingId: d.buildingId, quarter: d.quarter, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

async function importOverallStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const data = rows.map((r) => ({ unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent), medRent: csvNum(r.medRent), minRent: csvNum(r.minRent), maxRent: csvNum(r.maxRent), nRent: csvNum(r.nRent), avgPsf: csvNum(r.avgPsf), medPsf: csvNum(r.medPsf), minPsf: csvNum(r.minPsf), maxPsf: csvNum(r.maxPsf), nPsf: csvNum(r.nPsf), avgSf: csvNum(r.avgSf), medSf: csvNum(r.medSf), minSf: csvNum(r.minSf), maxSf: csvNum(r.maxSf), nSf: csvNum(r.nSf) }));
  if (mode === "replace") {
    await prisma.$transaction([prisma.overallUnitStat.deleteMany(), ...data.map((d) => prisma.overallUnitStat.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.overallUnitStat.upsert({ where: { unitType: d.unitType }, update: d, create: d });
  }
  return data.length;
}

async function importTypeStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const data = rows.map((r) => ({ propertyType: csvStr(r.propertyType), unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent), medRent: csvNum(r.medRent), minRent: csvNum(r.minRent), maxRent: csvNum(r.maxRent), nRent: csvNum(r.nRent), avgPsf: csvNum(r.avgPsf), medPsf: csvNum(r.medPsf), minPsf: csvNum(r.minPsf), maxPsf: csvNum(r.maxPsf), nPsf: csvNum(r.nPsf) }));
  if (mode === "replace") {
    await prisma.$transaction([prisma.typeUnitStat.deleteMany(), ...data.map((d) => prisma.typeUnitStat.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.typeUnitStat.upsert({ where: { propertyType_unitType: { propertyType: d.propertyType, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

async function importTrend(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const data = rows.map((r) => ({ quarter: csvStr(r.quarter), quarterOrder: csvNum(r.quarterOrder) ?? 0, unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent) ?? 0, avgPsf: csvNum(r.avgPsf) }));
  if (mode === "replace") {
    await prisma.$transaction([prisma.trendPoint.deleteMany(), ...data.map((d) => prisma.trendPoint.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.trendPoint.upsert({ where: { quarter_unitType: { quarter: d.quarter, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

async function importLeaseComps(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const data = rows
    .filter((r) => r.building?.trim())
    .map((r) => {
      let leaseDate: Date | null = null;
      if (r.leaseDate?.trim()) {
        const parsed = new Date(r.leaseDate.trim());
        if (!isNaN(parsed.getTime())) leaseDate = parsed;
      }
      return {
        building: csvStr(r.building),
        unit: r.unit?.trim() || null,
        unitType: r.unitType?.trim() || null,
        unitSf: csvNum(r.unitSf),
        grossRent: csvNum(r.grossRent),
        grossPsf: csvNum(r.grossPsf),
        netRent: csvNum(r.netRent),
        concession: csvNum(r.concession),
        leaseDate,
        quarter: r.quarter?.trim() || null,
        propertyType: r.propertyType?.trim() || null,
      };
    });
  if (mode === "replace") {
    await prisma.$transaction([prisma.leaseComp.deleteMany(), ...data.map((d) => prisma.leaseComp.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.leaseComp.create({ data: d });
  }
  return data.length;
}
