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

// GET — list projects that need geocoding
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const projects = await prisma.project.findMany({
    where: { OR: [{ lat: 0, lng: 0 }] },
    select: { id: true, name: true, address: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ projects });
}

// POST with { id } — geocode a single project and save it
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await req.json() as { id: string };
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, address: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const query = project.address?.trim() || project.name?.trim();
  if (!query) return NextResponse.json({ ok: false, reason: "no address" });

  console.log(`[geocode] querying Nominatim for: "${query}"`);
  const coords = await geocodeAddress(query);
  console.log(`[geocode] result for "${query}":`, coords ?? "null");
  if (!coords) return NextResponse.json({ ok: false, reason: "not found" });

  await prisma.project.update({ where: { id }, data: coords });
  return NextResponse.json({ ok: true, ...coords });
}
