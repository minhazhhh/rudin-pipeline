"use client";

import { useEffect, useState } from "react";

type ResourceHealth = {
  total: number;
  duplicateRows: number;
  groups: number;
};

type HealthResult = {
  compBuildingUnits: ResourceHealth;
  leaseComps: ResourceHealth;
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
      setCleanCounts((prev) => ({ ...prev, [resource]: data.deleted }));
      setCleanStates((prev) => ({ ...prev, [resource]: "done" }));
      await fetchHealth();
    } catch (e) {
      setCleanStates((prev) => ({ ...prev, [resource]: "error" }));
    }
  }

  const RESOURCES: { key: string; label: string; field: keyof HealthResult }[] = [
    { key: "comp-building-units", label: "Comp Building Units", field: "compBuildingUnits" },
    { key: "lease-comps", label: "Lease Comps", field: "leaseComps" },
  ];

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Data Health</h1>
      <p style={{ color: "var(--muted, #666)", marginBottom: "2rem", fontSize: "0.875rem" }}>
        Scans for duplicate rows in resources that have no unique database constraints. Duplicates are identified by composite key (building + unit identifiers).
      </p>

      {loading && <p style={{ color: "var(--muted, #666)" }}>Scanning…</p>}
      {error && <p style={{ color: "var(--danger, #c0392b)" }}>Scan failed: {error}</p>}

      {health && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {RESOURCES.map(({ key, label, field }) => {
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
                  <div
                    style={{
                      marginTop: "0.35rem",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      color: hasDupes ? "var(--danger, #c0392b)" : "var(--accent, #0d4d3a)",
                    }}
                  >
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
                    <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--danger, #c0392b)" }}>
                      Clean failed
                    </div>
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
