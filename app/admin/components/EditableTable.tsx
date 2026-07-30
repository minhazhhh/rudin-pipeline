"use client";

import { useEffect, useState } from "react";

export type ColumnType = "text" | "number" | "boolean" | "select" | "json";

export type Row = Record<string, unknown>;

export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  options?: { value: string; label: string }[]; // for type "select"
  width?: string;
  placeholder?: string;
}

export interface EditableTableProps {
  columns: Column[];
  apiBase: string; // e.g. "/api/projects"
  initialRows: Row[];
  emptyRow: Row; // template used when "Add row" is clicked
  idKey?: string;
  resource?: string; // e.g. "comp-buildings" — enables version history panel
  draftMode?: boolean; // when true, PUT/DELETE on existing rows are staged as drafts
}

type SnapMeta = { id: string; label: string; createdAt: string };

export default function EditableTable({ columns, apiBase, initialRows, emptyRow, idKey = "id", resource, draftMode = false }: EditableTableProps) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  // Draft state — tracks which rows have been staged (not yet live)
  const [stagedKeys, setStagedKeys] = useState<Set<string>>(new Set());
  const [stagedDeletes, setStagedDeletes] = useState<Set<string>>(new Set());

  // ── Version history ────────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<SnapMeta[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!resource || !historyOpen) return;
    fetch(`/api/snapshots?resource=${encodeURIComponent(resource)}`)
      .then((r) => r.json())
      .then((data) => setSnapshots(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [resource, historyOpen]);

  async function restoreSnapshot(id: string) {
    if (!confirm("Restore to this version? Current data will be overwritten (a new snapshot is saved first so you can undo).")) return;
    setRestoring(id); setRestoreMsg(null);
    const res = await fetch(`/api/snapshots/${id}`, { method: "POST" });
    const body = await res.json().catch(() => ({})) as { ok?: boolean; rowsRestored?: number; error?: string };
    setRestoring(null);
    if (res.ok) {
      setRestoreMsg({ ok: true, text: `Restored ${body.rowsRestored ?? "?"} rows. Refresh to see changes.` });
      // Refresh snapshot list
      fetch(`/api/snapshots?resource=${encodeURIComponent(resource!)}`)
        .then((r) => r.json()).then((data) => setSnapshots(Array.isArray(data) ? data : []));
    } else {
      setRestoreMsg({ ok: false, text: body.error ?? "Restore failed." });
    }
  }

  async function deleteSnapshot(id: string) {
    if (!confirm("Delete this snapshot?")) return;
    await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
  }

  function rowKey(row: Row, idx: number): string {
    const id = row[idKey];
    return typeof id === "string" && id ? id : `new-${idx}`;
  }

  function updateCell(idx: number, key: string, value: unknown) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [key]: value };
      return next;
    });
    setDirty((prev) => new Set(prev).add(rowKey(rows[idx], idx)));
  }

  async function saveRow(idx: number) {
    const row = rows[idx];
    const key = rowKey(row, idx);
    setSavingKeys((s) => new Set(s).add(key));
    setErrors((e) => ({ ...e, [key]: "" }));

    const payload: Row = {};
    for (const col of columns) {
      let v = row[col.key];
      if (col.type === "json" && typeof v === "string") {
        try {
          v = v.trim() ? JSON.parse(v) : null;
        } catch {
          setErrors((e) => ({ ...e, [key]: `Invalid JSON in "${col.label}"` }));
          setSavingKeys((s) => {
            const n = new Set(s);
            n.delete(key);
            return n;
          });
          return;
        }
      }
      payload[col.key] = v;
    }

    const existingId = row[idKey];
    const isNew = !(typeof existingId === "string" && existingId);
    const url = isNew ? apiBase : `${apiBase}/${existingId}`;
    const method = isNew ? "POST" : "PUT";

    // Stage as draft when updating an existing row in draft mode
    if (draftMode && !isNew && resource) {
      const label = String(row[columns[0]?.key] ?? existingId);
      const res = await fetch("/api/admin/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, entityId: existingId, method: "PUT", payload, entityLabel: label }),
      });
      setSavingKeys((s) => { const n = new Set(s); n.delete(key); return n; });
      if (!res.ok) {
        setErrors((e) => ({ ...e, [key]: "Failed to stage change." }));
        return;
      }
      setStagedKeys((s) => new Set(s).add(key));
      setDirty((prev) => { const n = new Set(prev); n.delete(key); return n; });
      window.dispatchEvent(new CustomEvent("draft-staged"));
      return;
    }

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    setSavingKeys((s) => {
      const n = new Set(s);
      n.delete(key);
      return n;
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrors((e) => ({ ...e, [key]: typeof body.error === "string" ? body.error : "Save failed. Check field values." }));
      return;
    }

    const saved = (await res.json()) as Row;
    setRows((prev) => {
      const next = [...prev];
      next[idx] = saved;
      return next;
    });
    setDirty((prev) => {
      const n = new Set(prev);
      n.delete(key);
      return n;
    });
  }

  async function deleteRow(idx: number) {
    const row = rows[idx];
    const existingId = row[idKey];
    if (!(typeof existingId === "string" && existingId)) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      return;
    }

    // In draft mode: stage the delete instead of executing immediately
    if (draftMode && resource) {
      if (stagedDeletes.has(existingId)) {
        // Un-stage: remove the draft for this row
        if (!confirm("Cancel the staged deletion for this row?")) return;
        const draftsRes = await fetch("/api/admin/drafts");
        if (draftsRes.ok) {
          const drafts = (await draftsRes.json()) as { id: string; entityId: string; method: string }[];
          const match = drafts.find((d) => d.entityId === existingId && d.method === "DELETE");
          if (match) await fetch(`/api/admin/drafts/${match.id}`, { method: "DELETE" });
        }
        setStagedDeletes((s) => { const n = new Set(s); n.delete(existingId); return n; });
        window.dispatchEvent(new CustomEvent("draft-staged"));
        return;
      }
      if (!confirm("Stage this row for deletion? It won't be removed until you confirm all changes.")) return;
      const label = String(row[columns[0]?.key] ?? existingId);
      const res = await fetch("/api/admin/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, entityId: existingId, method: "DELETE", entityLabel: label }),
      });
      if (res.ok) {
        setStagedDeletes((s) => new Set(s).add(existingId));
        window.dispatchEvent(new CustomEvent("draft-staged"));
      }
      return;
    }

    if (!confirm("Delete this row? This can't be undone.")) return;
    const res = await fetch(`${apiBase}/${existingId}`, { method: "DELETE" });
    if (res.ok) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
      setSelected((prev) => { const n = new Set(prev); n.delete(existingId); return n; });
    } else {
      alert("Delete failed.");
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const ids = [...selected].filter((k) => !k.startsWith("new-"));

    if (draftMode && resource) {
      if (!confirm(`Stage ${ids.length} row(s) for deletion? They won't be removed until you confirm all changes.`)) return;
      setBulkDeleting(true);
      await Promise.all(
        ids.map((id) => {
          const row = rows.find((r, i) => rowKey(r, i) === id);
          const label = row ? String(row[columns[0]?.key] ?? id) : id;
          return fetch("/api/admin/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resource, entityId: id, method: "DELETE", entityLabel: label }),
          });
        })
      );
      setStagedDeletes((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n; });
      setSelected(new Set());
      setBulkDeleting(false);
      window.dispatchEvent(new CustomEvent("draft-staged"));
      return;
    }

    if (!confirm(`Delete ${selected.size} selected row(s)? This can't be undone.`)) return;
    setBulkDeleting(true);
    const results = await Promise.all(ids.map((id) => fetch(`${apiBase}/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => !r.ok).length;
    setRows((prev) => prev.filter((row, idx) => !selected.has(rowKey(row, idx))));
    setSelected(new Set());
    setBulkDeleting(false);
    if (failed > 0) alert(`${failed} row(s) could not be deleted.`);
  }

  const allKeys = rows.map((row, idx) => rowKey(row, idx));

  function toggleRow(key: string, shiftKey: boolean) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (shiftKey && lastChecked && lastChecked !== key) {
        const from = allKeys.indexOf(lastChecked);
        const to = allKeys.indexOf(key);
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from < to ? [from, to] : [to, from];
          const adding = !n.has(key);
          for (let i = lo; i <= hi; i++) {
            adding ? n.add(allKeys[i]) : n.delete(allKeys[i]);
          }
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

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allKeys));
    }
  }

  function addRow() {
    setRows((prev) => [...prev, { ...emptyRow }]);
  }

  return (
    <div>
      <div className="admin-toolbar">
        <button className="admin-btn secondary" onClick={addRow} type="button">
          + Add row
        </button>
        {selected.size > 0 && (
          <button className="admin-btn danger" onClick={deleteSelected} disabled={bulkDeleting} type="button">
            {bulkDeleting ? "Deleting…" : `Delete ${selected.size} selected`}
          </button>
        )}
        <span className="admin-badge">{rows.length} rows</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
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
                <th key={c.key} style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              {/* No width set here on purpose: the data columns above are sized in
                  percentages that sum to ~92%, so this trailing actions column
                  automatically fills the remaining ~8% — keeping Save/Delete
                  flush against the table's right edge with no horizontal overflow. */}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const key = rowKey(row, idx);
              const existingId = typeof row[idKey] === "string" ? (row[idKey] as string) : "";
              const isDirty = dirty.has(key) || !existingId;
              const isSelected = selected.has(key);
              const isStaged = stagedKeys.has(key);
              const isStagedDelete = existingId ? stagedDeletes.has(existingId) : false;
              const rowClass = [isDirty && !isStaged ? "dirty" : "", isSelected ? "selected" : "", isStaged ? "staged" : "", isStagedDelete ? "staged-delete" : ""].filter(Boolean).join(" ");
              return (
                <tr key={key} className={rowClass}>
                  <td style={{ textAlign: "center" }}>
                    <input type="checkbox" checked={isSelected} onChange={(e) => toggleRow(key, e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey)} />
                  </td>
                  {columns.map((col) => (
                    <td key={col.key} style={isStagedDelete ? { textDecoration: "line-through", opacity: .5 } : undefined}>
                      {renderCell(col, row, idx, updateCell)}
                    </td>
                  ))}
                  <td>
                    <div className="admin-row-actions">
                      <button className="admin-btn" disabled={savingKeys.has(key) || isStagedDelete} onClick={() => saveRow(idx)} type="button" title={isStaged ? "Staged — will apply on Confirm" : undefined} style={isStaged ? { background: "#d97706", borderColor: "#d97706", color: "#fff" } : undefined}>
                        {savingKeys.has(key) ? "Saving…" : isStaged ? "Staged ✓" : "Save"}
                      </button>
                      <button className="admin-btn danger" onClick={() => deleteRow(idx)} type="button" style={isStagedDelete ? { background: "#92400e", borderColor: "#92400e" } : undefined}>
                        {isStagedDelete ? "Undo" : "Delete"}
                      </button>
                    </div>
                    {errors[key] && <div className="admin-error">{errors[key]}</div>}
                    {isStagedDelete && <div style={{ fontSize: 11, color: "#92400e", marginTop: 2 }}>Staged for deletion</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Version history ──────────────────────────────────────────────── */}
      {resource && (
        <div style={{ marginTop: "2rem", borderTop: "1px solid #e2e8f0", paddingTop: "1rem" }}>
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: "0.88rem", color: "#475569", fontWeight: 600 }}
            type="button"
          >
            <span style={{ fontSize: "0.75rem", display: "inline-block", transform: historyOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
            Version history
          </button>

          {historyOpen && (
            <div style={{ marginTop: "0.75rem" }}>
              {restoreMsg && (
                <div style={{ padding: "8px 12px", borderRadius: 6, marginBottom: "0.75rem", fontSize: "0.84rem",
                  background: restoreMsg.ok ? "#f0fdf4" : "#fef2f2",
                  border: `1px solid ${restoreMsg.ok ? "#86efac" : "#fca5a5"}`,
                  color: restoreMsg.ok ? "#15803d" : "#dc2626" }}>
                  {restoreMsg.text}
                </div>
              )}
              {snapshots.length === 0 ? (
                <p style={{ fontSize: "0.84rem", color: "#94a3b8" }}>No snapshots yet — one is saved automatically before each import.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Saved</th>
                      <th style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: "#64748b" }}>Label</th>
                      <th style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: "#64748b" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => (
                      <tr key={s.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "6px 10px", color: "#64748b", whiteSpace: "nowrap" }}>
                          {new Date(s.createdAt).toLocaleString()}
                        </td>
                        <td style={{ padding: "6px 10px" }}>{s.label}</td>
                        <td style={{ padding: "6px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => restoreSnapshot(s.id)}
                            disabled={restoring === s.id}
                            style={{ padding: "3px 10px", fontSize: "0.8rem", background: restoring === s.id ? "#94a3b8" : "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: restoring === s.id ? "not-allowed" : "pointer", marginRight: 6 }}
                            type="button"
                          >
                            {restoring === s.id ? "Restoring…" : "Restore"}
                          </button>
                          <button
                            onClick={() => deleteSnapshot(s.id)}
                            style={{ padding: "3px 8px", fontSize: "0.8rem", background: "none", border: "1px solid #e2e8f0", borderRadius: 4, cursor: "pointer", color: "#94a3b8" }}
                            type="button"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function renderCell(col: Column, row: Row, idx: number, updateCell: (idx: number, key: string, value: unknown) => void) {
  const value = row[col.key];

  if (col.type === "boolean") {
    return <input type="checkbox" checked={!!value} onChange={(e) => updateCell(idx, col.key, e.target.checked)} />;
  }

  if (col.type === "select") {
    return (
      <select value={typeof value === "string" ? value : ""} onChange={(e) => updateCell(idx, col.key, e.target.value)}>
        <option value="">—</option>
        {col.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (col.type === "json") {
    const text = typeof value === "string" ? value : value != null ? JSON.stringify(value) : "";
    return <textarea value={text} onChange={(e) => updateCell(idx, col.key, e.target.value)} placeholder={col.placeholder} />;
  }

  if (col.type === "number") {
    const numVal = value === null || value === undefined ? "" : String(value);
    return (
      <input
        type="number"
        value={numVal}
        onChange={(e) => updateCell(idx, col.key, e.target.value === "" ? null : Number(e.target.value))}
        step="any"
      />
    );
  }

  return (
    <input
      type="text"
      value={typeof value === "string" ? value : value == null ? "" : String(value)}
      onChange={(e) => updateCell(idx, col.key, e.target.value)}
      placeholder={col.placeholder}
    />
  );
}
