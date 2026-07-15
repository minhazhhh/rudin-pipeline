"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RESOURCE_FIELDS, RESOURCE_LABELS, autoMapColumns, detectResource } from "@/app/lib/column-mapper";
import type { Resource } from "@/app/lib/sync-resources";

// ─── CSV parser ────────────────────────────────────────────────────────────────

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  function split(line: string): string[] {
    const fields: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ',') { fields.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  }
  const hdrs = split(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = split(line);
    const row: Record<string, string> = {};
    hdrs.forEach((h, i) => { row[h.trim()] = vals[i]?.trim() ?? ""; });
    return row;
  });
}

// ─── Excel parser ──────────────────────────────────────────────────────────────

export type ParsedSheet = { sheetName: string; rows: Record<string, string>[] };

async function parseExcel(buf: ArrayBuffer): Promise<ParsedSheet[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });

  function scoreRow(row: string[]): number {
    return row.filter((c) => {
      const s = String(c ?? "").trim();
      return s.length > 0 && s.length <= 80 && !/^__EMPTY/i.test(s);
    }).length;
  }

  function parseSheet(grid: string[][]): Record<string, string>[] {
    if (grid.length < 2) return [];
    let headerRowIdx = 0, bestScore = -1;
    for (let i = 0; i < Math.min(grid.length, 20); i++) {
      const s = scoreRow(grid[i]);
      if (s > bestScore) { bestScore = s; headerRowIdx = i; }
      if (s >= 8) break;
    }
    if (bestScore < 2) return [];
    const slots: { name: string; colIdx: number }[] = [];
    grid[headerRowIdx].forEach((h, j) => {
      const name = String(h ?? "").trim();
      if (name && !/^__EMPTY/i.test(name)) slots.push({ name, colIdx: j });
    });
    if (slots.length < 2) return [];
    const rows: Record<string, string>[] = [];
    for (let i = headerRowIdx + 1; i < grid.length; i++) {
      const row = grid[i];
      const obj: Record<string, string> = {};
      slots.forEach(({ name, colIdx }) => { obj[name] = String(row[colIdx] ?? "").trim(); });
      if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
    }
    return rows;
  }

  const skipPattern = /notes|legend|lookup|readme|instructions|changelog|key$/i;
  const results: ParsedSheet[] = [];
  for (const sheetName of wb.SheetNames) {
    if (skipPattern.test(sheetName)) continue;
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: "", raw: false,
    }) as string[][];
    const rows = parseSheet(grid);
    if (rows.length > 0) results.push({ sheetName, rows });
  }
  return results;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const SYNC_RESOURCES: { key: string; label: string; urlField: string }[] = [
  { key: "projects",                    label: "Pipeline Projects",                urlField: "projectsSheetUrl" },
  { key: "comp-buildings",              label: "Comp Buildings",                   urlField: "compBuildingsSheetUrl" },
  { key: "comp-building-stats",         label: "Comp Building Stats",              urlField: "compBuildingStatsSheetUrl" },
  { key: "comp-building-quarter-stats", label: "Comp Building Stats — By Quarter", urlField: "compBuildingQuarterStatsSheetUrl" },
  { key: "overall-stats",               label: "Overall Unit Stats",               urlField: "overallStatsSheetUrl" },
  { key: "type-stats",                  label: "Type × Unit Stats",                urlField: "typeStatsSheetUrl" },
  { key: "trend",                       label: "Rent Trend",                       urlField: "trendSheetUrl" },
];

const IMPORT_RESOURCES: Resource[] = [
  "lease-comps", "comp-buildings", "comp-building-stats", "comp-building-quarter-stats",
  "overall-stats", "type-stats", "trend", "projects",
];

type Config = Record<string, string | null>;
type Step = "drop" | "autoconfirm" | "map" | "preview" | "done" | "multi";
type ImportMode = "replace" | "upsert";

