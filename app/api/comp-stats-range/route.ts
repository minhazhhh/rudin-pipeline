import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

const UT_ORDER = ["ST", "ST+HO", "1BD", "1BD+HO", "1BD+2HO", "2BD", "2B+HO", "3BD"];
const round2 = (n: number | null | undefined) =>
  n == null ? null : Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  const { buildings, startDate, endDate } = await req.json() as {
    buildings: string[];
    startDate: string;
    endDate: string;
  };

  if (!buildings?.length || !startDate || !endDate) {
    return NextResponse.json(
      { error: "buildings, startDate, and endDate are required." },
      { status: 400 }
    );
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid date format." }, { status: 400 });
  }

  // ── 1. Try raw LeaseComp with exact date filter ──────────────────────────
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
    type Cell = { rents: number[]; psfs: number[]; sfs: number[] };
    const groups: Record<string, Cell> = {};
    for (const l of leases) {
      const key = `${l.building}|||${l.unitType ?? "Unknown"}`;
      if (!groups[key]) groups[key] = { rents: [], psfs: [], sfs: [] };
      if (l.grossRent != null) groups[key].rents.push(l.grossRent);
      if (l.grossPsf  != null) groups[key].psfs.push(l.grossPsf);
      if (l.unitSf    != null) groups[key].sfs.push(l.unitSf);
    }
    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const rows = Object.entries(groups).map(([key, cell]) => {
      const [building, unitType] = key.split("|||");
      const rents = [...cell.rents].sort((a, b) => a - b);
      const psfs  = [...cell.psfs].sort((a, b) => a - b);
      const sfs   = [...cell.sfs].sort((a, b) => a - b);
      return {
        building, unitType, n: rents.length,
        avgRent: round2(avg(rents)), medRent: round2(median(rents)),
        minRent: rents.length ? rents[0] : null,
        maxRent: rents.length ? rents[rents.length - 1] : null,
        avgPsf: round2(avg(psfs)), medPsf: round2(median(psfs)),
        avgSf: round2(avg(sfs)), medSf: round2(median(sfs)),
        nPsf: psfs.length, nSf: sfs.length, source: "lease-comps" as const,
      };
    });
    rows.sort((a, b) => {
      const bc = a.building.localeCompare(b.building);
      return bc !== 0 ? bc
        : (UT_ORDER.indexOf(a.unitType) === -1 ? 99 : UT_ORDER.indexOf(a.unitType))
        - (UT_ORDER.indexOf(b.unitType) === -1 ? 99 : UT_ORDER.indexOf(b.unitType));
    });
    return NextResponse.json({ rows, totalLeases: leases.length, source: "lease-comps" });
  }

  // ── 2. Fallback: CompBuildingStat (all-time aggregates) ──────────────────
  // Raw lease records were not imported; use pre-aggregated building stats.
  // Fetch all stats for the requested buildings via their IDs to avoid
  // relation-filter edge cases with name matching.
  const compBuildings = await prisma.compBuilding.findMany({
    where: { name: { in: buildings } },
    select: {
      name: true,
      stats: {
        select: {
          unitType: true,
          avgRent: true, medRent: true, minRent: true, maxRent: true, nRent: true,
          avgPsf: true, medPsf: true, nPsf: true,
          avgSf: true, medSf: true, nSf: true,
        },
      },
    },
  });

  const rows: Array<{
    building: string; unitType: string; n: number;
    avgRent: number | null; medRent: number | null;
    minRent: number | null; maxRent: number | null;
    avgPsf: number | null; medPsf: number | null;
    avgSf: number | null; medSf: number | null;
    nPsf: number; nSf: number; source: string;
  }> = [];

  for (const b of compBuildings) {
    for (const s of b.stats) {
      // Include row if any rent figure exists, even if count is null
      if (s.avgRent == null && s.medRent == null) continue;
      rows.push({
        building: b.name,
        unitType: s.unitType,
        n: s.nRent ?? 0,
        avgRent: round2(s.avgRent),
        medRent: round2(s.medRent),
        minRent: round2(s.minRent),
        maxRent: round2(s.maxRent),
        avgPsf: round2(s.avgPsf),
        medPsf: round2(s.medPsf),
        avgSf: round2(s.avgSf),
        medSf: round2(s.medSf),
        nPsf: s.nPsf ?? 0,
        nSf: s.nSf ?? 0,
        source: "building-stat",
      });
    }
  }

  rows.sort((a, b) => {
    const bc = a.building.localeCompare(b.building);
    return bc !== 0 ? bc
      : (UT_ORDER.indexOf(a.unitType) === -1 ? 99 : UT_ORDER.indexOf(a.unitType))
      - (UT_ORDER.indexOf(b.unitType) === -1 ? 99 : UT_ORDER.indexOf(b.unitType));
  });

  return NextResponse.json({
    rows,
    totalLeases: rows.reduce((s, r) => s + r.n, 0),
    source: "building-stat",
  });
}
