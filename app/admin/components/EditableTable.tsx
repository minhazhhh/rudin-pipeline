"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  apiBase: string;
  initialRows: Row[];
  emptyRow: Row;
  idKey?: string;
}

type CellRef = { rowIdx: number; colIdx: number };

export default function EditableTable({ columns, apiBase, initialRows, emptyRow, idKey = "id" }: EditableTableProps) {
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
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

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
    setDirty((prev) => new Set(prev).add(rowKey(rowsRef.current[idx], idx)));
  }

  function enterCell(rowIdx: number, colIdx: number) {
    const col = columns[colIdx];
    if (!col) return;
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

  // Parse Excel/Sheets clipboard (TSV) and flood-fill the grid from the active cell.
  // Adds blank rows at the bottom if the paste extends past the current row count.
  function handlePaste(e: React.ClipboardEvent, startRow: number, startCol: number) {
    const text = e.clipboardData.getData("text/plain");
    // Only intercept multi-cell pastes (contains tab or newline beyond a single cell)
    const lines = text.split(/\r?\n/).filter((l) => l !== "");
    const cells = lines.map((l) => l.split("\t"));
    if (cells.length === 1 && cells[0].length === 1) return; // single cell — let browser handle

    e.preventDefault();

    setRows((prev) => {
      const next = [...prev];
      const newDirtyKeys: string[] = [];

      for (let ri = 0; ri < cells.length; ri++) {
        const targetRow = startRow + ri;
        // Append new empty rows as needed
        while (next.length <= targetRow) next.push({ ...emptyRow });

        const rowCopy = { ...next[targetRow] };
        for (let ci = 0; ci < cells[ri].length; ci++) {
          const colIdx = startCol + ci;
          if (colIdx >= columns.length) break;
          const col = columns[colIdx];
          const raw = cells[ri][ci].trim();
          let coerced: unknown = raw;
          if (col.type === "number") coerced = raw === "" ? null : Number(raw.replace(/,/g, ""));
          else if (col.type === "boolean") coerced = raw.toLowerCase() === "true" || raw === "1" || raw.toLowerCase() === "yes";
          rowCopy[col.key] = coerced;
        }
        next[targetRow] = rowCopy;
        // Compute key from the original row (before edits) so new rows get new-N keys
        const key = (() => {
          const id = next[targetRow][idKey];
          return typeof id === "string" && id ? id : `new-${targetRow}`;
        })();
        newDirtyKeys.push(key);
      }

      // Update dirty set outside via a queued state update
      setDirty((prev) => {
        const n = new Set(prev);
        newDirtyKeys.forEach((k) => n.add(k));
        return n;
      });

      return next;
    });

    // Move focus to last pasted cell
    const lastRow = Math.min(startRow + cells.length - 1, startRow + cells.length - 1);
    const lastCol = Math.min(startCol + (cells[0]?.length ?? 1) - 1, columns.length - 1);
    setEditCell({ rowIdx: lastRow, colIdx: lastCol });
  }

  // Focus the active input whenever editCell changes
  useEffect(() => {
    if (!editCell) return;
    const t = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        if ("select" in inputRef.current && typeof inputRef.current.select === "function") {
          (inputRef.current as HTMLInputElement).select();
        }
      }
    }, 0);
    return () => clearTimeout(t);
  }, [editCell]);

  function handleKeyDown(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    const col = columns[colIdx];
    if (e.key === "Escape") {
      e.preventDefault();
      exitCell();
      return;
    }
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
    if (e.key === "Enter" && col.type !== "json") {
      e.preventDefault();
      moveTo(rowIdx + 1, colIdx);
      return;
    }
    if (col.type !== "text" && col.type !== "number" && col.type !== "json") return;
    if (e.key === "ArrowDown" && col.type !== "json") {
      e.preventDefault();
      moveTo(rowIdx + 1, colIdx);
    } else if (e.key === "ArrowUp" && col.type !== "json") {
      e.preventDefault();
      moveTo(rowIdx - 1, colIdx);
    }
  }

  async function saveRow(idx: number): Promise<boolean> {
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
      setErrors((e) => ({ ...e, [key]: typeof body.error === "string" ? body.error : "Save failed." }));
      return false;
    }

    const saved = (await res.json()) as Row;
    setRows((prev) => { const next = [...prev]; next[idx] = saved; return next; });
    setDirty((prev) => { const n = new Set(prev); n.delete(key); return n; });
    return true;
  }

  async function saveAllDirty() {
    setBulkSaving(true);
    const idxs = rows.map((row, idx) => ({ row, idx, key: rowKey(row, idx) }))
      .filter(({ key, row }) => dirty.has(key) || !(typeof row[idKey] === "string" && row[idKey]))
      .map(({ idx }) => idx);
    await Promise.all(idxs.map((i) => saveRow(i)));
    setBulkSaving(false);
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

  const allKeys = rows.map((row, idx) => rowKey(row, idx));
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

  function addRow() {
    setRows((prev) => [...prev, { ...emptyRow }]);
  }

  function displayValue(col: Column, row: Row): string {
    const v = row[col.key];
    if (v === null || v === undefined || v === "") return "";
    if (col.type === "boolean") return v ? "✓" : "";
    if (col.type === "json") return typeof v === "string" ? v : JSON.stringify(v);
    if (col.type === "select") {
      const opt = col.options?.find((o) => o.value === v);
      return opt ? opt.label : String(v);
    }
    return String(v);
  }

  return (
    <div>
      <div className="admin-toolbar">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="admin-btn secondary" onClick={addRow} type="button">+ Add row</button>
          {dirtyCount > 0 && (
            <button className="admin-btn" onClick={saveAllDirty} disabled={bulkSaving} type="button">
              {bulkSaving ? "Saving…" : `Save ${dirtyCount} row${dirtyCount !== 1 ? "s" : ""}`}
            </button>
          )}
          {selected.size > 0 && (
            <button className="admin-btn danger" onClick={deleteSelected} disabled={bulkDeleting} type="button">
              {bulkDeleting ? "Deleting…" : `Delete ${selected.size} selected`}
            </button>
          )}
        </div>
        <span className="admin-badge">{rows.length} rows</span>
      </div>

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
              const isSelected = selected.has(key);
              const rowErr = errors[key];
              return (
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
                    <button
                      className="ss-del-btn"
                      title="Delete row"
                      onClick={() => deleteRow(rowIdx)}
                      type="button"
                    >×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Object.entries(errors).map(([k, msg]) => msg ? (
          <div key={k} className="admin-error" style={{ padding: "4px 8px" }}>{msg}</div>
        ) : null)}
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

  const sharedProps = {
    onKeyDown: (e: React.KeyboardEvent) => onKeyDown(e, rowIdx, colIdx),
    onPaste: (e: React.ClipboardEvent) => onPaste(e, rowIdx, colIdx),
    onBlur,
  };

  if (col.type === "boolean") {
    return (
      <input
        ref={inputRef as React.MutableRefObject<HTMLInputElement>}
        type="checkbox"
        checked={!!value}
        onChange={(e) => onUpdate(rowIdx, col.key, e.target.checked)}
        {...sharedProps}
        className="ss-input"
      />
    );
  }

  if (col.type === "select") {
    return (
      <select
        ref={inputRef as React.MutableRefObject<HTMLSelectElement>}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onUpdate(rowIdx, col.key, e.target.value)}
        {...sharedProps}
        className="ss-input"
      >
        <option value="">—</option>
        {col.options?.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
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
        {...sharedProps}
        className="ss-input ss-textarea"
        rows={3}
      />
    );
  }

  if (col.type === "number") {
    const numVal = value === null || value === undefined ? "" : String(value);
    return (
      <input
        ref={inputRef as React.MutableRefObject<HTMLInputElement>}
        type="number"
        value={numVal}
        onChange={(e) => onUpdate(rowIdx, col.key, e.target.value === "" ? null : Number(e.target.value))}
        step="any"
        {...sharedProps}
        className="ss-input"
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
      {...sharedProps}
      className="ss-input"
    />
  );
}
