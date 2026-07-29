"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RESOURCE_FIELDS, RESOURCE_LABELS, autoMapColumns, detectResource } from "@/app/lib/column-mapper";
import type { Resource } from "@/app/lib/sync-resources";

// ─── Client-side column-letter helper (for Calculations sheet formulas) ────────
function colLetter(idx: number): string {
  let result = "", n = idx + 1;
  while (n > 0) { n--; result = String.fromCharCode(65 + (n % 26)) + result; n = Math.floor(n / 26); }
  return result;
}

// ─── Client-side row key (mirrors server diff/route.ts rowKey) ─────────────────
function clientRowKey(resource: string, row: Record<string, string>): string | null {
  switch (resource) {
    case "projects":      return row.name?.trim() || null;
    case "comp-buildings": return row.name?.trim() || null;
    case "comp-building-stats":
      return row.buildingName?.trim() && row.unitType?.trim()
        ? `${row.buildingName.trim()}|||${row.unitType.trim()}` : null;
    case "comp-building-quarter-stats":
      return row.buildingName?.trim() && row.quarter?.trim() && row.unitType?.trim()
        ? `${row.buildingName.trim()}|||${row.quarter.trim()}|||${row.unitType.trim()}` : null;
    case "overall-stats":  return row.unitType?.trim() || null;
    case "type-stats":
      return row.propertyType?.trim() && row.unitType?.trim()
        ? `${row.propertyType.trim()}|||${row.unitType.trim()}` : null;
    case "trend":
      return row.quarter?.trim() && row.unitType?.trim()
        ? `${row.quarter.trim()}|||${row.unitType.trim()}` : null;
    default: return null;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

type AiResult = {
  resources: Record<string, Record<string, string>[]>;
  xlsxBase64: string;
  fileName: string;
  summary: string;
};

type ImportStatus = {
  state: "pending" | "running" | "done" | "error";
  count?: number;
  message?: string;
};

type Step =
  | "drop"
  | "normalizing"
  | "confirm"
  | "importing"
  | "done"
  | "error"
  | "manual-map"
  | "manual-preview"
  | "manual-done";

type ImportMode = "replace" | "upsert";

type DiffResult = { newCount: number; updateCount: number; noKeyCount: number; updateKeys: string[] };

type SnapMeta = { id: string; resource: string; label: string; createdAt: string };

// ─── Constants ─────────────────────────────────────────────────────────────────

// Where each resource surfaces in the main dashboard
const RESOURCE_LOCATION: Record<string, { tab: string; where: string }> = {
  "projects":                    { tab: "Pipeline tab",    where: "Map markers + project cards (left panel)" },
  "comp-buildings":              { tab: "Rent Comps tab",  where: "Building list in all comp views (Compare, Trend, Date Range)" },
  "comp-building-stats":         { tab: "Rent Comps tab",  where: "Compare Buildings chart + Date Range all-time averages" },
  "comp-building-quarter-stats": { tab: "Rent Comps tab",  where: "Buildings Over Time chart + Date Range quarterly filtering" },
  "overall-stats":               { tab: "Rent Comps tab",  where: "Market Stats panel — overall market averages" },
  "type-stats":                  { tab: "Rent Comps tab",  where: "Market Stats panel — averages broken out by property type" },
  "trend":                       { tab: "Rent Comps tab",  where: "Trend Over Time chart (market-wide quarterly rent trend)" },
  "lease-comps":                 { tab: "Rent Comps tab",  where: "Date Range — per-lease filtering (enables exact date ranges)" },
  "comp-building-units":         { tab: "Rent Comps tab",  where: "Building unit-mix detail (unit count breakdown per building)" },
};

// Import order: comp-buildings must come before stats that reference it
const IMPORT_ORDER: Resource[] = [
  "comp-buildings",
  "projects",
  "comp-building-stats",
  "comp-building-quarter-stats",
  "overall-stats",
  "type-stats",
  "trend",
  "lease-comps",
  "comp-building-units",
];

const MANUAL_RESOURCES: Resource[] = [
  "lease-comps",
  "comp-buildings",
  "comp-building-stats",
  "comp-building-quarter-stats",
  "overall-stats",
  "type-stats",
  "trend",
  "projects",
  "comp-building-units",
];

const SYNC_RESOURCES: { key: string; label: string; urlField: string }[] = [
  { key: "projects",                    label: "Pipeline Projects",                urlField: "projectsSheetUrl" },
  { key: "comp-buildings",              label: "Comp Buildings",                   urlField: "compBuildingsSheetUrl" },
  { key: "comp-building-stats",         label: "Comp Building Stats",              urlField: "compBuildingStatsSheetUrl" },
  { key: "comp-building-quarter-stats", label: "Comp Building Stats — By Quarter", urlField: "compBuildingQuarterStatsSheetUrl" },
  { key: "overall-stats",               label: "Overall Unit Stats",               urlField: "overallStatsSheetUrl" },
  { key: "type-stats",                  label: "Type × Unit Stats",                urlField: "typeStatsSheetUrl" },
  { key: "trend",                       label: "Rent Trend",                       urlField: "trendSheetUrl" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Detects the multi-resource format produced by the Claude converter skill.
// Sections look like:  ###RESOURCE:comp-buildings###\nname,propertyType,...\n...
const RESOURCE_SECTION_RE = /^###RESOURCE:([a-z-]+)###\s*$/i;

function isMultiResourceCsv(text: string): boolean {
  return text.split(/\r?\n/).some((l) => RESOURCE_SECTION_RE.test(l.trim()));
}

function parseMultiResourceCsv(text: string): Record<string, Record<string, string>[]> {
  const result: Record<string, Record<string, string>[]> = {};
  const lines = text.split(/\r?\n/);
  let currentResource: string | null = null;
  let sectionLines: string[] = [];

  function flushSection() {
    if (!currentResource || !sectionLines.length) return;
    const rows = parseCsvLines(sectionLines);
    if (rows.length) result[currentResource] = rows;
  }

  for (const line of lines) {
    const m = line.trim().match(RESOURCE_SECTION_RE);
    if (m) {
      flushSection();
      currentResource = m[1].toLowerCase();
      sectionLines = [];
    } else if (currentResource) {
      sectionLines.push(line);
    }
  }
  flushSection();
  return result;
}

function parseCsvLines(lines: string[]): Record<string, string>[] {
  const nonEmpty = lines.filter((l) => l.trim());
  if (!nonEmpty.length) return [];
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
  const hdrs = split(nonEmpty[0]);
  return nonEmpty.slice(1).map((line) => {
    const vals = split(line);
    const row: Record<string, string> = {};
    hdrs.forEach((h, i) => { row[h.trim()] = vals[i]?.trim() ?? ""; });
    return row;
  }).filter((r) => Object.values(r).some((v) => v !== ""));
}

function parseCsv(text: string): Record<string, string>[] {
  return parseCsvLines(text.split(/\r?\n/));
}

function rowScore(row: string[]): number {
  return row.filter((c) => {
    const s = String(c ?? "").trim();
    return s.length > 0 && s.length <= 80 && !/^__EMPTY/i.test(s);
  }).length;
}

function sheetToRows(
  grid: string[][],
): { headers: string[]; rows: Record<string, string>[] } {
  if (!grid.length) return { headers: [], rows: [] };

  let headerRowIdx = 0, best = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const s = rowScore(grid[i]);
    if (s > best) { best = s; headerRowIdx = i; }
    if (s >= 8) break;
  }

  const slots: { name: string; colIdx: number }[] = [];
  (grid[headerRowIdx] ?? []).forEach((h, j) => {
    const name = String(h ?? "").trim();
    if (name && !/^__EMPTY/i.test(name)) slots.push({ name, colIdx: j });
  });

  const headers = slots.map((s) => s.name);
  const rows: Record<string, string>[] = [];
  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    const obj: Record<string, string> = {};
    slots.forEach(({ name, colIdx }) => { obj[name] = String(row[colIdx] ?? "").trim(); });
    if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
  }
  return { headers, rows };
}

async function parseAllSheets(
  buf: ArrayBuffer,
): Promise<{ name: string; headers: string[]; rows: Record<string, string>[] }[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const result: { name: string; headers: string[]; rows: Record<string, string>[] }[] = [];
  for (const sheetName of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: "", raw: false,
    }) as string[][];
    const { headers, rows } = sheetToRows(grid);
    if (rows.length > 0) result.push({ name: sheetName, headers, rows });
  }
  return result;
}

