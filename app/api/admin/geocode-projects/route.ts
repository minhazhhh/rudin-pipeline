import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";

async function geocodeAddress(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const encoded = encodeURIComponent(query + ", New York, NY");
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: { "User-Agent": "rudin-pipeline/1.0 (mhasan@rudin.com)" },
    });
    if (!res.ok) return null;
    const results = await res.json() as { lat: string; lon: string }[];
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const projects = await prisma.project.findMany({
    where: { OR: [{ lat: 0, lng: 0 }, { lat: null as never }, { lng: null as never }] },
    select: { id: true, name: true, address: true, lat: true, lng: true },
  });

  let updated = 0;
  let failed = 0;
  const results: { name: string; status: string; lat?: number; lng?: number }[] = [];

  for (const p of projects) {
    const query = p.address?.trim() || p.name?.trim();
    if (!query) { failed++; results.push({ name: p.name, status: "no address" }); continue; }

    // Nominatim rate limit: 1 req/sec
    await new Promise((r) => setTimeout(r, 1100));

    const coords = await geocodeAddress(query);
    if (!coords) {
      failed++;
      results.push({ name: p.name, status: "not found" });
      continue;
    }

    await prisma.project.update({ where: { id: p.id }, data: coords });
    updated++;
    results.push({ name: p.name, status: "ok", ...coords });
  }

  return NextResponse.json({ updated, failed, total: projects.length, results });
}
