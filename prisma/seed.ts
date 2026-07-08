import fs from "node:fs";
import path from "node:path";
import { prisma } from "../app/lib/prisma";

type StatTriple = { avg?: number | null; med?: number | null; min?: number | null; max?: number | null; n?: number | null } | null | undefined;
type UnitStatBlob = { gr?: StatTriple; psf?: StatTriple; sf?: StatTriple };

type LegacyData = {
  DATA: Array<{
    n: string; sub: string; st: string; ct: string; u: number | null; sf: number | null;
    d: string; sp: string; ln: string; lat: number; lng: number; rudin: number; img: string;
    aff_pct?: number; mkt_u?: number; aff_u?: number; avg_sf?: number;
    aff_bands?: Array<{ pct_units: number; ami: number; studio: number; one_br: number; two_br: number }>;
  }>;
  COMP_COORDS: Record<string, [number, number]>;
  AGG: {
    ut_stats: Record<string, UnitStatBlob>;
    pt_ut_stats: Record<string, Record<string, UnitStatBlob>>;
    bldg_stats: Record<string, { pt: string; underwritten?: boolean; total_n?: number; note?: string; units: Record<string, UnitStatBlob> }>;
    trend: Record<string, Record<string, number>>;
    quarters: string[];
  };
  BSTATS: Record<string, { type: string }>;
  NAME_MAP: Record<string, string>;
};

const raw = fs.readFileSync(path.join(import.meta.dirname, "..", "data", "legacy-data.json"), "utf8");
const legacy = JSON.parse(raw) as LegacyData;

function quarterOrder(q: string): number {
  const m = /^Q(\d) (\d{4})$/.exec(q);
  if (!m) return 0;
  return Number(m[2]) * 10 + Number(m[1]);
}

async function main() {
  console.log("Seeding projects...");
  for (const p of legacy.DATA) {
    await prisma.project.create({
      data: {
        name: p.n,
        borough: p.sub,
        status: p.st,
        category: p.ct,
        units: p.u,
        sqft: p.sf,
        deliveryLabel: p.d,
        sponsor: p.sp,
        lender: p.ln,
        lat: p.lat,
        lng: p.lng,
        isRudin: !!p.rudin,
        imageUrl: p.img,
        affPct: p.aff_pct ?? null,
        mktU: p.mkt_u ?? null,
        affU: p.aff_u ?? null,
        avgSf: p.avg_sf ?? null,
        affBands: p.aff_bands
          ? p.aff_bands.map((b) => ({
              pctUnits: b.pct_units,
              ami: b.ami,
              studio: b.studio,
              oneBr: b.one_br,
              twoBr: b.two_br,
            }))
          : undefined,
        compBuildingName: legacy.NAME_MAP[p.n] ?? null,
      },
    });
  }
  console.log(`  ${legacy.DATA.length} projects created`);

  console.log("Seeding comp buildings + stats...");
  const buildingNames = new Set([
    ...Object.keys(legacy.COMP_COORDS),
    ...Object.keys(legacy.AGG.bldg_stats),
  ]);
  let buildingCount = 0;
  let statCount = 0;
  for (const name of buildingNames) {
    const bs = legacy.AGG.bldg_stats[name];
    const coords = legacy.COMP_COORDS[name];
    const propertyType = bs?.pt ?? legacy.BSTATS[name]?.type ?? "Market";
    const building = await prisma.compBuilding.create({
      data: {
        name,
        propertyType,
        lat: coords?.[0] ?? null,
        lng: coords?.[1] ?? null,
        underwritten: bs?.underwritten ?? false,
        note: bs?.note ?? null,
        totalN: bs?.total_n ?? null,
      },
    });
    buildingCount++;

    if (bs) {
      for (const [unitType, blob] of Object.entries(bs.units)) {
        await prisma.compBuildingStat.create({
          data: {
            buildingId: building.id,
            unitType,
            avgRent: blob.gr?.avg ?? null,
            medRent: blob.gr?.med ?? null,
            minRent: blob.gr?.min ?? null,
            maxRent: blob.gr?.max ?? null,
            nRent: blob.gr?.n ?? null,
            avgPsf: blob.psf?.avg ?? null,
            medPsf: blob.psf?.med ?? null,
            minPsf: blob.psf?.min ?? null,
            maxPsf: blob.psf?.max ?? null,
            nPsf: blob.psf?.n ?? null,
            avgSf: blob.sf?.avg ?? null,
            medSf: blob.sf?.med ?? null,
            minSf: blob.sf?.min ?? null,
            maxSf: blob.sf?.max ?? null,
            nSf: blob.sf?.n ?? null,
          },
        });
        statCount++;
      }
    }
  }
  console.log(`  ${buildingCount} comp buildings, ${statCount} building/unit-type stat rows`);

  console.log("Seeding overall unit stats...");
  for (const [unitType, blob] of Object.entries(legacy.AGG.ut_stats)) {
    await prisma.overallUnitStat.create({
      data: {
        unitType,
        avgRent: blob.gr?.avg ?? null,
        medRent: blob.gr?.med ?? null,
        minRent: blob.gr?.min ?? null,
        maxRent: blob.gr?.max ?? null,
        nRent: blob.gr?.n ?? null,
        avgPsf: blob.psf?.avg ?? null,
        medPsf: blob.psf?.med ?? null,
        minPsf: blob.psf?.min ?? null,
        maxPsf: blob.psf?.max ?? null,
        nPsf: blob.psf?.n ?? null,
        avgSf: blob.sf?.avg ?? null,
        medSf: blob.sf?.med ?? null,
        minSf: blob.sf?.min ?? null,
        maxSf: blob.sf?.max ?? null,
        nSf: blob.sf?.n ?? null,
      },
    });
  }
  console.log(`  ${Object.keys(legacy.AGG.ut_stats).length} overall unit stats`);

  console.log("Seeding type x unit stats...");
  let typeStatCount = 0;
  for (const [propertyType, byUnit] of Object.entries(legacy.AGG.pt_ut_stats)) {
    for (const [unitType, blob] of Object.entries(byUnit)) {
      await prisma.typeUnitStat.create({
        data: {
          propertyType,
          unitType,
          avgRent: blob.gr?.avg ?? null,
          medRent: blob.gr?.med ?? null,
          minRent: blob.gr?.min ?? null,
          maxRent: blob.gr?.max ?? null,
          nRent: blob.gr?.n ?? null,
          avgPsf: blob.psf?.avg ?? null,
          medPsf: blob.psf?.med ?? null,
          minPsf: blob.psf?.min ?? null,
          maxPsf: blob.psf?.max ?? null,
          nPsf: blob.psf?.n ?? null,
        },
      });
      typeStatCount++;
    }
  }
  console.log(`  ${typeStatCount} type x unit stat rows`);

  console.log("Seeding trend points...");
  let trendCount = 0;
  for (const [quarter, byUnit] of Object.entries(legacy.AGG.trend)) {
    for (const [unitType, avgRent] of Object.entries(byUnit)) {
      await prisma.trendPoint.create({
        data: { quarter, quarterOrder: quarterOrder(quarter), unitType, avgRent },
      });
      trendCount++;
    }
  }
  console.log(`  ${trendCount} trend points`);

  await prisma.syncConfig.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
