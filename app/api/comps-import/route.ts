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
    // Snapshot current state before any destructive write so it can be restored
    await snapshotBefore(resource, rows.length, mode);
    const { count, derived } = await importResource(resource, rows, mode);
    await prisma.syncConfig.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } });
    return NextResponse.json({ ok: true, resource, rowsImported: count, derived, mode });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

type ImportResult = { count: number; derived?: string[] };

async function importResource(resource: Resource, rows: ImportRow[], mode: ImportMode): Promise<ImportResult> {
  switch (resource) {
    case "projects": return { count: await importProjects(rows, mode) };
    case "comp-buildings": return { count: await importCompBuildings(rows, mode) };
    case "comp-building-stats": return { count: await importCompBuildingStats(rows, mode) };
    case "comp-building-quarter-stats": return { count: await importCompBuildingQuarterStats(rows, mode) };
    case "overall-stats": return { count: await importOverallStats(rows, mode) };
    case "type-stats": return { count: await importTypeStats(rows, mode) };
    case "trend": return { count: await importTrend(rows, mode) };
    case "lease-comps": return importLeaseCompsWithDerived(rows, mode);
    case "comp-building-units": return { count: await importCompBuildingUnits(rows, mode) };
  }
}

async function importLeaseCompsWithDerived(rows: ImportRow[], mode: ImportMode): Promise<ImportResult> {
  const count = await importLeaseComps(rows, mode);
  // lease-comps import cascades into 4 derived tables — report them
  return {
    count,
    derived: ["Comp Building Stats", "Comp Building Quarter Stats", "Rent Trend", "Overall Unit Stats"],
  };
}

async function snapshotBefore(resource: Resource, incomingCount: number, mode: ImportMode) {
  try {
    const current = await fetchCurrentForSnapshot(resource);
    if (current.length === 0) return; // nothing to snapshot
    const verb = mode === "replace" ? "Replace" : "Merge";
    const label = `Before ${verb.toLowerCase()} — ${current.length} rows → ${incomingCount} incoming`;
    await prisma.snapshot.create({ data: { resource, label, data: current as object[] } });
    // Keep at most 20 snapshots per resource
    const all = await prisma.snapshot.findMany({ where: { resource }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (all.length > 20) {
      const toDelete = all.slice(20).map((s) => s.id);
      await prisma.snapshot.deleteMany({ where: { id: { in: toDelete } } });
    }
  } catch { /* snapshot failure is non-fatal */ }
}

async function fetchCurrentForSnapshot(resource: Resource): Promise<Record<string, unknown>[]> {
  switch (resource) {
    case "comp-building-stats":
      return prisma.compBuildingStat.findMany({ include: { building: { select: { name: true } } } });
    case "comp-building-quarter-stats":
      return prisma.compBuildingQuarterStat.findMany({ include: { building: { select: { name: true } } } });
    case "comp-buildings": return prisma.compBuilding.findMany();
    case "overall-stats": return prisma.overallUnitStat.findMany();
    case "type-stats": return prisma.typeUnitStat.findMany();
    case "trend": return prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } });
    case "projects": return prisma.project.findMany();
    case "lease-comps": return prisma.leaseComp.findMany();
    default: return [];
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
      address: r.address?.trim() || null,
      lat: csvNum(r.lat) ?? 0, lng: csvNum(r.lng) ?? 0,
      isRudin: csvBool(r.isRudin),
      imageUrl: csvStr(r.imageUrl), affPct: csvNum(r.affPct), mktU: csvNum(r.mktU),
      affU: csvNum(r.affU), avgSf: csvNum(r.avgSf), affBands: affBands ?? undefined,
      compBuildingName: r.compBuildingName?.trim() || null,
    };
  });
  if (mode === "replace") {
    await prisma.project.deleteMany();
    if (data.length) await prisma.project.createMany({ data });
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
    await prisma.compBuildingStat.deleteMany();
    await prisma.compBuilding.deleteMany();
    if (data.length) await prisma.compBuilding.createMany({ data });
  } else {
    for (const d of data) await prisma.compBuilding.upsert({ where: { name: d.name }, update: d, create: d });
  }
  return data.length;
}