type SheetJob = {
  sheetName: string;
  rows: Record<string, string>[];
  resource: Resource;
  mappings: Record<string, string | null>;
  include: boolean;
  status: "pending" | "validating" | "importing" | "done" | "error";
  result?: string;
};

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SyncPage() {
  // Sheet sync
  const [config, setConfig] = useState<Config>({});
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // File import
  const [step, setStep] = useState<Step>("drop");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [resource, setResource] = useState<Resource>("lease-comps");
  const [mappings, setMappings] = useState<Record<string, string | null>>({});
  const [aiMappedFields, setAiMappedFields] = useState<Set<string>>(new Set());
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiMapping, setAiMapping] = useState(false);
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [submitting, setSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [geocodeStatus, setGeocodeStatus] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [filteredIndices, setFilteredIndices] = useState<Set<number>>(new Set());
  const [filterReasons, setFilterReasons] = useState<Record<number, string>>({});
  const [sheetJobs, setSheetJobs] = useState<SheetJob[]>([]);
  const [multiImporting, setMultiImporting] = useState(false);
  const [multiMode, setMultiMode] = useState<ImportMode>("upsert");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/sync-config")
      .then((r) => r.json())
      .then((data) => { setConfig(data); setLastSyncedAt(data.lastSyncedAt ?? null); setLoadingConfig(false); });
  }, []);

  // ── File parsing ───────────────────────────────────────────────────────────

  const parseFile = useCallback(async (file: File) => {
    setFileName(file.name);
    const isExcel = /\.xlsx?$/i.test(file.name) || file.type.includes("spreadsheetml");
    const buf = await file.arrayBuffer();

    if (isExcel) {
      const sheets = await parseExcel(buf);
      if (!sheets.length) { alert("No data rows found in this file."); return; }

      if (sheets.length > 1) {
        // Multi-sheet: go to multi-import flow
        setStep("multi");
        setAiMapping(true);
        // Build initial jobs with heuristic mapping while AI runs
        const initial: SheetJob[] = sheets.map(({ sheetName, rows }) => {
          const hdrs = Object.keys(rows[0] ?? {});
          const fallback = detectResource(hdrs);
          const r = fallback?.resource ?? "lease-comps";
          return { sheetName, rows, resource: r, mappings: autoMapColumns(hdrs, r), include: true, status: "pending" };
        });
        setSheetJobs(initial);

        // AI-map each sheet in parallel
        const aiResults = await Promise.all(sheets.map(async ({ sheetName, rows }) => {
          const hdrs = Object.keys(rows[0] ?? {});
          try {
            const res = await fetch("/api/ai-map", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ headers: hdrs, sampleRows: rows.slice(0, 10), fileName: `${file.name} / ${sheetName}` }),
            });
            if (res.ok) {
              const data = await res.json() as { resource: Resource; mappings: Record<string, string | null> };
              return { sheetName, resource: data.resource, mappings: data.mappings };
            }
          } catch { /* fall back to heuristic */ }
          const fallback = detectResource(hdrs);
          const r = fallback?.resource ?? "lease-comps";
          return { sheetName, resource: r, mappings: autoMapColumns(hdrs, r) };
        }));

        setSheetJobs((prev) => prev.map((job) => {
          const ai = aiResults.find((r) => r.sheetName === job.sheetName);
          return ai ? { ...job, resource: ai.resource, mappings: ai.mappings } : job;
        }));
        setAiMapping(false);
        return;
      }

      // Single-sheet Excel — use existing single-sheet flow
      const { rows } = sheets[0];
      const hdrs = Object.keys(rows[0] ?? {});
      setRawRows(rows); setHeaders(hdrs);
      setAiMappedFields(new Set()); setAiReasoning(null); setAiMapping(true);
      // Stay on "drop" step showing a spinner while AI works; only advance once we know where to go
      try {
        const res = await fetch("/api/ai-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headers: hdrs, sampleRows: rows.slice(0, 10), fileName: file.name }),
        });
        if (res.ok) {
          const data = await res.json() as { resource: Resource; mappings: Record<string, string | null>; reasoning?: string };
          setResource(data.resource); setMappings(data.mappings);
          setAiMappedFields(new Set(Object.entries(data.mappings).filter(([, v]) => v !== null).map(([k]) => k)));
          setAiReasoning(data.reasoning ?? null);
          const requiredFields = RESOURCE_FIELDS[data.resource].filter((f) => f.required).map((f) => f.key);
          const mappedSet = new Set(Object.values(data.mappings).filter(Boolean) as string[]);
          const allRequiredMapped = requiredFields.every((k) => mappedSet.has(k));
          setStep(allRequiredMapped && mappedSet.size >= 3 ? "autoconfirm" : "map");
        } else {
          const fallback = detectResource(hdrs); const r = fallback?.resource ?? "lease-comps";
          setResource(r); setMappings(autoMapColumns(hdrs, r)); setStep("map");
        }
      } catch {
        const fallback = detectResource(hdrs); const r = fallback?.resource ?? "lease-comps";
        setResource(r); setMappings(autoMapColumns(hdrs, r)); setStep("map");
      } finally { setAiMapping(false); }
      return;
    }

    // CSV — existing single-sheet flow
    const parsed = parseCsv(new TextDecoder("utf-8").decode(buf));
    if (!parsed.length) { alert("No data rows found in this file."); return; }
    const hdrs = Object.keys(parsed[0]);
    setRawRows(parsed); setHeaders(hdrs);
    setAiMappedFields(new Set()); setAiReasoning(null); setAiMapping(true);
    try {
      const res = await fetch("/api/ai-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers: hdrs, sampleRows: parsed.slice(0, 10), fileName: file.name }),
      });
      if (res.ok) {
        const data = await res.json() as { resource: Resource; mappings: Record<string, string | null>; reasoning?: string };
        setResource(data.resource); setMappings(data.mappings);
        setAiMappedFields(new Set(Object.entries(data.mappings).filter(([, v]) => v !== null).map(([k]) => k)));
        setAiReasoning(data.reasoning ?? null);
        const requiredFields = RESOURCE_FIELDS[data.resource].filter((f) => f.required).map((f) => f.key);
        const mappedSet = new Set(Object.values(data.mappings).filter(Boolean) as string[]);
        const allRequiredMapped = requiredFields.every((k) => mappedSet.has(k));
        setStep(allRequiredMapped && mappedSet.size >= 3 ? "autoconfirm" : "map");
      } else {
        const fallback = detectResource(hdrs); const r = fallback?.resource ?? "lease-comps";
        setResource(r); setMappings(autoMapColumns(hdrs, r)); setStep("map");
      }
    } catch {
      const fallback = detectResource(hdrs); const r = fallback?.resource ?? "lease-comps";
      setResource(r); setMappings(autoMapColumns(hdrs, r)); setStep("map");
    } finally { setAiMapping(false); }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  }, [parseFile]);

  function onResourceChange(r: Resource) { setResource(r); setMappings(autoMapColumns(headers, r)); setAiMappedFields(new Set()); }

  function setMapping(header: string, dbField: string | null) {
    setMappings((m) => {
      const next = { ...m };
      if (dbField) for (const h of Object.keys(next)) { if (next[h] === dbField && h !== header) next[h] = null; }
      next[header] = dbField;
      return next;
    });
  }

  function buildMappedRows(onlyClean = false): Record<string, string>[] {
    return rawRows
      .map((row, i) => ({ row, i }))
      .filter(({ i }) => !onlyClean || !filteredIndices.has(i))
      .map(({ row }) => {
        const out: Record<string, string> = {};
        for (const [h, f] of Object.entries(mappings)) { if (f) out[f] = row[h] ?? ""; }
        return out;
      });
  }

  async function goToPreview() {
    setValidating(true);
    setFilteredIndices(new Set());
    setFilterReasons({});
    try {
      const mappedRows = buildMappedRows();
      const fields = RESOURCE_FIELDS[resource].filter((f) => Object.values(mappings).includes(f.key));
      const res = await fetch("/api/admin/validate-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, rows: mappedRows, fields }),
      });
      if (res.ok) {
        const data = await res.json() as { bad: number[]; reasons: Record<string, string> };
        setFilteredIndices(new Set(data.bad));
        setFilterReasons(Object.fromEntries(Object.entries(data.reasons).map(([k, v]) => [Number(k), v])));
      }
    } catch { /* validation failure is non-fatal — proceed with all rows */ }
    finally { setValidating(false); }
    setStep("preview");
  }

  async function runImport() {
    setSubmitting(true); setImportResult(null); setGeocodeStatus(null);
    try {
      const res = await fetch("/api/comps-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, rows: buildMappedRows(true), mode }),
      });
      const body = await res.json();
      setImportResult(res.ok
        ? { ok: true, message: `${mode === "replace" ? "Replaced all data with" : "Merged"} ${body.rowsImported} rows into ${RESOURCE_LABELS[resource]}.` }
        : { ok: false, message: body.error ?? "Unknown error" });

      if (res.ok && resource === "projects") {
        setStep("done");
        // Build name→address lookup from the file we just imported
        const addressByName: Record<string, string> = {};
        for (const row of buildMappedRows(true)) {
          if (row.name && row.address) addressByName[row.name] = row.address;
        }

        // Auto-geocode any projects missing coordinates
        const listRes = await fetch("/api/admin/geocode-projects");
        const { projects: missing } = await listRes.json() as { projects: { id: string; name: string; address: string | null }[] };
        if (missing.length > 0) {
          let geocoded = 0;
          let notFound = 0;
          for (let i = 0; i < missing.length; i++) {
            const p = missing[i];
            setGeocodeStatus(`Locating on map: ${p.name} (${i + 1}/${missing.length})`);
            try {
              const addressOverride = addressByName[p.name] || undefined;
              const gr = await fetch("/api/admin/geocode-projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: p.id, addressOverride }),
              });
              const gdata = await gr.json() as { ok: boolean; reason?: string };
              if (gdata.ok) geocoded++; else notFound++;
            } catch { notFound++; }
            if (i < missing.length - 1) await new Promise((r) => setTimeout(r, 1100));
          }
          if (geocoded > 0) {
            setGeocodeStatus(`Map coordinates set for ${geocoded} building${geocoded !== 1 ? "s" : ""}${notFound ? ` (${notFound} not found)` : "."}`);
          } else {
            setGeocodeStatus(`Could not locate buildings on map. Check Vercel logs for details.`);
          }
        }
        return;
      }
    } catch (e) {
      setImportResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally { setSubmitting(false); setStep("done"); }
  }

  function resetDrop() {
    setStep("drop"); setImportResult(null); setRawRows([]); setHeaders([]); setFileName("");
    setAiMappedFields(new Set()); setAiReasoning(null); setFilteredIndices(new Set()); setFilterReasons({});
    setSheetJobs([]); setMultiImporting(false);
  }

  async function runMultiImport() {
    const jobs = sheetJobs.filter((j) => j.include);
    if (!jobs.length) return;
    setMultiImporting(true);

    for (const job of jobs) {
      setSheetJobs((prev) => prev.map((j) => j.sheetName === job.sheetName ? { ...j, status: "validating" } : j));

      // Validate rows
      let cleanRows = job.rows;
      try {
        const fields = RESOURCE_FIELDS[job.resource].filter((f) => Object.values(job.mappings).includes(f.key));
        const mappedRows = job.rows.map((row) => {
          const out: Record<string, string> = {};
          for (const [h, f] of Object.entries(job.mappings)) { if (f) out[f] = row[h] ?? ""; }
          return out;
        });
        const vRes = await fetch("/api/admin/validate-rows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource: job.resource, rows: mappedRows, fields }),
        });
        if (vRes.ok) {
          const { bad } = await vRes.json() as { bad: number[] };
          const badSet = new Set(bad);
          cleanRows = job.rows.filter((_, i) => !badSet.has(i));
        }
      } catch { /* proceed with all rows */ }

      setSheetJobs((prev) => prev.map((j) => j.sheetName === job.sheetName ? { ...j, status: "importing" } : j));

      // Map rows
      const mappedRows = cleanRows.map((row) => {
        const out: Record<string, string> = {};
        for (const [h, f] of Object.entries(job.mappings)) { if (f) out[f] = row[h] ?? ""; }
        return out;
      });

      try {
        const res = await fetch("/api/comps-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource: job.resource, rows: mappedRows, mode: multiMode }),
        });
        const body = await res.json();
        if (res.ok) {
          setSheetJobs((prev) => prev.map((j) => j.sheetName === job.sheetName
            ? { ...j, status: "done", result: `${body.rowsImported} rows imported` } : j));
        } else {
          setSheetJobs((prev) => prev.map((j) => j.sheetName === job.sheetName
            ? { ...j, status: "error", result: body.error ?? "Import failed" } : j));
        }
      } catch (e) {
        setSheetJobs((prev) => prev.map((j) => j.sheetName === job.sheetName
          ? { ...j, status: "error", result: e instanceof Error ? e.message : "Import failed" } : j));
      }
    }

    setMultiImporting(false);
  }

  // ── Sheet sync ────────────────────────────────────────────────────────────

  async function saveUrls() {
    setSaving(true);
    const res = await fetch("/api/sync-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config) });
    setSaving(false);
    if (res.ok) setConfig(await res.json());
    else alert("Failed to save URLs.");
  }

  async function syncNow(key: string) {
    setSyncing(key); setSyncResults((r) => ({ ...r, [key]: "" }));
    const res = await fetch(`/api/sync/${key}`, { method: "POST" });
    const body = await res.json();
    setSyncing(null);
    setSyncResults((r) => ({ ...r, [key]: res.ok ? `Imported ${body.rowsImported} rows.` : `Error: ${body.error}` }));
    if (res.ok) setLastSyncedAt(new Date().toISOString());
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const missingRequired = RESOURCE_FIELDS[resource]
    .filter((f) => f.required)
    .map((f) => f.key)
    .filter((k) => !new Set(Object.values(mappings).filter(Boolean) as string[]).has(k));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>

      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>Import &amp; Sync</h1>
      <p style={{ color: "#555", fontSize: "0.88rem", marginBottom: "2rem", maxWidth: 700 }}>
        Drop any file — one of this app&apos;s own exports, a totally different sheet, a raw lease-by-lease
        workbook — and this will figure out where it goes: recognized table exports sync that table
        directly, and lease-level exports get matched against comp buildings, stats, quarterly stats,
        and the market trend. It never touches a table it doesn&apos;t recognize the file as belonging to.
        {lastSyncedAt && <>{" "}Last synced {new Date(lastSyncedAt).toLocaleString()}.</>}
      </p>

      {/* ── Drop zone ── */}
      {step === "drop" && (
        <div style={{ marginBottom: "3rem" }}>
          {aiMapping ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "3rem 1rem", gap: "0.75rem", color: "#475569", background: "#f8fafc", border: "2px dashed #c8d3de", borderRadius: 10 }}>
              <div style={{ width: 32, height: 32, border: "3px solid #e2e8f0", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
              <div style={{ fontWeight: 600, fontSize: "1rem" }}>Reading {fileName}…</div>
              <div style={{ fontSize: "0.83rem", color: "#64748b" }}>Claude is mapping columns</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragging ? "#2563eb" : "#c8d3de"}`,
                borderRadius: 10, padding: "2.5rem 2rem", textAlign: "center",
                cursor: "pointer", background: dragging ? "#eff6ff" : "#f8fafc",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "0.4rem" }}>⬇</div>
              <div style={{ fontWeight: 600, fontSize: "1.05rem", marginBottom: "0.2rem" }}>
                Drop a spreadsheet here, or click to browse
              </div>
              <div style={{ color: "#64748b", fontSize: "0.83rem" }}>.csv, .xlsx, .xls — any layout</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) parseFile(e.target.files[0]); }} />
            </div>
          )}
        </div>
      )}

      {/* ── Auto-confirm (single sheet, high-confidence detection) ── */}
      {step === "autoconfirm" && (
        <div style={{ marginBottom: "3rem", maxWidth: 520 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1.2rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{fileName}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 20, padding: "2px 10px", fontSize: "0.78rem", color: "#15803d", fontWeight: 600 }}>
              ✦ AI-mapped
            </span>
          </div>

          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "1.2rem 1.4rem", marginBottom: "1.4rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: "1.05rem", fontWeight: 700 }}>{RESOURCE_LABELS[resource]}</span>
              <span style={{ color: "#64748b", fontSize: "0.88rem" }}>{rawRows.length.toLocaleString()} rows</span>
            </div>
            <div style={{ color: "#475569", fontSize: "0.85rem" }}>
              All required fields mapped. Ready to import.
            </div>
          </div>

          <div style={{ marginBottom: "1.2rem" }}>
            <div style={{ fontWeight: 500, fontSize: "0.88rem", marginBottom: 6 }}>Import mode</div>
            <div style={{ display: "flex", gap: 20 }}>
              {(["upsert", "replace"] as ImportMode[]).map((m) => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.88rem" }}>
                  <input type="radio" name="acMode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                  {m === "upsert" ? <span><strong>Merge</strong> — add / update records</span> : <span><strong>Replace</strong> — delete existing rows first</span>}
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={runImport}
              disabled={submitting}
              style={{ padding: "9px 22px", background: submitting ? "#94a3b8" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: submitting ? "not-allowed" : "pointer", fontWeight: 700, fontSize: "0.95rem" }}
            >
              {submitting ? "Importing…" : "Import"}
            </button>
            <button
              onClick={() => setStep("map")}
              style={{ padding: "9px 14px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontSize: "0.88rem" }}
            >
              Manually configure columns →
            </button>
            <button onClick={resetDrop} style={{ padding: "9px 14px", background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "0.85rem" }}>
              ← Start over
            </button>
          </div>
        </div>
      )}

      {/* ── Multi-sheet import ── */}
      {step === "multi" && (
        <div style={{ marginBottom: "3rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.2rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{fileName}</span>
            {aiMapping
              ? <span style={{ color: "#64748b", fontSize: "0.88rem" }}>Claude is mapping {sheetJobs.length} sheets…</span>
              : <span style={{ color: "#64748b", fontSize: "0.88rem" }}>{sheetJobs.length} sheets detected</span>}
            {!aiMapping && <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 20, padding: "2px 10px", fontSize: "0.78rem", color: "#15803d", fontWeight: 600 }}>✦ AI-mapped</span>}
          </div>

          {aiMapping ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 1rem", gap: "0.75rem", color: "#475569" }}>
              <div style={{ width: 32, height: 32, border: "3px solid #e2e8f0", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
              <div style={{ fontWeight: 600, fontSize: "1rem" }}>Claude is reading all {sheetJobs.length} sheets…</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "1.5rem" }}>
                {sheetJobs.map((job) => {
                  const statusColor = { pending: "#64748b", validating: "#2563eb", importing: "#d97706", done: "#16a34a", error: "#dc2626" }[job.status];
                  const statusIcon = { pending: "○", validating: "⟳", importing: "↑", done: "✓", error: "✗" }[job.status];
                  return (
                    <div key={job.sheetName} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: job.include ? "#f8fafc" : "#f1f5f9", border: `1px solid ${job.include ? "#e2e8f0" : "#cbd5e1"}`, borderRadius: 8, opacity: job.include ? 1 : 0.5 }}>
                      <input type="checkbox" checked={job.include} disabled={multiImporting}
                        onChange={(e) => setSheetJobs((prev) => prev.map((j) => j.sheetName === job.sheetName ? { ...j, include: e.target.checked } : j))} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{job.sheetName}</span>
                          <span style={{ fontSize: "0.78rem", color: "#64748b" }}>→</span>
                          <select value={job.resource} disabled={multiImporting}
                            onChange={(e) => setSheetJobs((prev) => prev.map((j) => j.sheetName === job.sheetName ? { ...j, resource: e.target.value as Resource, mappings: autoMapColumns(Object.keys(j.rows[0] ?? {}), e.target.value as Resource) } : j))}
                            style={{ padding: "2px 6px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.82rem", background: "#fff" }}>
                            {IMPORT_RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_LABELS[r]}</option>)}
                          </select>
                          <span style={{ fontSize: "0.78rem", color: "#94a3b8" }}>{job.rows.length.toLocaleString()} rows</span>
                        </div>
                        {job.result && <div style={{ fontSize: "0.8rem", color: statusColor, marginTop: 2 }}>{job.result}</div>}
                      </div>
                      <span style={{ fontSize: "1rem", color: statusColor, fontWeight: 700 }}>{statusIcon}</span>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom: "1.2rem" }}>
                <div style={{ fontWeight: 500, fontSize: "0.88rem", marginBottom: 6 }}>Import mode</div>
                <div style={{ display: "flex", gap: 20 }}>
                  {(["upsert", "replace"] as ImportMode[]).map((m) => (
                    <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.88rem" }}>
                      <input type="radio" name="multiMode" value={m} checked={multiMode === m} onChange={() => setMultiMode(m)} disabled={multiImporting} />
                      {m === "upsert" ? <span><strong>Merge</strong> — add / update records</span> : <span><strong>Replace</strong> — delete existing rows first</span>}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {!multiImporting && sheetJobs.every((j) => !j.include || j.status === "done" || j.status === "error") && sheetJobs.some((j) => j.status === "done") ? (
                  <button onClick={resetDrop} style={{ padding: "8px 18px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                    Import another file
                  </button>
                ) : (
                  <button onClick={runMultiImport} disabled={multiImporting || aiMapping || sheetJobs.filter((j) => j.include).length === 0}
                    style={{ padding: "8px 18px", background: multiImporting || aiMapping ? "#94a3b8" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: multiImporting || aiMapping ? "not-allowed" : "pointer", fontWeight: 600 }}>
                    {multiImporting ? "Importing…" : `Import ${sheetJobs.filter((j) => j.include).length} sheets`}
                  </button>
                )}
                {!multiImporting && <button onClick={resetDrop} style={{ padding: "8px 14px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}>← Start over</button>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Map ── */}
      {step === "map" && (
        <div style={{ marginBottom: "3rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.2rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{fileName}</span>
            <span style={{ color: "#64748b", fontSize: "0.88rem" }}>{rawRows.length.toLocaleString()} rows</span>
            {!aiMapping && aiMappedFields.size > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 20, padding: "2px 10px", fontSize: "0.78rem", color: "#15803d", fontWeight: 600 }}>
                ✦ AI-mapped
              </span>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", marginLeft: "auto" }}>
              Importing into:&nbsp;
              <select value={resource} onChange={(e) => onResourceChange(e.target.value as Resource)}
                disabled={aiMapping}
                style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid #cbd5e1", fontSize: "0.88rem" }}>
                {IMPORT_RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_LABELS[r]}</option>)}
              </select>
            </label>
          </div>

          {aiMapping ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 1rem", gap: "0.75rem", color: "#475569" }}>
              <div style={{ width: 32, height: 32, border: "3px solid #e2e8f0", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
              <div style={{ fontWeight: 600, fontSize: "1rem" }}>Claude is reading your file…</div>
              <div style={{ fontSize: "0.83rem", color: "#94a3b8" }}>Detecting resource type and mapping all columns</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <>
              {aiReasoning && (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 14px", marginBottom: "1rem", fontSize: "0.83rem", color: "#166534" }}>
                  <strong>✦ Claude:</strong> {aiReasoning}
                </div>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", marginBottom: "1rem" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600 }}>File column</th>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600 }}>Maps to</th>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600 }}>Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h) => {
                    const mapped = mappings[h];
                    const wasAiMapped = aiMappedFields.has(h);
                    return (
                      <tr key={h} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "6px 12px", fontFamily: "monospace", color: mapped ? "#15803d" : "#94a3b8" }}>
                          {h}
                          {wasAiMapped && mapped && (
                            <span title="Mapped by Claude" style={{ marginLeft: 6, fontSize: "0.68rem", background: "#dcfce7", color: "#15803d", borderRadius: 4, padding: "1px 5px", fontFamily: "sans-serif", fontWeight: 700 }}>AI</span>
                          )}
                        </td>
                        <td style={{ padding: "6px 12px" }}>
                          <select value={mapped ?? ""} onChange={(e) => setMapping(h, e.target.value || null)}
                            style={{ padding: "3px 6px", borderRadius: 4, border: "1px solid #cbd5e1", fontSize: "0.82rem", background: mapped ? "#f0fdf4" : "#fff" }}>
                            <option value="">(skip)</option>
                            {RESOURCE_FIELDS[resource].map((f) => (
                              <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "6px 12px", color: "#64748b", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {rawRows[0]?.[h] ?? ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {missingRequired.length > 0 && (
                <div style={{ color: "#dc2626", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: "8px 12px", marginBottom: "1rem", fontSize: "0.84rem" }}>
                  Missing required fields: {missingRequired.join(", ")}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={goToPreview} disabled={missingRequired.length > 0 || validating}
                  style={{ padding: "8px 18px", background: missingRequired.length || validating ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: missingRequired.length || validating ? "not-allowed" : "pointer", fontWeight: 600 }}>
                  {validating ? "Validating rows…" : "Review & Import →"}
                </button>
                <button onClick={resetDrop} disabled={validating}
                  style={{ padding: "8px 14px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}>
                  ← Start over
                </button>
                {validating && <span style={{ fontSize: "0.82rem", color: "#64748b" }}>Claude is checking for junk rows…</span>}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Preview ── */}
      {step === "preview" && (() => {
        const cleanRows = buildMappedRows(true);
        const nFiltered = filteredIndices.size;
        return (
          <div style={{ marginBottom: "3rem" }}>
            <div style={{ fontWeight: 600, marginBottom: "1rem" }}>
              Preview — first 6 rows&nbsp;
              <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.88rem" }}>({cleanRows.length.toLocaleString()} rows to import)</span>
            </div>

            {nFiltered > 0 && (
              <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 14px", marginBottom: "1rem", fontSize: "0.84rem" }}>
                <strong>✦ Claude filtered {nFiltered} junk row{nFiltered !== 1 ? "s" : ""}:</strong>
                <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                  {Object.entries(filterReasons).map(([idx, reason]) => (
                    <li key={idx} style={{ marginBottom: 2, color: "#78350f" }}>
                      Row {Number(idx) + 1}: <em>{reason}</em>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => { setFilteredIndices(new Set()); setFilterReasons({}); }}
                  style={{ marginTop: 8, fontSize: "0.78rem", background: "none", border: "1px solid #d97706", borderRadius: 4, padding: "2px 8px", cursor: "pointer", color: "#92400e" }}>
                  Undo — import all rows anyway
                </button>
              </div>
            )}

            <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
              <table style={{ borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    {Object.entries(mappings).filter(([, v]) => v).map(([h]) => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{mappings[h]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cleanRows.slice(0, 6).map((row, i) => (
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
              <div style={{ fontWeight: 500, fontSize: "0.88rem", marginBottom: 6 }}>Import mode</div>
              <div style={{ display: "flex", gap: 20 }}>
                {(["upsert", "replace"] as ImportMode[]).map((m) => (
                  <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.88rem" }}>
                    <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                    {m === "upsert"
                      ? <span><strong>Merge</strong> — add / update records</span>
                      : <span><strong>Replace</strong> — delete all existing rows first</span>}
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={runImport} disabled={submitting}
                style={{ padding: "8px 18px", background: submitting ? "#94a3b8" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: submitting ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {submitting ? "Importing…" : `Import ${cleanRows.length.toLocaleString()} rows`}
              </button>
              <button onClick={() => setStep("map")}
                style={{ padding: "8px 14px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}>
                ← Back
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── Done ── */}
      {step === "done" && importResult && (
        <div style={{ padding: "1.25rem", borderRadius: 8, marginBottom: "3rem",
          background: importResult.ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${importResult.ok ? "#86efac" : "#fca5a5"}` }}>
          <div style={{ fontWeight: 700, marginBottom: "0.4rem", color: importResult.ok ? "#15803d" : "#dc2626" }}>
            {importResult.ok ? "Import complete" : "Import failed"}
          </div>
          <div style={{ fontSize: "0.88rem" }}>{importResult.message}</div>
          {geocodeStatus && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#2563eb" }}>
              {geocodeStatus.startsWith("Locating") ? "📍 " : "✓ "}{geocodeStatus}
            </div>
          )}
          <button onClick={resetDrop}
            style={{ marginTop: "0.75rem", padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.88rem" }}>
            Import another file
          </button>
        </div>
      )}

      {/* ── Divider ── */}
      <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "0 0 2rem" }} />

      {/* ── Google Sheets auto-sync ── */}
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.3rem" }}>Auto-sync via Google Sheets</h2>
      <p style={{ color: "#555", fontSize: "0.85rem", marginBottom: "1.5rem", maxWidth: 640 }}>
        Paste a published CSV link (File → Share → Publish to web → select tab → CSV) and hit Sync now.
        Only works with publicly fetchable links — not internal SharePoint files.
      </p>

      {loadingConfig ? <p style={{ color: "#64748b" }}>Loading…</p> : (
        <>
          {SYNC_RESOURCES.map((r) => (
            <div key={r.key} style={{ marginBottom: "1rem", padding: "0.9rem 1rem", background: "#f8fafc", borderRadius: 8, border: "1px solid #e2e8f0" }}>
              <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.5rem" }}>{r.label}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="url"
                  placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv"
                  value={config[r.urlField] ?? ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [r.urlField]: e.target.value }))}
                  style={{ flex: 1, padding: "5px 10px", borderRadius: 5, border: "1px solid #cbd5e1", fontSize: "0.84rem" }}
                />
                <button onClick={() => syncNow(r.key)} disabled={syncing === r.key || !config[r.urlField]}
                  style={{ padding: "5px 14px", background: syncing === r.key ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 5, cursor: syncing === r.key || !config[r.urlField] ? "not-allowed" : "pointer", fontSize: "0.84rem", whiteSpace: "nowrap" }}>
                  {syncing === r.key ? "Syncing…" : "Sync now"}
                </button>
                <a href={`/api/csv-template/${r.key}`} download
                  style={{ padding: "5px 12px", border: "1px solid #cbd5e1", borderRadius: 5, fontSize: "0.84rem", color: "#334155", textDecoration: "none", whiteSpace: "nowrap" }}>
                  Export CSV
                </a>
              </div>
              {syncResults[r.key] && (
                <div style={{ marginTop: 5, fontSize: "0.82rem", color: syncResults[r.key].startsWith("Error") ? "#dc2626" : "#15803d" }}>
                  {syncResults[r.key]}
                </div>
              )}
            </div>
          ))}
          <button onClick={saveUrls} disabled={saving}
            style={{ marginTop: "0.5rem", padding: "8px 18px", background: saving ? "#94a3b8" : "#0f172a", color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "not-allowed" : "pointer", fontWeight: 600 }}>
            {saving ? "Saving…" : "Save all URLs"}
          </button>
        </>
      )}
    </div>
  );
}
