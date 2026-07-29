"use client";
import { useState } from "react";

type Building = { id: string; name: string };

export default function GeocodeCompBuildingsButton({
  missingCount,
  buildings,
}: {
  missingCount: number;
  buildings: Building[];
}) {
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function run() {
    setStatus("running");
    setSummary(null);
    let updated = 0;
    let failed = 0;

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      setProgress({ done: i, total: buildings.length, current: b.name });
      try {
        const res = await fetch("/api/admin/geocode-comp-buildings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: b.id }),
        });
        const data = await res.json() as { ok: boolean };
        if (data.ok) updated++; else failed++;
      } catch {
        failed++;
      }
      if (i < buildings.length - 1) await new Promise((r) => setTimeout(r, 1100));
    }

    setProgress({ done: buildings.length, total: buildings.length, current: "" });
    setStatus("done");
    setSummary(`Geocoded ${updated} of ${buildings.length}${failed ? ` (${failed} not found)` : ""}.`);
    if (updated > 0) setTimeout(() => window.location.reload(), 1200);
  }

  return (
    <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "var(--accent-soft, #eef5f2)", border: "1px solid var(--accent-line, #c5ddd6)", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
      <span style={{ fontSize: 14 }}>
        <strong>{missingCount}</strong> building{missingCount !== 1 ? "s" : ""} missing map coordinates — required for the Quick Underwrite radius map
      </span>
      {status === "idle" && (
        <button
          onClick={run}
          style={{ padding: "0.35rem 0.9rem", fontSize: 13, background: "var(--accent, #0d4d3a)", color: "#fff", border: "none", cursor: "pointer" }}
        >
          Auto-geocode all
        </button>
      )}
      {status === "running" && progress && (
        <span style={{ fontSize: 13, color: "var(--ink-soft, #555)" }}>
          {progress.done + 1}/{progress.total}: <em>{progress.current}</em>…
        </span>
      )}
      {summary && (
        <span style={{ fontSize: 13, color: "var(--accent, #0d4d3a)" }}>{summary}</span>
      )}
    </div>
  );
}
