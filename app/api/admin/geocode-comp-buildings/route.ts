import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";

async function geocodeViaNominatim(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, { headers: { "User-Agent": "rudin-pipeline/1.0 (mhasan@rudin.com)" } });
    if (!res.ok) return null;
    const results = await res.json() as { lat: string; lon: string }[];
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch { return null; }
}

async function geocodeViaClaude(name: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rudin-pipeline.vercel.app",
        "X-Title": "Rudin Pipeline",
      },
      body: JSON.stringify({
        model: "anthropic/claude-opus-4-5",
        messages: [{ role: "user", content: `Return the latitude and longitude for this NYC building. Return ONLY valid JSON with no explanation:\n{"lat": <number or null>, "lng": <number or null>}\n\nBuilding: ${name}, New York, NY` }],
        max_tokens: 64,
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { lat: number | null; lng: number | null };
    if (!parsed.lat || !parsed.lng) return null;
    return { lat: parsed.lat, lng: parsed.lng };
  } catch { return null; }
}

// GET — list comp buildings missing coordinates
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const buildings = await prisma.compBuilding.findMany({
    where: { OR: [{ lat: null }, { lng: null }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ buildings });
}

// POST { id } — geocode a single comp building
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id } = await req.json() as { id: string };
  const building = await prisma.compBuilding.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!building) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let coords = await geocodeViaNominatim(`${building.name}, New York, NY`);
  if (!coords) coords = await geocodeViaNominatim(building.name);
  if (!coords) coords = await geocodeViaClaude(building.name);

  if (!coords) return NextResponse.json({ ok: false, reason: "not found" });

  await prisma.compBuilding.update({ where: { id }, data: { lat: coords.lat, lng: coords.lng } });
  return NextResponse.json({ ok: true, ...coords });
}
