import { NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { propertyTypes, unitTypes } = body as {
      propertyTypes?: string[];
      unitTypes?: string[];
    };

    // Pull all CompBuildingStat rows joined to their building's propertyType
    const rows = await prisma.compBuildingStat.findMany({
      where: {
        ...(unitTypes?.length ? { unitType: { in: unitTypes } } : {}),
        building: propertyTypes?.length
          ? { propertyType: { in: propertyTypes } }
          : undefined,
        nRent: { gt: 0 },
        medRent: { gt: 0 },
      },
      select: {
        unitType: true,
        medRent: true,
        avgRent: true,
        medPsf: true,
        nRent: true,
        building: { select: { propertyType: true } },
      },
    });

    // Group by unitType — treat each building stat as one data point
    // Use medRent values, weight equally (each building is one observation)
    const byType: Record<string, { rents: number[]; psfs: number[]; n: number }> = {};
    for (const r of rows) {
      if (!r.unitType || !r.medRent) continue;
      if (!byType[r.unitType]) byType[r.unitType] = { rents: [], psfs: [], n: 0 };
      byType[r.unitType].rents.push(r.medRent);
      byType[r.unitType].n += r.nRent ?? 1;
      if (r.medPsf && r.medPsf > 0) byType[r.unitType].psfs.push(r.medPsf);
    }

    function percentile(sorted: number[], p: number): number {
      if (!sorted.length) return 0;
      const idx = (p / 100) * (sorted.length - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    }

    const stats: Record<string, {
      n: number;
      med: number;
      avg: number;
      p25: number;
      p75: number;
      medPsf: number;
      bldgCount: number;
    }> = {};

    for (const [ut, { rents, psfs, n }] of Object.entries(byType)) {
      rents.sort((a, b) => a - b);
      psfs.sort((a, b) => a - b);
      const sum = rents.reduce((a, b) => a + b, 0);
      stats[ut] = {
        n,
        bldgCount: rents.length,
        med: percentile(rents, 50),
        avg: rents.length ? sum / rents.length : 0,
        p25: percentile(rents, 25),
        p75: percentile(rents, 75),
        medPsf: psfs.length ? percentile(psfs, 50) : 0,
      };
    }

    return NextResponse.json({ stats, totalBuildings: rows.length });
  } catch (e) {
    console.error('/api/underwrite error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
