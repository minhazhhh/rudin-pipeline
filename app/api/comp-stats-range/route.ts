import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

/** Convert a JS Date to a quarter string like "Q3 2024" */
function dateToQuarter(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

/** Return all quarter strings between two dates (inclusive) */
function quartersInRange(start: Date, end: Date): string[] {
  const result: string[] = [];
  const cur = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
  const endQ = new Date(end.getFullYear(), Math.floor(end.getMonth() / 3) * 3, 1);
  while (cur <= endQ) {
    result.push(dateToQuarter(cur));
    cur.setMonth(cur.getMonth() + 3);
  }
  return result;
}

const UT_ORDER = ["ST", "ST+HO", "1BD", "1BD+HO", "1BD+2HO", "2BD", "2B+HO", "3BD"];
const round2 = (n: number | null) => n == null ? null : Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  const { buildings, startDate, endDate } = await req.json() as {
    buildings: string[];
    startDate: string;
    endDate: string;
  };

  if (!buildings?.length || !startDate || !endDate) {
    return NextResponse.json({ error: "buildings, startDate, and endDate are required." }, { status: 400 });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date format." }, { status: 400 });
  }

  // ── Try raw LeaseComp first ──────────────────────────────────────────────
  const leases = await prisma.leaseComp.findMany({
    where: {
      building: { in: buildings },
      leaseDate: { gte: start, lte: end },
    },
    select: {
      building: true, unitType: true,
      grossRent: true, netRent: true, unitSf: true, grossPsf: true,
    },
  });

  if (leases.length > 0) {
    type Cell = { rents: number[]; psfs: number[]; sfs: number[]; netRents: number[] };
    const groups: Record<string, Cell> = {};
    for (const l of leases) {
      const key = `${l.building}|||${l.unitType ?? "Unknown"}`;
      if (!groups[key]) groups[key] = { rents: [], psfs: [], sfs: [], netRents: [] };
      if (l.grossRent != null) groups[key].rents.push(l.grossRent);
      if (l.grossPsf != null) groups[key].psfs.push(l.grossPsf);
      if (l.unitSf != null) groups[key].sfs.push(l.unitSf);
      if (l.netRent != null) groups[key].netRents.push(l.netRent);
    }
    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const rows = Object.entries(groups).map(([key, cell]) => {
      const [building, unitType] = key.split("|||");
      const rents = [...cell.rents].sort((a, b) => a - b);
      const psfs  = [...cell.psfs].sort((a, b) => a - b);
      const sfs   = [...cell.sfs].sort((a, b) => a - b);
      return {
        building, unitType,
        n: rents.length,
        avgRent: round2(avg(rents)), medRent: round2(median(rents)),
        minRent: rents.length ? rents[0] : null, maxRent: rents.length ? rents[rents.length - 1] : null,
        avgPsf: round2(avg(psfs)), medPsf: round2(median(psfs)),
        avgSf: round2(avg(sfs)), medSf: round2(median(sfs)),
        nPsf: psfs.length, nSf: sfs.length,
        source: "lease-comps" as const,
      };
    });
    rows.sort((a, b) => {
      const bc = a.building.localeCompare(b.building);
      if (bc !== 0) return bc;
      return (UT_ORDER.indexOf(a.unitType) ?? 99) - (UT_ORDER.indexOf(b.unitType) ?? 99);
    });
    return NextResponse.json({ rows, totalLeases: leases.length, source: "lease-comps" });
  }

  // ── Fallback: CompBuildingQuarterStat filtered by quarter range ──────────
  const quarters = quartersInRange(start, end);

  // If date range spans >8 quarters, also accept CompBuildingStat (all-time)
  const useBuildingStat = quarters.length === 0;

  if (useBuildingStat || quarters.length === 0) {
    // All-time stats from CompBuildingStat
    const stats = await prisma.compBuildingStat.findMany({
      where: { building: { name: { in: buildings } } },
      select: {
        unitType: true, nRent: true,
        avgRent: true, medRent: true, minRent: true, maxRent: true,
        avgPsf: true, medPsf: true, avgSf: true, medSf: true, nPsf: true, nSf: true,
        building: { select: { name: true } },
      },
    });
    const rows = stats.map((s) => ({
      building: s.building.name,
      unitType: s.unitType,
      n: s.nRent ?? 0,
      avgRent: round2(s.avgRent), medRent: round2(s.medRent),
      minRent: round2(s.minRent), maxRent: round2(s.maxRent),
      avgPsf: round2(s.avgPsf), medPsf: round2(s.medPsf),
      avgSf: round2(s.avgSf), medSf: round2(s.medSf),
      nPsf: s.nPsf ?? 0, nSf: s.nSf ?? 0,
      source: "building-stat" as const,
    })).filter((r) => r.n > 0);
    rows.sort((a, b) => {
      const bc = a.building.localeCompare(b.building);
      if (bc !== 0) return bc;
      return (UT_ORDER.indexOf(a.unitType) ?? 99) - (UT_ORDER.indexOf(b.unitType) ?? 99);
    });
    return NextResponse.json({ rows, totalLeases: rows.reduce((s, r) => s + r.n, 0), source: "building-stat" });
  }

  // Quarter-level stats
  const qStats = await prisma.compBuildingQuarterStat.findMany({
    where: {
      quarter: { in: quarters },
      building: { name: { in: buildings } },
    },
    select: {
      unitType: true, quarter: true, n: true, avgRent: true, avgPsf: true,
      building: { select: { name: true } },
    },
  });

  // Group by building + unitType, aggregate the quarter averages (weighted by n)
  type QCell = { sumRent: number; sumPsf: number; totalN: number; psfN: number };
  const groups: Record<string, QCell> = {};
  for (const q of qStats) {
    if (!q.n || q.n === 0) continue;
    const key = `${q.building.name}|||${q.unitType}`;
    if (!groups[key]) groups[key] = { sumRent: 0, sumPsf: 0, totalN: 0, psfN: 0 };
    if (q.avgRent != null) { groups[key].sumRent += q.avgRent * q.n; groups[key].totalN += q.n; }
    if (q.avgPsf != null) { groups[key].sumPsf += q.avgPsf * q.n; groups[key].psfN += q.n; }
  }

  const rows = Object.entries(groups).map(([key, cell]) => {
    const [building, unitType] = key.split("|||");
    const avgRent = cell.totalN > 0 ? cell.sumRent / cell.totalN : null;
    const avgPsf  = cell.psfN  > 0 ? cell.sumPsf  / cell.psfN  : null;
    return {
      building, unitType,
      n: cell.totalN,
      avgRent: round2(avgRent), medRent: round2(avgRent), // quarter data has avg only
      minRent: null, maxRent: null,
      avgPsf: round2(avgPsf), medPsf: round2(avgPsf),
      avgSf: null, medSf: null,
      nPsf: cell.psfN, nSf: 0,
      source: "quarter-stat" as const,
    };
  }).filter((r) => r.n > 0);

  rows.sort((a, b) => {
    const bc = a.building.localeCompare(b.building);
    if (bc !== 0) return bc;
    return (UT_ORDER.indexOf(a.unitType) ?? 99) - (UT_ORDER.indexOf(b.unitType) ?? 99);
  });

  // If no quarter data found either, fall all the way back to CompBuildingStat
  if (rows.length === 0) {
    const stats = await prisma.compBuildingStat.findMany({
      where: { building: { name: { in: buildings } } },
      select: {
        unitType: true, nRent: true,
        avgRent: true, medRent: true, minRent: true, maxRent: true,
        avgPsf: true, medPsf: true, avgSf: true, medSf: true, nPsf: true, nSf: true,
        building: { select: { name: true } },
      },
    });
    const fallback = stats.map((s) => ({
      building: s.building.name,
      unitType: s.unitType,
      n: s.nRent ?? 0,
      avgRent: round2(s.avgRent), medRent: round2(s.medRent),
      minRent: round2(s.minRent), maxRent: round2(s.maxRent),
      avgPsf: round2(s.avgPsf), medPsf: round2(s.medPsf),
      avgSf: round2(s.avgSf), medSf: round2(s.medSf),
      nPsf: s.nPsf ?? 0, nSf: s.nSf ?? 0,
      source: "building-stat" as const,
    })).filter((r) => r.n > 0);
    fallback.sort((a, b) => {
      const bc = a.building.localeCompare(b.building);
      if (bc !== 0) return bc;
      return (UT_ORDER.indexOf(a.unitType) ?? 99) - (UT_ORDER.indexOf(b.unitType) ?? 99);
    });
    return NextResponse.json({ rows: fallback, totalLeases: fallback.reduce((s, r) => s + r.n, 0), source: "building-stat" });
  }

  return NextResponse.json({ rows, totalLeases: rows.reduce((s, r) => s + r.n, 0), source: "quarter-stat" });
}
