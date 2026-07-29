import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";
import { draftMode } from "next/headers";

const IMPORT_ORDER = [
  "comp-buildings",
  "projects",
  "comp-building-stats",
  "comp-building-quarter-stats",
  "overall-stats",
  "type-stats",
  "trend",
  "lease-comps",
  "comp-building-units",
] as const;

// Run the actual import for each resource in the stored ImportPreview,
// then clear the preview and disable draft mode.
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const preview = await prisma.importPreview.findFirst({ orderBy: { createdAt: "desc" } });
  if (!preview) {
    return NextResponse.json({ error: "No import preview found." }, { status: 404 });
  }

  const previewFileName = preview.fileName;
  const resources = preview.resources as Record<string, Record<string, string>[]>;
  const origin = req.nextUrl.origin;
  const results: { resource: string; rowsImported?: number; error?: string }[] = [];

  // Import in the standard order (comp-buildings before stats that reference them)
  const orderedResources = IMPORT_ORDER.filter((r) => (resources[r]?.length ?? 0) > 0);

  // comp-buildings first (synchronously), then rest in parallel
  async function doImport(resource: string) {
    try {
      const res = await fetch(`${origin}/api/comps-import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Forward admin cookie so requireAdmin passes
          Cookie: req.headers.get("cookie") ?? "",
        },
        body: JSON.stringify({ resource, rows: resources[resource], mode: "upsert", fileName: previewFileName }),
      });
      const body = await res.json() as { rowsImported?: number; error?: string };
      if (res.ok) {
        results.push({ resource, rowsImported: body.rowsImported });
      } else {
        results.push({ resource, error: body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      results.push({ resource, error: e instanceof Error ? e.message : String(e) });
    }
  }

  if (resources["comp-buildings"]?.length) {
    await doImport("comp-buildings");
  }
  const rest = orderedResources.filter((r) => r !== "comp-buildings");
  if (rest.length) await Promise.allSettled(rest.map((r) => doImport(r)));

  // Clean up: delete preview and disable draft mode
  await prisma.importPreview.deleteMany();
  const dm = await draftMode();
  dm.disable();

  const failed = results.filter((r) => r.error);
  return NextResponse.json({
    ok: failed.length === 0,
    applied: results.filter((r) => !r.error).length,
    failed: failed.length,
    errors: failed.map((r) => `${r.resource}: ${r.error}`),
    results,
  });
}