async function importCompBuildingStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const buildingNames = [...new Set(rows.map((r) => csvStr(r.buildingName).trim()).filter(Boolean))];
  const existing = await prisma.compBuilding.findMany({ where: { name: { in: buildingNames } }, select: { id: true, name: true } });
  const idByName = new Map(existing.map((b: { id: string; name: string }) => [b.name, b.id]));
  // Skip rows whose building name doesn't match a known building (catches footnotes/headers that slip through)
  const data = rows
    .map((r) => {
      const buildingId = idByName.get(csvStr(r.buildingName).trim());
      if (!buildingId) return null;
      return { buildingId, unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent), medRent: csvNum(r.medRent), minRent: csvNum(r.minRent), maxRent: csvNum(r.maxRent), nRent: csvNum(r.nRent), avgPsf: csvNum(r.avgPsf), medPsf: csvNum(r.medPsf), minPsf: csvNum(r.minPsf), maxPsf: csvNum(r.maxPsf), nPsf: csvNum(r.nPsf), avgSf: csvNum(r.avgSf), medSf: csvNum(r.medSf), minSf: csvNum(r.minSf), maxSf: csvNum(r.maxSf), nSf: csvNum(r.nSf) };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  if (mode === "replace" && data.length > 0) {
    await prisma.compBuildingStat.deleteMany();
    await prisma.compBuildingStat.createMany({ data });
  } else {
    for (const d of data) await prisma.compBuildingStat.upsert({ where: { buildingId_unitType: { buildingId: d.buildingId, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

async function importCompBuildingQuarterStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const buildingNames = [...new Set(rows.map((r) => csvStr(r.buildingName).trim()).filter(Boolean))];
  const existing = await prisma.compBuilding.findMany({ where: { name: { in: buildingNames } }, select: { id: true, name: true } });
  const idByName = new Map(existing.map((b: { id: string; name: string }) => [b.name, b.id]));
  // Skip rows without a known building or missing required fields
  const data = rows
    .map((r) => {
      const buildingId = idByName.get(csvStr(r.buildingName).trim());
      const quarter = csvStr(r.quarter);
      const unitType = csvStr(r.unitType);
      if (!buildingId || !quarter || !unitType) return null;
      const quarterOrder = csvNum(r.quarterOrder) ?? deriveQuarterOrder(quarter);
      return { buildingId, quarter, quarterOrder, unitType, avgRent: csvNum(r.avgRent), avgPsf: csvNum(r.avgPsf), n: csvNum(r.n) ?? 0 };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  if (mode === "replace" && data.length > 0) {
    await prisma.compBuildingQuarterStat.deleteMany();
    await prisma.compBuildingQuarterStat.createMany({ data });
  } else {
    for (const d of data) await prisma.compBuildingQuarterStat.upsert({ where: { buildingId_quarter_unitType: { buildingId: d.buildingId, quarter: d.quarter, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

async function importOverallStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  // Deduplicate by unitType — last row wins (matches upsert semantics)
  const byUnitType = new Map<string, ReturnType<typeof mapOverallStatRow>>();
  for (const r of rows) {
    const mapped = mapOverallStatRow(r);
    if (mapped.unitType) byUnitType.set(mapped.unitType, mapped);
  }
  const data = [...byUnitType.values()];
  if (mode === "replace" && data.length > 0) {
    await prisma.overallUnitStat.deleteMany();
    await prisma.overallUnitStat.createMany({ data });
  } else {
    for (const d of data) await prisma.overallUnitStat.upsert({ where: { unitType: d.unitType }, update: d, create: d });
  }
  return data.length;
}

function mapOverallStatRow(r: ImportRow) {
  return { unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent), medRent: csvNum(r.medRent), minRent: csvNum(r.minRent), maxRent: csvNum(r.maxRent), nRent: csvNum(r.nRent), avgPsf: csvNum(r.avgPsf), medPsf: csvNum(r.medPsf), minPsf: csvNum(r.minPsf), maxPsf: csvNum(r.maxPsf), nPsf: csvNum(r.nPsf), avgSf: csvNum(r.avgSf), medSf: csvNum(r.medSf), minSf: csvNum(r.minSf), maxSf: csvNum(r.maxSf), nSf: csvNum(r.nSf) };
}

async function importTypeStats(rows: ImportRow[], mode: ImportMode): Promise<number> {
  // Deduplicate by propertyType+unitType
  const byKey = new Map<string, { propertyType: string; unitType: string; avgRent: number | null; medRent: number | null; minRent: number | null; maxRent: number | null; nRent: number | null; avgPsf: number | null; medPsf: number | null; minPsf: number | null; maxPsf: number | null; nPsf: number | null }>();
  for (const r of rows) {
    const d = { propertyType: csvStr(r.propertyType), unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent), medRent: csvNum(r.medRent), minRent: csvNum(r.minRent), maxRent: csvNum(r.maxRent), nRent: csvNum(r.nRent), avgPsf: csvNum(r.avgPsf), medPsf: csvNum(r.medPsf), minPsf: csvNum(r.minPsf), maxPsf: csvNum(r.maxPsf), nPsf: csvNum(r.nPsf) };
    if (d.propertyType && d.unitType) byKey.set(`${d.propertyType}::${d.unitType}`, d);
  }
  const data = [...byKey.values()];
  if (mode === "replace" && data.length > 0) {
    await prisma.typeUnitStat.deleteMany();
    await prisma.typeUnitStat.createMany({ data });
  } else {
    for (const d of data) await prisma.typeUnitStat.upsert({ where: { propertyType_unitType: { propertyType: d.propertyType, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

function deriveQuarterOrder(quarter: string): number {
  // Parse "Q3 2024" → 20243, "Q1 2025" → 20251, etc.
  const m = quarter.trim().match(/Q(\d)\s+(\d{4})/i);
  if (m) return parseInt(m[2]) * 10 + parseInt(m[1]);
  // Fallback: try "2024 Q3" format
  const m2 = quarter.trim().match(/(\d{4})\s+Q(\d)/i);
  if (m2) return parseInt(m2[1]) * 10 + parseInt(m2[2]);
  return 0;
}

async function importTrend(rows: ImportRow[], mode: ImportMode): Promise<number> {
  // Deduplicate by quarter+unitType
  const byKey = new Map<string, { quarter: string; quarterOrder: number; unitType: string; avgRent: number; avgPsf: number | null }>();
  for (const r of rows) {
    const quarter = csvStr(r.quarter);
    // Auto-derive quarterOrder from quarter label if not explicitly provided
    const quarterOrder = csvNum(r.quarterOrder) ?? deriveQuarterOrder(quarter);
    const d = { quarter, quarterOrder, unitType: csvStr(r.unitType), avgRent: csvNum(r.avgRent) ?? 0, avgPsf: csvNum(r.avgPsf) };
    if (d.quarter && d.unitType) byKey.set(`${d.quarter}::${d.unitType}`, d);
  }
  const data = [...byKey.values()];
  if (mode === "replace" && data.length > 0) {
    await prisma.trendPoint.deleteMany();
    await prisma.trendPoint.createMany({ data });
  } else {
    for (const d of data) await prisma.trendPoint.upsert({ where: { quarter_unitType: { quarter: d.quarter, unitType: d.unitType } }, update: d, create: d });
  }
  return data.length;
}

// Normalize a raw unitType string, floorplan, bed/bath counts, and sf to standard codes.
// Uses a scoring/evidence-accumulation approach: each signal votes for a bucket;
// highest-voted bucket wins. Returns null when evidence is genuinely ambiguous.
// Standard output codes: "ST", "1BD", "2BD", "3BD", "4BD"
// Home-office variants: "ST+HO", "1BD+HO", "2BD+HO"
function deriveUnitType(
  raw: string | undefined,
  beds: number | null,
  baths: number | null,
  sf: number | null,
  floorplan: string | undefined
): string | null {
  // ── helpers ───────────────────────────────────────────────────────────────
  function hasHO(s: string): boolean {
    const u = s.toUpperCase();
    return /\+\s*HO\b/.test(u) || /HOME\s*OFFICE/.test(u) || /\+\s*DEN\b/.test(u) || /\bDEN\b/.test(u);
  }

  type Bucket = "ST" | "1BD" | "2BD" | "3BD" | "4BD";
  const scores: Record<Bucket, number> = { ST: 0, "1BD": 0, "2BD": 0, "3BD": 0, "4BD": 0 };
  function vote(b: Bucket, w: number) { scores[b] += w; }
  function bdsCode(n: number): Bucket { return n === 0 ? "ST" : n === 1 ? "1BD" : n === 2 ? "2BD" : n === 3 ? "3BD" : "4BD"; }

  // Parse a text field (raw label or floorplan name/code) into evidence
  function parseText(s: string, isFloorplan: boolean): { bucket: Bucket | null; weight: number } {
    const t = s.trim();
    if (!t) return { bucket: null, weight: 0 };

    // Junior / Jr → always ST (partial wall, not a full bedroom)
    if (/^JR\.?\s*1?\s*(BR|BED(ROOM)?)?$/i.test(t) || /^JUNIOR(\s*(1\s*)?(BR|BED(ROOM)?))?$/i.test(t)) {
      return { bucket: "ST", weight: 10 };
    }

    // Bare single digit
    if (/^\d$/.test(t)) return { bucket: bdsCode(parseInt(t)), weight: 9 };

    // Slash format X/Y → X = beds
    const slashM = t.match(/^(\d)\/(\d)$/);
    if (slashM && parseInt(slashM[1]) <= 4) return { bucket: bdsCode(parseInt(slashM[1])), weight: 9 };

    // "1 Bed/1 Bath" style
    const bedBathSlash = t.match(/^(\d)\s*(?:bed|br|bedroom)s?\s*\/\s*\d\s*(?:bath|ba)s?$/i);
    if (bedBathSlash) return { bucket: bdsCode(parseInt(bedBathSlash[1])), weight: 9 };

    // Studio keywords
    if (/\bSTUDIO\b/i.test(t) || /\bEFFICIENCY\b/i.test(t) || /^EFF$/i.test(t) ||
        /\bCONVERTIBLE\b/i.test(t) || /^CONV$/i.test(t) || /\bFLEX\b/i.test(t)) {
      return { bucket: "ST", weight: 10 };
    }

    // Alcove → always ST (NYC alcoves are always studios)
    if (/\bALCOVE\b/i.test(t)) return { bucket: "ST", weight: 10 };

    // "S" alone → ST (Studio floorplan convention)
    if (/^S$/i.test(t)) return { bucket: "ST", weight: 9 };

    // Floorplan codes starting with S (SA, S1, S-A) → ST
    if (isFloorplan && /^S[A-Z0-9]/i.test(t)) return { bucket: "ST", weight: 7 };

    // Loft / Studio Loft alone → ST (lower weight so beds can override)
    if (/^LOFT$/i.test(t) || /^STUDIO\s*LOFT$/i.test(t)) return { bucket: "ST", weight: 5 };

    // "0 BR / 0 Bed" → ST
    if (/^0\s*(br|bed(room)?s?)$/i.test(t)) return { bucket: "ST", weight: 10 };

    // Numeric bedroom patterns: "1BR", "1 Bed", "1-Bedroom", "1BD" etc.
    const numBedM = t.match(/^(\d)[\s\-]*(?:bd|br|bed(?:room)?s?)(?:\s|$|\/|\+|,)/i);
    if (numBedM) return { bucket: bdsCode(parseInt(numBedM[1])), weight: 10 };
    const numBedFull = t.match(/^(\d)[\s\-]*(?:bd|br|bed(?:room)?s?)$/i);
    if (numBedFull) return { bucket: bdsCode(parseInt(numBedFull[1])), weight: 10 };

    // Word bedroom counts
    const wordBedM = t.match(/^(one|two|three|four)\s*(?:bed(?:room)?s?)?/i);
    if (wordBedM) {
      const map: Record<string, Bucket> = { one: "1BD", two: "2BD", three: "3BD", four: "4BD" };
      return { bucket: map[wordBedM[1].toLowerCase()], weight: 10 };
    }

    // "1B" shorthand (moderate confidence)
    const shortB = t.match(/^(\d)B$/i);
    if (shortB && parseInt(shortB[1]) <= 4) return { bucket: bdsCode(parseInt(shortB[1])), weight: 6 };

    // "Studio A/1/..." in floorplan
    if (isFloorplan && /^STUDIO\s*[A-Z0-9]/i.test(t)) return { bucket: "ST", weight: 7 };

    // Ambiguous: letter+number floorplan codes, single non-S letters, ambiguous modifiers
    // These contribute no votes (return null)
    return { bucket: null, weight: 0 };
  }

  // ── 1. Raw string ──────────────────────────────────────────────────────────
  const rawStr = raw?.trim() ?? "";
  if (rawStr) {
    const r = parseText(rawStr, false);
    if (r.bucket) vote(r.bucket, r.weight);
  }

  // ── 2. Floorplan ──────────────────────────────────────────────────────────
  const fpStr = floorplan?.trim() ?? "";
  if (fpStr) {
    const f = parseText(fpStr, true);
    if (f.bucket) vote(f.bucket, f.weight);
  }

  // ── 3. Beds column ────────────────────────────────────────────────────────
  if (beds !== null && beds >= 0 && beds <= 10) vote(bdsCode(beds), 8);

  // ── 4. SF — very conservative tiebreaker only ─────────────────────────────
  if (sf !== null && sf < 620) vote("ST", 2);

  // ── Resolve winner ────────────────────────────────────────────────────────
  const buckets: Bucket[] = ["ST", "1BD", "2BD", "3BD", "4BD"];
  let winner: Bucket | null = null;
  let maxScore = 0;
  for (const b of buckets) {
    if (scores[b] > maxScore) { maxScore = scores[b]; winner = b; }
  }

  // Require minimum confidence
  if (!winner || maxScore < 2) return null;

  // Apply +HO suffix only when raw string explicitly declares it
  const rawHO = rawStr ? hasHO(rawStr) : false;
  if (rawHO && winner && winner !== "3BD" && winner !== "4BD") return winner + "+HO";

  return winner;
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
      const beds = csvNum(r.bedrooms) ?? csvNum(r.beds);
      const baths = csvNum(r.bathrooms) ?? csvNum(r.baths);
      const sf = csvNum(r.sf) ?? csvNum(r.unitSf);
      const fp = r.floorplan?.trim() || r.floorplanName?.trim() || r.planType?.trim();
      return {
        building: csvStr(r.building),
        unit: r.unit?.trim() || null,
        unitType: deriveUnitType(r.unitType, beds, baths, sf, fp),
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
    await prisma.leaseComp.deleteMany();
    if (data.length) await prisma.leaseComp.createMany({ data });
  } else {
    if (data.length) await prisma.leaseComp.createMany({ data });
  }

  // Recalculate all derived stats from the full LeaseComp table
  const affectedBuildings = [...new Set(data.map((d) => d.building))];
  await recalculateLeaseCompStats(affectedBuildings);

  return data.length;
}

async function importCompBuildingUnits(rows: ImportRow[], mode: ImportMode): Promise<number> {
  const buildingNames = [...new Set(rows.map((r) => csvStr(r.buildingName).trim()).filter(Boolean))];
  const existing = await prisma.compBuilding.findMany({ where: { name: { in: buildingNames } }, select: { id: true, name: true } });
  const idByName = new Map(existing.map((b: { id: string; name: string }) => [b.name, b.id]));
  // Auto-create any buildings that don't exist yet
  for (const name of buildingNames) {
    if (!idByName.has(name)) {
      const created = await prisma.compBuilding.create({ data: { name, propertyType: "Market" } });
      idByName.set(name, created.id);
    }
  }
  const data = rows
    .filter((r) => csvStr(r.buildingName).trim())
    .map((r) => ({
      buildingId: idByName.get(csvStr(r.buildingName).trim())!,
      unitName: r.unitName?.trim() || null,
      unitNumber: r.unitNumber?.trim() || null,
      unitType: r.unitType?.trim() || null,
      floor: csvNum(r.floor) != null ? Math.round(csvNum(r.floor)!) : null,
      sf: csvNum(r.sf),
      bedrooms: csvNum(r.bedrooms) != null ? Math.round(csvNum(r.bedrooms)!) : null,
      bathrooms: csvNum(r.bathrooms),
      askingRent: csvNum(r.askingRent),
      netRent: csvNum(r.netRent),
      grossRent: csvNum(r.grossRent),
      psf: csvNum(r.psf),
      concessions: r.concessions?.trim() || null,
      leaseDate: r.leaseDate?.trim() || null,
      leaseStartDate: r.leaseStartDate?.trim() || null,
      leaseEndDate: r.leaseEndDate?.trim() || null,
      leaseTerm: csvNum(r.leaseTerm) != null ? Math.round(csvNum(r.leaseTerm)!) : null,
      status: r.status?.trim() || null,
      notes: r.notes?.trim() || null,
    }));
  if (mode === "replace") {
    const ids = [...idByName.values()];
    await prisma.$transaction([prisma.compBuildingUnit.deleteMany({ where: { buildingId: { in: ids } } }), ...data.map((d) => prisma.compBuildingUnit.create({ data: d }))]);
  } else {
    for (const d of data) await prisma.compBuildingUnit.create({ data: d });
  }
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
      const created = await prisma.compBuilding.create({ data: { name, propertyType: "Market" } });
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

  // OverallUnitStat — aggregate ALL leases across ALL buildings by unit type
  const allLeasesForOverall = await prisma.leaseComp.findMany();
  const overallMap = new Map<string, { rent: number[]; psf: number[]; sf: number[] }>();
  for (const l of allLeasesForOverall) {
    if (!l.unitType || !ALLOWED_UNIT_TYPES.includes(l.unitType)) continue;
    if (!overallMap.has(l.unitType)) overallMap.set(l.unitType, { rent: [], psf: [], sf: [] });
    if (l.grossRent !== null) overallMap.get(l.unitType)!.rent.push(l.grossRent);
    if (l.grossPsf  !== null) overallMap.get(l.unitType)!.psf.push(l.grossPsf);
    if (l.unitSf    !== null) overallMap.get(l.unitType)!.sf.push(l.unitSf);
  }
  for (const [ut, { rent, psf, sf }] of overallMap) {
    const rentS = computeStats(rent), psfS = computeStats(psf), sfS = computeStats(sf);
    await prisma.overallUnitStat.upsert({
      where: { unitType: ut },
      create: { unitType: ut, avgRent: rentS.avg, medRent: rentS.med, minRent: rentS.min, maxRent: rentS.max, nRent: rentS.n, avgPsf: psfS.avg, medPsf: psfS.med, minPsf: psfS.min, maxPsf: psfS.max, nPsf: psfS.n, avgSf: sfS.avg, medSf: sfS.med, minSf: sfS.min, maxSf: sfS.max, nSf: sfS.n },
      update: { avgRent: rentS.avg, medRent: rentS.med, minRent: rentS.min, maxRent: rentS.max, nRent: rentS.n, avgPsf: psfS.avg, medPsf: psfS.med, minPsf: psfS.min, maxPsf: psfS.max, nPsf: psfS.n, avgSf: sfS.avg, medSf: sfS.med, minSf: sfS.min, maxSf: sfS.max, nSf: sfS.n },
    });
  }
}
