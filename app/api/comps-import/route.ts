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

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const encoded = encodeURIComponent(query + ", New York, NY");
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: { "User-Agent": "rudin-pipeline/1.0 (mhasan@rudin.com)" },
    });
    if (!res.ok) return null;
    const results = await res.json() as { lat: string; lon: string }[];
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

async function importProjects(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const data: Awaited<ReturnType<typeof buildProjectData>>[] = [];
  for (const r of rows) {
    data.push(await buildProjectData(r));
  }
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

async function buildProjectData(r: ImportRow) {
  let affBands = undefined;
  if (r.affBandsJson?.trim()) {
    try { affBands = JSON.parse(r.affBandsJson); }
    catch { throw new Error(`Invalid affBandsJson for project "${r.name}": ${r.affBandsJson}`); }
  }

  let lat = csvNum(r.lat) ?? 0;
  let lng = csvNum(r.lng) ?? 0;
  const address = r.address?.trim() || null;

  if ((lat === 0 && lng === 0) || (!lat && !lng)) {
    const query = address || r.name?.trim();
    if (query) {
      const coords = await geocodeAddress(query);
      if (coords) { lat = coords.lat; lng = coords.lng; }
    }
  }

  return {
    name: csvStr(r.name), borough: csvStr(r.borough), status: csvStr(r.status),
    category: csvStr(r.category), units: csvNum(r.units), sqft: csvNum(r.sqft),
    deliveryLabel: csvStr(r.deliveryLabel), sponsor: csvStr(r.sponsor), lender: csvStr(r.lender),
    address, lat, lng, isRudin: csvBool(r.isRudin),
    imageUrl: csvStr(r.imageUrl), affPct: csvNum(r.affPct), mktU: csvNum(r.mktU),
    affU: csvNum(r.affU), avgSf: csvNum(r.avgSf), affBands: affBands ?? undefined,
    compBuildingName: r.compBuildingName?.trim() || null,
  };
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
      // Derive quarter from leaseDate if not explicitly provided
      let quarter = r.quarter?.trim() || null;
      if (!quarter && leaseDate) quarter = quarterFromDate(leaseDate);
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
        quarter,
        propertyType: r.propertyType?.trim() || null,
      };
    });

  if (mode === "replace") {
    await prisma.$transaction([prisma.leaseComp.deleteMany(), ...data.map((d) => prisma.leaseComp.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.leaseComp.create({ data: d });
  }

  // Recalculate all derived stats from the full LeaseComp table
  const affectedBuildings = [...new Set(data.map((d) => d.building))];
  await recalculateLeaseCompStats(affectedBuildings);

  return data.length;
}

function quarterFromDate(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function quarterOrder(q: string): number {
  const m = q.match(/Q(\d)\s+(\d{4})/);
  if (!m) return 0;
  return parseInt(m[2]) * 10 + parseInt(m[1]);
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function computeStats(nums: number[]) {
  if (!nums.length) return { avg: null, med: null, min: null, max: null, n: 0 };
  return {
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    med: median(nums),
    min: Math.min(...nums),
    max: Math.max(...nums),
    n: nums.length,
  };
}

const ALLOWED_UNIT_TYPES = ["ST", "1BD", "2BD", "3BD", "4BD"];

async function recalculateLeaseCompStats(buildingNames: string[]): Promise<void> {
  const buildings = await prisma.compBuilding.findMany({
    where: { name: { in: buildingNames } },
    select: { id: true, name: true },
  });

  // Auto-create any buildings that don't exist yet
  const existingNames = new Set(buildings.map((b: { id: string; name: string }) => b.name));
  for (const name of buildingNames) {
    if (!existingNames.has(name)) {
      const created = await prisma.compBuilding.create({ data: { name } });
      buildings.push(created);
    }
  }

  const buildingIds = buildings.map((b: { id: string; name: string }) => b.id);

  // Fetch all lease comps for these buildings
  const leases = await prisma.leaseComp.findMany({
    where: { building: { in: buildingNames } },
  });

  // Update totalN per building
  for (const b of buildings) {
    const count = leases.filter((l: { building: string }) => l.building === b.name).length;
    await prisma.compBuilding.update({ where: { id: b.id }, data: { totalN: count } });
  }

  // CompBuildingStat — replace for affected buildings
  await prisma.compBuildingStat.deleteMany({ where: { buildingId: { in: buildingIds } } });
  for (const b of buildings) {
    const bLeases = leases.filter((l: { building: string }) => l.building === b.name);
    const unitTypes = [...new Set(bLeases.map((l: { unitType: string | null }) => l.unitType).filter(Boolean) as string[])];
    for (const ut of unitTypes) {
      if (!ALLOWED_UNIT_TYPES.includes(ut)) continue;
      const utLeases = bLeases.filter((l: { unitType: string | null }) => l.unitType === ut);
      const rent = computeStats(utLeases.map((l: { grossRent: number | null }) => l.grossRent).filter((n: number | null): n is number => n !== null));
      const psf  = computeStats(utLeases.map((l: { grossPsf: number | null }) => l.grossPsf).filter((n: number | null): n is number => n !== null));
      const sf   = computeStats(utLeases.map((l: { unitSf: number | null }) => l.unitSf).filter((n: number | null): n is number => n !== null));
      await prisma.compBuildingStat.create({
        data: {
          buildingId: b.id, unitType: ut,
          avgRent: rent.avg, medRent: rent.med, minRent: rent.min, maxRent: rent.max, nRent: rent.n,
          avgPsf: psf.avg,  medPsf: psf.med,  minPsf: psf.min,  maxPsf: psf.max,  nPsf: psf.n,
          avgSf:  sf.avg,   medSf:  sf.med,   minSf:  sf.min,   maxSf:  sf.max,   nSf:  sf.n,
        },
      });
    }
  }

  // CompBuildingQuarterStat — upsert per building × quarter × unitType
  for (const b of buildings) {
    const bLeases = leases.filter((l: { building: string; quarter: string | null }) => l.building === b.name && l.quarter);
    const quarters = [...new Set(bLeases.map((l: { quarter: string | null }) => l.quarter) as string[])];
    for (const q of quarters) {
      const qLeases = bLeases.filter((l: { quarter: string | null }) => l.quarter === q);
      const unitTypes = [...new Set(qLeases.map((l: { unitType: string | null }) => l.unitType).filter(Boolean) as string[])];
      for (const ut of unitTypes) {
        if (!ALLOWED_UNIT_TYPES.includes(ut)) continue;
        const utLeases = qLeases.filter((l: { unitType: string | null }) => l.unitType === ut);
        const rent = computeStats(utLeases.map((l: { grossRent: number | null }) => l.grossRent).filter((n: number | null): n is number => n !== null));
        const psf  = computeStats(utLeases.map((l: { grossPsf: number | null }) => l.grossPsf).filter((n: number | null): n is number => n !== null));
        await prisma.compBuildingQuarterStat.upsert({
          where: { buildingId_quarter_unitType: { buildingId: b.id, quarter: q, unitType: ut } },
          create: { buildingId: b.id, quarter: q, quarterOrder: quarterOrder(q), unitType: ut, avgRent: rent.avg, avgPsf: psf.avg, n: utLeases.length },
          update: { avgRent: rent.avg, avgPsf: psf.avg, n: utLeases.length },
        });
      }
    }
  }

  // TrendPoint — recalculate market-wide from ALL leases in DB
  const allLeases = await prisma.leaseComp.findMany({ where: { quarter: { not: null } } });
  const trendMap = new Map<string, { rent: number[]; psf: number[]; qOrder: number }>();
  for (const l of allLeases) {
    if (!l.quarter || !l.unitType || !ALLOWED_UNIT_TYPES.includes(l.unitType)) continue;
    const key = `${l.quarter}::${l.unitType}`;
    if (!trendMap.has(key)) trendMap.set(key, { rent: [], psf: [], qOrder: quarterOrder(l.quarter) });
    if (l.grossRent !== null) trendMap.get(key)!.rent.push(l.grossRent);
    if (l.grossPsf  !== null) trendMap.get(key)!.psf.push(l.grossPsf);
  }
  for (const [key, { rent, psf, qOrder }] of trendMap) {
    const [q, ut] = key.split("::");
    const avgRent = rent.length ? rent.reduce((a, b) => a + b, 0) / rent.length : 0;
    const avgPsf  = psf.length  ? psf.reduce((a, b) => a + b, 0) / psf.length   : null;
    await prisma.trendPoint.upsert({
      where: { quarter_unitType: { quarter: q, unitType: ut } },
      create: { quarter: q, quarterOrder: qOrder, unitType: ut, avgRent, avgPsf },
      update: { avgRent, avgPsf },
    });
  }
}
