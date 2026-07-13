"use client";

import { useRef, useState } from "react";

type ExactResult = {
  format: "exact";
  resource: string;
  resourceLabel: string;
  rowCount: number;
};

type LeaseResult = {
  format: "lease-level";
  totalLeaseRows: number;
  buildings: { raw: string; matched: string | null; leaseCount: number }[];
  unmatchedNames: string[];
  excludedUnitTypeCounts: Record<string, number>;
  missingUnitTypeRows: number;
  quarterRange: [string, string] | null;
  affected: {
  compBuildings: number;
  compBuildingStats: number;
  compBuildingQuarterStats: number;
  trendPoints: number;
  };
};

type Result = ExactResult | LeaseResult;

/** The one drop target for every data file — no need to know which of the app's tables a file
*  belongs to first. Recognizes the app's own exact templates (Projects, Comp Buildings, Trend,
*  etc.) and syncs them the same way the old per-table upload buttons did, or, failing that, a
*  lease-by-lease export in any column layout, which it matches against existing Comp Buildings
*  and aggregates into stats/quarter-stats/trend. Shows what it found before writing anything. */
export default function SmartUpload() {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

const existingNames =
  preview && preview.format === "lease-level"
  ? [...new Set(preview.buildings.map((b) => b.matched).filter((n): n is string => !!n))]
  : [];

async function runPreview(f: File, ovr: Record<string, string>) {
  setLoading(true);
  setError(null);
  setApplied(null);
  const formData = new FormData();
  formData.append("file", f);
  formData.append("overrides", JSON.stringify(ovr));
  const res = await fetch("/api/smart-upload", { method: "POST", body: formData });
  const body = await res.json();
  setLoading(false);
  if (!res.ok) {
    setError(body.error ?? "Something went wrong.");
    setPreview(null);
    return;
  }
  setPreview(body);
}

function handleFile(f: File) {
  setFile(f);
  setOverrides({});
  runPreview(f, {});
}

async function applyImport() {
  if (!file) return;
  setLoading(true);
  setError(null);
  const formData = new FormData();
  formData.append("file", file);
  formData.append("overrides", JSON.stringify(overrides));
  const res = await fetch("/api/smart-upload?apply=1", { method: "POST", body: formData });
  const body = await res.json();
  setLoading(false);
  if (!res.ok) {
    setError(body.error ?? "Something went wrong.");
    return;
  }
  setApplied(body);
  setPreview(body);
}

function reset() {
  setFile(null);
  setPreview(null);
  setOverrides({});
  setError(null);
  setApplied(null);
}

const excludedTypes = preview && preview.format === "lease-level" ? Object.entries(preview.excludedUnitTypeCounts) : [];

return (
  <div className="admin-field-block">
  <label>Upload any file</label>
  <p className="admin-sub" style={{ marginTop: 0 }}>
  Drop whatever you&apos;ve got — one of this app&apos;s own exports, a totally different sheet, a raw
  lease-by-lease workbook — and this will figure out where it goes: recognized table exports sync that
  table directly, and lease-level exports get matched against existing buildings and aggregated into
  rent/$/SF stats, quarterly stats, and the market trend. It never touches a table it doesn&apos;t
  recognize the file as belonging to.
  </p>
  
    {!file && (
    <div
      className={`admin-dropzone${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f) handleFile(f);
      }}
      onClick={() => inputRef.current?.click()}
      >
    <input
      ref={inputRef}
      type="file"
      accept=".csv,.xlsx,.xls"
      style={{ display: "none" }}
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) handleFile(f);
        e.target.value = "";
      }}
      />
    <div className="admin-dropzone-icon">⇩</div>
    <div className="admin-dropzone-text">Drop a spreadsheet here, or click to browse</div>
    <div className="admin-dropzone-sub">.csv, .xlsx, .xls — any layout</div>
    </div>
    )}
  
    {file && (
    <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
    <span className="admin-badge">{file.name}</span>
      {!applied && (
      <button className="admin-btn secondary" type="button" onClick={reset}>
      Choose a different file
      </button>
      )}
    </div>
    
      {loading && <p className="admin-sub">Reading file…</p>}
      {error && <p className="admin-error">{error}</p>}
    
      {preview && !error && preview.format === "exact" && (
      <div className="admin-import-summary">
      <p>
      Recognized as <strong>{preview.resourceLabel}</strong> — {preview.rowCount} rows.
      </p>
        {applied ? (
        <p className="admin-badge">
        Applied: {preview.resourceLabel} fully replaced with {preview.rowCount} rows.
        </p>
        ) : (
        <p className="admin-sub">
        Applying will fully replace the current {preview.resourceLabel} data with these {preview.rowCount}{" "}
        rows.
        </p>
        )}
        {!applied && (
        <button className="admin-btn" type="button" disabled={loading} onClick={applyImport}>
        Apply changes
        </button>
        )}
        {applied && (
        <button className="admin-btn secondary" type="button" onClick={reset}>
        Upload another file
        </button>
        )}
      </div>
      )}
    
      {preview && !error && preview.format === "lease-level" && (
      <div className="admin-import-summary">
      <p>
      Found <strong>{preview.totalLeaseRows}</strong> lease records across{" "}
      <strong>{preview.buildings.length}</strong> buildings
        {preview.quarterRange && (
        <>
          {" "}
        spanning <strong>{preview.quarterRange[0]}</strong> to <strong>{preview.quarterRange[1]}</strong>
        </>
        )}
      .
      </p>
      
        {applied && applied.format === "lease-level" ? (
        <p className="admin-badge">
        Applied: {applied.affected.compBuildings} buildings updated, {applied.affected.compBuildingStats}{" "}
        building×unit-type stat rows, {applied.affected.compBuildingQuarterStats} quarterly stat rows,{" "}
          {applied.affected.trendPoints} market trend points.
        </p>
        ) : (
        <p className="admin-sub">
        Will update: {preview.affected.compBuildings} buildings&apos; lease counts,{" "}
          {preview.affected.compBuildingStats} building×unit-type stat rows,{" "}
          {preview.affected.compBuildingQuarterStats} quarterly stat rows, {preview.affected.trendPoints}{" "}
        market trend points.
        </p>
        )}
      
        {excludedTypes.length > 0 && (
        <p className="admin-sub">
        Excluded from stats (unit type outside the app&apos;s 8 standard types, still counted toward totals):{" "}
          {excludedTypes.map(([t, n]) => `${t} (${n})`).join(", ")}.
          {preview.missingUnitTypeRows > 0 && ` Also ${preview.missingUnitTypeRows} rows with no unit type.`}
        </p>
        )}
      
      <table className="admin-table" style={{ marginTop: 10, marginBottom: 10 }}>
      <thead>
      <tr>
      <th>In file</th>
      <th>Matched to</th>
      <th>Leases</th>
      </tr>
      </thead>
      <tbody>
        {preview.buildings.map((b) => (
        <tr key={b.raw}>
        <td>{b.raw}</td>
        <td>
          {b.matched ? (
          b.matched
          ) : applied ? (
          <span className="admin-error">skipped — unresolved</span>
          ) : (
          <input
            type="text"
            list="smart-upload-existing-names"
            placeholder="Type existing name, or a new one to create it"
            value={overrides[b.raw] ?? ""}
            onChange={(e) => setOverrides((o) => ({ ...o, [b.raw]: e.target.value }))}
            style={{ width: "100%", boxSizing: "border-box", padding: "4px 6px" }}
            />
          )}
        </td>
        <td>{b.leaseCount}</td>
        </tr>
        ))}
      </tbody>
      </table>
      <datalist id="smart-upload-existing-names">
        {existingNames.map((n) => (
        <option key={n} value={n} />
        ))}
      </datalist>
      
        {!applied && (
        <div style={{ display: "flex", gap: 8 }}>
        <button className="admin-btn" type="button" disabled={loading} onClick={() => runPreview(file, overrides)}>
        Re-check with names above
        </button>
        <button
          className="admin-btn"
          type="button"
          disabled={loading || preview.unmatchedNames.some((n) => !overrides[n])}
          onClick={applyImport}
          title={
            preview.unmatchedNames.some((n) => !overrides[n])
            ? "Resolve every unmatched building name first"
            : undefined
          }
          >
        Apply changes
        </button>
        </div>
        )}
        {applied && (
        <button className="admin-btn secondary" type="button" onClick={reset}>
        Upload another file
        </button>
        )}
      </div>
      )}
    </div>
    )}
  </div>
  );
}
