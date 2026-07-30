import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { csvNum } from "@/app/lib/sync";

export const dynamic = "force-dynamic";

type InRow = Record<string, string>;

export type ValidationIssue = {
  row?: number;    // 1-based
  key?: string;    // record identifier (name, buildingName+unitType, etc.)
  field?: string;
  message: string;
  severity: "error" | "warning";
};
export type ValidationResult = { errors: ValidationIssue[]; warnings: ValidationIssue[] };

// ── Bounds + enums ────────────────────────────────────────────────────────────
const NYC_LAT: [number, number] = [40.45, 40.92];
const NYC_LNG: [number, number] = [-74.30, -73.70];
const PROPERTY_TYPES = new Set(["Conversion", "Primary", "Market"]);
const PROJECT_STATUSES = new Set([
  "Completed Conversion", "Under Construction", "Planned Conversion",
  "Potential Conversion", "Ground-Up New Build", "Lease-up",
]);
const PROJECT_CATEGORIES = new Set(["Office-to-Residential", "Ground-Up New Build"]);

// Quarter format: "Q1 2024", "Q2 2025", etc.
function validQuarter(s: string): boolean {
  return /^Q[1-4] \d{4}$/.test(s.trim());
}

function numOk(s: string | undefined): boolean {
  return s !== undefined && s.trim() !== "" && !isNaN(Number(s.trim()));
}

function numOrEmpty(s: string | undefined): boolean {
  return !s || s.trim() === "" || !isNaN(Number(s.trim()));
}

function latOk(lat: number): boolean { return lat >= NYC_LAT[0] && lat <= NYC_LAT[1]; }
function lngOk(lng: number): boolean { return lng >= NYC_LNG[0] && lng <= NYC_LNG[1]; }

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { requireAdmin } = await import("@/app/lib/api-auth");
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource, rows, siblingKeys } = (await req.json()) as {
    resource: string;
    rows: InRow[];
    siblingKeys?: Record<string, string[]>;
  };

  if (!resource || !Array.isArray(rows)) {
    return NextResponse.json({ error: "resource and rows[] required" }, { status: 400 });
  }

  try {
    const result = await validate(resource, rows, siblingKeys ?? {});
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

async function validate(
  resource: string,
  rows: InRow[],
  siblingKeys: Record<string, string[]>,
): Promise<ValidationResult> {
  switch (resource) {
    case "projects":                    return validateProjects(rows);
    case "comp-buildings":              return validateCompBuildings(rows);
    case "comp-building-stats":         return validateCompBuildingStats(rows, siblingKeys);
    case "comp-building-quarter-stats": return validateCompBuildingQuarterStats(rows, siblingKeys);
    case "overall-stats":               return validateOverallStats(rows);
    case "type-stats":                  return validateTypeStats(rows);
    case "trend":                       return validateTrend(rows);
    default: return { errors: [], warnings: [] };
  }
}

// ── projects ──────────────────────────────────────────────────────────────────

async function validateProjects(rows: InRow[]): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seen = new Set<string>();

  const dbCount = await prisma.project.count();
  if (rows.length > 0 && rows.length < dbCount * 0.7) {
    warnings.push({
      message: `File has ${rows.length} projects but DB has ${dbCount} — ${dbCount - rows.length} existing records not in this file (will be left untouched in upsert mode, deleted in replace mode)`,
      severity: "warning",
    });
  }

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const key = row.name?.trim() || undefined;

    if (!key) { errors.push({ row: rowNum, field: "name", message: "name is required", severity: "error" }); }
    else {
      if (seen.has(key)) errors.push({ row: rowNum, key, message: `Duplicate name "${key}" in file`, severity: "error" });
      else seen.add(key);
    }

    const req = [
      ["borough", row.borough], ["status", row.status], ["category", row.category],
      ["deliveryLabel", row.deliveryLabel], ["sponsor", row.sponsor], ["lender", row.lender],
    ] as [string, string | undefined][];
    for (const [f, v] of req) {
      if (!v?.trim()) errors.push({ row: rowNum, key, field: f, message: `${f} is required`, severity: "error" });
    }

    if (row.status?.trim() && !PROJECT_STATUSES.has(row.status.trim())) {
      errors.push({ row: rowNum, key, field: "status", message: `Unknown status "${row.status.trim()}"`, severity: "error" });
    }
    if (row.category?.trim() && !PROJECT_CATEGORIES.has(row.category.trim())) {
      errors.push({ row: rowNum, key, field: "category", message: `Unknown category "${row.category.trim()}"`, severity: "error" });
    }

    // lat/lng
    if (!row.lat?.trim()) {
      errors.push({ row: rowNum, key, field: "lat", message: "lat is required", severity: "error" });
    } else {
      const lat = Number(row.lat);
      if (isNaN(lat)) errors.push({ row: rowNum, key, field: "lat", message: "lat must be a number", severity: "error" });
      else if (!latOk(lat)) warnings.push({ row: rowNum, key, field: "lat", message: `lat ${lat} is outside NYC bounds (${NYC_LAT[0]}–${NYC_LAT[1]})`, severity: "warning" });
    }
    if (!row.lng?.trim()) {
      errors.push({ row: rowNum, key, field: "lng", message: "lng is required", severity: "error" });
    } else {
      const lng = Number(row.lng);
      if (isNaN(lng)) errors.push({ row: rowNum, key, field: "lng", message: "lng must be a number", severity: "error" });
      else if (!lngOk(lng)) warnings.push({ row: rowNum, key, field: "lng", message: `lng ${lng} is outside NYC bounds (${NYC_LNG[0]}–${NYC_LNG[1]})`, severity: "warning" });
    }

    // Optional numeric fields
    for (const f of ["units", "sqft", "mktU", "affU", "avgSf", "affPct"]) {
      if (!numOrEmpty(row[f])) errors.push({ row: rowNum, key, field: f, message: `${f} must be a number`, severity: "error" });
    }
  });

  return { errors, warnings };
}

