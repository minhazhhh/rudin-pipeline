"use client";

import { useState, useMemo, useCallback } from "react";

type Unit = {
  id: string;
  unitName: string | null;
  unitNumber: string | null;
  unitType: string | null;
  floor: number | null;
  sf: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  askingRent: number | null;
  netRent: number | null;
  grossRent: number | null;
  psf: number | null;
  concessions: string | null;
  leaseDate: string | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  leaseTerm: number | null;
  status: string | null;
  notes: string | null;
};

type SortDir = "asc" | "desc";
type Col = keyof Unit;

const COLUMNS: { key: Col; label: string; numeric?: boolean }[] = [
  { key: "unitName", label: "Unit" },
  { key: "unitType", label: "Type" },
  { key: "floor", label: "Floor", numeric: true },
  { key: "sf", label: "SF", numeric: true },
  { key: "bedrooms", label: "BR", numeric: true },
  { key: "bathrooms", label: "BA", numeric: true },
  { key: "askingRent", label: "Asking Rent", numeric: true },
  { key: "netRent", label: "Net Rent", numeric: true },
  { key: "grossRent", label: "Gross Rent", numeric: true },
  { key: "psf", label: "$/SF", numeric: true },
  { key: "concessions", label: "Concessions" },
  { key: "leaseDate", label: "Lease Date" },
  { key: "leaseStartDate", label: "Start Date" },
  { key: "leaseEndDate", label: "End Date" },
  { key: "leaseTerm", label: "Term (mo)", numeric: true },
  { key: "status", label: "Status" },
  { key: "notes", label: "Notes" },
];

const UT_ORDER = ["ST", "ST+HO", "1BD", "1BD+HO", "1BD+2HO", "2BD", "2B+HO", "3BD"];

function fmtRent(n: number | null) {
  if (n == null) return "—";
  return "$" + Math.round(n).toLocaleString();
}
function fmtNum(n: number | null, dec = 0) {
  if (n == null) return "—";
  return dec > 0 ? n.toFixed(dec) : Math.round(n).toLocaleString();
}

function cellValue(unit: Unit, key: Col): string {
  const v = unit[key];
  if (v == null) return "—";
  if (key === "askingRent" || key === "netRent" || key === "grossRent") return fmtRent(v as number);
  if (key === "psf") return "$" + (v as number).toFixed(2);
  if (key === "sf" || key === "floor" || key === "bedrooms" || key === "leaseTerm") return fmtNum(v as number);
  if (key === "bathrooms") return fmtNum(v as number, 1);
  return String(v);
}

function sortVal(unit: Unit, key: Col): string | number {
  const v = unit[key];
  if (v == null) return key === "floor" || typeof v === "number" ? -Infinity : "";
  return v as string | number;
}

