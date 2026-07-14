"use client";
import { useState } from "react";

export default function GeocodeButton({ missingCount }: { missingCount: number }) {
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setStatus("running");
    setResult(null);
    try {
      const res = await fetch("/api/admin/geocode-projects", { method: "POST" });
      const data = await res.json() as { updated: number; failed: number; total: number };
      setResult(`Geocoded ${data.updated} of ${data.total} projects. ${data.failed} could not be located.`);
      setStatus("done");
      if (data.updated > 0) setTimeout(() => window.location.reload(), 1500);
    } catch {
      setStatus("error");
      setResult("Request failed. Check network.");
    }
  }

  return (
    <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 6, display: "flex", alignItems: "center", gap: "1rem" }}>
      <span style={{ fontSize: 14 }}>
        <strong>{missingCount}</strong> project{missingCount !== 1 ? "s" : ""} missing map coordinates
      </span>
      <button
        onClick={run}
        disabled={status === "running"}
        style={{ padding: "0.35rem 0.9rem", fontSize: 13, background: status === "done" ? "#198754" : "#0d6efd", color: "#fff", border: "none", borderRadius: 4, cursor: status === "running" ? "wait" : "pointer" }}
      >
        {status === "running" ? "Geocoding… (this takes ~1s per building)" : status === "done" ? "Done" : "Auto-geocode missing"}
      </button>
      {result && <span style={{ fontSize: 13, color: status === "error" ? "#dc3545" : "#155724" }}>{result}</span>}
    </div>
  );
}
