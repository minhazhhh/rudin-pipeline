import { NextRequest, NextResponse } from "next/server";
import { RESOURCE_FIELDS } from "@/app/lib/column-mapper";
import type { Resource } from "@/app/lib/sync-resources";

const SCHEMA_SUMMARY = Object.entries(RESOURCE_FIELDS)
  .map(([resource, fields]) => {
    const fieldList = fields
      .map((f) => `    - ${f.key} (${f.label})${f.required ? " [REQUIRED]" : ""}`)
      .join("\n");
    return `  ${resource}:\n${fieldList}`;
  })
  .join("\n\n");

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });
  }

  const { headers, sampleRows, fileName } = await req.json() as {
    headers: string[];
    sampleRows: Record<string, string>[];
    fileName?: string;
  };

  if (!headers?.length) {
    return NextResponse.json({ error: "No headers provided" }, { status: 400 });
  }

  const sample = sampleRows.slice(0, 10);

  // Summarise which columns actually have data — helps Claude break ties
  const columnsWithData = headers.filter((h) =>
    sample.some((row) => row[h] && row[h].trim() !== "")
  );
  const columnsEmpty = headers.filter((h) => !columnsWithData.includes(h));

  const sampleText = sample.length
    ? `\nSample data rows (up to 10):\n${JSON.stringify(sample, null, 2)}\n\nColumns WITH data in sample: ${JSON.stringify(columnsWithData)}\nColumns EMPTY in sample (lower priority for mapping): ${JSON.stringify(columnsEmpty)}`
    : "";

  const prompt = `You are a data import assistant for a real estate pipeline application. Your job is to identify which database resource a spreadsheet belongs to and map its columns to the correct database fields.

Available database resources and their fields:
${SCHEMA_SUMMARY}

The user dropped a file${fileName ? ` named "${fileName}"` : ""}. Here are its column headers:
${JSON.stringify(headers)}
${sampleText}

Based on the column headers AND the sample data values, determine:
1. Which resource this file most likely belongs to (pick exactly one)
2. Which database field each column header maps to (or null if no match)

Key signals to look for in the VALUES:
- Individual rent amounts ($1,000–$15,000 range) with unit IDs → lease-comps
- Statistical aggregates (avg/med/min/max rent columns together) → comp-building-stats or overall-stats
- Quarter labels like "Q1 2024" → comp-building-quarter-stats or trend
- Only building-level info with no units/rents → comp-buildings
- Pipeline/delivery dates, borough, sponsor → projects
- Property type breakdown (class A/B/C) + unit types → type-stats

Rules:
- A database field can only be mapped to ONE column — when two columns could both map to the same field, pick the one that has actual sample data (non-empty values). If both have data, pick the semantically stronger match.
- "First Listed", "Listed Date", "Available Date" are all valid date fields — map them to leaseDate if no better date column exists or if the "Leased Date" column is empty.
- "Beds" or "Bedrooms" with numeric values (0=studio, 1, 2, 3) is unitType — map it even if another column like "Floorplan Name" also suggests unitType; prefer the numeric beds column for unitType.
- Return null for columns that have no reasonable match (floor #, baths, active listing boolean, amenities arrays, pivot columns)
- Use both the column name AND the sample values — a column named "Asking Rent" with values like "$3,530" is grossRent in lease-comps
- Columns with empty sample values are lower priority than columns with actual data when both could fill the same field

Respond with ONLY valid JSON, no markdown, no explanation outside the JSON:
{
  "resource": "<resource-key>",
  "mappings": {
    "<exact-header-string>": "<field-key or null>",
    ...
  },
  "reasoning": "<one sentence explaining your resource choice>"
}`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
        max_tokens: 1024,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("OpenRouter response:", response.status, err);
      throw new Error(`OpenRouter error ${response.status}: ${err}`);
    }

    const data = await response.json() as {
      choices: { message: { content: string } }[];
    };

    const text = data.choices[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse JSON from response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      resource: Resource;
      mappings: Record<string, string | null>;
      reasoning?: string;
    };

    if (!RESOURCE_FIELDS[parsed.resource]) {
      throw new Error(`Unknown resource: ${parsed.resource}`);
    }

    // Validate — only allow known field keys or null
    const validKeys = new Set(RESOURCE_FIELDS[parsed.resource].map((f) => f.key));
    const cleanMappings: Record<string, string | null> = {};
    for (const header of headers) {
      const mapped = parsed.mappings[header];
      cleanMappings[header] = mapped && validKeys.has(mapped) ? mapped : null;
    }

    return NextResponse.json({
      resource: parsed.resource,
      mappings: cleanMappings,
      reasoning: parsed.reasoning ?? null,
    });
  } catch (err) {
    console.error("AI mapping error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI mapping failed" },
      { status: 500 }
    );
  }
}
