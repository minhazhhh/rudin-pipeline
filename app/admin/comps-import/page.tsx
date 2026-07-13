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
  const [resource, setResource] = useState<Resource>("comp-building-stats");
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
      // Find first row with ≥ 3 distinct non-empty string cells — that's the header row
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
    const detectedResource = detected?.resource ?? "comp-building-stats";
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
        setStep("done");
      } else {
        setResult({ ok: false, message: body.error ?? "Unknown error" });
      }
    } catch (e) { setResult({ ok: false, message: e instanceof Error ? e.message : String(e) }); }
    setSubmitting(false);
  }

  function reset() {
    setStep("drop"); setFileName(""); setRawRows([]); setHeaders([]); setMappings({}); setResult(null); setSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const fields = RESOURCE_FIELDS[resource];
  const mappedDbFields = new Set(Object.values(mappings).filter(Boolean) as string[]);
  const missingRequired = fields.filter((f) => f.required && !mappedDbFields.has(f.key));
  const previewRows = buildMappedRows().slice(0, 6);

  return (
    <div>
      <h1>Comps Import</h1>
      <p className="admin-sub">Drag and drop any Excel or CSV file — it will be read and mapped to the right columns automatically. You can review and correct the column mapping before importing.</p>

      {step === "drop" && (
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInputRef.current?.click()}
          style={{ border: `2px dashed ${dragging ? "#4f8ef7" : "#555"}`, borderRadius: 8, padding: "48px 32px", textAlign: "center", cursor: "pointer", background: dragging ? "#1a2540" : "transparent", transition: "all 0.15s", maxWidth: 560, margin: "32px auto" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>Drop your Excel or CSV file here</div>
          <div style={{ fontSize: 13, color: "#aaa" }}>Supports .xlsx, .xls, .csv — or click to browse</div>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
        </div>
      )}

      {step === "map" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, color: "#aaa" }}>File: <strong style={{ color: "#eee" }}>{fileName}</strong> — {rawRows.length} rows, {headers.length} columns</div>
            <button className="admin-btn secondary" onClick={reset} style={{ marginLeft: "auto" }}>← Use a different file</button>
          </div>
          <div className="admin-field-block" style={{ maxWidth: 480 }}>
            <label>Import into table</label>
            <select value={resource} onChange={(e) => onResourceChange(e.target.value as Resource)} style={{ width: "100%", padding: "6px 10px", background: "#1e1e1e", color: "#eee", border: "1px solid #444", borderRadius: 4 }}>
              {RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_LABELS[r]}</option>)}
            </select>
          </div>
          <h3 style={{ marginTop: 24, marginBottom: 4 }}>Column Mapping</h3>
          <p className="admin-sub" style={{ marginBottom: 12 }}>Columns auto-mapped from your file. Correct any mismatches using the dropdowns.</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ background: "#1e1e1e" }}>
                <th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #333" }}>Your column</th>
                <th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #333" }}>Maps to DB field</th>
                <th style={{ padding: "8px 12px", textAlign: "left", borderBottom: "1px solid #333" }}>Sample value</th>
              </tr></thead>
              <tbody>{headers.map((h) => {
                const mapped = mappings[h] ?? null;
                const sample = rawRows[0]?.[h] ?? "";
                return (
                  <tr key={h} style={{ borderBottom: "1px solid #222" }}>
                    <td style={{ padding: "6px 12px", fontFamily: "monospace", color: "#ccc" }}>{h}</td>
                    <td style={{ padding: "6px 12px" }}>
                      <select value={mapped ?? ""} onChange={(e) => setMapping(h, e.target.value || null)}
                        style={{ background: mapped ? "#1a2a1a" : "#2a1a1a", color: mapped ? "#7eca7e" : "#ca7e7e", border: `1px solid ${mapped ? "#3a5a3a" : "#5a3a3a"}`, borderRadius: 4, padding: "4px 8px", fontSize: 12, width: "100%", minWidth: 200 }}>
                        <option value="">— skip this column —</option>
                        {fields.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key}){f.required ? " *" : ""}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: "6px 12px", color: "#888", fontFamily: "monospace", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sample}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {missingRequired.length > 0 && <div className="admin-error" style={{ marginTop: 12 }}>Required fields not yet mapped: {missingRequired.map((f) => f.label).join(", ")}</div>}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <button className="admin-btn" disabled={missingRequired.length > 0} onClick={() => setStep("preview")}>Preview import →</button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ fontSize: 14, color: "#aaa" }}><strong style={{ color: "#eee" }}>{rawRows.length} rows</strong> → <strong style={{ color: "#eee" }}>{RESOURCE_LABELS[resource]}</strong></div>
            <button className="admin-btn secondary" onClick={() => setStep("map")}>← Edit mapping</button>
          </div>
          <h3 style={{ marginBottom: 8 }}>Preview (first {Math.min(6, rawRows.length)} rows)</h3>
          <div style={{ overflowX: "auto", marginBottom: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ background: "#1e1e1e" }}>
                {Object.values(mappings).filter(Boolean).map((dbField) => {
                  const f = fields.find((x) => x.key === dbField);
                  return <th key={dbField as string} style={{ padding: "6px 10px", textAlign: "left", borderBottom: "1px solid #333", whiteSpace: "nowrap" }}>{f?.label ?? dbField}</th>;
                })}
              </tr></thead>
              <tbody>{previewRows.map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #222", background: i % 2 ? "#141414" : "transparent" }}>
                  {Object.values(mappings).filter(Boolean).map((dbField) => (
                    <td key={dbField as string} style={{ padding: "5px 10px", color: "#ccc", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row[dbField as string] ?? ""}</td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="admin-field-block" style={{ maxWidth: 480 }}>
            <label>Import mode</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
              <label style={{ display: "flex", gap: 10, cursor: "pointer", alignItems: "flex-start" }}>
                <input type="radio" name="mode" value="upsert" checked={mode === "upsert"} onChange={() => setMode("upsert")} style={{ marginTop: 3 }} />
                <div><strong>Merge / add new</strong><div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>Add new rows and update existing ones. Existing data not in this file is left untouched.<br /><em>Best for adding new buildings or updating specific entries.</em></div></div>
              </label>
              <label style={{ display: "flex", gap: 10, cursor: "pointer", alignItems: "flex-start" }}>
                <input type="radio" name="mode" value="replace" checked={mode === "replace"} onChange={() => setMode("replace")} style={{ marginTop: 3 }} />
                <div><strong>Replace all</strong><div style={{ fontSize: 12, color: "#ca7e7e", marginTop: 2 }}>⚠ Deletes ALL existing data in this table and replaces with this file.<br /><em>Only use when you want a completely fresh dataset.</em></div></div>
              </label>
            </div>
          </div>
          {result && !result.ok && <div className="admin-error" style={{ marginTop: 12 }}>{result.message}</div>}
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <button className="admin-btn" onClick={runImport} disabled={submitting}>{submitting ? "Importing…" : `Import ${rawRows.length} rows`}</button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div style={{ maxWidth: 520, margin: "40px auto", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{result.ok ? "✅" : "❌"}</div>
          <div style={{ fontSize: 16, marginBottom: 24, color: result.ok ? "#7eca7e" : "#ca7e7e" }}>{result.message}</div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="admin-btn" onClick={reset}>Import another file</button>
            <a className="admin-btn secondary" href={`/admin/${resource === "comp-building-stats" ? "comp-building-stats" : resource === "comp-buildings" ? "comp-buildings" : "sync"}`}>View table →</a>
          </div>
        </div>
      )}
    </div>
  );
}
