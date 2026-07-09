import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { fetchCsvRows } from "@/app/lib/sync";
import { RESOURCES, Resource, SHEET_URL_FIELD, syncResource } from "@/app/lib/sync-resources";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/sync/[resource]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource: resourceParam } = await ctx.params;
  if (!RESOURCES.includes(resourceParam as Resource)) {
    return NextResponse.json({ error: `Unknown resource "${resourceParam}"` }, { status: 400 });
  }
  const resource = resourceParam as Resource;

  const config = await prisma.syncConfig.findUnique({ where: { id: 1 } });
  const url = config?.[SHEET_URL_FIELD[resource] as keyof typeof config] as string | null | undefined;
  if (!url) {
    return NextResponse.json(
      { error: `No sheet URL configured for "${resource}". Set it in Sync Settings first.` },
      { status: 400 },
    );
  }

  let rows: Record<string, string>[];
  try {
    rows = await fetchCsvRows(url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  try {
    const count = await syncResource(resource, rows);
    await prisma.syncConfig.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } });
    return NextResponse.json({ ok: true, resource, rowsImported: count });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