// ── comp-buildings ────────────────────────────────────────────────────────────

async function validateCompBuildings(rows: InRow[]): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seen = new Set<string>();

  const dbCount = await prisma.compBuilding.count();
  if (rows.length > 0 && rows.length < dbCount * 0.7) {
    warnings.push({
      message: `File has ${rows.length} buildings but DB has ${dbCount} — ${dbCount - rows.length} existing records not in this file`,
      severity: "warning",
    });
  }

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const key = row.name?.trim() || undefined;

    if (!key) { errors.push({ row: rowNum, field: "name", message: "name is required", severity: "error" }); return; }
    if (seen.has(key)) errors.push({ row: rowNum, key, message: `Duplicate name "${key}" in file`, severity: "error" });
    else seen.add(key);

    if (!row.propertyType?.trim()) {
      errors.push({ row: rowNum, key, field: "propertyType", message: "propertyType is required", severity: "error" });
    } else if (!PROPERTY_TYPES.has(row.propertyType.trim())) {
      errors.push({ row: rowNum, key, field: "propertyType", message: `Unknown propertyType "${row.propertyType.trim()}" — must be Conversion, Primary, or Market`, severity: "error" });
    }

    if (row.lat?.trim()) {
      const lat = Number(row.lat);
      if (isNaN(lat)) errors.push({ row: rowNum, key, field: "lat", message: "lat must be a number", severity: "error" });
      else if (!latOk(lat)) warnings.push({ row: rowNum, key, field: "lat", message: `lat ${lat} outside NYC bounds`, severity: "warning" });
    }
    if (row.lng?.trim()) {
      const lng = Number(row.lng);
      if (isNaN(lng)) errors.push({ row: rowNum, key, field: "lng", message: "lng must be a number", severity: "error" });
      else if (!lngOk(lng)) warnings.push({ row: rowNum, key, field: "lng", message: `lng ${lng} outside NYC bounds`, severity: "warning" });
    }
    if (!numOrEmpty(row.totalN)) errors.push({ row: rowNum, key, field: "totalN", message: "totalN must be a number", severity: "error" });
  });

  return { errors, warnings };
}

// ── comp-building-stats ───────────────────────────────────────────────────────

