import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/api-auth";

export async function POST(req: NextRequest) {
  const unauthorized = requireAdmin(req);
  if (unauthorized) return unauthorized;

  const { resource, rows, fields } = await req.json() as {
    resource: string;
    rows: Record<string, string>[];
    fields: { key: string; label: string }[];
  };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ bad: [], reasons: {} });

  // Represent rows compactly to minimise tokens
  const fieldKeys = fields.map((f) => f.key);
  const rowLines = rows.map((row, i) => {
    const parts = fieldKeys.map((k) => `${k}=${JSON.stringify(row[k] ?? "")}`).join(", ");
    return `Row ${i}: ${parts}`;
  }).join("\n");

  const prompt = `You are validating rows imported from a real estate spreadsheet into the "${resource}" table.

Each row was mapped to these fields: ${fields.map((f) => f.label).join(", ")}.

Your job: identify any rows that are NOT real data records. Flag rows that look like:
- Footer or notes rows (e.g. "Sources and Notes", "See above", "N/A", "Total:", "* Denotes…")
- Section headers or subtotals embedded in the data
- Repeated column headers mid-sheet
- Blank or placeholder rows with no meaningful values
- Rows where the building/record name is clearly not a real name (e.g. "TBD", "---", "continued")

Do NOT flag rows just because they have some empty fields — partial data is fine.
Do NOT flag rows that look like real but unusual buildings or records.

Rows to check:
${rowLines}

Return ONLY valid JSON, no explanation:
{"bad": [<array of row indices that are NOT real records>], "reasons": {"<index>": "<short reason>"}}

If all rows look like real data, return {"bad": [], "reasons": {}}.`;

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
        max_tokens: 1024,
        temperature: 0,
      }),
    });

    if (!res.ok) {
      console.error("[validate-rows] Claude error:", res.status, await res.text());
      return NextResponse.json({ bad: [], reasons: {} });
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const text = data.choices[0]?.message?.content ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ bad: [], reasons: {} });

    const parsed = JSON.parse(match[0]) as { bad: number[]; reasons: Record<string, string> };
    return NextResponse.json({ bad: parsed.bad ?? [], reasons: parsed.reasons ?? {} });
  } catch (e) {
    console.error("[validate-rows] exception:", e);
    return NextResponse.json({ bad: [], reasons: {} });
  }
}
