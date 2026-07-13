import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { extractLeaseRows, previewLeaseImport, applyLeaseImport } from "@/app/lib/lease-import";

// Accepts a spreadsheet in whatever shape it comes in (a lease-by-lease export, not one of the
// app's exact per-table templates) and figures out where it goes: matches building names against
// existing Comp Buildings, aggregates rents/psf/sf per building x unit type x quarter, and updates
// lease counts, comp stats, quarter stats, and the market trend. Call with no query params to get a
// dry-run preview; call with ?apply=1 and a `overrides` field (JSON map of raw name -> resolved
// building name) to actually write the changes.
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

const buf = await file.arrayBuffer();
  const rows = extractLeaseRows(buf, file.name);
  if (!rows) {
    return NextResponse.json(
      {
        error:
          `Couldn't recognize "${file.name}" as lease-level rent data — expected a sheet with a Building ` +
          `column, a Rent column, and a Unit Type, Quarter, or Date column. If this is one of the app's ` +
          `standard table templates (Projects, Comp Buildings, etc.), use the per-table upload buttons below ` +
          `instead.`,
      },
      { status: 400 },
      );
  }

const apply = req.nextUrl.searchParams.get("apply") === "1";

try {
  if (!apply) {
    const summary = await previewLeaseImport(rows, overrides);
    return NextResponse.json({ ok: true, mode: "preview", ...summary });
  }

  const summary = await applyLeaseImport(rows, overrides);
  await prisma.syncConfig.update({ where: { id: 1 }, data: { lastSyncedAt: new Date() } });
  return NextResponse.json({ ok: true, mode: "applied", ...summary });
} catch (e) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
}
}
