import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { RESOURCE_FIELDS } from "@/app/lib/column-mapper";
import type { Resource } from "@/app/lib/sync-resources";

const client = new Anthropic();

const SCHEMA_SUMMARY = Object.entries(RESOURCE_FIELDS)
  .map(([resource, fields]) => {
    const fieldList = fields
      .map((f) => `    - ${f.key} (${f.label})${f.required ? " [REQUIRED]" : ""}`)
      .join("\n");
    return `  ${resource}:\n${fieldList}`;
  })
  .join("\n\n");

export async function POST(req: NextRequest) {
  const { headers, sampleRows, fileName } = await req.json() as {
    headers: string[];
    sampleRows: Record<string, string>[];
    fileName?: string;
  };

  if (!headers?.length) {
    return NextResponse.json({ error: "No headers provided" }, { status: 400 });
  }

  const sample = sampleRows.slice(0, 5);
  const sampleText = sample.length
    ? `\nSample data rows (up to 5):\n${JSON.stringify(sample, null, 2)}`
    : "";

  const prompt = `You are a data import assistant for a real estate pipeline application. Your job is to identify which database resource a spreadsheet belongs to and map its columns to the correct database fields.

Available database resources and their fields:
${SCHEMA_SUMMARY}

The user dropped a file${fileName ? ` named "${fileName}"` : ""}. Here are its column headers:
${JSON.stringify(headers)}
${sampleText}

Based on the column headers and sample data, determine:
1. Which resource this file most likely belongs to (pick exactly one from the list above)
2. Which database field each column header maps to (or null if it doesn't match any field)

Rules:
- A database field can only be mapped to ONE header
- Use context clues from both header names AND sample data values
- If sample data contains building names and rent figures, it's likely lease-comps or comp-building-stats
- If sample data has quarter labels like "Q1 2024", it's likely comp-building-quarter-stats or trend
- Prefer the resource where the most required fields can be satisfied
- Return null for columns that don't match any field in the chosen resource

Respond with ONLY valid JSON in this exact format:
{
  "resource": "<resource-key>",
  "mappings": {
    "<header>": "<field-key or null>",
    ...
  },
  "reasoning": "<one sentence explaining your choice>"
}`;

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Claude");
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse JSON from response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      resource: Resource;
      mappings: Record<string, string | null>;
      reasoning?: string;
    };

    // Validate resource
    if (!RESOURCE_FIELDS[parsed.resource]) {
      throw new Error(`Unknown resource: ${parsed.resource}`);
    }

    // Validate mappings — only allow known field keys or null
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
