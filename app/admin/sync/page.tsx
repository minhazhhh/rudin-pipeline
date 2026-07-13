"use client";

import { useEffect, useState } from "react";
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

if (loading) return <p>Loading…</p>;
  
  return (
    <div>
    <h1>Sheet Sync &amp; Settings</h1>
    <p className="admin-sub">
    Drop any file below and it&apos;s parsed right here — nothing needs to be public. For a table that
    updates on its own, publish a Google Sheet tab to the web as CSV (File → Share → Publish to web →
    select the tab → CSV) and paste the link into the matching field below — that route does require the
    link to be fetchable without login, so it&apos;s not a good fit for internal SharePoint files. Either
    way, syncing fully replaces that table&apos;s data with what&apos;s in the file/sheet — any admin-panel
    edits made since the last sync will be overwritten.
      {lastSyncedAt && <> Last synced {new Date(lastSyncedAt).toLocaleString()}.</>}
    </p>
    
    <SmartUpload />
    
      {RESOURCES.map((r) => (
      <div className="admin-field-block" key={r.key}>
      <label>{r.label}</label>
      
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <a className="admin-btn secondary" href={`/api/csv-template/${r.key}`} download>
      Download current data as CSV
      </a>
      </div>
      
      <label htmlFor={r.key} style={{ fontWeight: "normal", fontSize: "0.9em" }}>
      Recurring sync — published CSV URL (Google Sheets only)
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
