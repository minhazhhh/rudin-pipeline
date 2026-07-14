import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { parseSheetBuffer } from "@/app/lib/sync";
import { detectExactResource, syncResource } from "@/app/lib/sync-resources";
import { RESOURCE_LABELS } from "@/app/lib/column-mapper";
import { extractLeaseRows, previewLeaseImport, applyLeaseImport } from "@/app/lib/lease-import";

// The single drop target for any spreadsheet, in whatever shape it comes in. Tries, in order:
//   1. One of the app's exact per-table templates (Projects, Comp Buildings, Trend, etc.) —
//      recognized by its distinctive column set, then synced via the same full-replace logic
//      as the old per-table upload buttons.
//   2. A lease-by-lease export (any column layout) — matched against existing Comp Buildings
//      and aggregated into stats/quarter-stats/trend.
// Call with no query params for a dry-run preview; call with ?apply=1 (and, for the lease-level
// path, an `overrides` field) to actually write the changes.
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }

let overrides: Record<string, string> = {};
  const overridesRaw = form.get("overrides");
  if (typeof overridesRaw === "string" && overridesRaw.trim()) {
    try {
      overrides = JSON.parse(overridesRaw);
    } catch {
      return NextResponse.json({ error: "Invalid overrides JSON." }, { status: 400 });
    }
  }

const apply = req.nextUrl.searchParams.get("apply") === "1";
  const buf = await file.arrayBuffer();

const looksLikeExcel = file.type.includes("spreadsheetml") || /\.xlsx?$/i.test(file.name);
  let templateRows: Record<string, string>[] = [];
  try {
    templateRows = parseSheetBuffer(buf, looksLikeExcel);
  } catch {
    // Not parseable as a plain single-header-row table — fall through to the lease-level detector.
  }

const resource = detectExactResource(templateRows);
  if (resource) {
    try {
      if (!apply) {
        return NextResponse.json({
          ok: true,
          format: "exact",
          resource,
          resourceLabel: RESOURCE_LABELS[resource],
          rowCount: templateRows.length,
        });
      }
      const rowsImported = await syncResource(resource, templateRows);
      await prisma.syncConfig.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } });
      return NextResponse.json({
        ok: true,
        format: "exact",
        resource,
        resourceLabel: RESOURCE_LABELS[resource],
        rowCount: rowsImported,
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }

const leaseRows = extractLeaseRows(buf, file.name);
  if (!leaseRows) {
    return NextResponse.json(
      {
        error:
          `Couldn't recognize "${file.name}" — it doesn't match any of the app's table templates ` +
          `(Projects, Comp Buildings, Comp Building Stats, Overall/Type Unit Stats, Rent Trend) and doesn't ` +
          `look like lease-level data either (expected a Building column, a Rent column, and a Unit Type, ` +
          `Quarter, or Date column somewhere in the file).`,
      },
      { status: 400 },
      );
  }

try {
  if (!apply) {
    const summary = await previewLeaseImport(leaseRows, overrides);
    return NextResponse.json({ ok: true, format: "lease-level", ...summary });
  }

  const summary = await applyLeaseImport(leaseRows, overrides);
  await prisma.syncConfig.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } });
  return NextResponse.json({ ok: true, format: "lease-level", ...summary });
} catch (e) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
}
}
