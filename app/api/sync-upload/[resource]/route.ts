import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { parseSheetBuffer } from "@/app/lib/sync";
import { RESOURCES, Resource, syncResource } from "@/app/lib/sync-resources";

// Lets an authenticated admin upload a CSV/XLSX file directly instead of pointing at a
// publicly-fetchable URL. Nothing here ever needs to leave your org's SharePoint/OneDrive.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/sync-upload/[resource]">) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource: resourceParam } = await ctx.params;
  if (!RESOURCES.includes(resourceParam as Resource)) {
    return NextResponse.json({ error: `Unknown resource "${resourceParam}"` }, { status: 400 });
  }
  const resource = resourceParam as Resource;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

  const looksLikeExcel = file.type.includes("spreadsheetml") || /\.xlsx?$/i.test(file.name);
  const buf = await file.arrayBuffer();

  let rows: Record<string, string>[];
  try {
    rows = parseSheetBuffer(buf, looksLikeExcel);
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't parse "${file.name}": ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 },
    );
  }

  try {
    const count = await syncResource(resource, rows);
    await prisma.syncConfig.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } });
    return NextResponse.json({ ok: true, resource, rowsImported: count });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
