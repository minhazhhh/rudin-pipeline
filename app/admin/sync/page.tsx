"use client";

import { useEffect, useRef, useState } from "react";
import SmartUpload from "@/app/admin/components/SmartUpload";

const RESOURCES: { key: string; label: string; urlField: string }[] = [
  { key: "projects", label: "Pipeline Projects", urlField: "projectsSheetUrl" },
  { key: "comp-buildings", label: "Comp Buildings", urlField: "compBuildingsSheetUrl" },
  { key: "comp-building-stats", label: "Comp Building Stats", urlField: "compBuildingStatsSheetUrl" },
  {
    key: "comp-building-quarter-stats",
    label: "Comp Building Stats — By Quarter",
    urlField: "compBuildingQuarterStatsSheetUrl",
  },
  { key: "overall-stats", label: "Overall Unit Stats", urlField: "overallStatsSheetUrl" },
  { key: "type-stats", label: "Type × Unit Stats", urlField: "typeStatsSheetUrl" },
  { key: "trend", label: "Rent Trend", urlField: "trendSheetUrl" },
  ];

type Config = Record<string, string | null>;

export default function SyncSettingsPage() {
  const [config, setConfig] = useState<Config>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

useEffect(() => {
  fetch("/api/sync-config")
  .then((r) => r.json())
  .then((data) => {
    setConfig(data);
    setLastSyncedAt(data.lastSyncedAt ?? null);
    setLoading(false);
  });
}, []);

async function saveUrls() {
  setSaving(true);
  const res = await fetch("/api/sync-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  setSaving(false);
  if (res.ok) {
    const data = await res.json();
    setConfig(data);
  } else {
    alert("Failed to save URLs — check they're valid https:// links.");
  }
}

async function syncNow(resourceKey: string) {
  setSyncing(resourceKey);
  setResults((r) => ({ ...r, [resourceKey]: "" }));
  const res = await fetch(`/api/sync/${resourceKey}`, { method: "POST" });
  const body = await res.json();
  setSyncing(null);
  setResults((r) => ({
    ...r,
    [resourceKey]: res.ok ? `Imported ${body.rowsImported} rows.` : `Error: ${body.error}`,
  }));
  if (res.ok) setLastSyncedAt(new Date().toISOString());
}

async function uploadFile(resourceKey: string, file: File) {
  setSyncing(resourceKey);
  setResults((r) => ({ ...r, [resourceKey]: "" }));
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/sync-upload/${resourceKey}`, { method: "POST", body: formData });
  const body = await res.json();
  setSyncing(null);
  setResults((r) => ({
    ...r,
    [resourceKey]: res.ok ? `Imported ${body.rowsImported} rows from ${file.name}.` : `Error: ${body.error}`,
  }));
  if (res.ok) setLastSyncedAt(new Date().toISOString());
}

if (loading) return <p>Loading…</p>;
  
  return (
    <div>
    <h1>Sheet Sync &amp; Settings</h1>
    <p className="admin-sub">
    Two ways to sync each table. <strong>Upload a file</strong> — pick a CSV or .xlsx exported from Excel/
    SharePoint/OneDrive and it&apos;s parsed right here, nothing needs to be public. Or <strong>paste a
    published CSV link</strong> if you&apos;re using Google Sheets (File → Share → Publish to web → select
    the tab → CSV) — that route does require the link to be fetchable without login, so it&apos;s not a good
    fit for internal SharePoint files. Either way, syncing fully replaces that table&apos;s data with what&apos;s
    in the file/sheet — any admin-panel edits made since the last sync will be overwritten.
      {lastSyncedAt && <> Last synced {new Date(lastSyncedAt).toLocaleString()}.</>}
    </p>
    
    <SmartUpload />
    
      {RESOURCES.map((r) => (
      <div className="admin-field-block" key={r.key}>
      <label>{r.label}</label>
      
      <input
        ref={(el) => {
          fileInputs.current[r.key] = el;
        }}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadFile(r.key, file);
          e.target.value = "";
        }}
        />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <button
        className="admin-btn"
        type="button"
        disabled={syncing === r.key}
        onClick={() => fileInputs.current[r.key]?.click()}
        >
        {syncing === r.key ? "Uploading…" : "Upload file (CSV or .xlsx)"}
      </button>
      <a className="admin-btn secondary" href={`/api/csv-template/${r.key}`} download>
      Download current data as CSV
      </a>
      </div>
      
      <label htmlFor={r.key} style={{ fontWeight: "normal", fontSize: "0.9em" }}>
      — or — published CSV URL (Google Sheets only)
      </label>
      <input
        id={r.key}
        type="url"
        placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?gid=0&single=true&output=csv"
        value={config[r.urlField] ?? ""}
        onChange={(e) => setConfig((c) => ({ ...c, [r.urlField]: e.target.value }))}
        />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button className="admin-btn" type="button" disabled={syncing === r.key} onClick={() => syncNow(r.key)}>
        {syncing === r.key ? "Syncing…" : "Sync now from URL"}
      </button>
        {results[r.key] && (
        <span className={results[r.key].startsWith("Error") ? "admin-error" : "admin-badge"}>
          {results[r.key]}
        </span>
        )}
      </div>
      </div>
      ))}
    
    <button className="admin-btn" type="button" onClick={saveUrls} disabled={saving}>
      {saving ? "Saving…" : "Save all URLs"}
    </button>
    </div>
    );
}
