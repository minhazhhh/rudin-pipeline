import { prisma } from "@/app/lib/prisma";
import type { AdminDraft } from "@/app/generated/prisma/client";
import { csvNum, csvBool, csvStr } from "@/app/lib/sync";

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

// ── Import preview data application ──────────────────────────────────────────
// Takes raw string-valued import rows (same format as /api/comps-import receives)
// and merges them into the in-memory Prisma arrays so the dashboard renders as if
// the import had already run, without actually writing to the DB.

function deriveQOrder(q: string): number {
  const m = q.trim().match(/Q(\d)\s+(\d{4})/i);
  if (m) return parseInt(m[2]) * 10 + parseInt(m[1]);
  return 0;
}

export type PreviewChanges = {
  newProjects: string[];
  changedProjects: string[];
  newBuildings: string[];
  changedBuildings: string[];
  resourcesReplaced: string[]; // overall-stats, trend, etc.
};

function applyImportPreviewData(
  raw: {
    projects: { id: string; [k: string]: unknown }[];
    compBuildings: { id: string; name: string; stats: { id: string; [k: string]: unknown }[]; quarterStats: { id: string; [k: string]: unknown }[]; [k: string]: unknown }[];
    overallStats: { id: string; [k: string]: unknown }[];
    typeStats: { id: string; [k: string]: unknown }[];
    trendPoints: { id: string; [k: string]: unknown }[];
  },
  previewResources: Record<string, Record<string, string>[]>
): PreviewChanges {
  const changes: PreviewChanges = { newProjects: [], changedProjects: [], newBuildings: [], changedBuildings: [], resourcesReplaced: [] };
  // projects — replace by name
  if (previewResources["projects"]?.length) {
    const byName = new Map(raw.projects.map((p) => [p.name as string, p]));
    for (const row of previewResources["projects"]) {
      const name = csvStr(row.name);
      if (!name) continue;
      const isNew = !byName.has(name);
      if (isNew) changes.newProjects.push(name);
      else changes.changedProjects.push(name);
      byName.set(name, {
        id: byName.get(name)?.id ?? `preview-${name}`,
        name,
        borough: csvStr(row.borough),
        status: csvStr(row.status),
        category: csvStr(row.category),
        units: csvNum(row.units),
        sqft: csvNum(row.sqft),
        deliveryLabel: csvStr(row.deliveryLabel),
        sponsor: csvStr(row.sponsor),
        lender: csvStr(row.lender),
        address: row.address?.trim() || null,
        lat: csvNum(row.lat) ?? 0,
        lng: csvNum(row.lng) ?? 0,
        isRudin: csvBool(row.isRudin),
        imageUrl: csvStr(row.imageUrl),
        affPct: csvNum(row.affPct),
        mktU: csvNum(row.mktU) != null ? Math.round(csvNum(row.mktU)!) : null,
        affU: csvNum(row.affU) != null ? Math.round(csvNum(row.affU)!) : null,
        avgSf: csvNum(row.avgSf) != null ? Math.round(csvNum(row.avgSf)!) : null,
        affBands: null,
        compBuildingName: row.compBuildingName?.trim() || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as typeof raw.projects[0]);
    }
    raw.projects.splice(0, raw.projects.length, ...byName.values());
    raw.projects.sort((a, b) => ((b.sqft as number | null) ?? 0) - ((a.sqft as number | null) ?? 0));
  }

  // comp-buildings — upsert by name, preserving existing stats arrays
  if (previewResources["comp-buildings"]?.length) {
    const byName = new Map(raw.compBuildings.map((b) => [b.name, b]));
    for (const row of previewResources["comp-buildings"]) {
      const name = csvStr(row.name);
      if (!name) continue;
      const isNew = !byName.has(name);
      if (isNew) changes.newBuildings.push(name);
      else changes.changedBuildings.push(name);
      const existing = byName.get(name);
      byName.set(name, {
        id: existing?.id ?? `preview-${name}`,
        name,
        propertyType: csvStr(row.propertyType) || "Market",
        lat: csvNum(row.lat),
        lng: csvNum(row.lng),
        underwritten: csvBool(row.underwritten),
        note: row.note?.trim() || null,
        totalN: csvNum(row.totalN) != null ? Math.round(csvNum(row.totalN)!) : null,
        stats: existing?.stats ?? [],
        quarterStats: existing?.quarterStats ?? [],
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      } as typeof raw.compBuildings[0]);
    }
    raw.compBuildings.splice(0, raw.compBuildings.length, ...byName.values());
  }

  // comp-building-stats — group by buildingName, replace stats on matched buildings
  if (previewResources["comp-building-stats"]?.length) {
    const statsByBuilding = new Map<string, Record<string, string>[]>();
    for (const row of previewResources["comp-building-stats"]) {
      const name = (row.buildingName ?? "").trim();
      if (!name) continue;
      if (!statsByBuilding.has(name)) statsByBuilding.set(name, []);
      statsByBuilding.get(name)!.push(row);
    }
    for (const b of raw.compBuildings) {
      const rows = statsByBuilding.get(b.name);
      if (!rows) continue;
      b.stats = rows.map((row) => ({
        id: `preview-stat-${b.name}-${row.unitType}`,
        buildingId: b.id,
        unitType: csvStr(row.unitType),
        avgRent: csvNum(row.avgRent), medRent: csvNum(row.medRent),
        minRent: csvNum(row.minRent), maxRent: csvNum(row.maxRent), nRent: csvNum(row.nRent),
        avgPsf: csvNum(row.avgPsf), medPsf: csvNum(row.medPsf),
        minPsf: csvNum(row.minPsf), maxPsf: csvNum(row.maxPsf), nPsf: csvNum(row.nPsf),
        avgSf: csvNum(row.avgSf), medSf: csvNum(row.medSf),
        minSf: csvNum(row.minSf), maxSf: csvNum(row.maxSf), nSf: csvNum(row.nSf),
      })) as typeof raw.compBuildings[0]["stats"];
      if (!changes.newBuildings.includes(b.name) && !changes.changedBuildings.includes(b.name)) {
        changes.changedBuildings.push(b.name);
      }
    }
  }

  // overall-stats — replace all
  if (previewResources["overall-stats"]?.length) {
    const newStats = previewResources["overall-stats"].map((row) => ({
      id: `preview-os-${row.unitType}`,
      unitType: csvStr(row.unitType),
      avgRent: csvNum(row.avgRent), medRent: csvNum(row.medRent),
      minRent: csvNum(row.minRent), maxRent: csvNum(row.maxRent), nRent: csvNum(row.nRent),
      avgPsf: csvNum(row.avgPsf), medPsf: csvNum(row.medPsf),
      minPsf: csvNum(row.minPsf), maxPsf: csvNum(row.maxPsf), nPsf: csvNum(row.nPsf),
      avgSf: csvNum(row.avgSf), medSf: csvNum(row.medSf),
      minSf: csvNum(row.minSf), maxSf: csvNum(row.maxSf), nSf: csvNum(row.nSf),
    })) as typeof raw.overallStats;
    raw.overallStats.splice(0, raw.overallStats.length, ...newStats);
    changes.resourcesReplaced.push("overall-stats");
  }

  // type-stats — replace all
  if (previewResources["type-stats"]?.length) {
    const newStats = previewResources["type-stats"].map((row) => ({
      id: `preview-ts-${row.propertyType}-${row.unitType}`,
      propertyType: csvStr(row.propertyType),
      unitType: csvStr(row.unitType),
      avgRent: csvNum(row.avgRent), medRent: csvNum(row.medRent),
      minRent: csvNum(row.minRent), maxRent: csvNum(row.maxRent), nRent: csvNum(row.nRent),
      avgPsf: csvNum(row.avgPsf), medPsf: csvNum(row.medPsf),
      minPsf: csvNum(row.minPsf), maxPsf: csvNum(row.maxPsf), nPsf: csvNum(row.nPsf),
    })) as typeof raw.typeStats;
    raw.typeStats.splice(0, raw.typeStats.length, ...newStats);
    changes.resourcesReplaced.push("type-stats");
  }

  // trend — replace all, derive quarterOrder if missing
  if (previewResources["trend"]?.length) {
    const newPoints = previewResources["trend"].map((row) => {
      const quarter = csvStr(row.quarter);
      return {
        id: `preview-tr-${quarter}-${row.unitType}`,
        quarter,
        quarterOrder: csvNum(row.quarterOrder) ?? deriveQOrder(quarter),
        unitType: csvStr(row.unitType),
        avgRent: csvNum(row.avgRent) ?? 0,
        avgPsf: csvNum(row.avgPsf),
      };
    }) as typeof raw.trendPoints;
    newPoints.sort((a, b) => ((a.quarterOrder as number) ?? 0) - ((b.quarterOrder as number) ?? 0));
    raw.trendPoints.splice(0, raw.trendPoints.length, ...newPoints);
    changes.resourcesReplaced.push("trend");
  }

  return changes;
}

export async function loadDashboardData(drafts?: Pick<AdminDraft, "id" | "resource" | "entityId" | "method" | "payload">[], importPreview?: Record<string, Record<string, string>[]>) {
  const [projects, compBuildings, overallStats, typeStats, trendPoints, leaseComps] = await Promise.all([
    prisma.project.findMany({ orderBy: { sqft: "desc" } }),
    prisma.compBuilding.findMany({ include: { stats: true, quarterStats: true, units: { select: { status: true } } } }),
    prisma.overallUnitStat.findMany(),
    prisma.typeUnitStat.findMany(),
    prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } }),
    prisma.leaseComp.findMany({ select: { building: true, quarter: true, unitType: true, grossRent: true, grossPsf: true, leaseDate: true } }),
  ]);

  if (drafts && drafts.length > 0) {
    applyDraftPatches({ projects: projects as { id: string; [k: string]: unknown }[], compBuildings: compBuildings as { id: string; stats: { id: string; [k: string]: unknown }[]; quarterStats: { id: string; [k: string]: unknown }[]; [k: string]: unknown }[], overallStats: overallStats as { id: string; [k: string]: unknown }[], typeStats: typeStats as { id: string; [k: string]: unknown }[], trendPoints: trendPoints as { id: string; [k: string]: unknown }[] }, drafts);
  }

  let previewChanges: PreviewChanges | undefined;
  if (importPreview && Object.keys(importPreview).length > 0) {
    previewChanges = applyImportPreviewData({ projects: projects as { id: string; [k: string]: unknown }[], compBuildings: compBuildings as { id: string; name: string; stats: { id: string; [k: string]: unknown }[]; quarterStats: { id: string; [k: string]: unknown }[]; [k: string]: unknown }[], overallStats: overallStats as { id: string; [k: string]: unknown }[], typeStats: typeStats as { id: string; [k: string]: unknown }[], trendPoints: trendPoints as { id: string; [k: string]: unknown }[] }, importPreview);
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
    // Status counts from individual unit records
    const statusCounts: Record<string, number> = {};
    for (const u of b.units) {
      const s = (u.status ?? "unknown").toLowerCase().trim();
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }
    BSTATS[b.name] = { type: b.propertyType, units, ...(b.units.length > 0 ? { status_counts: statusCounts, unit_record_count: b.units.length } : {}) };
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

  // Fallback: if no CompBuildingQuarterStat data exists, derive bldg_trend from raw LeaseComp records.
  // Uses LeaseComp.quarter when present, otherwise derives quarter from leaseDate.
  // LeaseComp.building is the raw import string; resolved case-insensitively against CompBuilding names.
  if (Object.keys(bldg_trend).length === 0 && leaseComps.length > 0) {
    const nameByLower = new Map<string, string>();
    for (const b of compBuildings) nameByLower.set(b.name.toLowerCase(), b.name);

    function quarterFromDate(d: Date): string {
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      return `Q${q} ${d.getUTCFullYear()}`;
    }

    type Cell = { grSum: number; psfSum: number; psfN: number; n: number };
    const acc: Record<string, Record<string, Record<string, Cell>>> = {};
    for (const lc of leaseComps) {
      if (!lc.unitType) continue;
      const q = lc.quarter ?? (lc.leaseDate ? quarterFromDate(lc.leaseDate) : null);
      if (!q) continue;
      const canon = nameByLower.get(lc.building.toLowerCase());
      if (!canon) continue;
      acc[canon] ??= {};
      acc[canon][q] ??= {};
      acc[canon][q][lc.unitType] ??= { grSum: 0, psfSum: 0, psfN: 0, n: 0 };
      const cell = acc[canon][q][lc.unitType];
      if (lc.grossRent != null) { cell.grSum += lc.grossRent; cell.n++; }
      if (lc.grossPsf != null) { cell.psfSum += lc.grossPsf; cell.psfN++; }
    }
    for (const [bName, byQ] of Object.entries(acc)) {
      bldg_trend[bName] = {};
      for (const [q, byUT] of Object.entries(byQ)) {
        bldg_trend[bName][q] = {};
        for (const [ut, cell] of Object.entries(byUT)) {
          bldg_trend[bName][q][ut] = {
            gr: cell.n > 0 ? cell.grSum / cell.n : null,
            psf: cell.psfN > 0 ? cell.psfSum / cell.psfN : null,
            n: cell.n,
          };
        }
      }
    }
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

  return { DATA, YEARS, maxUnits, maxSf, COMP_COORDS, AGG, BSTATS, NAME_MAP, previewChanges };
}
