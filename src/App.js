// src/App.js — Simple CSV Download Page (Create React App)
// Just paste this whole file and save.
// Then redeploy your frontend on Render.

import React, { useState, useMemo } from "react";

// Your API URL on Render (backend):
// If you prefer an env var, set REACT_APP_API_BASE_URL on Render and comment the hardcoded line.
const API_BASE =
  process.env.REACT_APP_API_BASE_URL || "https://maxtt-billing-api.onrender.com";

function useToday() {
  return useMemo(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);
}

function App() {
  const today = useToday();
  const [from, setFrom] = useState("");          // e.g. "2025-08-01"
  const [to, setTo] = useState(today);           // default to today
  const [franchisee, setFranchisee] = useState(""); // optional filter
  const [q, setQ] = useState("");                // vehicle no / customer code (optional)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function downloadCsv() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (franchisee) params.set("franchisee", franchisee);
      if (q) params.set("q", q);

      const url = `${API_BASE}/api/exports/invoices?${params.toString()}`;
      const res = await fetch(url);

      if (!res.ok) {
        // Try to read backend error JSON (if any)
        let msg = `Export failed (${res.status})`;
        try {
          const j = await res.json();
          if (j && (j.error || j.message)) {
            msg = j.error || j.message;
          }
        } catch {
          // ignore JSON parse error
        }
        throw new Error(msg);
      }

      const blob = await res.blob();
      const a = document.createElement("a");
      const dlUrl = URL.createObjectURL(blob);

      // Try to extract a filename from headers
      const disp = res.headers.get("Content-Disposition") || "";
      const name = disp.includes("filename=")
        ? disp.split('filename="')[1]?.split('"')[0] || "invoices.csv"
        : "invoices.csv";

      a.href = dlUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(dlUrl);
    } catch (e) {
      setError(e.message || "Download failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "flex-start", background: "#f7fafc" }}>
      <div style={{ width: "100%", maxWidth: 560, background: "#fff", marginTop: 24, padding: 20, borderRadius: 12, boxShadow: "0 6px 24px rgba(0,0,0,0.06)" }}>
        <h1 style={{ margin: 0, fontSize: 20 }}>MaxTT – Download Invoices CSV</h1>
        <p style={{ marginTop: 8, color: "#555" }}>
          Fill what you know. All fields are optional. Click “Download CSV”.
        </p>

        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>From (YYYY-MM-DD)</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="2025-08-01"
              style={inputStyle}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>To (YYYY-MM-DD)</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder={today}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Franchisee Code (optional)</span>
            <input
              value={franchisee}
              onChange={(e) => setFranchisee(e.target.value)}
              placeholder="MAXTT-DEMO-001"
              style={inputStyle}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Search (vehicle no / customer code)</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="DL1CAB1234 or CUST-0001"
              style={inputStyle}
            />
          </label>

          <button
            onClick={downloadCsv}
            disabled={busy}
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              background: busy ? "#e2e8f0" : "#1a73e8",
              color: busy ? "#333" : "#fff",
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 600
            }}
          >
            {busy ? "Preparing…" : "Download CSV"}
          </button>

          {error ? (
            <div style={{ color: "#b00020", fontWeight: 600 }}>{error}</div>
          ) : null}

          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
            Tip: Leave all fields empty to export up to 50,000 latest invoices.
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 12, background: "#f1f5f9", borderRadius: 8, fontSize: 12, color: "#374151" }}>
          API base: <code>{API_BASE}</code>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  outline: "none",
};

export default App;