async function validateCompBuildingStats(
  rows: InRow[],
  siblingKeys: Record<string, string[]>,
): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seen = new Set<string>();
  const RENT_FIELDS = ["avgRent", "medRent", "minRent", "maxRent", "avgPsf", "medPsf", "minPsf", "maxPsf", "avgSf", "medSf", "minSf", "maxSf"];
  const COUNT_FIELDS = ["nRent", "nPsf", "nSf"];

  // Valid building names: DB + sibling import
  const dbBuildings = await prisma.compBuilding.findMany({ select: { name: true } });
  const validNames = new Set([
    ...dbBuildings.map((b) => b.name),
    ...(siblingKeys["comp-buildings"] ?? []),
  ]);

  // Large-change detection: compare incoming avgRent vs DB
  const buildingNames = [...new Set(rows.map((r) => r.buildingName?.trim()).filter(Boolean))] as string[];
  const existingStats = await prisma.compBuildingStat.findMany({
    where: { building: { name: { in: buildingNames } } },
    include: { building: { select: { name: true } } },
  });
  const dbByKey = new Map(existingStats.map((e) => [`${e.building.name}|||${e.unitType}`, e.avgRent]));

  let largeChanges = 0;

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const bName = row.buildingName?.trim();
    const uType = row.unitType?.trim();
    const key = bName && uType ? `${bName}|||${uType}` : undefined;

    if (!bName) { errors.push({ row: rowNum, field: "buildingName", message: "buildingName is required", severity: "error" }); return; }
    if (!uType) { errors.push({ row: rowNum, key: bName, field: "unitType", message: "unitType is required", severity: "error" }); return; }

    if (key) {
      if (seen.has(key)) errors.push({ row: rowNum, key, message: `Duplicate buildingName+unitType "${key}" in file`, severity: "error" });
      else seen.add(key);
    }

    if (!validNames.has(bName)) {
      errors.push({ row: rowNum, key, field: "buildingName", message: `Building "${bName}" not found in database`, severity: "error" });
    }

    for (const f of RENT_FIELDS) {
      if (!numOrEmpty(row[f])) errors.push({ row: rowNum, key, field: f, message: `${f} must be a number`, severity: "error" });
    }
    for (const f of COUNT_FIELDS) {
      if (!numOrEmpty(row[f])) errors.push({ row: rowNum, key, field: f, message: `${f} must be a non-negative integer`, severity: "error" });
    }

    // Large avgRent change
    if (key) {
      const dbRent = dbByKey.get(key);
      const inRent = csvNum(row.avgRent);
      if (dbRent != null && inRent != null && dbRent > 0) {
        const pct = Math.abs((inRent - dbRent) / dbRent);
        if (pct > 0.30) largeChanges++;
      }
    }
  });

  if (largeChanges > 0) {
    warnings.push({
      message: `${largeChanges} record${largeChanges !== 1 ? "s" : ""} have avgRent changes > 30% vs current DB — review the field diff above before confirming`,
      severity: "warning",
    });
  }

  return { errors, warnings };
}

// ── comp-building-quarter-stats ────────────────────────────────────────────────

async function validateCompBuildingQuarterStats(
  rows: InRow[],
  siblingKeys: Record<string, string[]>,
): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seen = new Set<string>();

  const dbBuildings = await prisma.compBuilding.findMany({ select: { name: true } });
  const validNames = new Set([
    ...dbBuildings.map((b) => b.name),
    ...(siblingKeys["comp-buildings"] ?? []),
  ]);

  let badQuarters = 0;
  let largeChanges = 0;

  const buildingNames = [...new Set(rows.map((r) => r.buildingName?.trim()).filter(Boolean))] as string[];
  const existingStats = await prisma.compBuildingQuarterStat.findMany({
    where: { building: { name: { in: buildingNames } } },
    include: { building: { select: { name: true } } },
  });
  const dbByKey = new Map(existingStats.map((e) => [`${e.building.name}|||${e.quarter}|||${e.unitType}`, e.avgRent]));

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const bName = row.buildingName?.trim();
    const quarter = row.quarter?.trim();
    const uType = row.unitType?.trim();
    const key = bName && quarter && uType ? `${bName}|||${quarter}|||${uType}` : undefined;

    if (!bName) { errors.push({ row: rowNum, field: "buildingName", message: "buildingName is required", severity: "error" }); return; }
    if (!quarter) { errors.push({ row: rowNum, key: bName, field: "quarter", message: "quarter is required (e.g. Q3 2024)", severity: "error" }); return; }
    if (!uType) { errors.push({ row: rowNum, key: bName, field: "unitType", message: "unitType is required", severity: "error" }); return; }

    if (!validQuarter(quarter)) { badQuarters++; }

    if (key) {
      if (seen.has(key)) errors.push({ row: rowNum, key, message: `Duplicate buildingName+quarter+unitType "${key}" in file`, severity: "error" });
      else seen.add(key);
    }

    if (!validNames.has(bName)) {
      errors.push({ row: rowNum, key, field: "buildingName", message: `Building "${bName}" not found in database`, severity: "error" });
    }

    if (!numOrEmpty(row.avgRent)) errors.push({ row: rowNum, key, field: "avgRent", message: "avgRent must be a number", severity: "error" });
    if (!numOrEmpty(row.avgPsf)) errors.push({ row: rowNum, key, field: "avgPsf", message: "avgPsf must be a number", severity: "error" });
    if (row.n?.trim() && (isNaN(Number(row.n)) || Number(row.n) < 0)) {
      errors.push({ row: rowNum, key, field: "n", message: "n must be a non-negative integer", severity: "error" });
    }

    if (key) {
      const dbRent = dbByKey.get(key);
      const inRent = csvNum(row.avgRent);
      if (dbRent != null && inRent != null && dbRent > 0) {
        if (Math.abs((inRent - dbRent) / dbRent) > 0.30) largeChanges++;
      }
    }
  });

  if (badQuarters > 0) {
    errors.push({ message: `${badQuarters} row${badQuarters !== 1 ? "s" : ""} have invalid quarter format — expected "Q1 2024", "Q3 2025", etc.`, severity: "error" });
  }
  if (largeChanges > 0) {
    warnings.push({ message: `${largeChanges} record${largeChanges !== 1 ? "s" : ""} have avgRent changes > 30% vs current DB`, severity: "warning" });
  }

  return { errors, warnings };
}

