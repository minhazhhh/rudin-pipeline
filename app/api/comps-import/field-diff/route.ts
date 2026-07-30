import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { csvNum, csvBool, csvStr } from "@/app/lib/sync";

export const dynamic = "force-dynamic";

type InRow = Record<string, string>;

export type FieldChange = { field: string; before: string; after: string };
export type FieldDiffItem = { key: string; label: string; changes: FieldChange[] };
export type FieldDiffResult = { items: FieldDiffItem[]; totalUpdates: number };

function fmtVal(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  // Prisma Decimal comes back as object with toFixed
  if (typeof v === "object" && "toFixed" in (v as object)) return String(v);
  return String(v);
}

function numDiffer(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return false;
  if (a == null || b == null) return true;
  return Math.abs(a - b) > 0.0001;
}

function strDiffer(a: string, b: string): boolean {
  return a.trim() !== b.trim();
}

function boolDiffer(a: boolean, b: boolean): boolean {
  return a !== b;
}

// POST /api/comps-import/field-diff
// Body: { resource: string, rows: InRow[], limit?: number }
// Returns: { items: FieldDiffItem[], totalUpdates: number }
export async function POST(req: NextRequest) {
  const { requireAdmin } = await import("@/app/lib/api-auth");
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource, rows, limit = 30 } = (await req.json()) as {
    resource: string;
    rows: InRow[];
    limit?: number;
  };
  if (!resource || !Array.isArray(rows)) {
    return NextResponse.json({ error: "resource and rows[] required" }, { status: 400 });
  }

  try {
    const result = await computeFieldDiff(resource, rows, limit);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

async function computeFieldDiff(resource: string, rows: InRow[], limit: number): Promise<FieldDiffResult> {
  switch (resource) {
    case "projects":          return diffProjects(rows, limit);
    case "comp-buildings":    return diffCompBuildings(rows, limit);
    case "comp-building-stats":         return diffCompBuildingStats(rows, limit);
    case "comp-building-quarter-stats": return diffCompBuildingQuarterStats(rows, limit);
    case "overall-stats":     return diffOverallStats(rows, limit);
    case "type-stats":        return diffTypeStats(rows, limit);
    case "trend":             return diffTrend(rows, limit);
    default: return { items: [], totalUpdates: 0 };
  }
}

async function diffProjects(rows: InRow[], limit: number): Promise<FieldDiffResult> {
  const updateRows = rows.filter((r) => r.name?.trim());
  const names = updateRows.map((r) => r.name.trim());
  const existing = await prisma.project.findMany({
    where: { name: { in: names } },
    select: {
      name: true, borough: true, status: true, category: true, deliveryLabel: true,
      units: true, sqft: true, lat: true, lng: true, isRudin: true,
      sponsor: true, lender: true, address: true,
      affPct: true, mktU: true, affU: true, avgSf: true,
    },
  });
  const byName = new Map(existing.map((e) => [e.name, e]));

  const items: FieldDiffItem[] = [];
  let totalUpdates = 0;

  for (const row of updateRows) {
    const key = row.name.trim();
    const ex = byName.get(key);
    if (!ex) continue;
    totalUpdates++;
    if (items.length >= limit) continue;

    const changes: FieldChange[] = [];
    const fields: Array<[string, string, unknown]> = [
      ["borough",       csvStr(row.borough),       ex.borough],
      ["deliveryLabel", csvStr(row.deliveryLabel),  ex.deliveryLabel],
      ["status",        csvStr(row.status),         ex.status],
      ["category",      csvStr(row.category),       ex.category],
      ["units",         fmtVal(csvNum(row.units)),   fmtVal(ex.units)],
      ["sqft",          fmtVal(csvNum(row.sqft)),    fmtVal(ex.sqft)],
      ["lat",           fmtVal(csvNum(row.lat)),     fmtVal(ex.lat)],
      ["lng",           fmtVal(csvNum(row.lng)),     fmtVal(ex.lng)],
      ["sponsor",       csvStr(row.sponsor),         ex.sponsor],
      ["lender",        csvStr(row.lender),          ex.lender],
      ["address",       csvStr(row.address),         ex.address ?? ""],
      ["isRudin",       String(csvBool(row.isRudin)), String(ex.isRudin)],
      ["affPct",        fmtVal(csvNum(row.affPct)),  fmtVal(ex.affPct)],
      ["mktU",          fmtVal(csvNum(row.mktU)),    fmtVal(ex.mktU)],
      ["affU",          fmtVal(csvNum(row.affU)),    fmtVal(ex.affU)],
      ["avgSf",         fmtVal(csvNum(row.avgSf)),   fmtVal(ex.avgSf)],
    ];

    for (const [field, after, beforeRaw] of fields) {
      const before = fmtVal(beforeRaw);
      if (strDiffer(before, after)) changes.push({ field, before, after });
    }
    if (changes.length > 0) items.push({ key, label: key, changes });
  }

  return { items, totalUpdates };
}

async function diffCompBuildings(rows: InRow[], limit: number): Promise<FieldDiffResult> {
  const names = rows.map((r) => r.name?.trim()).filter(Boolean) as string[];
  const existing = await prisma.compBuilding.findMany({
    where: { name: { in: names } },
    select: { name: true, propertyType: true, lat: true, lng: true, underwritten: true, note: true, totalN: true },
  });
  const byName = new Map(existing.map((e) => [e.name, e]));

  const items: FieldDiffItem[] = [];
  let totalUpdates = 0;

  for (const row of rows) {
    const key = row.name?.trim();
    if (!key) continue;
    const ex = byName.get(key);
    if (!ex) continue;
    totalUpdates++;
    if (items.length >= limit) continue;

    const changes: FieldChange[] = [];
    const inPT   = csvStr(row.propertyType);
    const inLat  = csvNum(row.lat);
    const inLng  = csvNum(row.lng);
    const inUW   = csvBool(row.underwritten);
    const inNote = row.note?.trim() ?? "";
    const inTotalN = csvNum(row.totalN);

    if (strDiffer(inPT, ex.propertyType ?? "")) changes.push({ field: "propertyType", before: ex.propertyType ?? "", after: inPT });
    if (numDiffer(inLat, ex.lat)) changes.push({ field: "lat", before: fmtVal(ex.lat), after: fmtVal(inLat) });
    if (numDiffer(inLng, ex.lng)) changes.push({ field: "lng", before: fmtVal(ex.lng), after: fmtVal(inLng) });
    if (boolDiffer(inUW, ex.underwritten ?? false)) changes.push({ field: "underwritten", before: String(ex.underwritten), after: String(inUW) });
    if (strDiffer(inNote, ex.note ?? "")) changes.push({ field: "note", before: ex.note ?? "", after: inNote });
    if (numDiffer(inTotalN, ex.totalN)) changes.push({ field: "totalN", before: fmtVal(ex.totalN), after: fmtVal(inTotalN) });

    if (changes.length > 0) items.push({ key, label: key, changes });
  }

  return { items, totalUpdates };
}

async function diffCompBuildingStats(rows: InRow[], limit: number): Promise<FieldDiffResult> {
  const buildingNames = [...new Set(rows.map((r) => r.buildingName?.trim()).filter(Boolean))] as string[];
  const existing = await prisma.compBuildingStat.findMany({
    where: { building: { name: { in: buildingNames } } },
    include: { building: { select: { name: true } } },
  });
  const byKey = new Map(existing.map((e) => [`${e.building.name}|||${e.unitType}`, e]));

  const items: FieldDiffItem[] = [];
  let totalUpdates = 0;
  const RENT_FIELDS = ["avgRent", "medRent", "minRent", "maxRent", "nRent", "avgPsf", "medPsf", "minPsf", "maxPsf", "nPsf", "avgSf", "medSf", "minSf", "maxSf", "nSf"] as const;

  for (const row of rows) {
    const bName = row.buildingName?.trim();
    const uType = row.unitType?.trim();
    if (!bName || !uType) continue;
    const key = `${bName}|||${uType}`;
    const ex = byKey.get(key);
    if (!ex) continue;
    totalUpdates++;
    if (items.length >= limit) continue;

    const changes: FieldChange[] = [];
    for (const f of RENT_FIELDS) {
      const inV = csvNum(row[f]);
      const exV = ex[f] as number | null;
      if (numDiffer(inV, exV)) changes.push({ field: f, before: fmtVal(exV), after: fmtVal(inV) });
    }
    if (changes.length > 0) items.push({ key, label: `${bName} — ${uType}`, changes });
  }

  return { items, totalUpdates };
}

async function diffCompBuildingQuarterStats(rows: InRow[], limit: number): Promise<FieldDiffResult> {
  const buildingNames = [...new Set(rows.map((r) => r.buildingName?.trim()).filter(Boolean))] as string[];
  const existing = await prisma.compBuildingQuarterStat.findMany({
    where: { building: { name: { in: buildingNames } } },
    include: { building: { select: { name: true } } },
  });
  const byKey = new Map(existing.map((e) => [`${e.building.name}|||${e.quarter}|||${e.unitType}`, e]));

  const items: FieldDiffItem[] = [];
  let totalUpdates = 0;

  for (const row of rows) {
    const bName = row.buildingName?.trim();
    const quarter = row.quarter?.trim();
    const uType = row.unitType?.trim();
    if (!bName || !quarter || !uType) continue;
    const key = `${bName}|||${quarter}|||${uType}`;
    const ex = byKey.get(key);
    if (!ex) continue;
    totalUpdates++;
    if (items.length >= limit) continue;

    const changes: FieldChange[] = [];
    const inAvg = csvNum(row.avgRent);
    const inN   = csvNum(row.n);
    if (numDiffer(inAvg, ex.avgRent)) changes.push({ field: "avgRent", before: fmtVal(ex.avgRent), after: fmtVal(inAvg) });
    if (numDiffer(inN, ex.n)) changes.push({ field: "n", before: fmtVal(ex.n), after: fmtVal(inN) });
    if (changes.length > 0) items.push({ key, label: `${bName} — ${uType} — ${quarter}`, changes });
  }

  return { items, totalUpdates };
}

async function diffOverallStats(rows: InRow[], limit: number): Promise<FieldDiffResult> {
  const unitTypes = rows.map((r) => r.unitType?.trim()).filter(Boolean) as string[];
  const existing = await prisma.overallUnitStat.findMany({ where: { unitType: { in: unitTypes } } });
  const byKey = new Map(existing.map((e) => [e.unitType, e]));
  const RENT_FIELDS = ["avgRent", "medRent", "minRent", "maxRent", "nRent", "avgPsf", "medPsf", "minPsf", "maxPsf", "nPsf", "avgSf"] as const;

  const items: FieldDiffItem[] = [];
  let totalUpdates = 0;

  for (const row of rows) {
    const key = row.unitType?.trim();
    if (!key) continue;
    const ex = byKey.get(key);
    if (!ex) continue;
    totalUpdates++;
    if (items.length >= limit) continue;

    const changes: FieldChange[] = [];
    for (const f of RENT_FIELDS) {
      const inV = csvNum(row[f]);
      const exV = ex[f] as number | null;
      if (numDiffer(inV, exV)) changes.push({ field: f, before: fmtVal(exV), after: fmtVal(inV) });
    }
    if (changes.length > 0) items.push({ key, label: key, changes });
  }

  return { items, totalUpdates };
}

async function diffTypeStats(rows: InRow[], limit: number): Promise<FieldDiffResult> {
  const existing = await prisma.typeUnitStat.findMany();
  const byKey = new Map(existing.map((e) => [`${e.propertyType}|||${e.unitType}`, e]));
  const RENT_FIELDS = ["avgRent", "medRent", "minRent", "maxRent", "nRent", "avgPsf", "medPsf", "minPsf", "maxPsf", "nPsf"] as const;

  const items: FieldDiffItem[] = [];
  let totalUpdates = 0;

  for (const row of rows) {
    const pt = row.propertyType?.trim();
    const ut = row.unitType?.trim();
    if (!pt || !ut) continue;
    const key = `${pt}|||${ut}`;
    const ex = byKey.get(key);
    if (!ex) continue;
    totalUpdates++;
    if (items.length >= limit) continue;

    const changes: FieldChange[] = [];
    for (const f of RENT_FIELDS) {
      const inV = csvNum(row[f]);
      const exV = ex[f] as number | null;
      if (numDiffer(inV, exV)) changes.push({ field: f, before: fmtVal(exV), after: fmtVal(inV) });
    }
    if (changes.length > 0) items.push({ key, label: `${pt} — ${ut}`, changes });
  }

  return { items, totalUpdates };
}

async function diffTrend(rows: InRow[], limit: number): Promise<FieldDiffResult> {
  const existing = await prisma.trendPoint.findMany();
  const byKey = new Map(existing.map((e) => [`${e.quarter}|||${e.unitType}`, e]));

  const items: FieldDiffItem[] = [];
  let totalUpdates = 0;

  for (const row of rows) {
    const quarter = row.quarter?.trim();
    const uType   = row.unitType?.trim();
    if (!quarter || !uType) continue;
    const key = `${quarter}|||${uType}`;
    const ex = byKey.get(key);
    if (!ex) continue;
    totalUpdates++;
    if (items.length >= limit) continue;

    const changes: FieldChange[] = [];
    const inAvg = csvNum(row.avgRent);
    const inPsf = csvNum(row.avgPsf);
    if (numDiffer(inAvg, ex.avgRent)) changes.push({ field: "avgRent", before: fmtVal(ex.avgRent), after: fmtVal(inAvg) });
    if (numDiffer(inPsf, ex.avgPsf)) changes.push({ field: "avgPsf", before: fmtVal(ex.avgPsf), after: fmtVal(inPsf) });
    if (changes.length > 0) items.push({ key, label: `${quarter} — ${uType}`, changes });
  }

  return { items, totalUpdates };
}
