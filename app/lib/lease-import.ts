import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import { prisma } from "@/app/lib/prisma";

// The 8 unit types the app's stat tables are built around (see CompBuildingStat.unitType).
// Anything else (e.g. "ST+2HO", "JN2") still counts toward a building's total lease count
// but is excluded from the per-unit-type breakdown, quarter stats, and market trend.
export const ALLOWED_UNIT_TYPES = ["ST", "ST+HO", "1BD", "1BD+HO", "1BD+2HO", "2BD", "2B+HO", "3BD"];

const HEADER_SYNONYMS: Record<string, string[]> = {
  building: ["building", "building name", "property", "property name", "comp building"],
  unitType: ["unit type", "type", "unittype"],
  rent: ["gross rent", "rent", "asking rent", "net rent", "monthly rent"],
  psf: ["gross $/sf", "gross psf", "$/sf", "psf", "rent/sf", "rent psf", "rent per sf"],
  sf: ["unit sf", "sf", "square feet", "sqft"],
  quarter: ["quarter", "qtr"],
  date: ["date", "lease date", "lease start"],
  propertyType: ["property type", "type of property"],
};

export type LeaseRow = {
  building: string;
  unitType: string;
  rent: number | null;
  psf: number | null;
  sf: number | null;
  quarter: string | null;
  quarterOrder: number | null;
  propertyType: string;
};

