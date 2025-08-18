import React, { useState, useEffect, useCallback } from "react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

const API_URL = "https://maxtt-billing-api.onrender.com"; // change if needed
const API_KEY = "supersecret123";              // must match backend

// ---------- INR (ASCII-safe) ----------
function inr(num) {
  const n = Math.round((Number(num) || 0) * 100) / 100;
  const [intPartRaw, dec = "00"] = n.toFixed(2).split(".");
  const intPart = String(intPartRaw);
  if (intPart.length <= 3) return `Rs. ${intPart}.${dec}`;
  const last3 = intPart.slice(-3);
  const other = intPart.slice(0, -3);
  const withCommas = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `Rs. ${withCommas}.${dec}`;
}

// ---------- Vehicle categories ----------
const VEHICLE_CFG = {
  "2-Wheeler (Scooter/Motorcycle)": { k: 2.60, bufferPct: 0.03, defaultTyres: 2, options: [2] },
  "3-Wheeler (Auto)":               { k: 2.20, bufferPct: 0.00, defaultTyres: 3, options: [3] },
  "4-Wheeler (Passenger car/van/SUV)": { k: 2.56, bufferPct: 0.08, defaultTyres: 4, options: [4] },
  "6-Wheeler (Bus/LTV)":            { k: 3.00, bufferPct: 0.00, defaultTyres: 6, options: [6] },
  "HTV (>6 wheels: Trucks/Trailers/Mining)": { k: 3.00, bufferPct: 0.00, defaultTyres: 8, options: [8,10,12,14,16] }
};
function roundTo25(x) { return Math.round(x / 25) * 25; }
function computePerTyreDosageMl(vehicleType, widthMm, aspectPct, rimIn) {
  const entry = VEHICLE_CFG[vehicleType] || VEHICLE_CFG["4-Wheeler (Passenger car/van/SUV)"];
  const widthIn = Number(widthMm || 0) * 0.03937;
  const totalHeightIn = (widthIn * (Number(aspectPct || 0) / 100) * 2) + Number(rimIn || 0);
  let dosage = (widthIn * totalHeightIn * entry.k);
  dosage = dosage * (1 + entry.bufferPct);
  return roundTo25(dosage);
}

