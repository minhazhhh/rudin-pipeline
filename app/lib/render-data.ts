import { prisma } from "@/app/lib/prisma";
import type { AdminDraft } from "@/app/generated/prisma/client";

// Fixed taxonomies used only for display ordering — not user-editable content.
const PT_ORDER = ["Conversion", "Primary", "Market"];
const UT_ORDER = ["ST", "ST+HO", "1BD", "1BD+HO", "1BD+2HO", "2BD", "2B+HO", "3BD"];

type Triple = { avg: number | null; med: number | null; min: number | null; max: number | null; n: number | null };

function triple(avg: number | null, med: number | null, min: number | null, max: number | null, n: number | null): Triple | null {
  return n == null ? null : { avg, med, min, max, n };
}

type P = Record<string, unknown>;

function applyDraftPatches(
  raw: {
    projects: { id: string; [k: string]: unknown }[];
    compBuildings: { id: string; stats: { id: string; [k: string]: unknown }[]; quarterStats: { id: string; [k: string]: unknown }[]; [k: string]: unknown }[];
    overallStats: { id: string; [k: string]: unknown }[];
    typeStats: { id: string; [k: string]: unknown }[];
    trendPoints: { id: string; [k: string]: unknown }[];
  },
  drafts: Pick<AdminDraft, "id" | "resource" | "entityId" | "method" | "payload">[]
) {
  for (const draft of drafts) {
    const p = draft.payload as P | null;
    switch (draft.resource) {
      case "comp-buildings": {
        if (draft.method === "PUT" && draft.entityId) {
          const b = raw.compBuildings.find((b) => b.id === draft.entityId);
          if (b && p) Object.assign(b, p);
        } else if (draft.method === "DELETE" && draft.entityId) {
          const idx = raw.compBuildings.findIndex((b) => b.id === draft.entityId);
          if (idx !== -1) raw.compBuildings.splice(idx, 1);
        } else if (draft.method === "POST" && p) {
          raw.compBuildings.push({ id: `draft-${draft.id}`, stats: [], quarterStats: [], ...p } as typeof raw.compBuildings[0]);
        }
        break;
      }
      case "comp-building-stats": {
        if (draft.method === "PUT" && draft.entityId && p) {
          for (const b of raw.compBuildings) {
            const s = b.stats.find((s) => s.id === draft.entityId);
            if (s) { Object.assign(s, p); break; }
          }
        } else if (draft.method === "DELETE" && draft.entityId) {
          for (const b of raw.compBuildings) {
            const idx = b.stats.findIndex((s) => s.id === draft.entityId);
            if (idx !== -1) { b.stats.splice(idx, 1); break; }
          }
        } else if (draft.method === "POST" && p) {
          const building = raw.compBuildings.find((b) => b.id === p.buildingId);
          if (building) building.stats.push({ id: `draft-${draft.id}`, ...p } as typeof raw.compBuildings[0]["stats"][0]);
        }
        break;
      }
      case "projects": {
        if (draft.method === "PUT" && draft.entityId && p) {
          const proj = raw.projects.find((x) => x.id === draft.entityId);
          if (proj) Object.assign(proj, p);
        } else if (draft.method === "DELETE" && draft.entityId) {
          const idx = raw.projects.findIndex((x) => x.id === draft.entityId);
          if (idx !== -1) raw.projects.splice(idx, 1);
        } else if (draft.method === "POST" && p) {
          raw.projects.push({ id: `draft-${draft.id}`, ...p } as typeof raw.projects[0]);
        }
        break;
      }
      case "overall-stats": {
        if (draft.method === "PUT" && draft.entityId && p) {
          const s = raw.overallStats.find((x) => x.id === draft.entityId);
          if (s) Object.assign(s, p);
        } else if (draft.method === "DELETE" && draft.entityId) {
          const idx = raw.overallStats.findIndex((x) => x.id === draft.entityId);
          if (idx !== -1) raw.overallStats.splice(idx, 1);
        }
        break;
      }
      case "trend": {
        if (draft.method === "PUT" && draft.entityId && p) {
          const pt = raw.trendPoints.find((x) => x.id === draft.entityId);
          if (pt) Object.assign(pt, p);
        } else if (draft.method === "DELETE" && draft.entityId) {
          const idx = raw.trendPoints.findIndex((x) => x.id === draft.entityId);
          if (idx !== -1) raw.trendPoints.splice(idx, 1);
        }
        break;
      }
      case "type-stats": {
        if (draft.method === "PUT" && draft.entityId && p) {
          const s = raw.typeStats.find((x) => x.id === draft.entityId);
          if (s) Object.assign(s, p);
        } else if (draft.method === "DELETE" && draft.entityId) {
          const idx = raw.typeStats.findIndex((x) => x.id === draft.entityId);
          if (idx !== -1) raw.typeStats.splice(idx, 1);
        }
        break;
      }
    }
  }
}

export async function loadDashboardData(drafts?: Pick<AdminDraft, "id" | "resource" | "entityId" | "method" | "payload">[]) {
  const [projects, compBuildings, overallStats, typeStats, trendPoints] = await Promise.all([
    prisma.project.findMany({ orderBy: { sqft: "desc" } }),
    prisma.compBuilding.findMany({ include: { stats: true, quarterStats: true } }),
    prisma.overallUnitStat.findMany(),
    prisma.typeUnitStat.findMany(),
    prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } }),
  ]);

  if (drafts && drafts.length > 0) {
    applyDraftPatches({ projects: projects as { id: string; [k: string]: unknown }[], compBuildings: compBuildings as { id: string; stats: { id: string; [k: string]: unknown }[]; quarterStats: { id: string; [k: string]: unknown }[]; [k: string]: unknown }[], overallStats: overallStats as { id: string; [k: string]: unknown }[], typeStats: typeStats as { id: string; [k: string]: unknown }[], trendPoints: trendPoints as { id: string; [k: string]: unknown }[] }, drafts);
  }

  const DATA = projects.map((p) => ({
    n: p.name,
    addr: p.address ?? null,
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
