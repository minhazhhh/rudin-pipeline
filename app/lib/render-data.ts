import { prisma } from "@/app/lib/prisma";

// Fixed taxonomies used only for display ordering — not user-editable content.
const PT_ORDER = ["Conversion", "Primary", "Market"];
const UT_ORDER = ["ST", "ST+HO", "1BD", "1BD+HO", "1BD+2HO", "2BD", "2B+HO", "3BD"];

type Triple = { avg: number | null; med: number | null; min: number | null; max: number | null; n: number | null };

function triple(avg: number | null, med: number | null, min: number | null, max: number | null, n: number | null): Triple | null {
  return n == null ? null : { avg, med, min, max, n };
}

export async function loadDashboardData() {
  const [projects, compBuildings, overallStats, typeStats, trendPoints] = await Promise.all([
    prisma.project.findMany({ orderBy: { sqft: "desc" } }),
    prisma.compBuilding.findMany({ include: { stats: true, quarterStats: true } }),
    prisma.overallUnitStat.findMany(),
    prisma.typeUnitStat.findMany(),
    prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } }),
  ]);

  const DATA = projects.map((p) => ({
    n: p.name,
    sub: p.borough,
    st: p.status,
    ct: p.category,
    u: p.units,
    sf: p.sqft,
    d: p.deliveryLabel,
    sp: p.sponsor,
    ln: p.lender,
    lat: p.lat,
    lng: p.lng,
    rudin: p.isRudin ? 1 : 0,
    img: p.imageUrl,
    aff_pct: p.affPct,
    mkt_u: p.mktU,
    aff_u: p.affU,
    avg_sf: p.avgSf,
    aff_bands: Array.isArray(p.affBands)
      ? (p.affBands as Array<{ pctUnits: number; ami: number; studio: number; oneBr: number; twoBr: number }>).map((b) => ({
          pct_units: b.pctUnits,
          ami: b.ami,
          studio: b.studio,
          one_br: b.oneBr,
          two_br: b.twoBr,
        }))
      : null,
  }));

  const yearSet = new Set<string>();
  for (const p of projects) {
    if (/^\d{4}$/.test(p.deliveryLabel)) yearSet.add(p.deliveryLabel);
  }
  const YEARS = [...yearSet].sort();

  const maxUnits = Math.max(1, ...projects.map((p) => p.units ?? 0));
  const maxSf = Math.max(1, ...projects.map((p) => p.sqft ?? 0));

  const COMP_COORDS: Record<string, [number, number]> = {};
  for (const b of compBuildings) {
    if (b.lat != null && b.lng != null) COMP_COORDS[b.name] = [b.lat, b.lng];
  }

  const BSTATS: Record<string, unknown> = {};
  for (const b of compBuildings) {
    const units: Record<string, { avg: number; n: number; avg_psf: number | null }> = {};
    for (const s of b.stats) {
      if (s.nRent == null) continue;
      units[s.unitType] = {
        avg: Math.round(s.avgRent ?? 0),
        n: s.nRent,
        avg_psf: s.avgPsf,
      };
    }
    BSTATS[b.name] = { type: b.propertyType, units };
  }

  const bldg_stats: Record<string, unknown> = {};
  for (const b of compBuildings) {
    if (b.stats.length === 0) continue;
    const units: Record<string, { gr: Triple | null; psf: Triple | null; sf: Triple | null }> = {};
    for (const s of b.stats) {
      units[s.unitType] = {
        gr: triple(s.avgRent, s.medRent, s.minRent, s.maxRent, s.nRent),
        psf: triple(s.avgPsf, s.medPsf, s.minPsf, s.maxPsf, s.nPsf),
        sf: triple(s.avgSf, s.medSf, s.minSf, s.maxSf, s.nSf),
      };
    }
    bldg_stats[b.name] = {
      pt: b.propertyType,
      ...(b.underwritten ? { underwritten: true } : {}),
      ...(b.totalN != null ? { total_n: b.totalN } : {}),
      ...(b.note ? { note: b.note } : {}),
      units,
    };
  }

  const ut_stats: Record<string, unknown> = {};
  for (const s of overallStats) {
    ut_stats[s.unitType] = {
      gr: triple(s.avgRent, s.medRent, s.minRent, s.maxRent, s.nRent),
      psf: triple(s.avgPsf, s.medPsf, s.minPsf, s.maxPsf, s.nPsf),
      sf: triple(s.avgSf, s.medSf, s.minSf, s.maxSf, s.nSf),
    };
  }

  const pt_ut_stats: Record<string, Record<string, unknown>> = {};
  for (const s of typeStats) {
    pt_ut_stats[s.propertyType] ??= {};
    pt_ut_stats[s.propertyType][s.unitType] = {
      gr: triple(s.avgRent, s.medRent, s.minRent, s.maxRent, s.nRent),
      psf: triple(s.avgPsf, s.medPsf, s.minPsf, s.maxPsf, s.nPsf),
    };
  }

  const trend: Record<string, Record<string, number>> = {};
  const trend_psf: Record<string, Record<string, number>> = {};
  const quarterSet: string[] = [];
  for (const t of trendPoints) {
    if (!trend[t.quarter]) {
      trend[t.quarter] = {};
      trend_psf[t.quarter] = {};
      quarterSet.push(t.quarter);
    }
    trend[t.quarter][t.unitType] = t.avgRent;
    if (t.avgPsf != null) trend_psf[t.quarter][t.unitType] = t.avgPsf;
  }

  // Per-building, per-quarter, per-unit-type — sparse by nature (see CompBuildingQuarterStat).
  // bldg_trend[buildingName][quarter][unitType] = { gr, psf, n }
  const bldg_trend: Record<string, Record<string, Record<string, { gr: number | null; psf: number | null; n: number }>>> = {};
  for (const b of compBuildings) {
    if (b.quarterStats.length === 0) continue;
    const byQuarter: Record<string, Record<string, { gr: number | null; psf: number | null; n: number }>> = {};
    for (const s of b.quarterStats) {
      byQuarter[s.quarter] ??= {};
      byQuarter[s.quarter][s.unitType] = { gr: s.avgRent, psf: s.avgPsf, n: s.n };
    }
    bldg_trend[b.name] = byQuarter;
  }

  // All comp building names (sorted), regardless of whether they have stats or trend data.
  // Used by the dashboard to show greyed-out unavailable buildings in selectors.
  const all_bldgs = compBuildings.map((b) => b.name).sort();

  const AGG = {
    ut_stats,
    pt_ut_stats,
    bldg_stats,
    trend,
    trend_psf,
    bldg_trend,
    quarters: quarterSet,
    pt_order: PT_ORDER,
    ut_order: UT_ORDER,
    all_bldgs,
  };

  const NAME_MAP: Record<string, string> = {};
  for (const p of projects) {
    if (p.compBuildingName) NAME_MAP[p.name] = p.compBuildingName;
  }

  return { DATA, YEARS, maxUnits, maxSf, COMP_COORDS, AGG, BSTATS, NAME_MAP };
}