// ---------- PDF (uses profile for header) ----------
function generateInvoicePDF(inv, profile) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;
  doc.setFont("helvetica", "normal");

  // Franchisee header
  doc.setFontSize(16);
  doc.text(profile?.name || "Franchisee", margin, 40);
  doc.setFontSize(11);
  const addrLines = String(profile?.address || "").split(/\n|, /g).filter(Boolean);
  addrLines.slice(0, 3).forEach((t, i) => doc.text(t, margin, 58 + i * 14));
  let y = 58 + addrLines.length * 14 + 4;
  doc.text(`Franchisee ID: ${profile?.franchisee_id || ""}`, margin, y); y += 14;
  doc.text(`GSTIN: ${profile?.gstin || ""}`, margin, y);

  // Invoice meta
  const created = inv.created_at ? new Date(inv.created_at) : new Date();
  const dateStr = created.toLocaleString();
  doc.text(`Invoice ID: ${inv.id}`, pageWidth - margin, 40, { align: "right" });
  doc.text(`Date: ${dateStr}`, pageWidth - margin, 58, { align: "right" });

  // Watermark
  doc.saveGraphicsState && doc.saveGraphicsState();
  doc.setFontSize(56);
  doc.setTextColor(210);
  doc.text("MaxTT Billing", pageWidth / 2, 380, { angle: 35, align: "center" });
  doc.setTextColor(0);
  doc.restoreGraphicsState && doc.restoreGraphicsState();

  // Customer block
  const yCustStart = 120;
  doc.setFontSize(12);
  doc.text("Customer Details", margin, yCustStart);
  doc.setFontSize(11);
  [
    `Name: ${inv.customer_name || ""}`,
    `Mobile: ${inv.mobile_number || ""}`,
    `Vehicle: ${inv.vehicle_number || ""}`,
    `Customer GSTIN: ${inv.customer_gstin || ""}`,
    `Address: ${inv.customer_address || ""}`,
    `Installer: ${inv.installer_name || ""}`
  ].forEach((t, i) => doc.text(t, margin, yCustStart + 18 + i * 16));

  // Tyre/Vehicle block
  const yTyreStart = yCustStart;
  const xRight = pageWidth / 2 + 20;
  doc.setFontSize(12);
  doc.text("Tyre / Vehicle", xRight, yTyreStart);
  doc.setFontSize(11);
  const perTyre = inv.tyre_count ? Math.round((Number(inv.dosage_ml || 0) / inv.tyre_count) / 25) * 25 : null;
  [
    `Vehicle Category: ${inv.vehicle_type || ""}`,
    `Tyres: ${inv.tyre_count ?? ""}`,
    `Tyre Size: ${inv.tyre_width_mm || ""}/${inv.aspect_ratio || ""} R${inv.rim_diameter_in || ""}`,
    `Tread Depth: ${inv.tread_depth_mm ?? ""} mm`,
    `Fitment: ${inv.fitment_locations || ""}`,
    `Per-tyre Dosage: ${perTyre ?? ""} ml`,
    `Total Dosage: ${inv.dosage_ml ?? ""} ml`
  ].forEach((t, i) => doc.text(t, xRight, yTyreStart + 18 + i * 16));

  // Amounts
  const price = Number(inv.price_per_ml ?? 0);
  const before = Number(inv.total_before_gst ?? 0);
  const gst = Number(inv.gst_amount ?? 0);
  const total = Number(inv.total_with_gst ?? 0);
  doc.autoTable({
    startY: yCustStart + 150,
    head: [["Description", "Value"]],
    body: [
      ["Total Dosage (ml)", `${inv.dosage_ml ?? ""}`],
      ["MRP per ml", inr(price)],
      ["Amount (before GST)", inr(before)],
      ["GST", inr(gst)],
      ["Total (with GST)", inr(total)]
    ],
    styles: { fontSize: 11, cellPadding: 6 },
    headStyles: { fillColor: [60, 60, 60] }
  });

  const yAfter = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 24 : 500;
  doc.setFontSize(10);
  doc.text("This invoice is system-generated. Pricing and GST are computed per configured rates.", margin, yAfter);

  doc.save(`MaxTT_Invoice_${inv.id || "draft"}.pdf`);
}

// ---------- Login View ----------
function LoginView({ onLoggedIn }) {
  const [fid, setFid] = useState("");
  const [fpw, setFpw] = useState("");
  const [err, setErr] = useState("");

  async function doLogin() {
    setErr("");
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: fid, password: fpw })
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error === "invalid_credentials" ? "Invalid ID or password" : "Login failed");
        return;
      }
      localStorage.setItem("maxtt_token", data.token);
      onLoggedIn(data.token);
    } catch {
      setErr("Network error");
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "120px auto", padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>Franchisee Login</h2>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        <input placeholder="Franchisee ID" value={fid} onChange={e => setFid(e.target.value)} />
        <input placeholder="Password" type="password" value={fpw} onChange={e => setFpw(e.target.value)} />
        {err && <div style={{ color: "crimson" }}>{err}</div>}
        <button onClick={doLogin}>Login</button>
      </div>
    </div>
  );
}

