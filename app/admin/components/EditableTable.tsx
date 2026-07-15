"use client";

import { useEffect, useRef, useState } from "react";

export type ColumnType = "text" | "number" | "boolean" | "select" | "json";

export type Row = Record<string, unknown>;

export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  options?: { value: string; label: string }[];
  width?: string;
  placeholder?: string;
}

export interface EditableTableProps {
  columns: Column[];
  apiBase: string;
  initialRows: Row[];
  emptyRow: Row;
  idKey?: string;
  resource?: string; // resource key for snapshot history (e.g. "trend")
}

type SnapshotMeta = { id: string; label: string; createdAt: string };
type SnapshotWithData = SnapshotMeta & { data: Row[] };

type CellRef = { rowIdx: number; colIdx: number };

export default function EditableTable({ columns, apiBase, initialRows, emptyRow, idKey = "id", resource }: EditableTableProps) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [editCell, setEditCell] = useState<CellRef | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null);

  // History panel
  const [historyOpen, setHistoryOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [previewSnap, setPreviewSnap] = useState<SnapshotWithData | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  // Keep refs in sync so callbacks always see latest values without stale closures
  const rowsRef = useRef(rows);
  const dirtyRef = useRef(dirty);
  rowsRef.current = rows;
  dirtyRef.current = dirty;

  function rowKey(row: Row, idx: number): string {
    const id = row[idKey];
    return typeof id === "string" && id ? id : `new-${idx}`;
  }

  function markDirty(idx: number) {
    // Use rowsRef so we always get the stable id (or new-N) regardless of render timing
    const key = rowKey(rowsRef.current[idx], idx);
    setDirty((prev) => {
      if (prev.has(key)) return prev;
      return new Set(prev).add(key);
    });
  }

  function updateCell(idx: number, key: string, value: unknown) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
    markDirty(idx);
  }

  function enterCell(rowIdx: number, colIdx: number) {
    if (!columns[colIdx]) return;
    setEditCell({ rowIdx, colIdx });
  }

  function exitCell() {
    setEditCell(null);
  }

  function moveTo(rowIdx: number, colIdx: number) {
    const r = Math.max(0, Math.min(rowsRef.current.length - 1, rowIdx));
    const c = Math.max(0, Math.min(columns.length - 1, colIdx));
    setEditCell({ rowIdx: r, colIdx: c });
  }

  useEffect(() => {
    if (!editCell) return;
    const t = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        if (inputRef.current instanceof HTMLInputElement) {
          inputRef.current.select();
        }
      }
    }, 0);
    return () => clearTimeout(t);
  }, [editCell]);

  // Ctrl+S saves all dirty rows
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveAllDirty();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function handleKeyDown(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    const col = columns[colIdx];
    if (e.key === "Escape") { e.preventDefault(); exitCell(); return; }
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        if (colIdx > 0) moveTo(rowIdx, colIdx - 1);
        else if (rowIdx > 0) moveTo(rowIdx - 1, columns.length - 1);
      } else {
        if (colIdx < columns.length - 1) moveTo(rowIdx, colIdx + 1);
        else moveTo(rowIdx + 1, 0);
      }
      return;
    }
    if (e.key === "Enter" && col.type !== "json") { e.preventDefault(); moveTo(rowIdx + 1, colIdx); return; }
    if (col.type === "text" || col.type === "number") {
      if (e.key === "ArrowDown") { e.preventDefault(); moveTo(rowIdx + 1, colIdx); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveTo(rowIdx - 1, colIdx); }
    }
  }

  // Parse Excel/Sheets TSV paste and flood-fill from active cell
  function handlePaste(e: React.ClipboardEvent, startRow: number, startCol: number) {
    const text = e.clipboardData.getData("text/plain");
    const lines = text.split(/\r?\n/).filter((l) => l !== "");
    const grid = lines.map((l) => l.split("\t"));
    if (grid.length === 1 && grid[0].length === 1) return; // single cell — let browser handle normally
    e.preventDefault();

    const keysToMarkDirty: string[] = [];

    setRows((prev) => {
      const next = [...prev];
      for (let ri = 0; ri < grid.length; ri++) {
        const targetRow = startRow + ri;
        while (next.length <= targetRow) next.push({ ...emptyRow });
        const rowCopy = { ...next[targetRow] };
        for (let ci = 0; ci < grid[ri].length; ci++) {
          const colIdx = startCol + ci;
          if (colIdx >= columns.length) break;
          const col = columns[colIdx];
          const raw = grid[ri][ci].trim();
          let coerced: unknown = raw;
          if (col.type === "number") coerced = raw === "" ? null : Number(raw.replace(/,/g, ""));
          else if (col.type === "boolean") coerced = /^(true|1|yes)$/i.test(raw);
          rowCopy[col.key] = coerced;
        }
        next[targetRow] = rowCopy;
        // Collect key using the id already present in next[targetRow]
        const id = next[targetRow][idKey];
        keysToMarkDirty.push(typeof id === "string" && id ? id : `new-${targetRow}`);
      }
      return next;
    });

    // Update dirty AFTER setRows so it's a separate state update (not inside an updater)
    setDirty((prev) => {
      const n = new Set(prev);
      keysToMarkDirty.forEach((k) => n.add(k));
      return n;
    });

    const lastRow = startRow + grid.length - 1;
    const lastCol = Math.min(startCol + (grid[0]?.length ?? 1) - 1, columns.length - 1);
    setEditCell({ rowIdx: lastRow, colIdx: lastCol });
  }

  async function saveRow(idx: number, currentRows: Row[]): Promise<boolean> {
    const row = currentRows[idx];
    if (!row) return false;
    const key = rowKey(row, idx);
    setSavingKeys((s) => new Set(s).add(key));
    setErrors((e) => ({ ...e, [key]: "" }));

    const payload: Row = {};
    for (const col of columns) {
      let v = row[col.key];
      if (col.type === "json" && typeof v === "string") {
        try { v = v.trim() ? JSON.parse(v) : null; }
        catch {
          setErrors((e) => ({ ...e, [key]: `Invalid JSON in "${col.label}"` }));
          setSavingKeys((s) => { const n = new Set(s); n.delete(key); return n; });
          return false;
        }
      }
      payload[col.key] = v;
    }

    const existingId = row[idKey];
    const isNew = !(typeof existingId === "string" && existingId);
    const url = isNew ? apiBase : `${apiBase}/${existingId}`;
    const method = isNew ? "POST" : "PUT";

    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setSavingKeys((s) => { const n = new Set(s); n.delete(key); return n; });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = typeof body.error === "string" ? body.error
        : (body.error?.formErrors?.[0] ?? body.error?.fieldErrors ? "Validation error — check field values" : "Save failed");
      setErrors((e) => ({ ...e, [key]: msg }));
      return false;
    }

    const saved = (await res.json()) as Row;
    setRows((prev) => { const next = [...prev]; next[idx] = saved; return next; });
    setDirty((prev) => { const n = new Set(prev); n.delete(key); return n; });
    return true;
  }

  async function saveAllDirty() {
    const snapshot = rowsRef.current;
    const currentDirty = dirtyRef.current;
    const idxs = snapshot
      .map((row, idx) => ({ idx, key: rowKey(row, idx), isNew: !(typeof row[idKey] === "string" && row[idKey]) }))
      .filter(({ key, isNew }) => isNew || currentDirty.has(key))
      .map(({ idx }) => idx);
    if (idxs.length === 0) return;

    // Snapshot current DB state before saving so the edit can be undone
    if (resource && idxs.length > 0) {
      const existingCount = snapshot.filter((r) => typeof r[idKey] === "string" && r[idKey]).length;
      if (existingCount > 0) {
        fetch("/api/snapshots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resource,
            label: `Before manual edit — ${idxs.length} row${idxs.length !== 1 ? "s" : ""} changed`,
            data: snapshot.filter((r) => typeof r[idKey] === "string" && r[idKey]),
          }),
        }).catch(() => {});
      }
    }

    setBulkSaving(true);
    await Promise.all(idxs.map((i) => saveRow(i, snapshot)));
    setBulkSaving(false);
  }

  async function loadHistory() {
    if (!resource) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/snapshots?resource=${encodeURIComponent(resource)}`);
      if (res.ok) setSnapshots(await res.json());
    } finally { setLoadingHistory(false); }
  }

  async function openHistory() {
    setHistoryOpen(true);
    setPreviewSnap(null);
    await loadHistory();
  }

  async function previewSnapshot(id: string) {
    const res = await fetch(`/api/snapshots/${id}`);
    if (res.ok) setPreviewSnap(await res.json());
  }

  async function restoreSnapshot(id: string) {
    if (!confirm("Restore this snapshot? Current data will be replaced. (A backup of current state will be saved first.)")) return;
    setRestoring(id);
    try {
      const res = await fetch(`/api/snapshots/${id}`, { method: "POST" });
      if (res.ok) {
        // Reload the page so the table reflects restored data
        window.location.reload();
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Restore failed: ${body.error ?? "Unknown error"}`);
      }
    } finally { setRestoring(null); }
  }

  async function deleteSnapshot(id: string) {
    if (!confirm("Delete this version history entry?")) return;
    await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
    if (previewSnap?.id === id) setPreviewSnap(null);
  }

  async function deleteRow(idx: number) {
    const row = rows[idx];
    const existingId = row[idKey];
    if (!(typeof existingId === "string" && existingId)) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      return;
    }
    if (!confirm("Delete this row? This can't be undone.")) return;
    const res = await fetch(`${apiBase}/${existingId}`, { method: "DELETE" });
    if (res.ok) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      setSelected((prev) => { const n = new Set(prev); n.delete(String(existingId)); return n; });
    } else {
      alert("Delete failed.");
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} selected row(s)? This can't be undone.`)) return;
    setBulkDeleting(true);
    const ids = [...selected].filter((k) => !k.startsWith("new-"));
    const results = await Promise.all(ids.map((id) => fetch(`${apiBase}/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => !r.ok).length;
    setRows((prev) => prev.filter((row, idx) => !selected.has(rowKey(row, idx))));
    setSelected(new Set());
    setBulkDeleting(false);
    if (failed > 0) alert(`${failed} row(s) could not be deleted.`);
  }

  const allKeys = rows.map(rowKey);
  const dirtyCount = rows.filter((row, idx) => {
    const key = rowKey(row, idx);
    return dirty.has(key) || !(typeof row[idKey] === "string" && row[idKey]);
  }).length;

  function toggleRow(key: string, shiftKey: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (shiftKey && lastChecked && lastChecked !== key) {
        const from = allKeys.indexOf(lastChecked);
        const to = allKeys.indexOf(key);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          const adding = !n.has(key);
          for (let i = lo; i <= hi; i++) adding ? n.add(allKeys[i]) : n.delete(allKeys[i]);
          return n;
        }
      }
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
    setLastChecked(key);
  }

  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));
  const someSelected = !allSelected && allKeys.some((k) => selected.has(k));
  function toggleAll() { allSelected ? setSelected(new Set()) : setSelected(new Set(allKeys)); }
  function addRow() { setRows((prev) => [...prev, { ...emptyRow }]); }

  function displayValue(col: Column, row: Row): string {
    const v = row[col.key];
    if (v === null || v === undefined || v === "") return "";
    if (col.type === "boolean") return v ? "✓" : "";
    if (col.type === "json") return typeof v === "string" ? v : JSON.stringify(v);
    if (col.type === "select") return col.options?.find((o) => o.value === v)?.label ?? String(v);
    return String(v);
  }

  return (
    <div>
      <div className="admin-toolbar">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="admin-btn secondary" onClick={addRow} type="button">+ Add row</button>
          {dirtyCount > 0 && (
            <button
              className="admin-btn"
              onMouseDown={(e) => e.preventDefault()} // prevent blur stealing focus from active cell
              onClick={saveAllDirty}
              disabled={bulkSaving}
              type="button"
              title="Ctrl+S"
            >
              {bulkSaving ? "Saving…" : `Save ${dirtyCount} row${dirtyCount !== 1 ? "s" : ""}`}
            </button>
          )}
          {selected.size > 0 && (
            <button className="admin-btn danger" onClick={deleteSelected} disabled={bulkDeleting} type="button">
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size} selected`}
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {resource && (
            <button className="admin-btn secondary" onClick={openHistory} type="button" title="View version history">
              ↩ History
            </button>
          )}
          <span className="admin-badge">{rows.length} rows</span>
        </div>
      </div>

      {/* ── History panel ── */}
      {historyOpen && resource && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          display: "flex", alignItems: "stretch", justifyContent: "flex-end",
        }}>
          {/* Backdrop */}
          <div
            style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.25)" }}
            onClick={() => { setHistoryOpen(false); setPreviewSnap(null); }}
          />
          {/* Panel */}
          <div style={{
            position: "relative", zIndex: 1, width: previewSnap ? 780 : 400, maxWidth: "95vw",
            background: "var(--surface)", borderLeft: "1px solid var(--border)",
            display: "flex", flexDirection: "column", overflow: "hidden",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
          }}>
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontWeight: 700, fontSize: "1rem", flex: 1 }}>Version History</span>
              {previewSnap && (
                <button
                  onClick={() => setPreviewSnap(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: "0.85rem" }}
                >← Back</button>
              )}
              <button
                onClick={() => { setHistoryOpen(false); setPreviewSnap(null); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--ink-faint)", lineHeight: 1 }}
              >×</button>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 0" }}>
              {loadingHistory ? (
                <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink-faint)" }}>Loading…</div>
              ) : previewSnap ? (
                // Preview mode: show rows
                <div style={{ padding: "0 16px" }}>
                  <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.92rem" }}>{previewSnap.label}</span>
                    <span style={{ color: "var(--ink-faint)", fontSize: "0.8rem" }}>
                      {new Date(previewSnap.createdAt).toLocaleString()} — {previewSnap.data.length} rows
                    </span>
                  </div>
                  <div style={{ overflowX: "auto", fontSize: "0.78rem", marginBottom: 16 }}>
                    <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 400 }}>
                      <thead>
                        <tr>
                          {columns.map((c) => (
                            <th key={c.key} style={{ padding: "4px 8px", background: "var(--surface-alt, #f8fafc)", borderBottom: "1px solid var(--border)", textAlign: "left", whiteSpace: "nowrap" }}>
                              {c.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewSnap.data.slice(0, 50).map((row, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                            {columns.map((c) => (
                              <td key={c.key} style={{ padding: "3px 8px", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>
                                {row[c.key] != null ? String(row[c.key]) : ""}
                              </td>
                            ))}
                          </tr>
                        ))}
                        {previewSnap.data.length > 50 && (
                          <tr><td colSpan={columns.length} style={{ padding: "4px 8px", color: "var(--ink-faint)", fontSize: "0.78rem" }}>
                            … and {previewSnap.data.length - 50} more rows
                          </td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onClick={() => restoreSnapshot(previewSnap.id)}
                    disabled={restoring === previewSnap.id}
                    style={{
                      padding: "8px 18px", background: restoring === previewSnap.id ? "#94a3b8" : "#16a34a",
                      color: "#fff", border: "none", borderRadius: 6,
                      cursor: restoring === previewSnap.id ? "not-allowed" : "pointer", fontWeight: 600,
                    }}
                  >
                    {restoring === previewSnap.id ? "Restoring…" : "Restore this version"}
                  </button>
                </div>
              ) : snapshots.length === 0 ? (
                <div style={{ padding: "2rem 20px", color: "var(--ink-faint)", fontSize: "0.88rem" }}>
                  No saved versions yet. Versions are created automatically before imports and bulk saves.
                </div>
              ) : (
                // List mode
                snapshots.map((snap) => (
                  <div key={snap.id} style={{
                    padding: "10px 20px", borderBottom: "1px solid var(--border)",
                    display: "flex", alignItems: "flex-start", gap: 10,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.88rem", fontWeight: 500, marginBottom: 2, lineHeight: 1.3 }}>
                        {snap.label}
                      </div>
                      <div style={{ fontSize: "0.78rem", color: "var(--ink-faint)" }}>
                        {new Date(snap.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => previewSnapshot(snap.id)}
                        style={{ padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 5, background: "none", cursor: "pointer", fontSize: "0.8rem" }}
                      >Preview</button>
                      <button
                        onClick={() => restoreSnapshot(snap.id)}
                        disabled={restoring === snap.id}
                        style={{ padding: "4px 10px", border: "none", borderRadius: 5, background: "#16a34a", color: "#fff", cursor: restoring === snap.id ? "not-allowed" : "pointer", fontSize: "0.8rem", fontWeight: 600 }}
                      >{restoring === snap.id ? "…" : "Restore"}</button>
                      <button
                        onClick={() => deleteSnapshot(snap.id)}
                        style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 5, background: "none", cursor: "pointer", fontSize: "0.8rem", color: "var(--ink-faint)" }}
                        title="Delete this history entry"
                      >×</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table ss-table">
          <thead>
            <tr>
              <th style={{ width: "32px", textAlign: "center" }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={toggleAll}
                  title="Select all"
                />
              </th>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }}>{c.label}</th>
              ))}
              <th style={{ width: "28px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => {
              const key = rowKey(row, rowIdx);
              const isDirty = dirty.has(key) || !(typeof row[idKey] === "string" && row[idKey]);
              const isSaving = savingKeys.has(key);
              const rowErr = errors[key];
              const isSelected = selected.has(key);
              return (
                <>
                  <tr
                    key={key}
                    className={[isDirty ? "dirty" : "", isSelected ? "selected" : ""].filter(Boolean).join(" ")}
                  >
                    <td style={{ textAlign: "center", padding: "0 4px" }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={(e) => toggleRow(key, e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey)}
                      />
                    </td>
                    {columns.map((col, colIdx) => {
                      const isActive = editCell?.rowIdx === rowIdx && editCell?.colIdx === colIdx;
                      return (
                        <td
                          key={col.key}
                          className={isActive ? "ss-cell active" : "ss-cell"}
                          onClick={() => !isActive && enterCell(rowIdx, colIdx)}
                          style={{ opacity: isSaving ? 0.5 : 1 }}
                        >
                          {isActive ? (
                            <ActiveCell
                              col={col}
                              row={row}
                              rowIdx={rowIdx}
                              colIdx={colIdx}
                              inputRef={inputRef}
                              onUpdate={updateCell}
                              onKeyDown={handleKeyDown}
                              onBlur={exitCell}
                              onPaste={handlePaste}
                            />
                          ) : (
                            <span className={`ss-display${col.type === "boolean" ? " ss-bool" : ""}`}>
                              {displayValue(col, row)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td style={{ padding: "0 4px", textAlign: "center" }}>
                      {isSaving ? (
                        <span style={{ fontSize: 11, color: "var(--ink-faint)" }}>…</span>
                      ) : (
                        <button className="ss-del-btn" title="Delete row" onClick={() => deleteRow(rowIdx)} type="button">×</button>
                      )}
                    </td>
                  </tr>
                  {rowErr && (
                    <tr key={`${key}-err`} className="ss-err-row">
                      <td />
                      <td colSpan={columns.length + 1} className="ss-err-cell">{rowErr}</td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ActiveCellProps {
  col: Column;
  row: Row;
  rowIdx: number;
  colIdx: number;
  inputRef: React.MutableRefObject<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>;
  onUpdate: (idx: number, key: string, value: unknown) => void;
  onKeyDown: (e: React.KeyboardEvent, rowIdx: number, colIdx: number) => void;
  onBlur: () => void;
  onPaste: (e: React.ClipboardEvent, rowIdx: number, colIdx: number) => void;
}

function ActiveCell({ col, row, rowIdx, colIdx, inputRef, onUpdate, onKeyDown, onBlur, onPaste }: ActiveCellProps) {
  const value = row[col.key];
  const shared = {
    onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, rowIdx, colIdx),
    onPaste: (e: React.ClipboardEvent) => onPaste(e, rowIdx, colIdx),
    onBlur,
    className: "ss-input",
  };

  if (col.type === "boolean") {
    return (
      <input
        ref={inputRef as React.MutableRefObject<HTMLInputElement>}
        type="checkbox"
        checked={!!value}
        onChange={(e) => onUpdate(rowIdx, col.key, e.target.checked)}
        {...shared}
      />
    );
  }

  if (col.type === "select") {
    return (
      <select
        ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onUpdate(rowIdx, col.key, e.target.value)}
        {...shared}
      >
        <option value="">—</option>
        {col.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }

  if (col.type === "json") {
    const text = typeof value === "string" ? value : value != null ? JSON.stringify(value, null, 2) : "";
    return (
      <textarea
        ref={inputRef as React.MutableRefObject<HTMLTextAreaElement>}
        value={text}
        onChange={(e) => onUpdate(rowIdx, col.key, e.target.value)}
        placeholder={col.placeholder}
        rows={3}
        {...shared}
        className="ss-input ss-textarea"
      />
    );
  }

  if (col.type === "number") {
    return (
      <input
        ref={inputRef as React.MutableRefObject<HTMLInputElement>}
        type="number"
        value={value === null || value === undefined ? "" : String(value)}
        onChange={(e) => onUpdate(rowIdx, col.key, e.target.value === "" ? null : Number(e.target.value))}
        step="any"
        {...shared}
      />
    );
  }

  return (
    <input
      ref={inputRef as React.MutableRefObject<HTMLInputElement>}
      type="text"
      value={typeof value === "string" ? value : value == null ? "" : String(value)}
      onChange={(e) => onUpdate(rowIdx, col.key, e.target.value)}
      placeholder={col.placeholder}
      {...shared}
    />
  );
}
