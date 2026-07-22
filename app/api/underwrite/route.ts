import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';

export const dynamic = 'force-dynamic';

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { propertyTypes, unitTypes } = body as {
      propertyTypes?: string[];
      unitTypes?: string[];
    };

    const leases = await prisma.leaseComp.findMany({
      where: {
        grossRent: { gt: 0 },
        ...(propertyTypes?.length ? { propertyType: { in: propertyTypes } } : {}),
        ...(unitTypes?.length ? { unitType: { in: unitTypes } } : {}),
      },
      select: { unitType: true, grossRent: true, unitSf: true, grossPsf: true },
    });

    // Group by unitType
    const byType: Record<string, { rents: number[]; psfs: number[] }> = {};
    for (const l of leases) {
      if (!l.unitType || !l.grossRent) continue;
      if (!byType[l.unitType]) byType[l.unitType] = { rents: [], psfs: [] };
      byType[l.unitType].rents.push(l.grossRent);
      if (l.grossPsf && l.grossPsf > 0) byType[l.unitType].psfs.push(l.grossPsf);
    }

    const stats: Record<string, {
      n: number;
      med: number;
      avg: number;
      p25: number;
      p75: number;
      medPsf: number;
    }> = {};

    for (const [ut, { rents, psfs }] of Object.entries(byType)) {
      rents.sort((a, b) => a - b);
      psfs.sort((a, b) => a - b);
      const sum = rents.reduce((a, b) => a + b, 0);
      stats[ut] = {
        n: rents.length,
        med: percentile(rents, 50),
        avg: sum / rents.length,
        p25: percentile(rents, 25),
        p75: percentile(rents, 75),
        medPsf: psfs.length ? percentile(psfs, 50) : 0,
      };
    }

    return NextResponse.json({ stats, totalLeases: leases.length });
  } catch (e) {
    console.error('/api/underwrite error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