async function parseSingleSheet(
  buf: ArrayBuffer,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => /^data$/i.test(n)) ?? wb.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, defval: "", raw: false,
  }) as string[][];
  return sheetToRows(grid);
}

function downloadXlsx(base64: string, fileName: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  URL.revokeObjectURL(url);
}

// ─── Client-side normalization (no API key needed) ─────────────────────────────
// Uses detectResource + autoMapColumns fuzzy-matching from column-mapper.ts

async function normalizeClientSide(
  sheets: { name: string; headers: string[]; rows: Record<string, string>[] }[],
  originalFileName: string,
): Promise<AiResult> {
  const normalizedResources: Record<string, Record<string, string>[]> = {};
  const sheetSummaries: string[] = [];

  for (const sheet of sheets) {
    if (!sheet.headers.length || !sheet.rows.length) continue;

    const detected = detectResource(sheet.headers);
    // Skip sheets with very low score (e.g. cover/legend sheets with no matching columns)
    if (!detected || detected.score < 5) continue;

    const resource = detected.resource;
    const mapping = autoMapColumns(sheet.headers, resource);

    const normalizedRows = sheet.rows
      .map((row) => {
        const out: Record<string, string> = {};
        for (const [srcCol, targetField] of Object.entries(mapping)) {
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

    sheetSummaries.push(`"${sheet.name}" → ${RESOURCE_LABELS[resource]} (${normalizedRows.length} rows)`);
  }

  // Generate normalized XLSX
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  for (const resource of IMPORT_ORDER) {
    const rows = normalizedResources[resource];
    if (!rows?.length) continue;

    const fields = RESOURCE_FIELDS[resource];
    const sheetLabel = RESOURCE_LABELS[resource].slice(0, 31);
    const headerRow = fields.map((f) => f.label);
    const dataRows = rows.map((row) => fields.map((f) => row[f.key] ?? ""));
    const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
    XLSX.utils.book_append_sheet(wb, ws, sheetLabel);
  }

  // Calculations sheet for lease-comps
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
  const normalizedFileName = `normalized-${originalFileName.replace(/\.xlsx?$/i, "").replace(/\.csv$/i, "")}.xlsx`;
  const summary = sheetSummaries.length
    ? `Detected: ${sheetSummaries.join(", ")}.`
    : "No matching data found in file.";

  return { resources: normalizedResources, xlsxBase64, fileName: normalizedFileName, summary };
}

// ─── Status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ state }: { state: ImportStatus["state"] }) {
  if (state === "pending") return <span style={{ color: "#94a3b8", fontSize: "1rem" }}>◦</span>;
  if (state === "running") return (
    <>
      <span style={{ display: "inline-block", width: 14, height: 14, border: "2px solid #e2e8f0", borderTop: "2px solid #2563eb", borderRadius: "50%", animation: "spin 0.8s linear infinite", verticalAlign: "middle" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </>
  );
  if (state === "done") return <span style={{ color: "#16a34a", fontWeight: 700 }}>✓</span>;
  return <span style={{ color: "#dc2626", fontWeight: 700 }}>✗</span>;
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function SyncPage() {
  // Sheet sync config
  const [config, setConfig] = useState<Record<string, string | null>>({});
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResults, setSyncResults] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // AI flow
  const [step, setStep] = useState<Step>("drop");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [importStatuses, setImportStatuses] = useState<Record<string, ImportStatus>>({});
  const [normalizeError, setNormalizeError] = useState<string | null>(null);
  // Track which resources were just imported so we can show undo
  const [lastImportedResources, setLastImportedResources] = useState<string[]>([]);

  // Manual fallback
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [resource, setResource] = useState<Resource>("lease-comps");
  const [mappings, setMappings] = useState<Record<string, string | null>>({});
  const [aiMappedFields, setAiMappedFields] = useState<Set<string>>(new Set());
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiMapping, setAiMapping] = useState(false);
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [submitting, setSubmitting] = useState(false);
  const [manualResult, setManualResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Confirm step — which resources are selected for import
  const [confirmSelected, setConfirmSelected] = useState<Set<string>>(new Set());

  // Duplicate detection
  const [diffResults, setDiffResults] = useState<Record<string, DiffResult>>({});
  const [diffErrors, setDiffErrors] = useState<Set<string>>(new Set());
  const [diffLoading, setDiffLoading] = useState(false);
  const [importModes, setImportModes] = useState<Record<string, "all" | "new-only">>({});

  // Import preview
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Version history / undo
  const [snapshots, setSnapshots] = useState<SnapMeta[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [undoing, setUndoing] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<{ buf: ArrayBuffer; name: string } | null>(null);

  useEffect(() => {
    fetch("/api/sync-config")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data);
        setLastSyncedAt(data.lastSyncedAt ?? null);
        setLoadingConfig(false);
      });
  }, []);

  function loadSnapshots() {
    fetch("/api/snapshots?limit=50")
      .then((r) => r.json())
      .then((data) => setSnapshots(Array.isArray(data) ? data : []));
  }

  useEffect(() => { loadSnapshots(); }, []);

  async function restoreSnapshot(id: string) {
    if (!confirm("Restore to this version? Current data will be overwritten (a new snapshot is saved first so you can undo).")) return;
    setRestoring(id);
    setRestoreMsg(null);
    try {
      const res = await fetch(`/api/snapshots/${id}`, { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        setRestoreMsg({ ok: true, text: `Restored. ${body.rowsImported ?? ""} rows loaded. Refresh the data pages to see changes.` });
        loadSnapshots();
      } else {
        setRestoreMsg({ ok: false, text: body.error ?? "Restore failed." });
      }
    } catch (e) {
      setRestoreMsg({ ok: false, text: e instanceof Error ? e.message : "Network error" });
    } finally {
      setRestoring(null);
    }
  }

  async function deleteSnapshot(id: string) {
    if (!confirm("Delete this snapshot?")) return;
    await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
    loadSnapshots();
  }

  async function undoLastImport() {
    const target = snapshots.find((s) => lastImportedResources.includes(s.resource));
    if (!target) return;
    setUndoing(true);
    try {
      const res = await fetch(`/api/snapshots/${target.id}`, { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        setRestoreMsg({ ok: true, text: `Undone. Restored ${target.resource} to state before last import.` });
        setLastImportedResources([]);
        loadSnapshots();
      } else {
        setRestoreMsg({ ok: false, text: body.error ?? "Undo failed." });
      }
    } finally {
      setUndoing(false);
    }
  }

  // ── Duplicate detection ────────────────────────────────────────────────────

  function retryDiff(r: string, rows: Record<string, string>[]) {
    setDiffErrors((prev) => { const next = new Set(prev); next.delete(r); return next; });
    setDiffResults((prev) => { const next = { ...prev }; delete next[r]; return next; });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    fetch("/api/comps-import/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: r, rows }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        clearTimeout(timer);
        if (!res.ok) {
          const text = await res.text().catch(() => String(res.status));
          console.warn(`[diff retry] ${r} => HTTP ${res.status}:`, text);
          setDiffErrors((prev) => new Set([...prev, r]));
        } else {
          const data = await res.json();
          console.log(`[diff retry] ${r} =>`, data);
          setDiffResults((prev) => ({ ...prev, [r]: data }));
        }
      })
      .catch((err) => {
        clearTimeout(timer);
        console.warn(`[diff retry] ${r} => failed:`, String(err));
        setDiffErrors((prev) => new Set([...prev, r]));
      });
  }

  // ── AI import flow ─────────────────────────────────────────────────────────

  async function runImports(resources: Record<string, Record<string, string>[]>) {
    const toImport = IMPORT_ORDER.filter((r) => (resources[r]?.length ?? 0) > 0);
    if (!toImport.length) { setStep("done"); return; }

    const init: Record<string, ImportStatus> = {};
    for (const r of toImport) init[r] = { state: "pending" };
    setImportStatuses(init);
    setStep("importing");

    const succeeded: Resource[] = [];

    async function doImport(r: Resource) {
      setImportStatuses((prev) => ({ ...prev, [r]: { state: "running" } }));
      try {
        const res = await fetch("/api/comps-import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource: r, rows: resources[r], mode: "upsert", fileName: aiResult?.fileName }),
        });
        const body = await res.json();
        if (res.ok) {
          succeeded.push(r);
          setImportStatuses((prev) => ({ ...prev, [r]: { state: "done", count: body.rowsImported } }));
        } else {
          setImportStatuses((prev) => ({ ...prev, [r]: { state: "error", message: body.error ?? "Failed" } }));
        }
      } catch (e) {
        setImportStatuses((prev) => ({
          ...prev,
          [r]: { state: "error", message: e instanceof Error ? e.message : "Network error" },
        }));
      }
    }

    // comp-buildings must come first (stats sheets reference building names)
    if (resources["comp-buildings"]?.length) {
      await doImport("comp-buildings");
    }

    // All remaining in parallel
    const rest = toImport.filter((r) => r !== "comp-buildings");
    if (rest.length) {
      await Promise.allSettled(rest.map((r) => doImport(r)));
    }

    setStep("done");
    if (succeeded.length) { setLastImportedResources(succeeded); loadSnapshots(); }
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setNormalizeError(null);
    setAiResult(null);
    setImportStatuses({});
    setStep("normalizing");

    const buf = await file.arrayBuffer();
    fileRef.current = { buf, name: file.name };

    const isExcel = /\.xlsx?$/i.test(file.name) || file.type.includes("spreadsheetml");
    let sheets: { name: string; headers: string[]; rows: Record<string, string>[] }[];

    // ── Fast path: Claude converter skill output (multi-resource CSV) ──────────
    if (!isExcel) {
      const text = new TextDecoder("utf-8").decode(buf);
      if (isMultiResourceCsv(text)) {
        const sections = parseMultiResourceCsv(text);
        const resources = sections as Record<string, Record<string, string>[]>;
        const validResources: Record<string, Record<string, string>[]> = {};
        for (const [k, v] of Object.entries(resources)) {
          if (IMPORT_ORDER.includes(k as typeof IMPORT_ORDER[number]) && v.length > 0) {
            validResources[k] = v;
          }
        }
        if (!Object.keys(validResources).length) {
          setNormalizeError("No recognized resource sections found in this file.");
          setStep("error");
          return;
        }
        const totalRows = Object.values(validResources).reduce((s, r) => s + r.length, 0);
        const resourceNames = Object.keys(validResources).join(", ");
        const result: AiResult = {
          resources: validResources,
          xlsxBase64: "",
          fileName: file.name.replace(/\.csv$/i, "") + "-imported",
          summary: `Pre-formatted import: ${Object.keys(validResources).length} resource type(s), ${totalRows} total rows (${resourceNames})`,
        };
        setAiResult(result);
        setConfirmSelected(new Set(IMPORT_ORDER.filter((r) => (result.resources[r]?.length ?? 0) > 0)));
        setDiffResults({});
        setDiffErrors(new Set());
        setImportModes({});
        setStep("confirm");

        const diffResources = IMPORT_ORDER.filter((r) => (result.resources[r]?.length ?? 0) > 0);
        if (diffResources.length > 0) {
          setDiffLoading(true);
          let pending = diffResources.length;
          const finishOne = () => { pending--; if (pending === 0) setDiffLoading(false); };
          for (const r of diffResources) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 20000);
            fetch("/api/comps-import/diff", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ resource: r, rows: result.resources[r] }),
              signal: ctrl.signal,
            })
              .then(async (res) => {
                clearTimeout(timer);
                if (!res.ok) { setDiffErrors((prev) => new Set([...prev, r])); }
                else { const data = await res.json(); setDiffResults((prev) => ({ ...prev, [r]: data })); }
              })
              .catch(() => { clearTimeout(timer); setDiffErrors((prev) => new Set([...prev, r])); })
              .finally(finishOne);
          }
        }
        return;
      }
    }
    // ── End fast path ──────────────────────────────────────────────────────────

    if (isExcel) {
      sheets = await parseAllSheets(buf);
    } else {
      const rows = parseCsv(new TextDecoder("utf-8").decode(buf));
      if (!rows.length) { setNormalizeError("No data rows found."); setStep("error"); return; }
      sheets = [{ name: "Data", headers: Object.keys(rows[0]), rows }];
    }

    if (!sheets.length) { setNormalizeError("No data found in file."); setStep("error"); return; }

    try {
      const result = await normalizeClientSide(sheets, file.name);
      setAiResult(result);
      setConfirmSelected(new Set(IMPORT_ORDER.filter((r) => (result.resources[r]?.length ?? 0) > 0)));
      setDiffResults({});
      setDiffErrors(new Set());
      setImportModes({});
      setStep("confirm"); // show preview + confirm before importing

      // Fetch duplicate detection counts — one request per resource, update UI as each arrives
      const diffResources = IMPORT_ORDER.filter((r) => (result.resources[r]?.length ?? 0) > 0);
      console.log("[diff v3] starting for resources:", diffResources);
      if (diffResources.length === 0) return;

      setDiffLoading(true);
      let pending = diffResources.length;

      const finishOne = () => { pending--; if (pending === 0) setDiffLoading(false); };

      for (const r of diffResources) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);

        fetch("/api/comps-import/diff", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource: r, rows: result.resources[r] }),
          signal: ctrl.signal,
        })
          .then(async (res) => {
            clearTimeout(timer);
            if (!res.ok) {
              const text = await res.text().catch(() => String(res.status));
              console.warn(`[diff v3] ${r} => HTTP ${res.status}:`, text);
              setDiffErrors((prev) => new Set([...prev, r]));
            } else {
              const data = await res.json();
              console.log(`[diff v3] ${r} =>`, data);
              setDiffResults((prev) => ({ ...prev, [r]: data }));
            }
          })
          .catch((err) => {
            clearTimeout(timer);
            const msg = err?.name === "AbortError" ? "timed out after 20s" : String(err);
            console.warn(`[diff v3] ${r} => failed:`, msg);
            setDiffErrors((prev) => new Set([...prev, r]));
          })
          .finally(finishOne);
      }
    } catch (e) {
      setNormalizeError(e instanceof Error ? e.message : String(e));
      setStep("error");
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Manual fallback ────────────────────────────────────────────────────────

  async function switchToManual() {
    const ref = fileRef.current;
    if (!ref) return;

    const isExcel = /\.xlsx?$/i.test(ref.name) || true;
    const { headers: hdrs, rows } = isExcel
      ? await parseSingleSheet(ref.buf)
      : (() => {
          const r = parseCsv(new TextDecoder("utf-8").decode(ref.buf));
          return { headers: r.length ? Object.keys(r[0]) : [], rows: r };
        })();

    if (!rows.length) { alert("No data rows found."); return; }
    setRawRows(rows); setHeaders(hdrs);
    setAiMappedFields(new Set()); setAiReasoning(null); setAiMapping(true);
    setStep("manual-map");

    try {
      const res = await fetch("/api/ai-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers: hdrs, sampleRows: rows.slice(0, 5), fileName: ref.name }),
      });
      if (res.ok) {
        const data = await res.json() as { resource: Resource; mappings: Record<string, string | null>; reasoning?: string };
        setResource(data.resource);
        setMappings(data.mappings);
        setAiMappedFields(new Set(Object.entries(data.mappings).filter(([, v]) => v !== null).map(([k]) => k)));
        setAiReasoning(data.reasoning ?? null);
      } else {
        const fallback = detectResource(hdrs);
        const r = fallback?.resource ?? "lease-comps";
        setResource(r); setMappings(autoMapColumns(hdrs, r));
      }
    } catch {
      const fallback = detectResource(hdrs);
      const r = fallback?.resource ?? "lease-comps";
      setResource(r); setMappings(autoMapColumns(hdrs, r));
    } finally {
      setAiMapping(false);
    }
  }

  function onResourceChange(r: Resource) {
    setResource(r); setMappings(autoMapColumns(headers, r)); setAiMappedFields(new Set());
  }

  function setMapping(header: string, dbField: string | null) {
    setMappings((m) => {
      const next = { ...m };
      if (dbField) for (const h of Object.keys(next)) { if (next[h] === dbField && h !== header) next[h] = null; }
      next[header] = dbField;
      return next;
    });
  }

  function buildMappedRows(): Record<string, string>[] {
    return rawRows.map((row) => {
      const out: Record<string, string> = {};
      for (const [h, f] of Object.entries(mappings)) { if (f) out[f] = row[h] ?? ""; }
      return out;
    });
  }

  async function runManualImport() {
    setSubmitting(true); setManualResult(null);
    try {
      const res = await fetch("/api/comps-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, rows: buildMappedRows(), mode, fileName }),
      });
      const body = await res.json();
      if (res.ok) {
        setManualResult({ ok: true, message: `${mode === "replace" ? "Replaced all data with" : "Merged"} ${body.rowsImported} rows into ${RESOURCE_LABELS[resource]}.` });
        setLastImportedResources([resource]);
        loadSnapshots();
      } else {
        setManualResult({ ok: false, message: body.error ?? "Unknown error" });
      }
    } catch (e) {
      setManualResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false); setStep("manual-done");
    }
  }

  function resetDrop() {
    setStep("drop"); setAiResult(null); setImportStatuses({}); setNormalizeError(null);
    setRawRows([]); setHeaders([]); setFileName(""); setManualResult(null);
    setAiMappedFields(new Set()); setAiReasoning(null); fileRef.current = null;
  }

  async function handlePreviewOnDashboard() {
    if (!aiResult) return;
    setPreviewError(null);
    setPreviewing(true);
    try {
      // Build the filtered resource set (respect checked resources + new-only mode)
      const filtered: Record<string, Record<string, string>[]> = {};
      for (const [r, rows] of Object.entries(aiResult.resources)) {
        if (!confirmSelected.has(r)) continue;
        const mode = importModes[r] ?? "all";
        if (mode === "new-only" && diffResults[r]?.updateKeys?.length) {
          const skipSet = new Set(diffResults[r].updateKeys);
          filtered[r] = rows.filter((row) => {
            const k = clientRowKey(r, row);
            return k === null || !skipSet.has(k);
          });
        } else {
          filtered[r] = rows;
        }
      }
      if (!Object.keys(filtered).length) {
        setPreviewError("Select at least one resource to preview.");
        return;
      }
      const res = await fetch("/api/comps-import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resources: filtered, fileName: aiResult.fileName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setPreviewError(body.error ?? "Failed to start preview.");
        return;
      }
      window.open("/", "_blank");
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Network error");
    } finally {
      setPreviewing(false);
    }
  }

  // Sheet sync
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

  // Derived for manual flow
  const missingRequired = RESOURCE_FIELDS[resource]
    .filter((f) => f.required)
    .map((f) => f.key)
    .filter((k) => !new Set(Object.values(mappings).filter(Boolean) as string[]).has(k));

  const isAiStep = ["drop", "normalizing", "confirm", "importing", "done", "error"].includes(step);
  const doneCount = Object.values(importStatuses).filter((s) => s.state === "done").length;
  const errCount  = Object.values(importStatuses).filter((s) => s.state === "error").length;
  const totalImports = Object.keys(importStatuses).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "2rem 1rem" }}>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: "0.25rem" }}>
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>Import &amp; Sync</h1>
        <a
          href="/rudin-import-converter.md"
          download="rudin-import-converter.md"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "0.4rem 0.9rem",
            border: "1px solid var(--accent, #0d4d3a)",
            color: "var(--accent, #0d4d3a)",
            fontSize: "0.78rem", fontWeight: 600,
            textDecoration: "none",
            whiteSpace: "nowrap",
            background: "transparent",
          }}
          title="Download this file, then attach it to a Claude conversation alongside your spreadsheet to get a perfectly formatted CSV ready to import"
        >
          ↓ Download Claude converter skill
        </a>
      </div>
      <p style={{ color: "#555", fontSize: "0.88rem", marginBottom: "0.5rem", maxWidth: 700 }}>
        Drop any spreadsheet — the AI reads all sheets, maps every column to the right field,
        auto-imports all data into the database, and gives you a clean normalized XLSX to keep.
        {lastSyncedAt && <>{" "}Last synced {new Date(lastSyncedAt).toLocaleString()}.</>}
      </p>
      <p style={{ color: "#777", fontSize: "0.8rem", marginBottom: "2rem", maxWidth: 700 }}>
        <strong style={{ color: "#555" }}>Prefer manual control?</strong> Download the converter skill above, attach it to a Claude conversation with your spreadsheet, and Claude will output a clean CSV you can drop here directly — no guessing.
      </p>

      {/* ── Drop zone ───────────────────────────────────────────────────────── */}
      {step === "drop" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? "#2563eb" : "#c8d3de"}`,
            borderRadius: 12, padding: "3rem 2rem", textAlign: "center",
            cursor: "pointer", background: dragging ? "#eff6ff" : "#f8fafc",
            transition: "all 0.15s", marginBottom: "3rem",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>⬇</div>
          <div style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>
            Drop your spreadsheet here, or click to browse
          </div>
          <div style={{ color: "#64748b", fontSize: "0.84rem", marginBottom: "0.75rem" }}>
            .csv · .xlsx · .xls · converter skill output
          </div>
          <div style={{ display: "inline-flex", gap: 12, flexWrap: "wrap", justifyContent: "center", fontSize: "0.78rem", color: "#94a3b8" }}>
            <span>✦ AI reads all sheets</span>
            <span>✦ Maps all columns automatically</span>
            <span>✦ Imports all resources</span>
            <span>✦ Converter skill CSV imports instantly</span>
          </div>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }}
            onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        </div>
      )}

      {/* ── Normalizing spinner ──────────────────────────────────────────────── */}
      {step === "normalizing" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", gap: "0.75rem", marginBottom: "3rem" }}>
          <div style={{ width: 40, height: 40, border: "3px solid #e2e8f0", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin2 0.9s linear infinite" }} />
          <style>{`@keyframes spin2{to{transform:rotate(360deg)}}`}</style>
          <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>Analyzing your file…</div>
          <div style={{ color: "#64748b", fontSize: "0.84rem" }}>
            {fileName} — detecting sheets and mapping columns
          </div>
        </div>
      )}

      {/* ── Error state ──────────────────────────────────────────────────────── */}
      {step === "error" && (
        <div style={{ padding: "1.25rem", borderRadius: 8, marginBottom: "3rem", background: "#fef2f2", border: "1px solid #fca5a5" }}>
          <div style={{ fontWeight: 700, marginBottom: "0.4rem", color: "#dc2626" }}>AI normalization failed</div>
          <div style={{ fontSize: "0.88rem", marginBottom: "1rem" }}>{normalizeError}</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={resetDrop}
              style={{ padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.88rem", fontWeight: 600 }}>
              Try another file
            </button>
            {fileRef.current && (
              <button onClick={switchToManual}
                style={{ padding: "6px 14px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer", fontSize: "0.88rem" }}>
                Map manually instead
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Confirm step ─────────────────────────────────────────────────────── */}
      {step === "confirm" && aiResult && (
        <div style={{ marginBottom: "3rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: "1.25rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "0.2rem", color: "var(--ink)" }}>Review &amp; confirm import</div>
              <div style={{ fontSize: "12px", color: "var(--ink-faint)" }}>{aiResult.summary}</div>
            </div>
            <button onClick={() => downloadXlsx(aiResult.xlsxBase64, aiResult.fileName)}
              style={{ padding: "6px 14px", background: "var(--near-black)", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "12px", whiteSpace: "nowrap", fontFamily: "inherit" }}>
              ⬇ Download normalized XLSX
            </button>
          </div>

          {IMPORT_ORDER.filter((r) => (aiResult.resources[r]?.length ?? 0) > 0).map((r) => {
            const rows = aiResult.resources[r];
            const loc = RESOURCE_LOCATION[r];
            const previewHeaders = rows[0] ? Object.keys(rows[0]) : [];
            const included = confirmSelected.has(r);
            const diff = diffResults[r];
            const diffErr = diffErrors.has(r);
            const imode = importModes[r] ?? "all";
            const toggleId = `confirm-toggle-${r}`;
            return (
              <div key={r} style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: "1rem" }}>
                {/* Checkbox — outside the card */}
                <label htmlFor={toggleId} style={{ paddingTop: 13, cursor: "pointer", flexShrink: 0 }}>
                  <input
                    id={toggleId}
                    type="checkbox"
                    checked={included}
                    onChange={() => setConfirmSelected((prev) => {
                      const next = new Set(prev);
                      next.has(r) ? next.delete(r) : next.add(r);
                      return next;
                    })}
                    style={{ width: 15, height: 15, accentColor: "var(--accent)", cursor: "pointer" }}
                  />
                </label>

                {/* Card */}
                <div style={{
                  flex: 1, minWidth: 0, overflow: "hidden",
                  border: `1px solid ${included ? "var(--accent)" : "var(--line)"}`,
                  borderLeft: `3px solid ${included ? "var(--accent)" : "var(--line)"}`,
                  opacity: included ? 1 : 0.45,
                  transition: "border-color 0.15s, opacity 0.15s",
                  background: "var(--paper-raised)",
                }}>
                  {/* Card header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", background: included ? "var(--accent-soft)" : "var(--paper)", borderBottom: "1px solid var(--line-soft)", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--ink)" }}>{RESOURCE_LABELS[r]}</div>
                      <div style={{ fontSize: "11px", color: "var(--ink-faint)", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {rows.length.toLocaleString()} rows
                        {diffLoading && !diff && !diffErr && (
                          <span style={{ color: "var(--ink-faint)", fontStyle: "italic" }}>checking duplicates…</span>
                        )}
                        {diffErr && (
                          <>
                            <span style={{ background: "#fff3f3", color: "var(--red)", border: "1px solid #f0c0c0", padding: "0 6px", fontSize: "10px" }}>⚠ dup check failed</span>
                            <button onClick={() => retryDiff(r, aiResult.resources[r])} style={{ fontSize: "10px", padding: "0 5px", border: "1px solid var(--line)", background: "var(--paper)", cursor: "pointer", fontFamily: "inherit", color: "var(--ink-soft)" }}>retry</button>
                          </>
                        )}
                        {diff && (
                          <>
                            {diff.newCount > 0 && (
                              <span style={{ background: "var(--accent-soft)", color: "var(--accent)", border: "1px solid var(--accent-line)", padding: "0 6px", fontWeight: 600, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {diff.newCount.toLocaleString()} new
                              </span>
                            )}
                            {diff.updateCount > 0 && (
                              <span style={{ background: "#fdf6e3", color: "#7a5a1a", border: "1px solid #e8d59a", padding: "0 6px", fontWeight: 600, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                {diff.updateCount.toLocaleString()} updates
                              </span>
                            )}
                            {diff.newCount === 0 && diff.updateCount === 0 && (
                              <span style={{ background: "var(--line-soft)", color: "var(--ink-faint)", padding: "0 6px", fontSize: "10px" }}>
                                {diff.noKeyCount > 0 ? `${diff.noKeyCount.toLocaleString()} rows (no unique key to check)` : "all already in DB"}
                              </span>
                            )}
                          </>
                        )}
                        {loc && (
                          <>
                            <span style={{ color: "var(--line)" }}>·</span>
                            <span style={{ background: "var(--accent-soft)", color: "var(--accent)", padding: "0 6px", fontWeight: 600, fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.04em" }}>{loc.tab}</span>
                            <span style={{ color: "var(--ink-faint)" }}>{loc.where}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: "11px", color: included ? "var(--accent)" : "var(--ink-faint)", fontWeight: 600, flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                      {included ? "Will import" : "Skipped"}
                    </span>
                  </div>

                  {/* Duplicate handling — only when updates exist and card is included */}
                  {included && diff && diff.updateCount > 0 && (
                    <div style={{ padding: "7px 14px", background: "#fdf6e3", borderBottom: "1px solid #e8d59a", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: "11px", color: "#7a5a1a", fontWeight: 600 }}>
                        {diff.updateCount} row{diff.updateCount !== 1 ? "s" : ""} already exist — how to handle:
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => setImportModes((m) => ({ ...m, [r]: "all" }))}
                          style={{ padding: "3px 10px", fontSize: "11px", border: "1px solid", cursor: "pointer", fontWeight: 600, fontFamily: "inherit",
                            background: imode === "all" ? "var(--gold)" : "var(--paper-raised)",
                            color: imode === "all" ? "#fff" : "#7a5a1a",
                            borderColor: imode === "all" ? "var(--gold)" : "#e8d59a" }}>
                          Update existing
                        </button>
                        <button
                          onClick={() => setImportModes((m) => ({ ...m, [r]: "new-only" }))}
                          style={{ padding: "3px 10px", fontSize: "11px", border: "1px solid", cursor: "pointer", fontWeight: 600, fontFamily: "inherit",
                            background: imode === "new-only" ? "var(--accent)" : "var(--paper-raised)",
                            color: imode === "new-only" ? "#fff" : "var(--ink-soft)",
                            borderColor: imode === "new-only" ? "var(--accent)" : "var(--line)" }}>
                          New only ({diff.newCount})
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Data preview */}
                  <div style={{ overflowX: "auto", fontSize: "12px" }}>
                    <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                      <thead>
                        <tr style={{ background: "var(--line-soft)" }}>
                          {previewHeaders.map((h) => (
                            <th key={h} style={{ padding: "5px 10px", textAlign: "left", fontWeight: 600, fontSize: "10.5px", color: "var(--ink-faint)", letterSpacing: "0.03em", whiteSpace: "nowrap", borderRight: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 5).map((row, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid var(--line-soft)", background: i % 2 === 1 ? "var(--paper)" : "var(--paper-raised)" }}>
                            {previewHeaders.map((h) => (
                              <td key={h} style={{ padding: "4px 10px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderRight: "1px solid var(--line-soft)", color: "var(--ink-soft)", fontSize: "12px" }}>
                                {row[h] ?? ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 5 && (
                    <div style={{ padding: "4px 10px", fontSize: "11px", color: "var(--ink-faint)", background: "var(--paper)", borderTop: "1px solid var(--line-soft)" }}>
                      + {(rows.length - 5).toLocaleString()} more rows
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ display: "flex", gap: 8, marginTop: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => {
                const filtered: Record<string, Record<string, string>[]> = {};
                for (const [r, rows] of Object.entries(aiResult.resources)) {
                  if (!confirmSelected.has(r)) continue;
                  const mode = importModes[r] ?? "all";
                  if (mode === "new-only" && diffResults[r]?.updateKeys?.length) {
                    const skipSet = new Set(diffResults[r].updateKeys);
                    filtered[r] = rows.filter((row) => {
                      const k = clientRowKey(r, row);
                      return k === null || !skipSet.has(k);
                    });
                  } else {
                    filtered[r] = rows;
                  }
                }
                runImports(filtered);
              }}
              disabled={confirmSelected.size === 0}
              style={{ padding: "7px 18px", background: confirmSelected.size === 0 ? "var(--ink-faint)" : "var(--accent)", color: "#fff", border: "none", cursor: confirmSelected.size === 0 ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "13px", fontFamily: "inherit" }}>
              Import {confirmSelected.size} resource{confirmSelected.size !== 1 ? "s" : ""}
            </button>
            <button
              onClick={() => { void handlePreviewOnDashboard(); }}
              disabled={confirmSelected.size === 0 || previewing}
              title="See how the dashboard will look with this data before importing"
              style={{ padding: "7px 16px", background: "#1e3a5f", color: "#93c5fd", border: "1px solid #2d5a9e", cursor: confirmSelected.size === 0 || previewing ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "13px", fontFamily: "inherit", opacity: confirmSelected.size === 0 || previewing ? 0.5 : 1 }}>
              {previewing ? "Opening…" : "Preview on dashboard ↗"}
            </button>
            <button onClick={resetDrop}
              style={{ padding: "7px 14px", background: "none", border: "1px solid var(--line)", cursor: "pointer", fontSize: "13px", color: "var(--ink-soft)", fontFamily: "inherit" }}>
              ← Start over
            </button>
            {confirmSelected.size === 0 && (
              <span style={{ fontSize: "12px", color: "var(--ink-faint)" }}>Select at least one resource to import.</span>
            )}
            {previewError && (
              <span style={{ fontSize: "12px", color: "var(--red)" }}>{previewError}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Importing / Done ─────────────────────────────────────────────────── */}
      {(step === "importing" || step === "done") && aiResult && (
        <div style={{ marginBottom: "3rem" }}>
          {/* Header bar */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: "1.25rem", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: "1.05rem", marginBottom: "0.25rem" }}>
                {step === "importing" ? "Importing…" : (
                  errCount === 0
                    ? `Import complete — ${doneCount} resource${doneCount !== 1 ? "s" : ""} updated`
                    : `Done with ${errCount} error${errCount !== 1 ? "s" : ""} (${doneCount}/${totalImports} succeeded)`
                )}
              </div>
              <div style={{ fontSize: "0.84rem", color: "#64748b" }}>{aiResult.summary}</div>
            </div>
            <button
              onClick={() => downloadXlsx(aiResult.xlsxBase64, aiResult.fileName)}
              style={{ padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: 7, cursor: "pointer", fontWeight: 600, fontSize: "0.84rem", whiteSpace: "nowrap" }}>
              ⬇ Download normalized XLSX
            </button>
          </div>

          {/* Per-resource status list */}
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden", marginBottom: "1.25rem" }}>
            {IMPORT_ORDER.filter((r) => importStatuses[r]).map((r, i, arr) => {
              const s = importStatuses[r];
              return (
                <div key={r} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 14px",
                  borderBottom: i < arr.length - 1 ? "1px solid #e2e8f0" : "none",
                  background: s.state === "error" ? "#fef2f2" : s.state === "done" ? "#f0fdf4" : "#fff",
                }}>
                  <div style={{ width: 18, textAlign: "center", flexShrink: 0 }}>
                    <StatusIcon state={s.state} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.88rem", fontWeight: 500, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      {RESOURCE_LABELS[r]}
                      {RESOURCE_LOCATION[r] && (
                        <span style={{ fontSize: "0.72rem", background: "#dbeafe", color: "#1d4ed8", borderRadius: 4, padding: "1px 7px", fontWeight: 600 }}>{RESOURCE_LOCATION[r].tab}</span>
                      )}
                    </div>
                    {RESOURCE_LOCATION[r] && (
                      <div style={{ fontSize: "0.76rem", color: "#64748b", marginTop: 2 }}>{RESOURCE_LOCATION[r].where}</div>
                    )}
                  </div>
                  <div style={{ fontSize: "0.82rem", color: s.state === "error" ? "#dc2626" : "#64748b", flexShrink: 0 }}>
                    {s.state === "pending" && "Waiting…"}
                    {s.state === "running" && "Importing…"}
                    {s.state === "done" && `${s.count?.toLocaleString() ?? "?"} rows`}
                    {s.state === "error" && (s.message ?? "Error")}
                  </div>
                </div>
              );
            })}
          </div>

          {step === "done" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button onClick={resetDrop}
                style={{ padding: "7px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: "0.88rem" }}>
                Import another file
              </button>
              {lastImportedResources.length > 0 && snapshots.some((s) => lastImportedResources.includes(s.resource)) && (
                <button onClick={undoLastImport} disabled={undoing}
                  style={{ padding: "7px 14px", background: undoing ? "#94a3b8" : "#fff", color: undoing ? "#fff" : "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, cursor: undoing ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "0.88rem" }}>
                  {undoing ? "Undoing…" : "↩ Undo last import"}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Manual: Map step ─────────────────────────────────────────────────── */}
      {step === "manual-map" && (
        <div style={{ marginBottom: "3rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.2rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>{fileRef.current?.name}</span>
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
                {MANUAL_RESOURCES.map((r) => <option key={r} value={r}>{RESOURCE_LABELS[r]}</option>)}
              </select>
            </label>
          </div>

          {aiMapping ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "3rem 1rem", gap: "0.75rem", color: "#475569" }}>
              <div style={{ width: 28, height: 28, border: "3px solid #e2e8f0", borderTop: "3px solid #2563eb", borderRadius: "50%", animation: "spin2 0.9s linear infinite" }} />
              <div style={{ fontWeight: 600 }}>Claude is reading your file…</div>
            </div>
          ) : (
            <>
              {aiReasoning && (
                <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 14px", marginBottom: "1rem", fontSize: "0.83rem", color: "#166534" }}>
                  <strong>✦ Claude:</strong> {aiReasoning}
                </div>
              )}

              {/* ── Sheet preview ──────────────────────────────────────────── */}
              <div style={{ marginBottom: "1.25rem" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>
                  Sheet preview — first {Math.min(rawRows.length, 6)} of {rawRows.length.toLocaleString()} rows
                </div>
                <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.78rem" }}>
                  <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
                    <thead>
                      <tr style={{ background: "#f8fafc" }}>
                        {headers.map((h) => {
                          const mapped = mappings[h];
                          const wasAi = aiMappedFields.has(h);
                          const field = RESOURCE_FIELDS[resource].find((f) => f.key === mapped);
                          return (
                            <th key={h} style={{
                              padding: "5px 10px", textAlign: "left", whiteSpace: "nowrap", fontWeight: 600,
                              borderRight: "1px solid #e2e8f0", borderBottom: "2px solid #e2e8f0",
                              background: mapped ? "#f0fdf4" : "#f8fafc",
                              color: mapped ? "#15803d" : "#94a3b8", minWidth: 90,
                            }}>
                              <div style={{ fontSize: "0.7rem", color: mapped ? "#86efac" : "#e2e8f0", marginBottom: 1 }}>
                                {mapped ? `→ ${field?.label ?? mapped}${wasAi ? " (AI)" : ""}` : "(skip)"}
                              </div>
                              {h}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rawRows.slice(0, 6).map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f1f5f9", background: i % 2 === 1 ? "#fafafa" : "#fff" }}>
                          {headers.map((h) => {
                            const mapped = mappings[h];
                            return (
                              <td key={h} style={{
                                padding: "4px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                borderRight: "1px solid #f1f5f9",
                                color: mapped ? "#1e293b" : "#94a3b8",
                                background: mapped ? undefined : "rgba(0,0,0,.015)",
                              }}>
                                {row[h] ?? ""}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: "0.73rem", color: "#94a3b8", marginTop: "0.4rem" }}>
                  Mapped columns are <span style={{ color: "#15803d", fontWeight: 600 }}>highlighted green</span>. Skipped columns are greyed out.
                </div>
              </div>

              {/* ── Mapping table ──────────────────────────────────────────── */}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", marginBottom: "1rem" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600 }}>File column</th>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600 }}>Maps to</th>
                    <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600 }}>Sample value</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h) => {
                    const mapped = mappings[h];
                    const wasAi = aiMappedFields.has(h);
                    return (
                      <tr key={h} style={{ borderBottom: "1px solid #e2e8f0", background: mapped ? "rgba(240,253,244,.5)" : undefined }}>
                        <td style={{ padding: "6px 12px", fontFamily: "monospace", color: mapped ? "#15803d" : "#94a3b8" }}>
                          {h}
                          {wasAi && mapped && (
                            <span style={{ marginLeft: 6, fontSize: "0.68rem", background: "#dcfce7", color: "#15803d", borderRadius: 4, padding: "1px 5px", fontFamily: "sans-serif", fontWeight: 700 }}>AI</span>
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

              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setStep("manual-preview")} disabled={missingRequired.length > 0}
                  style={{ padding: "8px 18px", background: missingRequired.length ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: missingRequired.length ? "not-allowed" : "pointer", fontWeight: 600 }}>
                  Review &amp; Import →
                </button>
                <button onClick={resetDrop}
                  style={{ padding: "8px 14px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}>
                  ← Start over
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Manual: Preview step ─────────────────────────────────────────────── */}
      {step === "manual-preview" && (
        <div style={{ marginBottom: "3rem" }}>
          <div style={{ fontWeight: 600, marginBottom: "1rem" }}>
            Preview — first 6 rows&nbsp;
            <span style={{ color: "#64748b", fontWeight: 400, fontSize: "0.88rem" }}>({rawRows.length.toLocaleString()} total)</span>
          </div>
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
            <button onClick={runManualImport} disabled={submitting}
              style={{ padding: "8px 18px", background: submitting ? "#94a3b8" : "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: submitting ? "not-allowed" : "pointer", fontWeight: 600 }}>
              {submitting ? "Importing…" : `Import ${rawRows.length.toLocaleString()} rows`}
            </button>
            <button onClick={() => setStep("manual-map")}
              style={{ padding: "8px 14px", background: "none", border: "1px solid #cbd5e1", borderRadius: 6, cursor: "pointer" }}>
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── Manual: Done ─────────────────────────────────────────────────────── */}
      {step === "manual-done" && manualResult && (
        <div style={{ padding: "1.25rem", borderRadius: 8, marginBottom: "3rem",
          background: manualResult.ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${manualResult.ok ? "#86efac" : "#fca5a5"}` }}>
          <div style={{ fontWeight: 700, marginBottom: "0.4rem", color: manualResult.ok ? "#15803d" : "#dc2626" }}>
            {manualResult.ok ? "Import complete" : "Import failed"}
          </div>
          <div style={{ fontSize: "0.88rem" }}>{manualResult.message}</div>
          <div style={{ marginTop: "0.75rem", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={resetDrop}
              style={{ padding: "6px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "0.88rem" }}>
              Import another file
            </button>
            {manualResult.ok && lastImportedResources.length > 0 && snapshots.some((s) => lastImportedResources.includes(s.resource)) && (
              <button onClick={undoLastImport} disabled={undoing}
                style={{ padding: "6px 12px", background: undoing ? "#94a3b8" : "#fff", color: undoing ? "#fff" : "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, cursor: undoing ? "not-allowed" : "pointer", fontWeight: 600, fontSize: "0.88rem" }}>
                {undoing ? "Undoing…" : "↩ Undo"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── "Manual import" link when in AI flow but file is loaded ─────────── */}
      {isAiStep && step !== "drop" && step !== "normalizing" && fileRef.current && (
        <div style={{ marginBottom: "3rem", fontSize: "0.84rem", color: "#64748b" }}>
          Need to override AI mapping?{" "}
          <button onClick={switchToManual}
            style={{ background: "none", border: "none", padding: 0, color: "#2563eb", cursor: "pointer", textDecoration: "underline", fontSize: "0.84rem" }}>
            Map columns manually
          </button>
        </div>
      )}

      {/* ── Undo / restore feedback ──────────────────────────────────────────── */}
      {restoreMsg && (
        <div style={{ padding: "10px 14px", borderRadius: 8, marginBottom: "1.5rem",
          background: restoreMsg.ok ? "#f0fdf4" : "#fef2f2",
          border: `1px solid ${restoreMsg.ok ? "#86efac" : "#fca5a5"}`,
          color: restoreMsg.ok ? "#15803d" : "#dc2626", fontSize: "0.88rem" }}>
          {restoreMsg.text}
          <button onClick={() => setRestoreMsg(null)} style={{ float: "right", background: "none", border: "none", cursor: "pointer", color: "inherit", fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* ── Version history ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "2rem" }}>
        <button onClick={() => setHistoryOpen((o) => !o)} type="button"
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", color: "#475569", fontWeight: 600 }}>
          <span style={{ fontSize: "0.75rem", display: "inline-block", transform: historyOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
          Version history {snapshots.length > 0 && <span style={{ fontWeight: 400, color: "#94a3b8" }}>({snapshots.length} snapshots)</span>}
        </button>
        {historyOpen && (
          <div style={{ marginTop: "0.75rem" }}>
            {snapshots.length === 0 ? (
              <p style={{ fontSize: "0.84rem", color: "#94a3b8" }}>No snapshots yet — one is saved automatically before each import.</p>
            ) : (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Saved</th>
                      <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Resource</th>
                      <th style={{ padding: "7px 12px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Label</th>
                      <th style={{ padding: "7px 12px", textAlign: "right", fontWeight: 600, color: "#64748b" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s, i) => (
                      <tr key={s.id} style={{ borderBottom: i < snapshots.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                        <td style={{ padding: "6px 12px", color: "#64748b", whiteSpace: "nowrap" }}>{new Date(s.createdAt).toLocaleString()}</td>
                        <td style={{ padding: "6px 12px" }}><span style={{ fontSize: "0.78rem", background: "#f1f5f9", borderRadius: 4, padding: "2px 7px", color: "#475569", fontFamily: "monospace" }}>{s.resource}</span></td>
                        <td style={{ padding: "6px 12px", color: "#475569" }}>{s.label}</td>
                        <td style={{ padding: "6px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <button onClick={() => restoreSnapshot(s.id)} disabled={restoring === s.id} type="button"
                            style={{ padding: "3px 10px", fontSize: "0.8rem", background: restoring === s.id ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: restoring === s.id ? "not-allowed" : "pointer", marginRight: 6 }}>
                            {restoring === s.id ? "Restoring…" : "Restore"}
                          </button>
                          <button onClick={() => deleteSnapshot(s.id)} type="button"
                            style={{ padding: "3px 8px", fontSize: "0.8rem", background: "none", border: "1px solid #e2e8f0", borderRadius: 4, cursor: "pointer", color: "#94a3b8" }}>
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Divider ──────────────────────────────────────────────────────────── */}
      <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "0 0 2rem" }} />

      {/* ── Google Sheets auto-sync ──────────────────────────────────────────── */}
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: "0.3rem" }}>Auto-sync via Google Sheets</h2>
      <p style={{ color: "#555", fontSize: "0.85rem", marginBottom: "1.5rem", maxWidth: 640 }}>
        Paste a published CSV link (File → Share → Publish to web → select tab → CSV) and hit Sync now.
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
