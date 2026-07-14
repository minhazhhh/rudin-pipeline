import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/api-auth";

async function geocodeViaNominatim(query: string, appendCity: boolean): Promise<{ lat: number; lng: number } | null> {
  try {
    const q = appendCity ? `${query}, New York, NY` : query;
    const encoded = encodeURIComponent(q);
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

  const query = address?.trim() ? `${address}` : `${name}, New York, NY`;
  const prompt = `You are a geocoding assistant. Return the latitude and longitude for this location.

Location: ${query}

Return ONLY valid JSON with no explanation:
{"lat": <number or null>, "lng": <number or null>}

If you are not confident in the exact coordinates, return null for both fields.`;

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
    if (!res.ok) {
      console.error("[geocode] Claude error:", res.status, await res.text());
      return null;
    }
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { lat: number | null; lng: number | null };
    if (!parsed.lat || !parsed.lng) return null;
    return { lat: parsed.lat, lng: parsed.lng };
  } catch (e) {
    console.error("[geocode] Claude exception:", e);
    return null;
  }
}

async function fetchImageViaClaude(name: string, address: string | null, year: string | null): Promise<string | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const location = address?.trim() ? address : `${name}, New York, NY`;
  const prompt = `You are a real estate research assistant. Find a direct URL to a real photograph of this building.

Building: ${name}
Address: ${location}${year ? `\nYear: ${year}` : ""}

Return ONLY valid JSON — no explanation, no markdown:
{"imageUrl": "<direct image URL to a photo of this building, or null if unknown>"}

Rules:
- The URL must end in .jpg, .jpeg, .png, or .webp
- It must be a photo of the actual building exterior, not a logo, map, or icon
- Prefer Wikimedia Commons URLs (upload.wikimedia.org) — these are reliably public
- If you are not confident the URL is real and publicly accessible, return null`;

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
        max_tokens: 128,
        temperature: 0,
      }),
    });
    if (!res.ok) {
      console.error("[image] Claude error:", res.status, await res.text());
      return null;
    }
    const data = await res.json() as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { imageUrl: string | null };
    const url = parsed.imageUrl;
    if (!url || url === "null") return null;
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) return null;
    return url;
  } catch (e) {
    console.error("[image] Claude exception:", e);
    return null;
  }
}

// GET — list projects that need geocoding or images
export async function GET(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const projects = await prisma.project.findMany({
    where: { OR: [{ lat: 0, lng: 0 }, { imageUrl: "" }] },
    select: { id: true, name: true, address: true, lat: true, lng: true, imageUrl: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ projects });
}

// POST with { id } — geocode a single project and save it
export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { id, addressOverride } = await req.json() as { id: string; addressOverride?: string };
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, address: true, lat: true, lng: true, imageUrl: true, deliveryLabel: true },
  });
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!project.name) return NextResponse.json({ ok: false, reason: "no name" });

  // Allow caller to supply the address (e.g. from the imported row) when the DB row predates the address field
  if (addressOverride && !project.address) {
    await prisma.project.update({ where: { id }, data: { address: addressOverride } });
    project.address = addressOverride;
  }

  const address = project.address?.trim() || null;

  // Geocode if needed
  const needsGeocode = !project.lat && !project.lng || (project.lat === 0 && project.lng === 0);
  let coords: { lat: number; lng: number } | null = null;
  if (needsGeocode) {
    if (address) {
      coords = await geocodeViaNominatim(address, false);
      if (!coords) coords = await geocodeViaNominatim(address, true);
    }
    if (!coords) coords = await geocodeViaNominatim(project.name, true);
    if (!coords) coords = await geocodeViaClaude(project.name, address);
    console.log(`[geocode] "${project.name}" →`, coords ?? "not found");
    if (!coords) return NextResponse.json({ ok: false, reason: "not found" });
  }

  // Fetch building image if missing via Claude
  const needsImage = !project.imageUrl?.trim();
  let imageUrl: string | null = null;
  if (needsImage) {
    imageUrl = await fetchImageViaClaude(project.name, address, project.deliveryLabel?.trim() || null);
    console.log(`[image] "${project.name}" →`, imageUrl ?? "not found");
  }

  const update: Record<string, unknown> = {};
  if (coords) { update.lat = coords.lat; update.lng = coords.lng; }
  if (imageUrl) update.imageUrl = imageUrl;
  if (Object.keys(update).length) await prisma.project.update({ where: { id }, data: update });

  return NextResponse.json({ ok: true, ...(coords ?? {}), imageUrl });
}
