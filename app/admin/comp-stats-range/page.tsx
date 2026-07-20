"use client";

import { useEffect, useState } from "react";

type Building = { id: string; name: string };

type StatRow = {
  building: string;
  unitType: string;
  n: number;
  avgRent: number | null;
  medRent: number | null;
  minRent: number | null;
  maxRent: number | null;
  avgPsf: number | null;
  medPsf: number | null;
  avgSf: number | null;
  medSf: number | null;
  nPsf: number;
  nSf: number;
};

function fmt(n: number | null, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtDollar(n: number | null): string {
  if (n == null) return "—";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// Default date range: last 12 months
function defaultDates() {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export default function CompStatsRangePage() {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dates, setDates] = useState(defaultDates);
  const [rows, setRows] = useState<StatRow[]>([]);
  const [totalLeases, setTotalLeases] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    fetch("/api/comp-buildings")
      .then((r) => r.json())
      .then((data: Building[]) => {
        setBuildings(data.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => {});
  }, []);

  function toggleBuilding(name: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  }

  function selectAll() {
    setSelected(new Set(buildings.map((b) => b.name)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function runQuery() {
    if (!selected.size) { setError("Select at least one building."); return; }
    if (!dates.start || !dates.end) { setError("Set a start and end date."); return; }
    if (dates.start > dates.end) { setError("Start date must be before end date."); return; }

    setLoading(true); setError(null); setSearched(true);

    try {
      const res = await fetch("/api/comp-stats-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildings: [...selected], startDate: dates.start, endDate: dates.end }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Query failed");
      setRows(body.rows);
      setTotalLeases(body.totalLeases);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  // Group rows by building for display
  const byBuilding: Record<string, StatRow[]> = {};
  for (const row of rows) {
    if (!byBuilding[row.building]) byBuilding[row.building] = [];
    byBuilding[row.building].push(row);
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>
        Custom Date-Range Stats
      </h1>
      <p style={{ color: "#555", fontSize: "0.88rem", marginBottom: "2rem", maxWidth: 680 }}>
        Aggregate lease comp stats for any combination of buildings over any date range.
        Calculated live from individual lease transactions.
      </p>

      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "2rem" }}>

        {/* Date range */}
        <div>
          <div style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.5rem", color: "#374151" }}>
            Date Range
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="date"
              value={dates.start}
              onChange={(e) => setDates((d) => ({ ...d, start: e.target.value }))}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.88rem" }}
            />
            <span style={{ color: "#64748b" }}>to</span>
            <input
              type="date"
              value={dates.end}
              onChange={(e) => setDates((d) => ({ ...d, end: e.target.value }))}
              style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: "0.88rem" }}
            />
          </div>
        </div>

        {/* Run button */}
        <div style={{ paddingTop: "1.55rem" }}>
          <button
            onClick={runQuery}
            disabled={loading}
            style={{
              padding: "8px 22px", background: loading ? "#94a3b8" : "#2563eb",
              color: "#fff", border: "none", borderRadius: 7, cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 700, fontSize: "0.9rem",
            }}
          >
            {loading ? "Loading…" : "Run"}
          </button>
        </div>
      </div>

      {/* ── Building selector ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "0.6rem" }}>
          <span style={{ fontWeight: 600, fontSize: "0.88rem", color: "#374151" }}>Buildings</span>
          <button onClick={selectAll} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: "0.82rem", padding: 0 }}>Select all</button>
          <button onClick={clearAll} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: "0.82rem", padding: 0 }}>Clear</button>
          <span style={{ fontSize: "0.82rem", color: "#94a3b8" }}>{selected.size} selected</span>
        </div>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 6, padding: "12px 14px",
          border: "1px solid #e2e8f0", borderRadius: 8, background: "#f8fafc",
          maxHeight: 200, overflowY: "auto",
        }}>
          {buildings.map((b) => {
            const on = selected.has(b.name);
            return (
              <button
                key={b.id}
                onClick={() => toggleBuilding(b.name)}
                style={{
                  padding: "4px 12px", borderRadius: 20, fontSize: "0.82rem", fontWeight: 500,
                  cursor: "pointer", transition: "all 0.1s",
                  background: on ? "#2563eb" : "#fff",
                  color: on ? "#fff" : "#374151",
                  border: `1px solid ${on ? "#2563eb" : "#cbd5e1"}`,
                }}
              >
                {b.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 6, background: "#fef2f2", border: "1px solid #fca5a5", color: "#dc2626", fontSize: "0.88rem", marginBottom: "1.5rem" }}>
          {error}
        </div>
      )}

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {searched && !loading && rows.length === 0 && !error && (
        <div style={{ color: "#64748b", fontSize: "0.88rem", padding: "2rem", textAlign: "center", border: "1px solid #e2e8f0", borderRadius: 8 }}>
          No lease comps found for the selected buildings and date range.
        </div>
      )}

      {rows.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: "1rem", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
              {Object.keys(byBuilding).length} building{Object.keys(byBuilding).length !== 1 ? "s" : ""},&nbsp;
              {rows.length} row{rows.length !== 1 ? "s" : ""}
            </span>
            <span style={{ color: "#64748b", fontSize: "0.84rem" }}>
              {totalLeases?.toLocaleString()} lease transaction{totalLeases !== 1 ? "s" : ""} in range
            </span>
            <span style={{ color: "#94a3b8", fontSize: "0.82rem" }}>
              {new Date(dates.start).toLocaleDateString()} – {new Date(dates.end).toLocaleDateString()}
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
              <thead>
                <tr style={{ background: "#f1f5f9", borderBottom: "2px solid #e2e8f0" }}>
                  <th style={thStyle}>Building</th>
                  <th style={thStyle}>Type</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>n</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Avg Rent</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Med Rent</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Min Rent</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Max Rent</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Avg $/SF</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Med $/SF</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Avg SF</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Med SF</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(byBuilding).map(([building, bRows], bi) => (
                  bRows.map((row, ri) => (
                    <tr
                      key={`${building}-${row.unitType}`}
                      style={{ borderBottom: "1px solid #e2e8f0", background: bi % 2 === 0 ? "#fff" : "#fafafa" }}
                    >
                      <td style={{ ...tdStyle, fontWeight: ri === 0 ? 600 : 400, color: ri === 0 ? "#0f172a" : "#64748b" }}>
                        {ri === 0 ? building : ""}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: "monospace", color: "#475569" }}>{row.unitType}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>{row.n}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>{fmtDollar(row.avgRent)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{fmtDollar(row.medRent)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>{fmtDollar(row.minRent)}</td>
                      <td style={{ ...tdStyle, textAlign: "right", color: "#64748b" }}>{fmtDollar(row.maxRent)}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{row.nPsf > 0 ? "$" + fmt(row.avgPsf, 2) : "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{row.nPsf > 0 ? "$" + fmt(row.medPsf, 2) : "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{row.nSf > 0 ? fmt(row.avgSf) : "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>{row.nSf > 0 ? fmt(row.medSf) : "—"}</td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 600,
  color: "#475569",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "7px 12px",
  whiteSpace: "nowrap",
};
