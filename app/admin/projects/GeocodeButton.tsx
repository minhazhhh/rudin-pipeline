"use client";
import { useState } from "react";

type Project = { id: string; name: string; address: string | null };

export default function GeocodeButton({ missingCount }: { missingCount: number }) {
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function run() {
    setStatus("running");
    setSummary(null);

    const listRes = await fetch("/api/admin/geocode-projects");
    const { projects } = await listRes.json() as { projects: Project[] };

    if (!projects.length) {
      setStatus("done");
      setSummary("No projects need geocoding.");
      return;
    }

    let updated = 0;
    let failed = 0;

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      setProgress({ done: i, total: projects.length, current: p.name });

      try {
        const res = await fetch("/api/admin/geocode-projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: p.id }),
        });
        const data = await res.json() as { ok: boolean };
        if (data.ok) updated++; else failed++;
      } catch {
        failed++;
      }

      // Respect Nominatim 1 req/sec rate limit between calls
      if (i < projects.length - 1) await new Promise((r) => setTimeout(r, 1100));
    }

    setProgress({ done: projects.length, total: projects.length, current: "" });
    setStatus("done");
    setSummary(`Geocoded ${updated} of ${projects.length}${failed ? ` (${failed} not found)` : ""}.`);
    if (updated > 0) setTimeout(() => window.location.reload(), 1200);
  }

  return (
    <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 6, display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
      <span style={{ fontSize: 14 }}>
        <strong>{missingCount}</strong> project{missingCount !== 1 ? "s" : ""} missing map coordinates
      </span>
      {status === "idle" && (
        <button onClick={run} style={{ padding: "0.35rem 0.9rem", fontSize: 13, background: "#0d6efd", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          Auto-geocode missing
        </button>
      )}
      {status === "running" && progress && (
        <span style={{ fontSize: 13, color: "#555" }}>
          Geocoding {progress.done + 1}/{progress.total}: <em>{progress.current}</em>…
        </span>
      )}
      {summary && (
        <span style={{ fontSize: 13, color: status === "done" ? "#155724" : "#721c24" }}>{summary}</span>
      )}
    </div>
  );
}
