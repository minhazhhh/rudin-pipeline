import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { draftMode } from "next/headers";

type P = Record<string, unknown>;

export async function POST(req: NextRequest) {
  const unauth = requireAdmin(req);
  if (unauth) return unauth;

  const drafts = await prisma.adminDraft.findMany({ orderBy: { createdAt: "asc" } });
  let applied = 0;
  const errors: string[] = [];

  for (const draft of drafts) {
    const p = draft.payload as P | null;
    try {
      switch (draft.resource) {
        case "comp-buildings": {
          if (draft.method === "PUT" && draft.entityId && p) {
            await prisma.compBuilding.update({
              where: { id: draft.entityId },
              data: {
                name: p.name as string | undefined,
                propertyType: p.propertyType as string | undefined,
                lat: p.lat as number | null | undefined,
                lng: p.lng as number | null | undefined,
                underwritten: p.underwritten as boolean | undefined,
                note: p.note as string | null | undefined,
                totalN: p.totalN as number | null | undefined,
              },
            });
          } else if (draft.method === "DELETE" && draft.entityId) {
            await prisma.compBuilding.delete({ where: { id: draft.entityId } });
          } else if (draft.method === "POST" && p) {
            await prisma.compBuilding.create({
              data: {
                name: p.name as string,
                propertyType: p.propertyType as string,
                lat: (p.lat as number | null) ?? null,
                lng: (p.lng as number | null) ?? null,
                underwritten: (p.underwritten as boolean) ?? false,
                note: (p.note as string | null) ?? null,
                totalN: (p.totalN as number | null) ?? null,
              },
            });
          }
          break;
        }
        case "comp-building-stats": {
          if (draft.method === "PUT" && draft.entityId && p) {
            const { buildingId: _b, id: _i, ...rest } = p;
            await prisma.compBuildingStat.update({ where: { id: draft.entityId }, data: rest as Parameters<typeof prisma.compBuildingStat.update>[0]["data"] });
          } else if (draft.method === "DELETE" && draft.entityId) {
            await prisma.compBuildingStat.delete({ where: { id: draft.entityId } });
          } else if (draft.method === "POST" && p) {
            const { id: _i, ...rest } = p;
            await prisma.compBuildingStat.create({ data: rest as Parameters<typeof prisma.compBuildingStat.create>[0]["data"] });
          }
          break;
        }
        case "projects": {
          if (draft.method === "PUT" && draft.entityId && p) {
            const { id: _i, ...rest } = p;
            await prisma.project.update({ where: { id: draft.entityId }, data: rest as Parameters<typeof prisma.project.update>[0]["data"] });
          } else if (draft.method === "DELETE" && draft.entityId) {
            await prisma.project.delete({ where: { id: draft.entityId } });
          } else if (draft.method === "POST" && p) {
            const { id: _i, ...rest } = p;
            await prisma.project.create({ data: rest as Parameters<typeof prisma.project.create>[0]["data"] });
          }
          break;
        }
        case "overall-stats": {
          if (draft.method === "PUT" && draft.entityId && p) {
            const { id: _i, ...rest } = p;
            await prisma.overallUnitStat.update({ where: { id: draft.entityId }, data: rest as Parameters<typeof prisma.overallUnitStat.update>[0]["data"] });
          } else if (draft.method === "DELETE" && draft.entityId) {
            await prisma.overallUnitStat.delete({ where: { id: draft.entityId } });
          }
          break;
        }
        case "trend": {
          if (draft.method === "PUT" && draft.entityId && p) {
            const { id: _i, ...rest } = p;
            await prisma.trendPoint.update({ where: { id: draft.entityId }, data: rest as Parameters<typeof prisma.trendPoint.update>[0]["data"] });
          } else if (draft.method === "DELETE" && draft.entityId) {
            await prisma.trendPoint.delete({ where: { id: draft.entityId } });
          }
          break;
        }
        case "type-stats": {
          if (draft.method === "PUT" && draft.entityId && p) {
            const { id: _i, ...rest } = p;
            await prisma.typeUnitStat.update({ where: { id: draft.entityId }, data: rest as Parameters<typeof prisma.typeUnitStat.update>[0]["data"] });
          } else if (draft.method === "DELETE" && draft.entityId) {
            await prisma.typeUnitStat.delete({ where: { id: draft.entityId } });
          }
          break;
        }
        default:
          errors.push(`Unknown resource: ${draft.resource}`);
          continue;
      }
      applied++;
    } catch (e) {
      errors.push(`${draft.resource}/${draft.entityId ?? "new"}: ${String(e)}`);
    }
  }

  if (errors.length === 0) {
    await prisma.adminDraft.deleteMany();
    const dm = await draftMode();
    dm.disable();
  }

  return NextResponse.json({ applied, failed: errors.length, errors });
}
