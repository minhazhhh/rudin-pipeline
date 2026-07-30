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
        setError(`${data.failed} failed: ${data.errors.slice(0, 2).join("; ")}`);
      } else {
        setCount(0);
      }
    } catch {
      setError("Network error — try again.");
    }
    setStatus("idle");
  }

  async function handleDiscard() {
    if (!confirm(`Discard all ${count} staged change${count !== 1 ? "s" : ""}?`)) return;
    setStatus("discarding");
    setError(null);
    try {
      await fetch("/api/admin/drafts", { method: "DELETE" });
      await fetch("/api/admin/draft-preview", { method: "DELETE" });
      setCount(0);
    } catch {
      setError("Network error — try again.");
    }
    setStatus("idle");
  }

  const hasDrafts = count > 0;

  return (
    <div style={{
      background: hasDrafts ? "#1a2e25" : "#f0f4f2",
      borderBottom: hasDrafts ? "none" : "1px solid #d4e3dd",
      borderTop: hasDrafts ? "3px solid #f59e0b" : "none",
      color: hasDrafts ? "#e8f0ed" : "#5a7a6e",
      padding: "8px 20px",
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      fontSize: 13, fontFamily: "inherit",
      position: "sticky", top: 0, zIndex: 200,
      transition: "background 200ms",
    }}>
      {hasDrafts ? (
        <>
          <span style={{ fontSize: 14 }}>⚡</span>
          <strong style={{ color: "#f59e0b", fontSize: 13 }}>
            {count} staged change{count !== 1 ? "s" : ""}
          </strong>
          <span style={{ color: "#8fa89f", flex: 1 }}>
            Not yet live — preview first, then confirm
          </span>
          {error && <span style={{ color: "#fca5a5", fontSize: 12 }}>{error}</span>}
          <button
            onClick={() => { void handlePreview(); }}
            style={{ padding: "4px 12px", background: "#2e7d5e", color: "#fff", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            Preview on dashboard ↗
          </button>
          <button
            onClick={() => { void handleConfirm(); }}
            disabled={status !== "idle"}
            style={{ padding: "4px 12px", background: "#f59e0b", color: "#1a1a1a", border: "none", borderRadius: 4, fontSize: 12, fontWeight: 700, cursor: status !== "idle" ? "not-allowed" : "pointer", opacity: status !== "idle" ? .6 : 1 }}
          >
            {status === "confirming" ? "Confirming…" : "Confirm all & go live"}
          </button>
          <button
            onClick={() => { void handleDiscard(); }}
            disabled={status !== "idle"}
            style={{ padding: "4px 10px", background: "none", color: "#a0b8af", border: "1px solid #3a5248", borderRadius: 4, fontSize: 12, cursor: status !== "idle" ? "not-allowed" : "pointer" }}
          >
            {status === "discarding" ? "Discarding…" : "Discard all"}
          </button>
        </>
      ) : (
        <>
          <span style={{ fontSize: 13 }}>🛡</span>
          <span style={{ fontWeight: 600, color: "#3a6b58", fontSize: 12 }}>Draft mode on</span>
          <span style={{ fontSize: 12 }}>
            — edits on this page are staged before going live. Save a row to stage it, then Preview → Confirm.
          </span>
        </>
      )}
    </div>
  );
}
