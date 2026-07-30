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
  if (v == null) return typeof unit[key] === "number" || ["floor","sf","bedrooms","bathrooms","askingRent","netRent","grossRent","psf","leaseTerm"].includes(key) ? -Infinity : "";
  return v as string | number;
}

// Compact number range input pair
function RangeFilter({ label, min, max, valueMin, valueMax, onMin, onMax, prefix = "" }: {
  label: string; min: number; max: number;
  valueMin: string; valueMax: string;
  onMin: (v: string) => void; onMax: (v: string) => void;
  prefix?: string;
}) {
  const inp: React.CSSProperties = { width: 80, padding: "5px 8px", border: "1px solid #ccd8cc", borderRadius: 3, fontSize: 12, color: "#1e3a2a", background: "#fff", outline: "none" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#7a9a8a" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input type="number" placeholder={prefix + min.toLocaleString()} value={valueMin} onChange={e => onMin(e.target.value)} style={inp} />
        <span style={{ color: "#9aab9a", fontSize: 11 }}>–</span>
        <input type="number" placeholder={prefix + max.toLocaleString()} value={valueMax} onChange={e => onMax(e.target.value)} style={inp} />
      </div>
    </div>
  );
}

export default function BuildingTable({ units, buildingName }: { units: Unit[]; buildingName: string }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [bedroomFilter, setBedroomFilter] = useState<string>("");
  const [floorMin, setFloorMin] = useState("");
  const [floorMax, setFloorMax] = useState("");
  const [sfMin, setSfMin] = useState("");
  const [sfMax, setSfMax] = useState("");
  const [rentMin, setRentMin] = useState("");
  const [rentMax, setRentMax] = useState("");
  const [psfMin, setPsfMin] = useState("");
  const [psfMax, setPsfMax] = useState("");
  const [leaseDateFrom, setLeaseDateFrom] = useState("");
  const [leaseDateTo, setLeaseDateTo] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sortCol, setSortCol] = useState<Col>("unitName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const unitTypes = useMemo(() => {
    const types = [...new Set(units.map((u) => u.unitType).filter(Boolean) as string[])];
    return types.sort((a, b) => {
      const ai = UT_ORDER.indexOf(a), bi = UT_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [units]);

  const statuses = useMemo(() => [...new Set(units.map((u) => u.status).filter(Boolean) as string[])].sort(), [units]);
  const bedroomOptions = useMemo(() => [...new Set(units.map((u) => u.bedrooms).filter((v): v is number => v != null))].sort((a, b) => a - b), [units]);

  const ranges = useMemo(() => {
    const floors = units.map(u => u.floor).filter((v): v is number => v != null);
    const sfs = units.map(u => u.sf).filter((v): v is number => v != null);
    const rents = units.map(u => u.askingRent ?? u.netRent).filter((v): v is number => v != null);
    const psfs = units.map(u => u.psf).filter((v): v is number => v != null);
    return {
      floorMin: floors.length ? Math.min(...floors) : 1,
      floorMax: floors.length ? Math.max(...floors) : 50,
      sfMin: sfs.length ? Math.min(...sfs) : 0,
      sfMax: sfs.length ? Math.max(...sfs) : 5000,
      rentMin: rents.length ? Math.min(...rents) : 0,
      rentMax: rents.length ? Math.max(...rents) : 20000,
      psfMin: psfs.length ? Math.min(...psfs) : 0,
      psfMax: psfs.length ? Math.max(...psfs) : 30,
    };
  }, [units]);

  const handleSort = useCallback((col: Col) => {
    setSortCol((prev) => {
      if (prev === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else setSortDir("asc");
      return col;
    });
  }, []);

  const activeFilterCount = [
    search, typeFilter, statusFilter, bedroomFilter,
    floorMin, floorMax, sfMin, sfMax, rentMin, rentMax, psfMin, psfMax,
    leaseDateFrom, leaseDateTo,
  ].filter(Boolean).length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const fMin = floorMin ? parseFloat(floorMin) : null;
    const fMax = floorMax ? parseFloat(floorMax) : null;
    const sMin = sfMin ? parseFloat(sfMin) : null;
    const sMax = sfMax ? parseFloat(sfMax) : null;
    const rMin = rentMin ? parseFloat(rentMin) : null;
    const rMax = rentMax ? parseFloat(rentMax) : null;
    const pMin = psfMin ? parseFloat(psfMin) : null;
    const pMax = psfMax ? parseFloat(psfMax) : null;

    return units.filter((u) => {
      if (typeFilter && u.unitType !== typeFilter) return false;
      if (statusFilter && u.status !== statusFilter) return false;
      if (bedroomFilter && String(u.bedrooms) !== bedroomFilter) return false;
      if (fMin != null && (u.floor == null || u.floor < fMin)) return false;
      if (fMax != null && (u.floor == null || u.floor > fMax)) return false;
      if (sMin != null && (u.sf == null || u.sf < sMin)) return false;
      if (sMax != null && (u.sf == null || u.sf > sMax)) return false;
      if (rMin != null || rMax != null) {
        const rent = u.askingRent ?? u.netRent ?? u.grossRent;
        if (rMin != null && (rent == null || rent < rMin)) return false;
        if (rMax != null && (rent == null || rent > rMax)) return false;
      }
      if (pMin != null && (u.psf == null || u.psf < pMin)) return false;
      if (pMax != null && (u.psf == null || u.psf > pMax)) return false;
      if (leaseDateFrom && u.leaseDate && u.leaseDate < leaseDateFrom) return false;
      if (leaseDateTo && u.leaseDate && u.leaseDate > leaseDateTo) return false;
      if (q) {
        return COLUMNS.some((c) => {
          const v = u[c.key];
          return v != null && String(v).toLowerCase().includes(q);
        });
      }
      return true;
    });
  }, [units, search, typeFilter, statusFilter, bedroomFilter, floorMin, floorMax, sfMin, sfMax, rentMin, rentMax, psfMin, psfMax, leaseDateFrom, leaseDateTo]);

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
    for (const t of Object.keys(map)) {
      const rows = units.filter((u) => (u.unitType ?? "Unknown") === t);
      const avg = (arr: (number | null)[]) => { const v = arr.filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
      map[t].avgAsk = avg(rows.map(u => u.askingRent));
      map[t].avgNet = avg(rows.map(u => u.netRent));
      map[t].avgPsf = avg(rows.map(u => u.psf));
      map[t].avgSf = avg(rows.map(u => u.sf));
    }
    return map;
  }, [units]);

  const summaryTypes = useMemo(() => Object.keys(summaryByType).sort((a, b) => {
    const ai = UT_ORDER.indexOf(a), bi = UT_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }), [summaryByType]);

  function clearAll() {
    setSearch(""); setTypeFilter(""); setStatusFilter(""); setBedroomFilter("");
    setFloorMin(""); setFloorMax(""); setSfMin(""); setSfMax("");
    setRentMin(""); setRentMax(""); setPsfMin(""); setPsfMax("");
    setLeaseDateFrom(""); setLeaseDateTo("");
  }

  const inputSm: React.CSSProperties = { padding: "5px 10px", border: "1px solid #ccd8cc", borderRadius: 3, fontSize: 12.5, color: "#1e3a2a", background: "#fff", outline: "none" };
  const selectSm: React.CSSProperties = { ...inputSm, cursor: "pointer" };

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
                  <tr key={t} style={{ borderBottom: "1px solid #eef2ee", cursor: "pointer" }} onClick={() => setTypeFilter(typeFilter === t ? "" : t)} title={`Filter to ${t} units`}>
                    <td style={{ padding: "7px 14px", fontWeight: 700, color: typeFilter === t ? "#00614a" : "#1e3a2a" }}>{t}{typeFilter === t && <span style={{ marginLeft: 6, fontSize: 9, color: "#00614a" }}>✕</span>}</td>
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
        {summaryTypes.length > 1 && <div style={{ fontSize: 10, color: "#9aab9a", marginTop: 5 }}>Click a row to filter the table below to that unit type.</div>}
      </div>

      {/* Filter bar */}
      <div style={{ background: "#f4f6f4", borderRadius: 5, padding: "14px 16px", marginBottom: 14, border: "1px solid #d4e4d4" }}>
        {/* Primary filters */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#7a9a8a" }}>Search</span>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Any column…" style={{ ...inputSm, width: 200 }} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#7a9a8a" }}>Unit Type</span>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectSm}>
              <option value="">All</option>
              {unitTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {statuses.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#7a9a8a" }}>Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectSm}>
                <option value="">All</option>
                {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {bedroomOptions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#7a9a8a" }}>Bedrooms</span>
              <select value={bedroomFilter} onChange={(e) => setBedroomFilter(e.target.value)} style={selectSm}>
                <option value="">Any</option>
                {bedroomOptions.map((b) => <option key={b} value={String(b)}>{b === 0 ? "Studio" : b + "BR"}</option>)}
              </select>
            </div>
          )}

          <button
            onClick={() => setShowAdvanced(v => !v)}
            style={{ padding: "5px 12px", background: showAdvanced ? "#1a2e24" : "transparent", color: showAdvanced ? "#7ab89a" : "#5a7a68", border: "1px solid #ccd8cc", borderRadius: 3, fontSize: 11.5, cursor: "pointer", fontWeight: 600, alignSelf: "flex-end" }}
          >
            {showAdvanced ? "▲ Less" : "▼ More filters"}{activeFilterCount > (search || typeFilter || statusFilter || bedroomFilter ? 1 : 0) ? ` (${activeFilterCount})` : ""}
          </button>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-end", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#7a9a8a", paddingBottom: 6 }}>
              <strong style={{ color: "#1e3a2a" }}>{sorted.length}</strong> of {units.length} units
            </span>
            {activeFilterCount > 0 && (
              <button onClick={clearAll} style={{ fontSize: 11, color: "#e05a5a", background: "none", border: "1px solid #f0c8c8", borderRadius: 3, padding: "4px 10px", cursor: "pointer", alignSelf: "flex-end" }}>
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Advanced filters */}
        {showAdvanced && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #d4e4d4", display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
            <RangeFilter label="Floor" min={ranges.floorMin} max={ranges.floorMax} valueMin={floorMin} valueMax={floorMax} onMin={setFloorMin} onMax={setFloorMax} />
            <RangeFilter label="SF" min={ranges.sfMin} max={ranges.sfMax} valueMin={sfMin} valueMax={sfMax} onMin={setSfMin} onMax={setSfMax} />
            <RangeFilter label="Rent (asking / net)" min={ranges.rentMin} max={ranges.rentMax} valueMin={rentMin} valueMax={rentMax} onMin={setRentMin} onMax={setRentMax} prefix="$" />
            <RangeFilter label="$/SF" min={ranges.psfMin} max={ranges.psfMax} valueMin={psfMin} valueMax={psfMax} onMin={setPsfMin} onMax={setPsfMax} prefix="$" />
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: .5, color: "#7a9a8a" }}>Lease Date</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="date" value={leaseDateFrom} onChange={e => setLeaseDateFrom(e.target.value)} style={{ ...inputSm, width: 130 }} />
                <span style={{ color: "#9aab9a", fontSize: 11 }}>–</span>
                <input type="date" value={leaseDateTo} onChange={e => setLeaseDateTo(e.target.value)} style={{ ...inputSm, width: 130 }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", borderRadius: 4, border: "1px solid #d4e4d4" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, width: "100%", minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#f4f6f4" }}>
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
                  {sortCol === c.key && <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === "asc" ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((unit, i) => (
              <tr key={unit.id} style={{ background: i % 2 === 0 ? "#fff" : "#f9fbf9", borderBottom: "1px solid #eef2ee" }}>
                {COLUMNS.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: "7px 12px",
                      textAlign: c.numeric ? "right" : "left",
                      color: (c.key === "askingRent" || c.key === "netRent" || c.key === "grossRent") && unit[c.key] != null ? "#1e3a2a" : "#3a4a42",
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
                  No units match the current filters.{" "}
                  <button onClick={clearAll} style={{ color: "#00614a", background: "none", border: "none", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}>Clear filters</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
