// src/DownloadInvoicesCsvButton.js
import React, { useState } from "react";

const API_BASE =
  process.env.REACT_APP_API_BASE_URL || "https://maxtt-billing-api.onrender.com";

export default function DownloadInvoicesCsvButton({ from, to, franchisee, q }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onClick() {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (franchisee) params.set("franchisee", franchisee);
      if (q) params.set("q", q);

      const res = await fetch(`${API_BASE}/api/exports/invoices?${params.toString()}`);
      if (!res.ok) {
        let msg = `Export failed (${res.status})`;
        try { const j = await res.json(); if (j.error || j.message) msg = j.error || j.message; } catch {}
        throw new Error(msg);
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      const disp = res.headers.get("Content-Disposition") || "";
      const name = disp.includes("filename=")
        ? disp.split('filename="')[1]?.split('"')[0] || "invoices.csv"
        : "invoices.csv";
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button onClick={onClick} disabled={busy}
        style={{ padding: "8px 12px", borderRadius: 8, background: busy ? "#e2e8f0" : "#1a73e8", color: "#fff", border: "none", cursor: busy ? "not-allowed" : "pointer" }}>
        {busy ? "Preparing…" : "Download CSV"}
      </button>
      {error ? <span style={{ color: "#b00020", fontSize: 12 }}>{error}</span> : null}
    </div>
  );
}