export default function BuildingTable({ units, buildingName }: { units: Unit[]; buildingName: string }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sortCol, setSortCol] = useState<Col>("unitName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const unitTypes = useMemo(() => {
    const types = [...new Set(units.map((u) => u.unitType).filter(Boolean) as string[])];
    return types.sort((a, b) => {
      const ai = UT_ORDER.indexOf(a), bi = UT_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [units]);

  const statuses = useMemo(() => {
    return [...new Set(units.map((u) => u.status).filter(Boolean) as string[])].sort();
  }, [units]);

  const handleSort = useCallback((col: Col) => {
    setSortCol((prev) => {
      if (prev === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else setSortDir("asc");
      return col;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return units.filter((u) => {
      if (typeFilter && u.unitType !== typeFilter) return false;
      if (statusFilter && u.status !== statusFilter) return false;
      if (q) {
        return COLUMNS.some((c) => {
          const v = u[c.key];
          return v != null && String(v).toLowerCase().includes(q);
        });
      }
      return true;
    });
  }, [units, search, typeFilter, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = sortVal(a, sortCol), bv = sortVal(b, sortCol);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const summaryByType = useMemo(() => {
    const map: Record<string, { count: number; avgAsk: number | null; avgNet: number | null; avgPsf: number | null; avgSf: number | null }> = {};
    for (const u of units) {
      const t = u.unitType ?? "Unknown";
      if (!map[t]) map[t] = { count: 0, avgAsk: null, avgNet: null, avgPsf: null, avgSf: null };
      map[t].count++;
    }
    // compute averages
    for (const t of Object.keys(map)) {
      const rows = units.filter((u) => (u.unitType ?? "Unknown") === t);
      const asks = rows.map((u) => u.askingRent).filter((v): v is number => v != null);
      const nets = rows.map((u) => u.netRent).filter((v): v is number => v != null);
      const psfs = rows.map((u) => u.psf).filter((v): v is number => v != null);
      const sfs = rows.map((u) => u.sf).filter((v): v is number => v != null);
      map[t].avgAsk = asks.length ? asks.reduce((s, v) => s + v, 0) / asks.length : null;
      map[t].avgNet = nets.length ? nets.reduce((s, v) => s + v, 0) / nets.length : null;
      map[t].avgPsf = psfs.length ? psfs.reduce((s, v) => s + v, 0) / psfs.length : null;
      map[t].avgSf = sfs.length ? sfs.reduce((s, v) => s + v, 0) / sfs.length : null;
    }
    return map;
  }, [units]);

  const summaryTypes = useMemo(() => {
    return Object.keys(summaryByType).sort((a, b) => {
      const ai = UT_ORDER.indexOf(a), bi = UT_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [summaryByType]);

  if (units.length === 0) {
    return (
      <div style={{ padding: "40px 0", textAlign: "center", color: "#6b7b75", fontSize: 14 }}>
        No unit records on file for <strong>{buildingName}</strong> yet.
        <div style={{ fontSize: 12, marginTop: 8, color: "#9aab9a" }}>
          Import unit-level data via the sync page to populate this view.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Summary by unit type */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "#7a9a8a", marginBottom: 10 }}>
          Summary by Unit Type
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "auto" }}>
            <thead>
              <tr style={{ background: "#f4f6f4" }}>
                {["Type", "Units", "Avg Asking", "Avg Net", "Avg $/SF", "Avg SF"].map((h) => (
                  <th key={h} style={{ padding: "7px 14px", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: .5, color: "#5a7a68", borderBottom: "1.5px solid #d4e4d4", textAlign: h === "Type" ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {summaryTypes.map((t) => {
                const s = summaryByType[t];
                return (
                  <tr key={t} style={{ borderBottom: "1px solid #eef2ee" }}>
                    <td style={{ padding: "7px 14px", fontWeight: 700, color: "#1e3a2a" }}>{t}</td>
                    <td style={{ padding: "7px 14px", textAlign: "right", color: "#4a6a58" }}>{s.count}</td>
                    <td style={{ padding: "7px 14px", textAlign: "right", color: "#1e3a2a", fontWeight: 600 }}>{fmtRent(s.avgAsk)}</td>
                    <td style={{ padding: "7px 14px", textAlign: "right", color: "#1e3a2a", fontWeight: 600 }}>{fmtRent(s.avgNet)}</td>
                    <td style={{ padding: "7px 14px", textAlign: "right" }}>{s.avgPsf != null ? "$" + s.avgPsf.toFixed(2) : "—"}</td>
                    <td style={{ padding: "7px 14px", textAlign: "right" }}>{s.avgSf != null ? Math.round(s.avgSf).toLocaleString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search all columns…"
          style={{ padding: "6px 12px", border: "1px solid #ccd8cc", borderRadius: 3, fontSize: 13, color: "#1e3a2a", outline: "none", width: 220, background: "#fff" }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #ccd8cc", borderRadius: 3, fontSize: 13, color: "#1e3a2a", background: "#fff" }}
        >
          <option value="">All unit types</option>
          {unitTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {statuses.length > 0 && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #ccd8cc", borderRadius: 3, fontSize: 13, color: "#1e3a2a", background: "#fff" }}
          >
            <option value="">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span style={{ fontSize: 12, color: "#7a9a8a", marginLeft: 4 }}>
          {sorted.length} of {units.length} units
        </span>
        {(search || typeFilter || statusFilter) && (
          <button
            onClick={() => { setSearch(""); setTypeFilter(""); setStatusFilter(""); }}
            style={{ fontSize: 11, color: "#7a9a8a", background: "none", border: "1px solid #ccd8cc", borderRadius: 3, padding: "4px 10px", cursor: "pointer" }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: 4, border: "1px solid #d4e4d4" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#f4f6f4", position: "sticky", top: 0, zIndex: 1 }}>
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => handleSort(c.key)}
                  style={{
                    padding: "8px 12px",
                    fontWeight: 700,
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: .5,
                    color: sortCol === c.key ? "#00614a" : "#5a7a68",
                    borderBottom: "1.5px solid #d4e4d4",
                    textAlign: c.numeric ? "right" : "left",
                    cursor: "pointer",
                    userSelect: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.label}
                  {sortCol === c.key && (
                    <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((unit, i) => (
              <tr
                key={unit.id}
                style={{ background: i % 2 === 0 ? "#fff" : "#f9fbf9", borderBottom: "1px solid #eef2ee" }}
              >
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: "7px 12px",
                      textAlign: c.numeric ? "right" : "left",
                      color: (c.key === "askingRent" || c.key === "netRent" || c.key === "grossRent") && unit[c.key] != null
                        ? "#1e3a2a"
                        : "#3a4a42",
                      fontWeight: (c.key === "askingRent" || c.key === "netRent") ? 600 : 400,
                      whiteSpace: c.key === "notes" ? "normal" : "nowrap",
                      maxWidth: c.key === "notes" ? 240 : undefined,
                    }}
                  >
                    {cellValue(unit, c.key)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: "24px 12px", textAlign: "center", color: "#7a9a8a", fontSize: 13 }}>
                  No units match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
