import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

function median(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
}

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

  const leases = await prisma.leaseComp.findMany({
    where: {
      building: { in: buildings },
      leaseDate: { gte: start, lte: end },
    },
    select: {
      building: true,
      unitType: true,
      grossRent: true,
      netRent: true,
      unitSf: true,
      grossPsf: true,
      leaseDate: true,
    },
    orderBy: { leaseDate: "asc" },
  });

  // Group by building + unitType, aggregate
  type Cell = {
    rents: number[];
    psfs: number[];
    sfs: number[];
    netRents: number[];
  };
  const groups: Record<string, Cell> = {};

  for (const l of leases) {
    const key = `${l.building}|||${l.unitType ?? "Unknown"}`;
    if (!groups[key]) groups[key] = { rents: [], psfs: [], sfs: [], netRents: [] };
    if (l.grossRent != null) groups[key].rents.push(l.grossRent);
    if (l.grossPsf != null) groups[key].psfs.push(l.grossPsf);
    if (l.unitSf != null) groups[key].sfs.push(l.unitSf);
    if (l.netRent != null) groups[key].netRents.push(l.netRent);
  }

  const rows = Object.entries(groups).map(([key, cell]) => {
    const [building, unitType] = key.split("|||");
    const rents = [...cell.rents].sort((a, b) => a - b);
    const psfs  = [...cell.psfs].sort((a, b) => a - b);
    const sfs   = [...cell.sfs].sort((a, b) => a - b);
    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
    const round2 = (n: number | null) => n == null ? null : Math.round(n * 100) / 100;

    return {
      building,
      unitType,
      n: rents.length,
      avgRent:  round2(avg(rents)),
      medRent:  round2(median(rents)),
      minRent:  rents.length ? rents[0] : null,
      maxRent:  rents.length ? rents[rents.length - 1] : null,
      avgPsf:   round2(avg(psfs)),
      medPsf:   round2(median(psfs)),
      avgSf:    round2(avg(sfs)),
      medSf:    round2(median(sfs)),
      nPsf:     psfs.length,
      nSf:      sfs.length,
    };
  });

  // Sort: building asc, then unitType order
  const UT_ORDER = ["ST", "1BD", "2BD", "3BD", "4BD"];
  rows.sort((a, b) => {
    const bc = a.building.localeCompare(b.building);
    if (bc !== 0) return bc;
    const ai = UT_ORDER.indexOf(a.unitType);
    const bi = UT_ORDER.indexOf(b.unitType);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return NextResponse.json({ rows, totalLeases: leases.length });
}
