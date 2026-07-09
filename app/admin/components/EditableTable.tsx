"use client";

import { useState } from "react";

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
}

export default function EditableTable({ columns, apiBase, initialRows, emptyRow, idKey = "id" }: EditableTableProps) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    if (!confirm("Delete this row? This can't be undone.")) return;
    const res = await fetch(`${apiBase}/${existingId}`, { method: "DELETE" });
    if (res.ok) {
      setRows((prev) => prev.filter((_, i) => i !== idx));
    } else {
      alert("Delete failed.");
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
        <span className="admin-badge">{rows.length} rows</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
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
              const isDirty = dirty.has(key) || !(typeof row[idKey] === "string" && row[idKey]);
              return (
                <tr key={key} className={isDirty ? "dirty" : ""}>
                  {columns.map((col) => (
                    <td key={col.key}>{renderCell(col, row, idx, updateCell)}</td>
                  ))}
                  <td>
                    <div className="admin-row-actions">
                      <button className="admin-btn" disabled={savingKeys.has(key)} onClick={() => saveRow(idx)} type="button">
                        {savingKeys.has(key) ? "Saving…" : "Save"}
                      </button>
                      <button className="admin-btn danger" onClick={() => deleteRow(idx)} type="button">
                        Delete
                      </button>
                    </div>
                    {errors[key] && <div className="admin-error">{errors[key]}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
