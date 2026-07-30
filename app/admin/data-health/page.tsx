"use client";

import { useEffect, useState } from "react";

type ResourceHealth = { total: number; duplicateRows: number; groups: number };
type QuarterHealth = { total: number; badFormats: number };

type HealthResult = {
  compBuildingUnits: ResourceHealth;
  leaseComps: ResourceHealth;
  quarterFormats: {
    leaseComps: QuarterHealth;
    compBuildingQuarterStats: QuarterHealth;
    trendPoints: QuarterHealth;
  };
};

type CleanState = "idle" | "cleaning" | "done" | "error";

export default function DataHealthPage() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cleanStates, setCleanStates] = useState<Record<string, CleanState>>({});
  const [cleanCounts, setCleanCounts] = useState<Record<string, number>>({});

  async function fetchHealth() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/data-health");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth(await res.json());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchHealth(); }, []);

  async function clean(resource: string) {
    setCleanStates((prev) => ({ ...prev, [resource]: "cleaning" }));
    try {
      const res = await fetch("/api/admin/data-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCleanCounts((prev) => ({ ...prev, [resource]: data.deleted ?? data.fixed ?? 0 }));
      setCleanStates((prev) => ({ ...prev, [resource]: "done" }));
      await fetchHealth();
    } catch (e) {
      setCleanStates((prev) => ({ ...prev, [resource]: "error" }));
    }
  }

  const DUPE_RESOURCES: { key: string; label: string; field: keyof Omit<HealthResult, "quarterFormats"> }[] = [
    { key: "comp-building-units", label: "Comp Building Units", field: "compBuildingUnits" },
    { key: "lease-comps", label: "Lease Comps", field: "leaseComps" },
  ];

  const totalBadQuarters = health
    ? health.quarterFormats.leaseComps.badFormats +
      health.quarterFormats.compBuildingQuarterStats.badFormats +
      health.quarterFormats.trendPoints.badFormats
    : 0;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Data Health</h1>
      <p style={{ color: "var(--muted, #666)", marginBottom: "2rem", fontSize: "0.875rem" }}>
        Detects and fixes data quality issues: duplicate rows and malformed quarter labels.
      </p>

      {loading && <p style={{ color: "var(--muted, #666)" }}>Scanning…</p>}
      {error && <p style={{ color: "var(--danger, #c0392b)" }}>Scan failed: {error}</p>}

      {health && (
        <>
          {/* ── Quarter format section ── */}
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Quarter Format
          </h2>
          <div
            style={{
              border: "1px solid var(--border, #d0d0d0)",
              padding: "1.25rem 1.5rem",
              marginBottom: "1.75rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div>
              <div style={{ fontWeight: 600, marginBottom: "0.4rem" }}>Quarter label consistency</div>
              <div style={{ fontSize: "0.85rem", color: "var(--muted, #666)", lineHeight: 1.6 }}>
                Lease Comps: {health.quarterFormats.leaseComps.total} rows, {health.quarterFormats.leaseComps.badFormats} bad
                <br />
                Building Quarter Stats: {health.quarterFormats.compBuildingQuarterStats.total} rows, {health.quarterFormats.compBuildingQuarterStats.badFormats} bad
                <br />
                Trend Points: {health.quarterFormats.trendPoints.total} rows, {health.quarterFormats.trendPoints.badFormats} bad
              </div>
              <div style={{ marginTop: "0.4rem", fontSize: "0.85rem", fontWeight: 500, color: totalBadQuarters > 0 ? "var(--danger, #c0392b)" : "var(--accent, #0d4d3a)" }}>
                {totalBadQuarters > 0
                  ? `${totalBadQuarters} rows have date-format quarters (e.g. "03/23/26") — causes broken charts`
                  : "All quarter labels are in correct format"}
              </div>
              {cleanStates["fix-quarter-formats"] === "done" && cleanCounts["fix-quarter-formats"] != null && (
                <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--accent, #0d4d3a)" }}>
                  Fixed {cleanCounts["fix-quarter-formats"]} row{cleanCounts["fix-quarter-formats"] !== 1 ? "s" : ""}
                </div>
              )}
              {cleanStates["fix-quarter-formats"] === "error" && (
                <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--danger, #c0392b)" }}>Fix failed</div>
              )}
            </div>
            <button
              onClick={() => clean("fix-quarter-formats")}
              disabled={totalBadQuarters === 0 || cleanStates["fix-quarter-formats"] === "cleaning"}
              style={{
                padding: "0.5rem 1.25rem",
                background: totalBadQuarters > 0 ? "var(--accent, #0d4d3a)" : "var(--muted-bg, #e8e8e8)",
                color: totalBadQuarters > 0 ? "#fff" : "var(--muted, #999)",
                border: "none",
                cursor: totalBadQuarters > 0 && cleanStates["fix-quarter-formats"] !== "cleaning" ? "pointer" : "default",
                fontWeight: 600,
                fontSize: "0.875rem",
                whiteSpace: "nowrap",
                opacity: cleanStates["fix-quarter-formats"] === "cleaning" ? 0.6 : 1,
              }}
            >
              {cleanStates["fix-quarter-formats"] === "cleaning" ? "Fixing…" : "Fix quarter formats"}
            </button>
          </div>

          {/* ── Duplicate rows section ── */}
          <h2 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Duplicate Rows
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {DUPE_RESOURCES.map(({ key, label, field }) => {
              const h = health[field];
              const state = cleanStates[key] ?? "idle";
              const hasDupes = h.duplicateRows > 0;
              return (
                <div
                  key={key}
                  style={{
                    border: "1px solid var(--border, #d0d0d0)",
                    padding: "1.25rem 1.5rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{label}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted, #666)" }}>
                      {h.total.toLocaleString()} total rows
                    </div>
                    <div style={{ marginTop: "0.35rem", fontSize: "0.85rem", fontWeight: 500, color: hasDupes ? "var(--danger, #c0392b)" : "var(--accent, #0d4d3a)" }}>
                      {hasDupes
                        ? `${h.duplicateRows} duplicate row${h.duplicateRows !== 1 ? "s" : ""} across ${h.groups} group${h.groups !== 1 ? "s" : ""}`
                        : "No duplicates found"}
                    </div>
                    {state === "done" && cleanCounts[key] != null && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--accent, #0d4d3a)" }}>
                        Removed {cleanCounts[key]} row{cleanCounts[key] !== 1 ? "s" : ""}
                      </div>
                    )}
                    {state === "error" && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--danger, #c0392b)" }}>Clean failed</div>
                    )}
                  </div>
                  <button
                    onClick={() => clean(key)}
                    disabled={!hasDupes || state === "cleaning"}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: hasDupes ? "var(--accent, #0d4d3a)" : "var(--muted-bg, #e8e8e8)",
                      color: hasDupes ? "#fff" : "var(--muted, #999)",
                      border: "none",
                      cursor: hasDupes && state !== "cleaning" ? "pointer" : "default",
                      fontWeight: 600,
                      fontSize: "0.875rem",
                      whiteSpace: "nowrap",
                      opacity: state === "cleaning" ? 0.6 : 1,
                    }}
                  >
                    {state === "cleaning" ? "Cleaning…" : "Clean duplicates"}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!loading && (
        <button
          onClick={fetchHealth}
          style={{
            marginTop: "1.5rem",
            padding: "0.45rem 1rem",
            background: "transparent",
            border: "1px solid var(--border, #ccc)",
            cursor: "pointer",
            fontSize: "0.85rem",
          }}
        >
          Rescan
        </button>
      )}
    </div>
  );
}