function normalizeHeaderCell(v: unknown): string {
  return String(v ?? "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, " ");
}

function scoreHeaderRow(cells: string[]): number {
  let score = 0;
  for (const cell of cells) {
    for (const synonyms of Object.values(HEADER_SYNONYMS)) {
      if (synonyms.includes(cell)) {
        score++;
        break;
      }
    }
  }
  return score;
}

/** Some exports (like a dashboard-style workbook) have a title/banner row above the real
*  header row — scan the first few rows and pick whichever one matches the most known fields. */
function findHeaderRowIndex(matrix: unknown[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const score = scoreHeaderRow((matrix[i] ?? []).map(normalizeHeaderCell));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function mapHeaders(headerRow: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((raw, idx) => {
    const cell = normalizeHeaderCell(raw);
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (!(field in map) && synonyms.includes(cell)) map[field] = idx;
    }
  });
  return map;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseQuarterLabel(label: string): { quarter: string; quarterOrder: number } | null {
  const m = /^Q([1-4])\s*(\d{4})$/i.exec(label.trim());
  if (!m) return null;
  const q = Number(m[1]);
  const year = Number(m[2]);
  return { quarter: `Q${q} ${year}`, quarterOrder: year * 10 + q };
}

function quarterFromDate(dateVal: unknown): { quarter: string; quarterOrder: number } | null {
  const d = dateVal instanceof Date ? dateVal : new Date(String(dateVal));
  if (Number.isNaN(d.getTime())) return null;
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const year = d.getUTCFullYear();
  return { quarter: `Q${q} ${year}`, quarterOrder: year * 10 + q };
}

/**
* Reads every sheet of a workbook (or a CSV file, treated as one sheet) and returns the rows
* of the first sheet that looks like lease-level data (a Building column, a Rent column, and
* either a Unit Type, Quarter, or Date column). Returns null if no sheet matches — the caller
* should fall back to treating the file as one of the app's exact per-table templates.
*/
export function extractLeaseRows(buf: ArrayBuffer, filename: string): LeaseRow[] | null {
  const matrices: unknown[][][] = [];

if (/\.csv$/i.test(filename)) {
  const text = new TextDecoder("utf-8").decode(buf);
  matrices.push(parse(text, { skip_empty_lines: true }) as string[][]);
} else {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const order = ["Data", ...wb.SheetNames.filter((n) => n !== "Data")];
  for (const name of order) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    matrices.push(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true }) as unknown[][]);
  }
}

for (const matrix of matrices) {
  if (matrix.length < 2) continue;
  const headerIdx = findHeaderRowIndex(matrix);
  const headerMap = mapHeaders(matrix[headerIdx]);
  if (headerMap.building === undefined || headerMap.rent === undefined) continue;
  if (headerMap.unitType === undefined && headerMap.quarter === undefined && headerMap.date === undefined) continue;

  const rows: LeaseRow[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const r = matrix[i];
    if (!r || r.length === 0) continue;
    const building = String(r[headerMap.building] ?? "").trim();
    if (!building) continue;

  let quarter: string | null = null;
    let quarterOrder: number | null = null;
    if (headerMap.quarter !== undefined) {
      const parsed = parseQuarterLabel(String(r[headerMap.quarter] ?? ""));
      if (parsed) {
        quarter = parsed.quarter;
        quarterOrder = parsed.quarterOrder;
      }
    }
    if (!quarter && headerMap.date !== undefined) {
      const parsed = quarterFromDate(r[headerMap.date]);
      if (parsed) {
        quarter = parsed.quarter;
        quarterOrder = parsed.quarterOrder;
      }
    }

  rows.push({
    building,
    unitType: headerMap.unitType !== undefined ? String(r[headerMap.unitType] ?? "").trim() : "",
    rent: headerMap.rent !== undefined ? num(r[headerMap.rent]) : null,
    psf: headerMap.psf !== undefined ? num(r[headerMap.psf]) : null,
    sf: headerMap.sf !== undefined ? num(r[headerMap.sf]) : null,
    quarter,
    quarterOrder,
    propertyType: headerMap.propertyType !== undefined ? String(r[headerMap.propertyType] ?? "").trim() : "",
  });
  }
  if (rows.length) return rows;
}
  return null;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Matches a raw building name from an import file against the app's existing Comp Building
*  names — exact match first, then prefix containment either direction (handles abbreviations
*  like "355 Lex" -> "355 Lexington Ave" or "55 BROAD ST." -> "55 Broad St"). */
export function matchBuildingName(raw: string, existingNames: string[]): string | null {
  const normRaw = normalizeName(raw);
  for (const name of existingNames) {
    if (normalizeName(name) === normRaw) return name;
  }
  for (const name of existingNames) {
    const normExisting = normalizeName(name);
    if (normRaw.length < 3 || normExisting.length < 3) continue;
    if (normExisting.startsWith(normRaw) || normRaw.startsWith(normExisting)) return name;
  }
  return null;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function stats(nums: number[]): { avg: number | null; med: number | null; min: number | null; max: number | null; n: number } {
  if (!nums.length) return { avg: null, med: null, min: null, max: null, n: 0 };
  return {
    avg: nums.reduce((a, b) => a + b, 0) / nums.length,
    med: median(nums),
    min: Math.min(...nums),
    max: Math.max(...nums),
    n: nums.length,
  };
}

function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best || "Market";
}

export type ImportSummary = {
  totalLeaseRows: number;
  buildings: { raw: string; matched: string | null; leaseCount: number }[];
  unmatchedNames: string[];
  excludedUnitTypeCounts: Record<string, number>;
  missingUnitTypeRows: number;
  quarterRange: [string, string] | null;
  affected: {
  compBuildings: number;
  compBuildingStats: number;
  compBuildingQuarterStats: number;
  trendPoints: number;
  };
};

/** Groups raw lease rows by building name and resolves each to an existing Comp Building,
*  using `overrides` (raw name -> resolved name, which may be a brand-new name) for any the
*  automatic matcher couldn't place. Shared by both the preview and apply paths so the two
*  never disagree about what a run would do. */
async function resolveBuildings(rows: LeaseRow[], overrides: Record<string, string>) {
  const existing = await prisma.compBuilding.findMany({ select: { id: true, name: true } });
  const existingNames = existing.map((b) => b.name);
  const idByName = new Map(existing.map((b) => [b.name, b.id]));

const rawNames = [...new Set(rows.map((r) => r.building))];
  const resolved = new Map<string, string | null>(); // raw -> resolved existing/new name, or null if unresolved
for (const raw of rawNames) {
  if (overrides[raw]) {
    resolved.set(raw, overrides[raw]);
    continue;
  }
  resolved.set(raw, matchBuildingName(raw, existingNames));
}

return { idByName, resolved, existingNames };
}

export async function previewLeaseImport(rows: LeaseRow[], overrides: Record<string, string> = {}): Promise<ImportSummary> {
  const { idByName, resolved } = await resolveBuildings(rows, overrides);

const byRaw = new Map<string, LeaseRow[]>();
  for (const r of rows) {
    if (!byRaw.has(r.building)) byRaw.set(r.building, []);
    byRaw.get(r.building)!.push(r);
  }

const buildings = [...byRaw.entries()].map(([raw, leaseRows]) => ({
  raw,
  matched: resolved.get(raw) ?? null,
  leaseCount: leaseRows.length,
}));
  const unmatchedNames = buildings.filter((b) => !b.matched).map((b) => b.raw);

const excludedUnitTypeCounts: Record<string, number> = {};
  let missingUnitTypeRows = 0;
  const quarters: string[] = [];
  const statKeys = new Set<string>();
  const quarterStatKeys = new Set<string>();
  const trendKeys = new Set<string>();

for (const r of rows) {
  if (r.quarter) quarters.push(r.quarter);
  if (!r.unitType) {
    missingUnitTypeRows++;
    continue;
  }
  if (!ALLOWED_UNIT_TYPES.includes(r.unitType)) {
    excludedUnitTypeCounts[r.unitType] = (excludedUnitTypeCounts[r.unitType] ?? 0) + 1;
    continue;
  }
  const matched = resolved.get(r.building);
  if (matched) statKeys.add(`${matched}::${r.unitType}`);
  if (matched && r.quarter) quarterStatKeys.add(`${matched}::${r.quarter}::${r.unitType}`);
  if (r.quarter) trendKeys.add(`${r.quarter}::${r.unitType}`);
}

quarters.sort();

return {
  totalLeaseRows: rows.length,
  buildings: buildings.sort((a, b) => b.leaseCount - a.leaseCount),
  unmatchedNames,
  excludedUnitTypeCounts,
  missingUnitTypeRows,
  quarterRange: quarters.length ? [quarters[0], quarters[quarters.length - 1]] : null,
  affected: {
    compBuildings: [...byRaw.keys()].filter((raw) => resolved.get(raw) || idByName.has(resolved.get(raw) ?? "")).length,
    compBuildingStats: statKeys.size,
    compBuildingQuarterStats: quarterStatKeys.size,
    trendPoints: trendKeys.size,
  },
};
}

export async function applyLeaseImport(rows: LeaseRow[], overrides: Record<string, string> = {}): Promise<ImportSummary> {
  const { idByName, resolved } = await resolveBuildings(rows, overrides);

// Create any genuinely new buildings named via overrides before we need their ids.
for (const [raw, name] of resolved) {
  if (!name || idByName.has(name)) continue;
  const rowsForRaw = rows.filter((r) => r.building === raw);
  const created = await prisma.compBuilding.create({
    data: { name, propertyType: mode(rowsForRaw.map((r) => r.propertyType)) },
  });
  idByName.set(name, created.id);
}

const byRaw = new Map<string, LeaseRow[]>();
  for (const r of rows) {
    if (!byRaw.has(r.building)) byRaw.set(r.building, []);
    byRaw.get(r.building)!.push(r);
  }

const affectedBuildingIds: string[] = [];

for (const [raw, leaseRows] of byRaw) {
  const name = resolved.get(raw);
  const id = name ? idByName.get(name) : undefined;
  if (!id) continue; // left unresolved — skipped, reported back to the caller via preview separately
  affectedBuildingIds.push(id);
  await prisma.compBuilding.update({ where: { id }, data: { totalN: leaseRows.length } });
}

// Per-building x unit-type stats: replace only for the buildings this import touched.
const statRows: { buildingId: string; unitType: string; rows: LeaseRow[] }[] = [];
  const quarterStatRows: { buildingId: string; quarter: string; quarterOrder: number; unitType: string; rows: LeaseRow[] }[] = [];
  const trendGroups = new Map<string, { quarter: string; quarterOrder: number; unitType: string; rows: LeaseRow[] }>();

for (const [raw, leaseRows] of byRaw) {
  const name = resolved.get(raw);
  const id = name ? idByName.get(name) : undefined;
  for (const utGroup of groupBy(leaseRows, (r) => r.unitType)) {
    if (!utGroup.key || !ALLOWED_UNIT_TYPES.includes(utGroup.key)) continue;
    if (id) statRows.push({ buildingId: id, unitType: utGroup.key, rows: utGroup.rows });
    for (const qGroup of groupBy(utGroup.rows.filter((r) => r.quarter), (r) => r.quarter!)) {
      if (id) {
        quarterStatRows.push({
          buildingId: id,
          quarter: qGroup.key,
          quarterOrder: qGroup.rows[0].quarterOrder ?? 0,
          unitType: utGroup.key,
          rows: qGroup.rows,
        });
      }
      const trendKey = `${qGroup.key}::${utGroup.key}`;
      if (!trendGroups.has(trendKey)) {
        trendGroups.set(trendKey, { quarter: qGroup.key, quarterOrder: qGroup.rows[0].quarterOrder ?? 0, unitType: utGroup.key, rows: [] });
      }
      trendGroups.get(trendKey)!.rows.push(...qGroup.rows);
    }
  }
}

await prisma.$transaction([
  prisma.compBuildingStat.deleteMany({ where: { buildingId: { in: affectedBuildingIds } } }),
  ...statRows.map(({ buildingId, unitType, rows: rs }) => {
    const rent = stats(rs.map((r) => r.rent).filter((n): n is number => n !== null));
    const psf = stats(rs.map((r) => r.psf).filter((n): n is number => n !== null));
    const sf = stats(rs.map((r) => r.sf).filter((n): n is number => n !== null));
    return prisma.compBuildingStat.create({
      data: {
        buildingId,
        unitType,
        avgRent: rent.avg,
        medRent: rent.med,
        minRent: rent.min,
        maxRent: rent.max,
        nRent: rent.n,
        avgPsf: psf.avg,
        medPsf: psf.med,
        minPsf: psf.min,
        maxPsf: psf.max,
        nPsf: psf.n,
        avgSf: sf.avg,
        medSf: sf.med,
        minSf: sf.min,
        maxSf: sf.max,
        nSf: sf.n,
      },
    });
  }),
  ]);

await prisma.$transaction(
  quarterStatRows.map(({ buildingId, quarter, quarterOrder, unitType, rows: rs }) => {
    const rent = stats(rs.map((r) => r.rent).filter((n): n is number => n !== null));
    const psf = stats(rs.map((r) => r.psf).filter((n): n is number => n !== null));
    return prisma.compBuildingQuarterStat.upsert({
      where: { buildingId_quarter_unitType: { buildingId, quarter, unitType } },
      create: { buildingId, quarter, quarterOrder, unitType, avgRent: rent.avg, avgPsf: psf.avg, n: rs.length },
      update: { avgRent: rent.avg, avgPsf: psf.avg, n: rs.length },
    });
  }),
  );

await prisma.$transaction(
  [...trendGroups.values()].map(({ quarter, quarterOrder, unitType, rows: rs }) => {
    const rent = stats(rs.map((r) => r.rent).filter((n): n is number => n !== null));
    const psf = stats(rs.map((r) => r.psf).filter((n): n is number => n !== null));
    return prisma.trendPoint.upsert({
      where: { quarter_unitType: { quarter, unitType } },
      create: { quarter, quarterOrder, unitType, avgRent: rent.avg ?? 0, avgPsf: psf.avg },
      update: { avgRent: rent.avg ?? 0, avgPsf: psf.avg },
    });
  }),
  );

return previewLeaseImport(rows, overrides);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): { key: string; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return [...map.entries()].map(([key, rowsArr]) => ({ key, rows: rowsArr }));
}
