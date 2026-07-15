import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { RESOURCES, Resource } from "@/app/lib/sync-resources";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/snapshots/[id]">) {
  const { id } = await ctx.params;
  const snap = await prisma.snapshot.findUnique({ where: { id } });
  if (!snap) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(snap);
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/snapshots/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;
  const { id } = await ctx.params;
  await prisma.snapshot.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// POST — restore snapshot back into DB via comps-import
export async function POST(req: NextRequest, ctx: RouteContext<"/api/snapshots/[id]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await ctx.params;
  const snap = await prisma.snapshot.findUnique({ where: { id } });
  if (!snap) return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });

  if (!RESOURCES.includes(snap.resource as Resource)) {
    return NextResponse.json({ error: `Unknown resource "${snap.resource}"` }, { status: 400 });
  }

  // Snapshot current state first so the restore itself is undoable
  const currentRows = await fetchCurrentRows(snap.resource as Resource);
  await prisma.snapshot.create({
    data: {
      resource: snap.resource,
      label: `Before restore to "${snap.label}"`,
      data: currentRows as object[],
    },
  });

  // comps-import expects Record<string, string> — snapshot data has typed values, so stringify.
  // Also flatten nested building relation: { building: { name: "Foo" } } → { buildingName: "Foo" }
  const snapRows = (snap.data as Record<string, unknown>[]).map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      if (k === "building" && v && typeof v === "object" && "name" in v) {
        out["buildingName"] = String((v as { name: unknown }).name ?? "");
      } else if (v == null || typeof v === "object") {
        // skip nested objects other than building
      } else {
        out[k] = String(v);
      }
    }
    return out;
  });

  const importRes = await fetch(new URL("/api/comps-import", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: req.headers.get("cookie") ?? "" },
    body: JSON.stringify({ resource: snap.resource, rows: snapRows, mode: "replace" }),
  });
  if (!importRes.ok) {
    const body = await importRes.json().catch(() => ({}));
    return NextResponse.json({ error: (body as { error?: string }).error ?? "Restore failed" }, { status: 500 });
  }
  const result = await importRes.json() as { rowsImported?: number; count?: number };
  return NextResponse.json({ ok: true, rowsRestored: result.rowsImported ?? result.count ?? 0 });
}

async function fetchCurrentRows(resource: Resource): Promise<Record<string, unknown>[]> {
  switch (resource) {
    case "comp-building-stats":
      return prisma.compBuildingStat.findMany({ include: { building: { select: { name: true } } } });
    case "comp-building-quarter-stats":
      return prisma.compBuildingQuarterStat.findMany({ include: { building: { select: { name: true } } } });
    case "comp-buildings":
      return prisma.compBuilding.findMany();
    case "overall-stats":
      return prisma.overallUnitStat.findMany();
    case "type-stats":
      return prisma.typeUnitStat.findMany();
    case "trend":
      return prisma.trendPoint.findMany({ orderBy: { quarterOrder: "asc" } });
    case "projects":
      return prisma.project.findMany();
    case "lease-comps":
      return prisma.leaseComp.findMany();
    default:
      return [];
  }
}
