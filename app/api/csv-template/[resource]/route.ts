import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { toCsv } from "@/app/lib/csv";

const RESOURCES = [
  "projects",
  "comp-buildings",
  "comp-building-stats",
  "comp-building-quarter-stats",
  "overall-stats",
  "type-stats",
  "trend",
] as const;
type Resource = (typeof RESOURCES)[number];

export async function GET(req: NextRequest, ctx: RouteContext<"/api/csv-template/[resource]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource: resourceParam } = await ctx.params;
  if (!RESOURCES.includes(resourceParam as Resource)) {
    return NextResponse.json({ error: `Unknown resource "${resourceParam}"` }, { status: 400 });
  }
  const resource = resourceParam as Resource;

  const csv = await buildCsv(resource);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${resource}.csv"`,
    },
  });
}

async function buildCsv(resource: Resource): Promise<string> {
  switch (resource) {
    case "projects": {
      const rows = await prisma.project.findMany({ orderBy: { createdAt: "asc" } });
      return toCsv(
        [
          "name", "borough", "status", "category", "units", "sqft", "deliveryLabel", "sponsor", "lender",
          "lat", "lng", "isRudin", "imageUrl", "affPct", "mktU", "affU", "avgSf", "affBandsJson", "compBuildingName",
        ],
        rows.map((p) => [
          p.name, p.borough, p.status, p.category, p.units, p.sqft, p.deliveryLabel, p.sponsor, p.lender,
          p.lat, p.lng, p.isRudin, p.imageUrl, p.affPct, p.mktU, p.affU, p.avgSf,
          p.affBands ? JSON.stringify(p.affBands) : "", p.compBuildingName,
        ]),
      );
    }
    case "comp-buildings": {
      const rows = await prisma.compBuilding.findMany({ orderBy: { name: "asc" } });
      return toCsv(
        ["name", "propertyType", "lat", "lng", "underwritten", "note", "totalN"],
        rows.map((b) => [b.name, b.propertyType, b.lat, b.lng, b.underwritten, b.note, b.totalN]),
      );
    }
    case "comp-building-stats": {
      const rows = await prisma.compBuildingStat.findMany({ include: { building: { select: { name: true } } } });
      return toCsv(
        [
          "buildingName", "unitType", "avgRent", "medRent", "minRent", "maxRent", "nRent",
          "avgPsf", "medPsf", "minPsf", "maxPsf", "nPsf", "avgSf", "medSf", "minSf", "maxSf", "nSf",
        ],
        rows.map((s) => [
          s.building.name, s.unitType, s.avgRent, s.medRent, s.minRent, s.maxRent, s.nRent,
          s.avgPsf, s.medPsf, s.minPsf, s.maxPsf, s.nPsf, s.avgSf, s.medSf, s.minSf, s.maxSf, s.nSf,
        ]),
      );
    }
    case "comp-building-quarter-stats": {
      const rows = await prisma.compBuildingQuarterStat.findMany({
        include: { building: { select: { name: true } } },
        orderBy: { quarterOrder: "asc" },
      });
      return toCsv(
        ["buildingName", "quarter", "quarterOrder", "unitType", "avgRent", "avgPsf", "n"],
        rows.map((s) => [s.building.name, s.quarter, s.quarterOrder, s.unitType, s.avgRent, s.avgPsf, s.n]),
      );
    }
    case "overall-stats": {
      const rows = await prisma.overallUnitStat.findMany();
      return toCsv(
        [
          "unitType", "avgRent", "medRent", "minRent", "maxRent", "nRent",
          "avgPsf", "medPsf", "minPsf", "maxPsf", "nPsf", "avgSf", "medSf", "minSf", "maxSf", "nSf",
        ],
        rows.map((s) => [
          s.unitType, s.avgRent, s.medRent, s.minRent, s.maxRent, s.nRent,
          s.avgPsf, s.medPsf, s.minPsf, s.maxPsf, s.nPsf, s.avgSf, s.medSf, s.minSf, s.maxSf, s.nSf,
        ]),
      );
    }
    case "type-stats": {
      const rows = await prisma.typeUnitStat.findMany();
      return toCsv(
        ["propertyType", "unitType", "avgRent", "medRent", "minRent", "maxRent", "nRent", "avgPsf", "medPsf", "minPsf", "maxPsf", "nPsf"],
        rows.map((s) => [
          s.propertyType, s.unitType, s.avgRent, s.medRent, s.minRent, s.maxRent, s.nRent,
          s.avgPsf, s.medPsf, s.minPsf, s.maxPsf, s.nPsf,
        ]),
      );
    }
    case "trend": {
      const rows = await prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } });
      return toCsv(
        ["quarter", "quarterOrder", "unitType", "avgRent", "avgPsf"],
        rows.map((t) => [t.quarter, t.quarterOrder, t.unitType, t.avgRent, t.avgPsf]),
      );
    }
  }
}
