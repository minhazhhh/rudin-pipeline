import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";

async function geocodeViaNominatim(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const encoded = encodeURIComponent(query + ", New York, NY");
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, { headers: { "User-Agent": "rudin-pipeline/1.0 (mhasan@rudin.com)" } });
    if (!res.ok) return null;
    const results = await res.json() as { lat: string; lon: string }[];
    if (!results.length) return null;
    return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
  } catch { return null; }
}

async function geocodeViaClaude(name: string, address: string | null): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const query = address ? `${name} (address: ${address})` : name;
  const prompt = `You are a geocoding assistant for NYC real estate. Given a building name or address in New York City, return ONLY a JSON object with the exact latitude and longitude.

Building: ${query}

Rules:
- Only return coordinates within NYC (lat: 40.4–40.95, lng: -74.3 to -73.7)
- If you are not confident, return null for both fields
- Return ONLY valid JSON, no explanation

{"lat": <number or null>, "lng": <number or null>}`;

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
        messages: [{ role: "user", content: prompt }],
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
    // Sanity check: must be within NYC bounds
    if (parsed.lat < 40.4 || parsed.lat > 40.95 || parsed.lng < -74.3 || parsed.lng > -73.7) return null;
    return { lat: parsed.lat, lng: parsed.lng };
  } catch { return null; }
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
  if (!project.name) return NextResponse.json({ ok: false, reason: "no name" });

  // Try Nominatim first (free, fast), fall back to Claude (knows named buildings)
  let coords = await geocodeViaNominatim(project.address?.trim() || project.name.trim());
  if (!coords) {
    coords = await geocodeViaClaude(project.name, project.address);
  }

  if (!coords) return NextResponse.json({ ok: false, reason: "not found" });

  await prisma.project.update({ where: { id }, data: coords });
  return NextResponse.json({ ok: true, ...coords });
}