// ── overall-stats ─────────────────────────────────────────────────────────────

async function validateOverallStats(rows: InRow[]): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seen = new Set<string>();
  const FIELDS = ["avgRent", "medRent", "minRent", "maxRent", "avgPsf", "medPsf", "minPsf", "maxPsf", "avgSf", "medSf", "minSf", "maxSf", "nRent", "nPsf", "nSf"];

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const key = row.unitType?.trim();
    if (!key) { errors.push({ row: rowNum, field: "unitType", message: "unitType is required", severity: "error" }); return; }
    if (seen.has(key)) errors.push({ row: rowNum, key, message: `Duplicate unitType "${key}" in file`, severity: "error" });
    else seen.add(key);
    for (const f of FIELDS) {
      if (!numOrEmpty(row[f])) errors.push({ row: rowNum, key, field: f, message: `${f} must be a number`, severity: "error" });
    }
  });

  return { errors, warnings };
}

// ── type-stats ────────────────────────────────────────────────────────────────

async function validateTypeStats(rows: InRow[]): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seen = new Set<string>();
  const FIELDS = ["avgRent", "medRent", "minRent", "maxRent", "avgPsf", "medPsf", "minPsf", "maxPsf", "nRent", "nPsf"];

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const pt = row.propertyType?.trim();
    const ut = row.unitType?.trim();
    const key = pt && ut ? `${pt}|||${ut}` : undefined;

    if (!pt) { errors.push({ row: rowNum, field: "propertyType", message: "propertyType is required", severity: "error" }); return; }
    if (!ut) { errors.push({ row: rowNum, key: pt, field: "unitType", message: "unitType is required", severity: "error" }); return; }

    if (!PROPERTY_TYPES.has(pt)) {
      errors.push({ row: rowNum, key, field: "propertyType", message: `Unknown propertyType "${pt}" — must be Conversion, Primary, or Market`, severity: "error" });
    }

    if (key) {
      if (seen.has(key)) errors.push({ row: rowNum, key, message: `Duplicate propertyType+unitType "${key}" in file`, severity: "error" });
      else seen.add(key);
    }

    for (const f of FIELDS) {
      if (!numOrEmpty(row[f])) errors.push({ row: rowNum, key, field: f, message: `${f} must be a number`, severity: "error" });
    }
  });

  return { errors, warnings };
}

// ── trend ─────────────────────────────────────────────────────────────────────

async function validateTrend(rows: InRow[]): Promise<ValidationResult> {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const seen = new Set<string>();
  let badQuarters = 0;

  rows.forEach((row, i) => {
    const rowNum = i + 1;
    const quarter = row.quarter?.trim();
    const uType = row.unitType?.trim();
    const key = quarter && uType ? `${quarter}|||${uType}` : undefined;

    if (!quarter) { errors.push({ row: rowNum, field: "quarter", message: "quarter is required", severity: "error" }); return; }
    if (!uType) { errors.push({ row: rowNum, key: quarter, field: "unitType", message: "unitType is required", severity: "error" }); return; }

    if (!validQuarter(quarter)) badQuarters++;

    if (key) {
      if (seen.has(key)) errors.push({ row: rowNum, key, message: `Duplicate quarter+unitType "${key}" in file`, severity: "error" });
      else seen.add(key);
    }

    if (!numOk(row.avgRent)) {
      errors.push({ row: rowNum, key, field: "avgRent", message: "avgRent is required and must be a number", severity: "error" });
    } else if (Number(row.avgRent) <= 0) {
      warnings.push({ row: rowNum, key, field: "avgRent", message: `avgRent ${row.avgRent} is zero or negative`, severity: "warning" });
    }

    if (!numOrEmpty(row.avgPsf)) errors.push({ row: rowNum, key, field: "avgPsf", message: "avgPsf must be a number", severity: "error" });
  });

  if (badQuarters > 0) {
    errors.push({ message: `${badQuarters} row${badQuarters !== 1 ? "s" : ""} have invalid quarter format — expected "Q1 2024"`, severity: "error" });
  }

  return { errors, warnings };
}
