import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import * as XLSX from "xlsx";
import { RESOURCE_FIELDS, RESOURCE_LABELS } from "@/app/lib/column-mapper";
import type { Resource } from "@/app/lib/sync-resources";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RESOURCES_LIST = Object.keys(RESOURCE_FIELDS) as Resource[];

function colLetter(idx: number): string {
  let result = "";
  let n = idx + 1;
  while (n > 0) {
    n--;
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

const SCHEMA_SUMMARY = RESOURCES_LIST.map((resource) => {
  const fields = RESOURCE_FIELDS[resource];
  return `  ${resource}:\n${fields.map((f) => `    - ${f.key} (${f.label})${f.required ? " [REQUIRED]" : ""}`).join("\n")}`;
}).join("\n\n");

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  let body: {
    fileName: string;
    sheets: { name: string; headers: string[]; rows: Record<string, string>[] }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { fileName, sheets } = body;
  if (!sheets?.length) {
    return NextResponse.json({ error: "No sheets provided." }, { status: 400 });
  }

  // Send only headers + 10 sample rows per sheet to the AI (keeps prompt small regardless of file size)
  const sheetsForAI = sheets.map((s) => ({
    name: s.name,
    headers: s.headers,
    sampleRows: s.rows.slice(0, 10),
    totalRows: s.rows.length,
  }));

  const sheetsText = sheetsForAI
    .map(
      (s) =>
        `Sheet: "${s.name}" (${s.totalRows} rows)\nHeaders: ${JSON.stringify(s.headers)}\nSample:\n${JSON.stringify(s.sampleRows, null, 2)}`,
    )
    .join("\n\n---\n\n");

  const prompt = `You are a data normalization assistant for a real estate pipeline application. Analyze the uploaded spreadsheet and return a column-mapping for each sheet.

Available resources and canonical field keys:
${SCHEMA_SUMMARY}

File: "${fileName}"

${sheetsText}

Instructions:
1. For each sheet, decide which resource it belongs to (or null if irrelevant).
2. Map every source column header to the canonical field key it represents, or null if it doesn't map to anything.
3. Multiple sheets may map to the same resource — they will be merged.
4. Skip cover sheets, legend sheets, or clearly empty/irrelevant sheets (resource: null).
5. For a sheet with raw lease transactions, use "lease-comps".
6. For a sheet with per-building aggregate stats by unit type, use "comp-building-stats".
7. Use common sense for ambiguous columns — e.g. "Unit SF" → "unitSf", "Gross Rent" → "grossRent".

Return ONLY valid JSON with no markdown or explanation:
{
  "sheetMappings": [
    {
      "sheetName": "exact sheet name as given",
      "resource": "resource-key or null",
      "columnMapping": {
        "Source Column Header": "canonicalFieldKey or null"
      }
    }
  ],
  "summary": "one sentence describing what was found and normalized"
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0]?.type === "text" ? message.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse JSON from AI response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      sheetMappings: {
        sheetName: string;
        resource: string | null;
        columnMapping: Record<string, string | null>;
      }[];
      summary: string;
    };

    // Apply column mappings to ALL rows from the original (untruncated) sheets
    const normalizedResources: Record<string, Record<string, string>[]> = {};

    for (const mapping of parsed.sheetMappings ?? []) {
      if (!mapping.resource) continue;
      const resource = mapping.resource as Resource;
      if (!RESOURCE_FIELDS[resource]) continue;

      const sheet = sheets.find((s) => s.name === mapping.sheetName);
      if (!sheet) continue;

      const normalizedRows = sheet.rows
        .map((row) => {
          const out: Record<string, string> = {};
          for (const [srcCol, targetField] of Object.entries(mapping.columnMapping)) {
            if (targetField && row[srcCol] !== undefined) {
              out[targetField] = String(row[srcCol] ?? "").trim();
            }
          }
          return out;
        })
        .filter((row) => Object.values(row).some((v) => v !== ""));

      if (!normalizedRows.length) continue;

      if (!normalizedResources[resource]) {
        normalizedResources[resource] = normalizedRows;
      } else {
        normalizedResources[resource].push(...normalizedRows);
      }
    }

    // ── Generate XLSX workbook ─────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    for (const resource of RESOURCES_LIST) {
      const rows = normalizedResources[resource];
      if (!rows?.length) continue;

      const fields = RESOURCE_FIELDS[resource];
      const sheetLabel = RESOURCE_LABELS[resource].slice(0, 31);
      const headerRow = fields.map((f) => f.label);
      const dataRows = rows.map((row) => fields.map((f) => row[f.key] ?? ""));
      const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
      XLSX.utils.book_append_sheet(wb, ws, sheetLabel);
    }

    // Calculations sheet — requires lease-comps data
    const leaseRows = normalizedResources["lease-comps"];
    if (leaseRows?.length) {
      const lcFields = RESOURCE_FIELDS["lease-comps"];
      const lcSheetName = RESOURCE_LABELS["lease-comps"].slice(0, 31);

      const unitTypeCol  = colLetter(lcFields.findIndex((f) => f.key === "unitType"));
      const grossRentCol = colLetter(lcFields.findIndex((f) => f.key === "grossRent"));
      const netRentCol   = colLetter(lcFields.findIndex((f) => f.key === "netRent"));
      const unitSfCol    = colLetter(lcFields.findIndex((f) => f.key === "unitSf"));
      const dataEnd      = leaseRows.length + 1;

      const rng = (col: string) => `'${lcSheetName}'!${col}2:${col}${dataEnd}`;

      const calcLabels: string[][] = [
        [`Calculations — based on '${lcSheetName}' data`, "", "", ""],
        ["", "", "", ""],
        ["Metric", "Value", "", ""],
        ["Gross Rent — AVERAGE",     "", "", ""],
        ["Gross Rent — MEDIAN",      "", "", ""],
        ["Gross Rent — MIN",         "", "", ""],
        ["Gross Rent — MAX",         "", "", ""],
        ["Gross Rent — COUNT (> 0)", "", "", ""],
        ["", "", "", ""],
        ["Net Rent — AVERAGE", "", "", ""],
        ["Net Rent — MEDIAN",  "", "", ""],
        ["", "", "", ""],
        ["Unit SF — AVERAGE", "", "", ""],
        ["Unit SF — MEDIAN",  "", "", ""],
        ["", "", "", ""],
        ["By Unit Type", "Gross Rent AVG", "Net Rent AVG", "Unit SF AVG"],
        ["ST",  "", "", ""],
        ["1BD", "", "", ""],
        ["2BD", "", "", ""],
        ["3BD", "", "", ""],
        ["4BD", "", "", ""],
      ];

      const calcWs = XLSX.utils.aoa_to_sheet(calcLabels);
      const f = (cell: string, formula: string) => { calcWs[cell] = { t: "n", f: formula }; };

      f("B4",  `AVERAGE(${rng(grossRentCol)})`);
      f("B5",  `MEDIAN(${rng(grossRentCol)})`);
      f("B6",  `MIN(${rng(grossRentCol)})`);
      f("B7",  `MAX(${rng(grossRentCol)})`);
      f("B8",  `COUNTIF(${rng(grossRentCol)},">0")`);
      f("B10", `AVERAGE(${rng(netRentCol)})`);
      f("B11", `MEDIAN(${rng(netRentCol)})`);
      f("B13", `AVERAGE(${rng(unitSfCol)})`);
      f("B14", `MEDIAN(${rng(unitSfCol)})`);

      ["ST", "1BD", "2BD", "3BD", "4BD"].forEach((ut, i) => {
        const row = 17 + i;
        const criteria = `"${ut}"`;
        f(`B${row}`, `AVERAGEIF(${rng(unitTypeCol)},${criteria},${rng(grossRentCol)})`);
        f(`C${row}`, `AVERAGEIF(${rng(unitTypeCol)},${criteria},${rng(netRentCol)})`);
        f(`D${row}`, `AVERAGEIF(${rng(unitTypeCol)},${criteria},${rng(unitSfCol)})`);
      });

      XLSX.utils.book_append_sheet(wb, calcWs, "Calculations");
    }

    if (wb.SheetNames.length === 0) {
      const ws = XLSX.utils.aoa_to_sheet([["No data extracted — try manual import"]]);
      XLSX.utils.book_append_sheet(wb, ws, "Info");
    }

    const xlsxBase64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
    const normalizedFileName = `normalized-${fileName.replace(/\.xlsx?$/i, "").replace(/\.csv$/i, "")}.xlsx`;

    return NextResponse.json({
      resources: normalizedResources,
      xlsxBase64,
      fileName: normalizedFileName,
      summary: parsed.summary ?? "",
    });
  } catch (err) {
    console.error("AI normalize error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Normalization failed" },
      { status: 500 },
    );
  }
}
