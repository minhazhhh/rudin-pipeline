"use client";

import { useCallback, useRef, useState } from "react";
import { RESOURCE_FIELDS, RESOURCE_LABELS, autoMapColumns, detectResource } from "@/app/lib/column-mapper";
import type { Resource } from "@/app/lib/sync-resources";

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  function splitLine(line: string): string[] {
    const fields: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQ = true; }
        else if (ch === ',') { fields.push(cur.trim()); cur = ""; }
        else { cur += ch; }
      }
    }
    fields.push(cur.trim());
    return fields;
  }
  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = vals[i]?.trim() ?? ""; });
    return row;
  });
}

type Step = "drop" | "map" | "preview" | "done";
type ImportMode = "replace" | "upsert";

const RESOURCES: Resource[] = ["lease-comps","comp-buildings","comp-building-stats","comp-building-quarter-stats","overall-stats","type-stats","trend","projects"];

function normSheet(rows: Record<string, unknown>[]): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) out[k.trim()] = v === null || v === undefined ? "" : String(v).trim();
    return out;
  });
}

export default function CompsImportPage() {
  const [step, setStep] = useState<Step>("drop");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [resource, setResource] = useState<Resource>("lease-comps");
  const [mappings, setMappings] = useState<Record<string, string | null>>({});
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseFile = useCallback(async (file: File) => {
    setFileName(file.name);
    const isExcel = /\.xlsx?$/i.test(file.name) || file.type.includes("spreadsheetml");
    const buf = await file.arrayBuffer();
    let parsed: Record<string, string>[];
    if (isExcel) {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array" });
      // Prefer "Data" sheet if present (Rudin workbook), otherwise first sheet
      const sheetName = wb.SheetNames.find((n) => /^data$/i.test(n)) ?? wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      // Parse as array-of-arrays so we can detect/skip title banner rows
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
      // Find first row with >= 3 distinct non-empty string cells — that's the header row
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(grid.length, 10); i++) {
        const nonEmpty = grid[i].filter((c) => typeof c === "string" && c.trim().length > 0 && c.trim().length <= 80);
        if (nonEmpty.length >= 3) { headerRowIdx = i; break; }
      }
      const headers2 = (grid[headerRowIdx] as unknown[]).map((c) => String(c).trim());
      const raw: Record<string, string>[] = [];
      for (let i = headerRowIdx + 1; i < grid.length; i++) {
        const row = grid[i] as unknown[];
        const obj: Record<string, string> = {};
        headers2.forEach((h, j) => { obj[h] = row[j] !== undefined && row[j] !== null ? String(row[j]).trim() : ""; });
        if (Object.values(obj).some((v) => v !== "")) raw.push(obj);
      }
      parsed = raw;
    } else {
      parsed = parseCsv(new TextDecoder("utf-8").decode(buf));
    }
    if (!parsed.length) { alert("The file appears to be empty — no rows found."); return; }
    const hdrs = Object.keys(parsed[0]);
    setRawRows(parsed); setHeaders(hdrs);
    const detected = detectResource(hdrs);
    const detectedResource = detected?.resource ?? "lease-comps";
    setResource(detectedResource);
    setMappings(autoMapColumns(hdrs, detectedResource));
    setStep("map");
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  function onResourceChange(r: Resource) { setResource(r); setMappings(autoMapColumns(headers, r)); }

  function setMapping(header: string, dbField: string | null) {
    setMappings((m) => {
      const next = { ...m };
      if (dbField) { for (const h of Object.keys(next)) { if (next[h] === dbField && h !== header) next[h] = null; } }
      next[header] = dbField;
      return next;
    });
  }

  function buildMappedRows(): Record<string, string>[] {
    return rawRows.map((row) => {
      const out: Record<string, string> = {};
      for (const [header, dbField] of Object.entries(mappings)) { if (dbField) out[dbField] = row[header] ?? ""; }
      return out;
    });
  }

  async function runImport() {
    setSubmitting(true); setResult(null);
    const rows = buildMappedRows();
    try {
      const res = await fetch("/api/comps-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, rows, mode }) });
      const body = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: `Successfully ${mode === "replace" ? "replaced all data with" : "merged"} ${body.rowsImported} rows into ${RESOURCE_LABELS[resource]}.` });
      } else {
        setResult({ ok: false, message: body.error ?? "Unknown error" });
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
      setStep("done");
    }
  }

  const requiredFields = RESOURCE_FIELDS[resource].filter((f) => f.required).map((f) => f.key);
  const mappedDbFields = new Set(Object.values(mappings).filter(Boolean) as string[]);
  const missingRequired = requiredFields.filter((k) => !mappedDbFields.has(k));

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "2rem 1rem", fontFamily: "inherit" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>Comps Import</h1>
      <p style={{ color: "#666", marginBottom: "2rem", fontSize: "0.9rem" }}>Drop any Excel or CSV file — columns are auto-detected and mapped to the database.</p>

      {/* Step: drop */}
      {step === "drop" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#2563eb" : "#cbd5e1"}`,
            borderRadius: 12, padding: "3rem 2rem", textAlign: "center",
            cursor: "pointer", background: dragging ? "#eff6ff" : "#f8fafc",
            transition: "all 0.15s",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📂</div>
          <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>Drop your file here</div>
          <div style={{ color: "#64748b", fontSize: "0.85rem" }}>Excel (.xlsx, .xls) or CSV — any format</div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.[0]) parseFile(e.target.files[0]); }} />
        </div>
      )}

      {/* Step: map */}
      {step === "map" && (
        <div>
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: 600, marginBottom: "0.5rem" }}>File: <span style={{ fontWeight: 400 }}>{fileName}</span> — {rawRows.length.toLocaleString()} rows</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 500, fontSize: "0.9rem" }}>Importing into:</span>
              <select value={resource} onChange={(e) => onResourceChange(e.target.value as Resource)}
                style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.9rem" }}>
                {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_LABELS[r]}</option>)}
              </select>
            </label>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", marginBottom: "1rem" }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>File Column</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>Maps to DB Field</th>
                <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>Sample Value</th>
              </tr>
            </thead>
            <tbody>
              {headers.map((h) => {
                const mapped = mappings[h];
                const sample = rawRows[0]?.[h] ?? "";
                return (
                  <tr key={h} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: mapped ? "#15803d" : "#dc2626" }}>{h}</td>
                    <td style={{ padding: "7px 12px" }}>
                      <select value={mapped ?? ""} onChange={(e) => setMapping(h, e.target.value || null)}
                        style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.82rem", background: mapped ? "#f0fdf4" : "#fff7f7" }}>
                        <option value="">(skip)</option>
                        {RESOURCE_FIELDS[resource].map((f) => (
                          <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: "7px 12px", color: "#64748b", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sample}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {missingRequired.length > 0 && (
            <div style={{ color: "#dc2626", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "8px 12px", marginBottom: "1rem", fontSize: "0.85rem" }}>
              Missing required fields: {missingRequired.join(", ")}
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setStep("preview")} disabled={missingRequired.length > 0}
              style={{ padding: "8px 20px", background: missingRequired.length ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: missingRequired.length ? "not-allowed" : "pointer", fontWeight: 600 }}>
              Review & Import →
            </button>
            <button onClick={() => setStep("drop")}
              style={{ padding: "8px 16px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}>
              ← Start over
            </button>
          </div>
        </div>
      )}

      {/* Step: preview */}
      {step === "preview" && (
        <div>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>Preview — first 6 rows</h2>
          <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
            <table style={{ borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 400 }}>
              <thead>
                <tr style={{ background: "#f1f5f9" }}>
                  {Object.entries(mappings).filter(([, v]) => v).map(([h]) => (
                    <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{mappings[h]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {buildMappedRows().slice(0, 6).map((row, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                    {Object.entries(mappings).filter(([, v]) => v).map(([h]) => (
                      <td key={h} style={{ padding: "5px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row[mappings[h]!]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ fontWeight: 500, fontSize: "0.9rem" }}>Import mode:</label>
            <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="radio" name="mode" value="upsert" checked={mode === "upsert"} onChange={() => setMode("upsert")} />
                <span><strong>Merge</strong> — add / update records</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="radio" name="mode" value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} />
                <span><strong>Replace</strong> — delete all existing rows first</span>
              </label>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={runImport} disabled={submitting}
              style={{ padding: "8px 20px", background: submitting ? "#94a3b8" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: submitting ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {submitting ? "Importing…" : `Import ${rawRows.length.toLocaleString()} rows`}
            </button>
            <button onClick={() => setStep("map")}
              style={{ padding: "8px 16px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* Step: done */}
      {step === "done" && result && (
        <div style={{ padding: "1.5rem", borderRadius: 8, background: result.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${result.ok ? "#86efac" : "#fca5a5"}` }}>
          <div style={{ fontWeight: 700, marginBottom: "0.5rem", color: result.ok ? "#15803d" : "#dc2626" }}>
            {result.ok ? "Import complete" : "Import failed"}
          </div>
          <div style={{ fontSize: "0.9rem" }}>{result.message}</div>
          <button onClick={() => { setStep("drop"); setResult(null); setRawRows([]); setHeaders([]); setFileName(""); }}
            style={{ marginTop: "1rem", padding: "7px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
