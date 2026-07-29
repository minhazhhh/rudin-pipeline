"use client";
import { useCallback, useEffect, useState } from "react";

export default function DraftBar({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const [status, setStatus] = useState<"idle" | "confirming" | "discarding">("idle");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/drafts");
      if (res.ok) {
        const data = (await res.json()) as unknown[];
        setCount(Array.isArray(data) ? data.length : 0);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const handler = () => { void refresh(); };
    window.addEventListener("draft-staged", handler);
    return () => window.removeEventListener("draft-staged", handler);
  }, [refresh]);

  async function handlePreview() {
    await fetch("/api/admin/draft-preview", { method: "POST" });
    window.open("/", "_blank");
  }

  async function handleConfirm() {
    if (!confirm(`Apply ${count} staged change${count !== 1 ? "s" : ""} to the live site? This cannot be undone.`)) return;
    setStatus("confirming");
    setError(null);
    try {
      const res = await fetch("/api/admin/drafts/confirm", { method: "POST" });
      const data = (await res.json()) as { applied: number; failed: number; errors: string[] };
      if (data.failed > 0) {
        setError(`${data.failed} change${data.failed !== 1 ? "s" : ""} failed to apply. ${data.errors.slice(0, 2).join("; ")}`);
      } else {
        setCount(0);
      }
    } catch {
      setError("Network error — please try again.");
    }
    setStatus("idle");
  }

  async function handleDiscard() {
    if (!confirm(`Discard all ${count} staged change${count !== 1 ? "s" : ""}? They will not be applied.`)) return;
    setStatus("discarding");
    setError(null);
    try {
      await fetch("/api/admin/drafts", { method: "DELETE" });
      await fetch("/api/admin/draft-preview", { method: "DELETE" });
      setCount(0);
    } catch {
      setError("Network error — please try again.");
    }
    setStatus("idle");
  }

  if (count === 0 && !error) return null;

  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 1000,
      background: "#1e2b28", color: "#e8f0ed",
      padding: "10px 20px",
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      fontSize: 13, fontFamily: "inherit",
      boxShadow: "0 -2px 12px rgba(0,0,0,.25)",
    }}>
      <span style={{ fontSize: 15 }}>⚡</span>
      <strong style={{ color: "#7dcea4" }}>
        {count} staged change{count !== 1 ? "s" : ""}
      </strong>
      <span style={{ color: "#8fa89f", flex: 1, minWidth: 120 }}>
        Not yet live — preview or confirm when ready
      </span>
      {error && (
        <span style={{ color: "#fca5a5", fontSize: 12 }}>{error}</span>
      )}
      <button
        onClick={() => { void handlePreview(); }}
        disabled={count === 0}
        style={{ padding: "5px 13px", background: "#2e7d5e", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer", letterSpacing: ".2px" }}
      >
        Preview on dashboard
      </button>
      <button
        onClick={() => { void handleConfirm(); }}
        disabled={status !== "idle" || count === 0}
        style={{ padding: "5px 13px", background: "#0d4d3a", color: "#fff", border: "1px solid #2e7d5e", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: status !== "idle" ? "not-allowed" : "pointer", opacity: status !== "idle" ? .6 : 1 }}
      >
        {status === "confirming" ? "Confirming…" : "Confirm all"}
      </button>
      <button
        onClick={() => { void handleDiscard(); }}
        disabled={status !== "idle" || count === 0}
        style={{ padding: "5px 12px", background: "none", color: "#a0b8af", border: "1px solid #3a5248", borderRadius: 4, fontSize: 12, cursor: status !== "idle" ? "not-allowed" : "pointer", opacity: status !== "idle" ? .6 : 1 }}
      >
        {status === "discarding" ? "Discarding…" : "Discard all"}
      </button>
    </div>
  );
}