// ---------- Invoices list (filters + auto-search + export + details) ----------
function RecentInvoices({ token, profile, onOpenDetails }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // filters
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState(null);

  const headersAuth = { Authorization: `Bearer ${token}` };

  const fetchRows = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("limit", "500");

    fetch(`${API_URL}/api/invoices?${params.toString()}`, { headers: headersAuth })
      .then(r => r.json())
      .then(data => { setRows(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError("Could not load invoices"); setLoading(false); });

    // summary
    fetch(`${API_URL}/api/summary?${params.toString()}`, { headers: headersAuth })
      .then(r => r.json()).then(setSummary).catch(() => setSummary(null));
  }, [q, from, to, token]);

  // 🔄 Auto-search when you type (debounced)
  useEffect(() => {
    const t = setTimeout(fetchRows, 400);
    return () => clearTimeout(t);
  }, [q, from, to, fetchRows]);

  // initial load
  useEffect(() => {
    fetchRows();
    const onUpdated = () => fetchRows();
    window.addEventListener("invoices-updated", onUpdated);
    return () => window.removeEventListener("invoices-updated", onUpdated);
  }, [fetchRows]);

  function exportCsv() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    fetch(`${API_URL}/api/invoices/export?${params.toString()}`, { headers: headersAuth })
      .then(async (r) => {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "invoices_export.csv";
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
      })
      .catch(() => alert("Export failed"));
  }

  function onPressEnter(e) {
    if (e.key === "Enter") fetchRows();
  }

  if (loading) return <div style={{ marginTop: 20 }}>Loading recent invoices…</div>;
  if (error) return <div style={{ marginTop: 20, color: "crimson" }}>{error}</div>;

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Invoices</h2>

      {/* Filters */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
        marginBottom: 10, border: "1px solid #eee", padding: 8, borderRadius: 6
      }}>
        <input
          placeholder="Search name or vehicle no."
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onPressEnter}
          style={{ flex: 1, minWidth: 280 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          From:
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          To:
          <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <button onClick={fetchRows}>Apply</button>
        <button onClick={() => { setQ(""); setFrom(""); setTo(""); }}>Show All</button>
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      {/* Summary */}
      {summary && (
        <div style={{ marginBottom: 10, background: "#f7f7f7", padding: 8, borderRadius: 6 }}>
          <strong>Summary:</strong> &nbsp;
          Count: {summary.count} &nbsp; | &nbsp;
          Total Dosage: {summary.dosage_ml} ml &nbsp; | &nbsp;
          Before GST: {inr(summary.total_before_gst)} &nbsp; | &nbsp;
          GST: {inr(summary.gst_amount)} &nbsp; | &nbsp;
          Total: {inr(summary.total_with_gst)}
        </div>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        <div>No invoices found.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table border="1" cellPadding="6" style={{ minWidth: 1260 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Date/Time</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Category</th>
                <th>Tyres</th>
                <th>Fitment</th>
                <th>Total Dosage (ml)</th>
                <th>Total (₹)</th>
                <th>PDF</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.customer_name ?? ""}</td>
                  <td>{r.vehicle_number ?? ""}</td>
                  <td>{r.vehicle_type ?? ""}</td>
                  <td>{r.tyre_count ?? ""}</td>
                  <td>{r.fitment_locations || ""}</td>
                  <td>{r.dosage_ml ?? ""}</td>
                  <td>{inr(r.total_with_gst)}</td>
                  <td><button onClick={() => generateInvoicePDF(r, profile)}>PDF</button></td>
                  <td><button onClick={() => onOpenDetails(r.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- Details + Edit modal ----------
function DetailsModal({ token, invoiceId, profile, onClose, onEdited }) {
  const [inv, setInv] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetch(`${API_URL}/api/invoices/${invoiceId}`, { headers: authHeaders })
      .then(r => r.json()).then(setInv).catch(() => setInv(null));
  }, [invoiceId]);

  useEffect(() => {
    if (inv) {
      setForm({
        customer_name: inv.customer_name || "",
        mobile_number: inv.mobile_number || "",
        vehicle_number: inv.vehicle_number || "",
        odometer: inv.odometer ?? "",
        tread_depth_mm: inv.tread_depth_mm ?? "",
        installer_name: inv.installer_name || "",
        vehicle_type: inv.vehicle_type || "4-Wheeler (Passenger car/van/SUV)",
        tyre_width_mm: inv.tyre_width_mm ?? "",
        aspect_ratio: inv.aspect_ratio ?? "",
        rim_diameter_in: inv.rim_diameter_in ?? "",
        tyre_count: inv.tyre_count ?? "",
        customer_gstin: inv.customer_gstin || "",
        customer_address: inv.customer_address || "",
        dosage_ml: inv.dosage_ml ?? "",
        fitment_FL: (inv.fitment_locations || "").includes("Front Left"),
        fitment_FR: (inv.fitment_locations || "").includes("Front Right"),
        fitment_RL: (inv.fitment_locations || "").includes("Rear Left"),
        fitment_RR: (inv.fitment_locations || "").includes("Rear Right")
      });
    }
  }, [inv]);

  if (!inv) {
    return (
      <div style={modalWrap}>
        <div style={modalBox}>
          <div>Loading…</div>
          <div style={{ textAlign: "right", marginTop: 10 }}>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  function currentFitmentText() {
    const parts = [];
    if (form.fitment_FL) parts.push("Front Left");
    if (form.fitment_FR) parts.push("Front Right");
    if (form.fitment_RL) parts.push("Rear Left");
    if (form.fitment_RR) parts.push("Rear Right");
    return parts.join(", ");
  }

  async function saveEdits() {
    const payload = {
      ...form,
      odometer: form.odometer === "" ? null : Number(form.odometer),
      tread_depth_mm: form.tread_depth_mm === "" ? null : Number(form.tread_depth_mm),
      tyre_width_mm: form.tyre_width_mm === "" ? null : Number(form.tyre_width_mm),
      aspect_ratio: form.aspect_ratio === "" ? null : Number(form.aspect_ratio),
      rim_diameter_in: form.rim_diameter_in === "" ? null : Number(form.rim_diameter_in),
      tyre_count: form.tyre_count === "" ? null : Number(form.tyre_count),
      dosage_ml: form.dosage_ml === "" ? null : Number(form.dosage_ml),
      fitment_locations: currentFitmentText()
    };

    try {
      const res = await fetch(`${API_URL}/api/invoices/${invoiceId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Update failed: " + (data?.error || "unknown_error"));
        return;
      }
      alert("Invoice updated");
      setEditing(false);
      onEdited && onEdited();
      // refresh invoice
      fetch(`${API_URL}/api/invoices/${invoiceId}`, { headers: authHeaders })
        .then(r => r.json()).then(setInv).catch(() => {});
      window.dispatchEvent(new Event("invoices-updated"));
    } catch {
      alert("Network error");
    }
  }

  return (
    <div style={modalWrap}>
      <div style={modalBox}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Invoice #{inv.id}</h3>
          <div>
            <button onClick={() => generateInvoicePDF(inv, profile)} style={{ marginRight: 8 }}>Reprint PDF</button>
            {!editing && <button onClick={() => setEditing(true)} style={{ marginRight: 8 }}>Edit</button>}
            {editing && <button onClick={saveEdits} style={{ marginRight: 8 }}>Save</button>}
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        {!editing ? (
          <div style={{ marginTop: 10 }}>
            <div><strong>Date:</strong> {new Date(inv.created_at).toLocaleString()}</div>
            <div><strong>Customer:</strong> {inv.customer_name} ({inv.mobile_number || "-"})</div>
            <div><strong>Vehicle:</strong> {inv.vehicle_number}</div>
            <div><strong>Category:</strong> {inv.vehicle_type} &nbsp; <strong>Tyres:</strong> {inv.tyre_count}</div>
            <div><strong>Tyre Size:</strong> {inv.tyre_width_mm}/{inv.aspect_ratio} R{inv.rim_diameter_in}</div>
            <div><strong>Tread Depth:</strong> {inv.tread_depth_mm} mm</div>
            <div><strong>Fitment:</strong> {inv.fitment_locations || "-"}</div>
            <div><strong>Customer GSTIN:</strong> {inv.customer_gstin || "-"}</div>
            <div><strong>Address:</strong> {inv.customer_address || "-"}</div>
            <div><strong>Total Dosage:</strong> {inv.dosage_ml} ml</div>
            <div><strong>Total (with GST):</strong> {inr(inv.total_with_gst)}</div>
            <div style={{ color: "#888", marginTop: 6 }}>Updated: {new Date(inv.updated_at).toLocaleString()}</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <input placeholder="Customer Name" value={form.customer_name} onChange={e => setForm(f => ({...f, customer_name: e.target.value}))} />
            <input placeholder="Mobile Number" value={form.mobile_number} onChange={e => setForm(f => ({...f, mobile_number: e.target.value}))} />
            <input placeholder="Vehicle Number" value={form.vehicle_number} onChange={e => setForm(f => ({...f, vehicle_number: e.target.value}))} />
            <input placeholder="Odometer" value={form.odometer} onChange={e => setForm(f => ({...f, odometer: e.target.value}))} />
            <input placeholder="Tread Depth (mm)" value={form.tread_depth_mm} onChange={e => setForm(f => ({...f, tread_depth_mm: e.target.value}))} />
            <input placeholder="Installer Name" value={form.installer_name} onChange={e => setForm(f => ({...f, installer_name: e.target.value}))} />

            <input placeholder="Vehicle Category" value={form.vehicle_type} onChange={e => setForm(f => ({...f, vehicle_type: e.target.value}))} />
            <input placeholder="Tyre Width (mm)" value={form.tyre_width_mm} onChange={e => setForm(f => ({...f, tyre_width_mm: e.target.value}))} />
            <input placeholder="Aspect Ratio (%)" value={form.aspect_ratio} onChange={e => setForm(f => ({...f, aspect_ratio: e.target.value}))} />
            <input placeholder="Rim Diameter (in)" value={form.rim_diameter_in} onChange={e => setForm(f => ({...f, rim_diameter_in: e.target.value}))} />
            <input placeholder="Tyre Count" value={form.tyre_count} onChange={e => setForm(f => ({...f, tyre_count: e.target.value}))} />

            <input placeholder="Customer GSTIN" value={form.customer_gstin} onChange={e => setForm(f => ({...f, customer_gstin: e.target.value}))} />
            <input placeholder="Customer Address" value={form.customer_address} onChange={e => setForm(f => ({...f, customer_address: e.target.value}))} />

            <input placeholder="Total Dosage (ml)" value={form.dosage_ml} onChange={e => setForm(f => ({...f, dosage_ml: e.target.value}))} />

            <div style={{ gridColumn: "1 / span 2", marginTop: 6 }}>
              <div><strong>Fitment (tick):</strong></div>
              <label style={{ marginRight: 12 }}>
                <input type="checkbox" checked={form.fitment_FL} onChange={e => setForm(f => ({...f, fitment_FL: e.target.checked}))} /> Front Left
              </label>
              <label style={{ marginRight: 12 }}>
                <input type="checkbox" checked={form.fitment_FR} onChange={e => setForm(f => ({...f, fitment_FR: e.target.checked}))} /> Front Right
              </label>
              <label style={{ marginRight: 12 }}>
                <input type="checkbox" checked={form.fitment_RL} onChange={e => setForm(f => ({...f, fitment_RL: e.target.checked}))} /> Rear Left
              </label>
              <label style={{ marginRight: 12 }}>
                <input type="checkbox" checked={form.fitment_RR} onChange={e => setForm(f => ({...f, fitment_RR: e.target.checked}))} /> Rear Right
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
const modalWrap = { position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const modalBox  = { background: "#fff", borderRadius: 8, padding: 12, maxWidth: 900, width: "100%" };

// ---------- Main App ----------
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("maxtt_token") || "");
  const [profile, setProfile] = useState(null);
  const [showDetailsId, setShowDetailsId] = useState(null);

  // Franchisee profile (after login)
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setProfile).catch(() => setProfile(null));
  }, [token]);

  // ======== Create Invoice form (same as before, auto-PDF after save) ========
  const [customerName, setCustomerName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [odometer, setOdometer] = useState("");
  const [treadDepth, setTreadDepth] = useState("");
  const [installerName, setInstallerName] = useState("");

  const [vehicleType, setVehicleType] = useState("4-Wheeler (Passenger car/van/SUV)");
  const [tyreWidth, setTyreWidth] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [rimDiameter, setRimDiameter] = useState("");
  const [tyreCount, setTyreCount] = useState(4);

  const [dosagePerTyre, setDosagePerTyre] = useState(null);
  const [dosageTotal, setDosageTotal] = useState(null);

  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");

  const [fitFL, setFitFL] = useState(false);
  const [fitFR, setFitFR] = useState(false);
  const [fitRL, setFitRL] = useState(false);
  const [fitRR, setFitRR] = useState(false);

  function onVehicleTypeChange(v) {
    setVehicleType(v);
    const cfg = VEHICLE_CFG[v] || VEHICLE_CFG["4-Wheeler (Passenger car/van/SUV)"];
    setTyreCount(cfg.defaultTyres);
  }

  function selectedFitmentsToText() {
    const parts = [];
    if (fitFL) parts.push("Front Left");
    if (fitFR) parts.push("Front Right");
    if (fitRL) parts.push("Rear Left");
    if (fitRR) parts.push("Rear Right");
    return parts.join(", ");
  }

  async function saveInvoiceToServer(payload) {
    try {
      const res = await fetch(`${API_URL}/api/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Save failed: " + (data?.error || "unknown_error"));
        return null;
      }
      window.dispatchEvent(new Event("invoices-updated"));
      return data; // {id, totals}
    } catch {
      alert("Network error while saving invoice");
      return null;
    }
  }

  const handleCalculateAndSave = async () => {
    if (Number(treadDepth || 0) < 1.5) { alert("Installation blocked: Tread depth below 1.5mm."); return; }
    const tCount = parseInt(tyreCount || "0", 10);
    if (!tCount || tCount < 1) { alert("Please select number of tyres."); return; }

    const perTyre = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const totalMl = perTyre * tCount;

    setDosagePerTyre(perTyre);
    setDosageTotal(totalMl);

    if (!customerName || !vehicleNumber) { alert("Please fill Customer Name and Vehicle Number to save invoice."); return; }

    const fitmentText = selectedFitmentsToText();

    const saved = await saveInvoiceToServer({
      customer_name: customerName,
      mobile_number: mobileNumber || null,
      vehicle_number: vehicleNumber,
      odometer: Number(odometer || 0),
      tread_depth_mm: Number(treadDepth || 0),
      installer_name: installerName || null,
      vehicle_type: vehicleType,
      tyre_width_mm: Number(tyreWidth || 0),
      aspect_ratio: Number(aspectRatio || 0),
      rim_diameter_in: Number(rimDiameter || 0),
      dosage_ml: Number(totalMl),
      gps_lat: null, gps_lng: null, customer_code: null,
      tyre_count: tCount,
      fitment_locations: fitmentText || null,
      customer_gstin: gstin || null,
      customer_address: address || null
    });

    if (saved?.id) {
      alert(`Invoice saved. ID: ${saved.id}`);
      // Auto-open PDF: fetch the saved invoice and print
      const inv = await fetch(`${API_URL}/api/invoices/${saved.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).catch(() => null);
      if (inv) generateInvoicePDF(inv, profile);
    }
  };

  if (!token) return <LoginView onLoggedIn={setToken} />;

  return (
    <div style={{ maxWidth: 1220, margin: "20px auto", padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>MaxTT Billing & Dosage Calculator</h1>
        <button onClick={() => { localStorage.removeItem("maxtt_token"); setToken(""); }}>Logout</button>
      </div>

      {profile && (
        <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
          <strong>Franchisee:</strong> {profile.name} &nbsp;|&nbsp;
          <strong>ID:</strong> {profile.franchisee_id} &nbsp;|&nbsp;
          <strong>GSTIN:</strong> {profile.gstin}
          <div style={{ color: "#666" }}>{profile.address}</div>
        </div>
      )}

      {/* Create Invoice */}
      <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8 }}>
        <h3 style={{ marginTop: 0 }}>Create New Invoice</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <input placeholder="Customer Name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          <input placeholder="Vehicle Number" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} />
          <input placeholder="Mobile Number" value={mobileNumber} onChange={e => setMobileNumber(e.target.value)} />
          <input placeholder="Odometer Reading" value={odometer} onChange={e => setOdometer(e.target.value)} />
          <input placeholder="Tread Depth (mm)" value={treadDepth} onChange={e => setTreadDepth(e.target.value)} />
          <input placeholder="Installer Name" value={installerName} onChange={e => setInstallerName(e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ marginRight: 8 }}>Vehicle Category</label>
            <select value={vehicleType} onChange={e => { setVehicleType(e.target.value); onVehicleTypeChange(e.target.value); }}>
              {Object.keys(VEHICLE_CFG).map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label style={{ marginRight: 8 }}>Number of Tyres</label>
            <select value={tyreCount} onChange={e => setTyreCount(e.target.value)}>
              {(VEHICLE_CFG[vehicleType]?.options || [4]).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          <input placeholder="Tyre Width (mm)" value={tyreWidth} onChange={e => setTyreWidth(e.target.value)} />
          <input placeholder="Aspect Ratio (%)" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} />
          <input placeholder="Rim Diameter (in)" value={rimDiameter} onChange={e => setRimDiameter(e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <input placeholder="Customer GSTIN (optional)" value={gstin} onChange={e => setGstin(e.target.value)} />
          <input placeholder="Billing Address (optional)" value={address} onChange={e => setAddress(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}><strong>Fitment Location:</strong></div>
          <label style={{ marginRight: 12 }}>
            <input type="checkbox" checked={fitFL} onChange={e => setFitFL(e.target.checked)} /> Front Left
          </label>
          <label style={{ marginRight: 12 }}>
            <input type="checkbox" checked={fitFR} onChange={e => setFitFR(e.target.checked)} /> Front Right
          </label>
          <label style={{ marginRight: 12 }}>
            <input type="checkbox" checked={fitRL} onChange={e => setFitRL(e.target.checked)} /> Rear Left
          </label>
          <label style={{ marginRight: 12 }}>
            <input type="checkbox" checked={fitRR} onChange={e => setFitRR(e.target.checked)} /> Rear Right
          </label>
        </div>

        <button onClick={handleCalculateAndSave}>Calculate Dosage & Save (Auto PDF)</button>

        {(dosagePerTyre !== null || dosageTotal !== null) && (
          <div style={{ marginTop: 12 }}>
            {dosagePerTyre !== null && (<div><strong>Per-tyre Dosage:</strong> {dosagePerTyre} ml</div>)}
            {dosageTotal !== null && (<div><strong>Total Dosage:</strong> {dosageTotal} ml for {tyreCount} tyres</div>)}
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              (Per-tyre rounded to nearest 25 ml; includes buffer by category)
            </div>
          </div>
        )}
      </div>

      {/* Invoices list, filters, export, summary, details */}
      <RecentInvoices
        token={token}
        profile={profile}
        onOpenDetails={(id) => setShowDetailsId(id)}
      />

      {showDetailsId && (
        <DetailsModal
          token={token}
          invoiceId={showDetailsId}
          profile={profile}
          onClose={() => setShowDetailsId(null)}
          onEdited={() => {}}
        />
      )}
    </div>
  );
}
