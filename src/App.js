// src/App.js — Single-file UI (consent signature + CSV + invoices)
// Paste this entire file into src/App.js

import React, { useState, useEffect, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

// Backend API base
const API_URL =
  process.env.REACT_APP_API_BASE_URL || "https://maxtt-billing-api.onrender.com";

// If your backend expects a key for writes, put it here or via env in build:
const API_KEY = "supersecret123";

// -------- Money formatting (INR) --------
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

// -------- Vehicle dosage config --------
const VEHICLE_CFG = {
  "2-Wheeler (Scooter/Motorcycle)": { k: 2.6, bufferPct: 0.03, defaultTyres: 2, options: [2] },
  "3-Wheeler (Auto)": { k: 2.2, bufferPct: 0.03, defaultTyres: 3, options: [3] },
  "4-Wheeler (Passenger Car/Van/SUV)": { k: 2.56, bufferPct: 0.08, defaultTyres: 4, options: [4] },
  "6-Wheeler (Bus/LTV)": { k: 3.0, bufferPct: 0.05, defaultTyres: 6, options: [6] },
  "HTV (>6 wheels: Trucks/Trailers/Mining)": {
    k: 3.0, bufferPct: 0.05, defaultTyres: 8, options: [8, 10, 12, 14, 16, 18],
  },
};
const TREAD_MIN_MM = {
  "2-Wheeler (Scooter/Motorcycle)": 1.5,
  "3-Wheeler (Auto)": 1.5,
  "4-Wheeler (Passenger Car/Van/SUV)": 1.5,
  "6-Wheeler (Bus/LTV)": 1.5,
  "HTV (>6 wheels: Trucks/Trailers/Mining)": 1.5,
};
const minTreadFor = (v) => TREAD_MIN_MM[v] ?? 1.5;
const roundTo25 = (x) => Math.round(x / 25) * 25;
function computePerTyreDosageMl(vehicleType, widthMm, aspectPct, rimIn) {
  const entry = VEHICLE_CFG[vehicleType] || VEHICLE_CFG["4-Wheeler (Passenger Car/Van/SUV)"];
  const widthIn = Number(widthMm || 0) * 0.03937;
  const totalHeightIn = widthIn * (Number(aspectPct || 0) / 100) * 2 + Number(rimIn || 0);
  let dosage = widthIn * totalHeightIn * entry.k;
  dosage = dosage * (1 + entry.bufferPct);
  return roundTo25(dosage);
}

// -------- Fitment helpers --------
function fitmentSchema(vehicleType, tyreCount) {
  if (vehicleType === "2-Wheeler (Scooter/Motorcycle)") {
    return { mode: "list", labels: ["Front", "Rear"] };
  }
  if (vehicleType === "3-Wheeler (Auto)") {
    return { mode: "list", labels: ["Front", "Rear Left", "Rear Right"] };
  }
  if (vehicleType.startsWith("4-Wheeler")) {
    return { mode: "list", labels: ["Front Left", "Front Right", "Rear Left", "Rear Right"] };
  }
  const t = Number(tyreCount || 0);
  const rearEach = Math.max(2, Math.floor((t - 2) / 2));
  return {
    mode: "grouped",
    labels: ["Front Left", "Front Right", `Rear Left ×${rearEach}`, `Rear Right ×${rearEach}`],
    rearEach,
  };
}
const textFromFitState = (stateObj) =>
  Object.entries(stateObj)
    .filter(([, v]) => !!v)
    .map(([k]) => k)
    .join(", ");

// -------- PDF generation --------
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
  doc.text(`Franchisee ID: ${profile?.franchisee_id || ""}`, margin, y);
  y += 14;
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
  doc.text("MaxTT Billing", pageWidth / 2, 360, { angle: 35, align: "center" });
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
    `Installer: ${inv.installer_name || ""}`,
  ].forEach((t, i) => doc.text(t, margin, yCustStart + 18 + i * 16));

  // Tyre/Vehicle block
  const yTyreStart = yCustStart;
  const xRight = pageWidth / 2 + 20;
  doc.setFontSize(12);
  doc.text("Tyre / Vehicle", xRight, yTyreStart);
  doc.setFontSize(11);
  const perTyre = inv.tyre_count
    ? Math.round((Number(inv.dosage_ml || 0) / inv.tyre_count) / 25) * 25
    : null;
  [
    `Vehicle Category: ${inv.vehicle_type || ""}`,
    `Tyres: ${inv.tyre_count ?? ""}`,
    `Tyre Size: ${inv.tyre_width_mm || ""}/${inv.aspect_ratio || ""} R${inv.rim_diameter_in || ""}`,
    `Tread Depth: ${inv.tread_depth_mm ?? ""} mm`,
    `Fitment: ${inv.fitment_locations || ""}`,
    `Per-tyre Dosage: ${perTyre ?? ""} ml`,
    `Total Dosage: ${inv.dosage_ml ?? ""} ml`,
  ].forEach((t, i) => doc.text(t, xRight, yTyreStart + 18 + i * 16));

  // Amounts
  const before = Number(inv.total_before_gst ?? 0);
  const gst = Number(inv.gst_amount ?? 0);
  const total = Number(inv.total_with_gst ?? 0);
  const price = Number(inv.price_per_ml ?? 0);
  doc.autoTable({
    startY: yCustStart + 150,
    head: [["Description", "Value"]],
    body: [
      ["Total Dosage (ml)", `${inv.dosage_ml ?? ""}`],
      ["MRP per ml", inr(price)],
      ["Amount (before GST)", inr(before)],
      ["GST", inr(gst)],
      ["Total (with GST)", inr(total)],
    ],
    styles: { fontSize: 11, cellPadding: 6 },
    headStyles: { fillColor: [60, 60, 60] },
  });

  // Signature block (if present)
  let yAfter =
    doc.lastAutoTable && doc.lastAutoTable.finalY
      ? doc.lastAutoTable.finalY + 18
      : 480;
  doc.setFontSize(11);
  doc.text("Customer Signature:", margin, yAfter);
  if (inv.customer_signature) {
    try {
      doc.addImage(inv.customer_signature, "PNG", margin + 140, yAfter - 14, 140, 50);
    } catch {}
  }
  if (inv.signed_at) {
    const sdt = new Date(inv.signed_at);
    doc.text(`Signed at: ${sdt.toLocaleString()}`, margin + 300, yAfter);
  }
  yAfter += 70;

  // Final Declaration (printed above signature in invoice)
  doc.setFontSize(10);
  const decl = [
    "Customer Declaration",
    "1. I hereby acknowledge that the MaxTT Tyre Sealant installation has been completed on my vehicle to my satisfaction, as per my earlier consent to proceed.",
    "2. I have read, understood, and accepted the Terms & Conditions stated herein.",
    "3. I acknowledge that the total amount shown is correct and payable to the franchisee/installer of Treadstone Solutions.",
  ];
  const maxWidth = pageWidth - margin * 2;
  decl.forEach((p, idx) => {
    const wrapped = doc.splitTextToSize(p, maxWidth);
    if (idx === 0) {
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
    }
    wrapped.forEach((ln) => {
      doc.text(ln, margin, yAfter);
      yAfter += 14;
    });
    if (idx === 0) {
      doc.setFont(undefined, "normal");
      doc.setFontSize(10);
    }
    yAfter += 4;
  });

  // Footer T&C (frozen, always printed)
  const footer = [
    "Terms & Conditions",
    "1. The MaxTT Tyre Sealant, developed in New Zealand and supplied by Treadstone Solutions, is a preventive safety solution designed to reduce tyre-related risks and virtually eliminate punctures and blowouts.",
    "2. Effectiveness is assured only when the vehicle is operated within the speed limits prescribed by the competent traffic/transport authorities (RTO/Transport Department) in India.",
    "3. By signing/accepting this invoice, the customer affirms that the installation has been carried out to their satisfaction and agrees to abide by these conditions.",
  ];
  footer.forEach((p, idx) => {
    const wrapped = doc.splitTextToSize(p, maxWidth);
    if (idx === 0) {
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
    }
    wrapped.forEach((ln) => {
      doc.text(ln, margin, yAfter);
      yAfter += 14;
    });
    if (idx === 0) {
      doc.setFont(undefined, "normal");
      doc.setFontSize(10);
    }
    yAfter += 2;
  });

  doc.save(`MaxTT_Invoice_${inv.id || "draft"}.pdf`);
}

// ===== Login (multi-role) =====
function LoginView({ onLoggedIn }) {
  const [role, setRole] = useState("franchisee"); // franchisee | admin | super_admin
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  async function doLogin() {
    setErr("");
    const path =
      role === "admin"
        ? "/api/admin/login"
        : role === "super_admin"
        ? "/api/sa/login"
        : "/api/login";
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password: pw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error === "invalid_credentials" ? "Invalid credentials" : "Login failed");
        return;
      }
      localStorage.setItem("maxtt_token", data.token);
      localStorage.setItem("maxtt_role", role);
      onLoggedIn({ token: data.token, role });
    } catch {
      setErr("Network error");
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "120px auto", padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>Login</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <label><input type="radio" name="role" checked={role==="franchisee"} onChange={()=>setRole("franchisee")} /> Franchisee</label>
        <label><input type="radio" name="role" checked={role==="admin"} onChange={()=>setRole("admin")} /> Admin</label>
        <label><input type="radio" name="role" checked={role==="super_admin"} onChange={()=>setRole("super_admin")} /> Super Admin</label>
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        <input placeholder={`${role === "franchisee" ? "Franchisee" : role === "admin" ? "Admin" : "Super Admin"} ID`} value={id} onChange={e => setId(e.target.value)} />
        <input placeholder="Password" type="password" value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div style={{ color: "crimson" }}>{err}</div>}
        <button onClick={doLogin}>Login</button>
      </div>
    </div>
  );
}

// ===== SignaturePad with consent text =====
function SignaturePad({ open, onClose, onSave, title = "Customer Signature" }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const TERMS_TEXT = `
Customer Consent to Proceed
1) I have been informed about the MaxTT sealant installation process, pricing and applicable GST.
2) I understand the preventive nature of the product and that effectiveness requires normal, lawful vehicle operation.
3) I consent to proceed and undertake to pay the total invoice amount to the franchisee/installer upon completion.
  `.trim();

  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111";
    setHasStroke(false);
    setAgreed(false);
  }, [open]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => {
    setDrawing(true);
    const { x, y } = getPos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e) => {
    if (!drawing) return;
    const { x, y } = getPos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasStroke(true);
  };
  const end = () => setDrawing(false);

  const clear = () => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasStroke(false);
  };

  const save = () => {
    if (!hasStroke || !agreed) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const nowIso = new Date().toISOString();
    onSave({
      dataUrl,
      consent: { agreed: true, text: TERMS_TEXT, agreedAt: nowIso },
    });
  };

  if (!open) return null;
  return (
    <div style={modalWrap}>
      <div style={{ ...modalBox, maxWidth: 780 }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>

        <div
          style={{
            border: "1px solid #ddd",
            background: "#fbfbfb",
            padding: 10,
            borderRadius: 6,
            maxHeight: 140,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            fontSize: 13,
            lineHeight: 1.35,
            marginBottom: 10,
          }}
        >
          {TERMS_TEXT}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>I have read and agree to the above terms, and consent to proceed.</span>
        </label>

        <div style={{ border: "1px solid #ccc", borderRadius: 6, background: "#fff", touchAction: "none" }}>
          <canvas
            ref={canvasRef}
            width={660}
            height={220}
            style={{ width: "100%", height: 220, display: "block", borderRadius: 6 }}
            onMouseDown={start}
            onMouseMove={move}
            onMouseUp={end}
            onMouseLeave={end}
            onTouchStart={start}
            onTouchMove={move}
            onTouchEnd={end}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <div>
            <button onClick={clear} style={{ marginRight: 8 }}>
              Clear
            </button>
          </div>
          <div>
            <button onClick={onClose} style={{ marginRight: 8 }}>
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!agreed || !hasStroke}
              title={!agreed ? "Tick the consent box first" : !hasStroke ? "Sign in the box first" : ""}
            >
              Use this Signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Invoices list (table + export) =====
function RecentInvoices({ token, profile, onOpenDetails }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
      .then((r) => r.json())
      .then((data) => {
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load invoices");
        setLoading(false);
      });

    fetch(`${API_URL}/api/summary?${params.toString()}`, { headers: headersAuth })
      .then((r) => r.json())
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [q, from, to, token]);

  useEffect(() => {
    const t = setTimeout(fetchRows, 400);
    return () => clearTimeout(t);
  }, [q, from, to, fetchRows]);

  useEffect(() => {
    fetchRows();
    const onUpdated = () => fetchRows();
    window.addEventListener("invoices-updated", onUpdated);
    return () => window.removeEventListener("invoices-updated", onUpdated);
  }, [fetchRows]);

  async function exportCsv() {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`${API_URL}/api/exports/invoices?${params.toString()}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      const disp = res.headers.get("Content-Disposition") || "";
      const name = disp.includes("filename=")
        ? disp.split('filename="')[1]?.split('"')[0] || "invoices.csv"
        : "invoices.csv";
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Export failed");
    }
  }

  if (loading) return <div style={{ marginTop: 20 }}>Loading recent invoices…</div>;
  if (error) return <div style={{ marginTop: 20, color: "crimson" }}>{error}</div>;

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Invoices</h2>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          border: "1px solid #eee",
          padding: 8,
          borderRadius: 6,
        }}
      >
        <input
          placeholder="Search name or vehicle no."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 280 }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          From: <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          To: <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button onClick={fetchRows}>Apply</button>
        <button
          onClick={() => {
            setQ("");
            setFrom("");
            setTo("");
          }}
        >
          Show All
        </button>
        <button onClick={exportCsv}>Export CSV</button>
      </div>

      {summary && (
        <div style={{ marginBottom: 10, background: "#f7f7f7", padding: 8, borderRadius: 6 }}>
          <strong>Summary:</strong> &nbsp; Count: {summary.count} &nbsp; | &nbsp; Total Dosage: {summary.dosage_ml} ml
          &nbsp; | &nbsp; Before GST: {inr(summary.total_before_gst)} &nbsp; | &nbsp; GST: {inr(summary.gst_amount)} &nbsp; | &nbsp; Total: {inr(summary.total_with_gst)}
        </div>
      )}

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
              {rows.map((r) => (
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
                  <td>
                    <button onClick={() => generateInvoicePDF(r, profile)}>PDF</button>
                  </td>
                  <td>
                    <button onClick={() => onOpenDetails(r.id)}>Open</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ===== Invoice details modal (view/edit) =====
function DetailsModal({ token, invoiceId, profile, onClose, onEdited }) {
  const [inv, setInv] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [fit, setFit] = useState({});
  const authHeaders = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    fetch(`${API_URL}/api/invoices/${invoiceId}`, { headers: authHeaders })
      .then((r) => r.json())
      .then(setInv)
      .catch(() => setInv(null));
  }, [invoiceId]);

  useEffect(() => {
    if (inv) {
      const vtype = inv.vehicle_type || "4-Wheeler (Passenger Car/Van/SUV)";
      const schema = fitmentSchema(vtype, inv.tyre_count);
      const selected = {};
      const text = inv.fitment_locations || "";
      schema.labels.forEach((l) => (selected[l] = text.includes(l)));
      setFit(selected);

      setForm({
        customer_name: inv.customer_name || "",
        mobile_number: inv.mobile_number || "",
        vehicle_number: inv.vehicle_number || "",
        odometer: inv.odometer ?? "",
        tread_depth_mm: inv.tread_depth_mm ?? "",
        installer_name: inv.installer_name || "",
        vehicle_type: vtype,
        tyre_width_mm: inv.tyre_width_mm ?? "",
        aspect_ratio: inv.aspect_ratio ?? "",
        rim_diameter_in: inv.rim_diameter_in ?? "",
        tyre_count: inv.tyre_count ?? "",
        customer_gstin: inv.customer_gstin || "",
        customer_address: inv.customer_address || "",
        dosage_ml: inv.dosage_ml ?? "",
        customer_signature: inv.customer_signature || "",
        signed_at: inv.signed_at || "",
      });
    }
  }, [inv]);

  function onChangeVehicleType(v) {
    setForm((f) => ({ ...f, vehicle_type: v }));
    const schema = fitmentSchema(v, form.tyre_count);
    const next = {};
    schema.labels.forEach((l) => (next[l] = false));
    setFit(next);
  }
  function onChangeTyreCount(n) {
    setForm((f) => ({ ...f, tyre_count: n }));
    const schema = fitmentSchema(form.vehicle_type, n);
    const next = {};
    schema.labels.forEach((l) => (next[l] = false));
    setFit(next);
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
      fitment_locations: textFromFitState(fit),
    };

    try {
      const res = await fetch(`${API_URL}/api/invoices/${invoiceId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Update failed: " + (data?.error || "unknown_error"));
        return;
      }
      alert("Invoice updated");
      setEditing(false);
      onEdited && onEdited();
      fetch(`${API_URL}/api/invoices/${invoiceId}`, { headers: authHeaders })
        .then((r) => r.json())
        .then(setInv)
        .catch(() => {});
      window.dispatchEvent(new Event("invoices-updated"));
    } catch {
      alert("Network error");
    }
  }

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

  const editSchema = fitmentSchema(form.vehicle_type, form.tyre_count);

  return (
    <div style={modalWrap}>
      <div style={modalBox}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0 }}>Invoice #{inv.id}</h3>
          <div>
            <button onClick={() => generateInvoicePDF(inv, profile)} style={{ marginRight: 8 }}>
              Reprint PDF
            </button>
            {!editing && (
              <button onClick={() => setEditing(true)} style={{ marginRight: 8 }}>
                Edit
              </button>
            )}
            {editing && (
              <button onClick={saveEdits} style={{ marginRight: 8 }}>
                Save
              </button>
            )}
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        {!editing ? (
          <div style={{ marginTop: 10 }}>
            <div>
              <strong>Date:</strong> {new Date(inv.created_at).toLocaleString()}
            </div>
            <div>
              <strong>Customer:</strong> {inv.customer_name} ({inv.mobile_number || "-"})
            </div>
            <div>
              <strong>Vehicle:</strong> {inv.vehicle_number}
            </div>
            <div>
              <strong>Category:</strong> {inv.vehicle_type} &nbsp; <strong>Tyres:</strong> {inv.tyre_count}
            </div>
            <div>
              <strong>Tyre Size:</strong> {inv.tyre_width_mm}/{inv.aspect_ratio} R{inv.rim_diameter_in}
            </div>
            <div>
              <strong>Tread Depth:</strong> {inv.tread_depth_mm} mm
            </div>
            <div>
              <strong>Fitment:</strong> {inv.fitment_locations || "-"}
            </div>
            <div>
              <strong>Total Dosage:</strong> {inv.dosage_ml} ml
            </div>
            <div>
              <strong>Total (with GST):</strong> {inr(inv.total_with_gst)}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            <input
              placeholder="Customer Name"
              value={form.customer_name}
              onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
            />
            <input
              placeholder="Mobile Number"
              value={form.mobile_number}
              onChange={(e) => setForm((f) => ({ ...f, mobile_number: e.target.value }))}
            />
            <input
              placeholder="Vehicle Number"
              value={form.vehicle_number}
              onChange={(e) => setForm((f) => ({ ...f, vehicle_number: e.target.value }))}
            />
            <input
              placeholder="Odometer"
              value={form.odometer}
              onChange={(e) => setForm((f) => ({ ...f, odometer: e.target.value }))}
            />
            <input
              placeholder="Tread Depth (mm)"
              value={form.tread_depth_mm}
              onChange={(e) => setForm((f) => ({ ...f, tread_depth_mm: e.target.value }))}
            />
            <input
              placeholder="Installer Name"
              value={form.installer_name}
              onChange={(e) => setForm((f) => ({ ...f, installer_name: e.target.value }))}
            />

            <div style={{ gridColumn: "1 / span 2" }}>
              <label style={{ marginRight: 8 }}>Vehicle Category</label>
              <select value={form.vehicle_type} onChange={(e) => onChangeVehicleType(e.target.value)}>
                <option>2-Wheeler (Scooter/Motorcycle)</option>
                <option>3-Wheeler (Auto)</option>
                <option>4-Wheeler (Passenger Car/Van/SUV)</option>
                <option>6-Wheeler (Bus/LTV)</option>
                <option>HTV (>6 wheels: Trucks/Trailers/Mining)</option>
              </select>
            </div>

            <input
              placeholder="Tyre Width (mm)"
              value={form.tyre_width_mm}
              onChange={(e) => setForm((f) => ({ ...f, tyre_width_mm: e.target.value }))}
            />
            <input
              placeholder="Aspect Ratio (%)"
              value={form.aspect_ratio}
              onChange={(e) => setForm((f) => ({ ...f, aspect_ratio: e.target.value }))}
            />
            <input
              placeholder="Rim Diameter (in)"
              value={form.rim_diameter_in}
              onChange={(e) => setForm((f) => ({ ...f, rim_diameter_in: e.target.value }))}
            />
            <input
              placeholder="Tyre Count"
              value={form.tyre_count}
              onChange={(e) => onChangeTyreCount(e.target.value)}
            />

            <input
              placeholder="Customer GSTIN"
              value={form.customer_gstin}
              onChange={(e) => setForm((f) => ({ ...f, customer_gstin: e.target.value }))}
            />
            <input
              placeholder="Customer Address"
              value={form.customer_address}
              onChange={(e) => setForm((f) => ({ ...f, customer_address: e.target.value }))}
            />

            <input
              placeholder="Total Dosage (ml)"
              value={form.dosage_ml}
              onChange={(e) => setForm((f) => ({ ...f, dosage_ml: e.target.value }))}
            />

            <div style={{ gridColumn: "1 / span 2", marginTop: 6 }}>
              <div>
                <strong>Fitment (tick):</strong>
              </div>
              {editSchema.labels.map((label) => (
                <label key={label} style={{ marginRight: 12 }}>
                  <input
                    type="checkbox"
                    checked={!!fit[label]}
                    onChange={(e) =>
                      setFit((prev) => ({ ...prev, [label]: e.target.checked }))
                    }
                  />{" "}
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const modalWrap = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};
const modalBox = { background: "#fff", borderRadius: 8, padding: 12, maxWidth: 900, width: "100%" };

// ===== Franchisee App =====
function FranchiseeApp({ token, onLogout }) {
  const [profile, setProfile] = useState(null);

  const [sigOpen, setSigOpen] = useState(false);
  const [signatureData, setSignatureData] = useState("");
  const [consentMeta, setConsentMeta] = useState(null); // {agreed, text, agreedAt}

  // Form fields
  const [customerName, setCustomerName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [odometer, setOdometer] = useState("");
  const [treadDepth, setTreadDepth] = useState("");
  const [installerName, setInstallerName] = useState("");

  const [vehicleType, setVehicleType] = useState("4-Wheeler (Passenger Car/Van/SUV)");
  const [tyreWidth, setTyreWidth] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [rimDiameter, setRimDiameter] = useState("");
  const [tyreCount, setTyreCount] = useState(4);

  const [gstin, setGstin] = useState("");
  const [address, setAddress] = useState("");
  const [fit, setFit] = useState(() => {
    const init = {};
    fitmentSchema("4-Wheeler (Passenger Car/Van/SUV)", 4).labels.forEach((l) => (init[l] = false));
    return init;
  });

  useEffect(() => {
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (r.status === 401) {
          localStorage.removeItem("maxtt_token");
          localStorage.removeItem("maxtt_role");
          window.location.reload();
          return null;
        }
        return r.json();
      })
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [token]);

  function onVehicleTypeChange(v) {
    setVehicleType(v);
    const cfg = VEHICLE_CFG[v] || VEHICLE_CFG["4-Wheeler (Passenger Car/Van/SUV)"];
    const nextTyres = cfg.defaultTyres;
    setTyreCount(nextTyres);
    const schema = fitmentSchema(v, nextTyres);
    const next = {};
    schema.labels.forEach((l) => (next[l] = false));
    setFit(next);
  }
  function onTyreCountChange(n) {
    setTyreCount(n);
    const schema = fitmentSchema(vehicleType, n);
    const next = {};
    schema.labels.forEach((l) => (next[l] = false));
    setFit(next);
  }

  async function saveInvoiceToServer(payload) {
    try {
      const res = await fetch(`${API_URL}/api/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        localStorage.removeItem("maxtt_token");
        localStorage.removeItem("maxtt_role");
        alert("Session expired. Please log in again.");
        window.location.reload();
        return null;
      }
      const data = await res.json();
      if (!res.ok) {
        alert("Save failed: " + (data?.error || "unknown_error"));
        return null;
      }
      window.dispatchEvent(new Event("invoices-updated"));
      return data;
    } catch {
      alert("Network error while saving invoice");
      return null;
    }
  }

  const handleCalculateAndSave = async () => {
    const minTd = minTreadFor(vehicleType);
    if (Number(treadDepth || 0) < minTd) {
      alert(`Installation blocked: Tread depth below ${minTd} mm for this category.`);
      return;
    }
    if (!customerName || !vehicleNumber) {
      alert("Please fill Customer Name and Vehicle Number.");
      return;
    }

    if (!signatureData) {
      setSigOpen(true);
      return;
    }

    const tCount = parseInt(tyreCount || "0", 10);
    if (!tCount || tCount < 1) {
      alert("Please select number of tyres.");
      return;
    }

    const perTyre = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const totalMl = perTyre * tCount;

    const defaultConsentText =
      "Customer Consent to Proceed: Informed of process, pricing and GST; consents to installation and undertakes to pay upon completion.";
    const consentSnapshot = (consentMeta && consentMeta.text) || defaultConsentText;
    const consentSignedAt = (consentMeta && consentMeta.agreedAt) || new Date().toISOString();

    const declarationSnapshot =
      "Final Declaration: Installation completed to satisfaction; accepts T&C; acknowledges total amount payable.";

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
      tyre_count: tCount,
      fitment_locations: textFromFitState(fit) || null,
      dosage_ml: Number(totalMl),

      customer_gstin: gstin || null,
      customer_address: address || null,

      // Consent captured in popup
      consent_signature: signatureData,
      consent_signed_at: consentSignedAt,
      consent_snapshot: consentSnapshot,

      // Use same signature/time as final signature for now
      customer_signature: signatureData,
      signed_at: consentSignedAt,
      declaration_snapshot: declarationSnapshot,

      gps_lat: null,
      gps_lng: null,
      customer_code: null,
    });

    if (saved?.id) {
      alert(`Invoice saved. ID: ${saved.id}`);
      const inv = await fetch(`${API_URL}/api/invoices/${saved.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .catch(() => null);
      if (inv) generateInvoicePDF(inv, profile);
      setSignatureData("");
      setConsentMeta(null);
    }
  };

  // Details modal wiring (optional open)
  const [openId, setOpenId] = useState(null);

  return (
    <div style={{ maxWidth: 1220, margin: "20px auto", padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>MaxTT Billing & Dosage Calculator</h1>
        <button
          onClick={() => {
            localStorage.removeItem("maxtt_token");
            localStorage.removeItem("maxtt_role");
            onLogout();
          }}
        >
          Logout
        </button>
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
          <input placeholder="Customer Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          <input placeholder="Vehicle Number" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
          <input placeholder="Mobile Number" value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} />
          <input placeholder="Odometer Reading" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          <div>
            <input placeholder="Tread Depth (mm)" value={treadDepth} onChange={(e) => setTreadDepth(e.target.value)} />
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
              Minimum for this category: <strong>{minTreadFor(vehicleType)} mm</strong>
            </div>
          </div>
          <input placeholder="Installer Name" value={installerName} onChange={(e) => setInstallerName(e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ marginRight: 8 }}>Vehicle Category</label>
            <select value={vehicleType} onChange={(e) => onVehicleTypeChange(e.target.value)}>
              <option>2-Wheeler (Scooter/Motorcycle)</option>
              <option>3-Wheeler (Auto)</option>
              <option>4-Wheeler (Passenger Car/Van/SUV)</option>
              <option>6-Wheeler (Bus/LTV)</option>
              <option>HTV (>6 wheels: Trucks/Trailers/Mining)</option>
            </select>
          </div>
          <div>
            <label style={{ marginRight: 8 }}>Number of Tyres</label>
            <select value={tyreCount} onChange={(e) => onTyreCountChange(e.target.value)}>
              {(VEHICLE_CFG[vehicleType]?.options || [4]).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          <input placeholder="Tyre Width (mm)" value={tyreWidth} onChange={(e) => setTyreWidth(e.target.value)} />
          <input placeholder="Aspect Ratio (%)" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} />
          <input placeholder="Rim Diameter (in)" value={rimDiameter} onChange={(e) => setRimDiameter(e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <input placeholder="Customer GSTIN (optional)" value={gstin} onChange={(e) => setGstin(e.target.value)} />
          <input placeholder="Billing Address (optional)" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 6 }}>
            <strong>Fitment Location:</strong>
          </div>
          {fitmentSchema(vehicleType, tyreCount).labels.map((label) => (
            <label key={label} style={{ marginRight: 12 }}>
              <input
                type="checkbox"
                checked={!!fit[label]}
                onChange={(e) => setFit((prev) => ({ ...prev, [label]: e.target.checked }))}
              />{" "}
              {label}
            </label>
          ))}
        </div>

        {!signatureData ? (
          <button onClick={() => setSigOpen(true)} style={{ marginRight: 8 }}>
            Capture Customer Signature
          </button>
        ) : (
          <span style={{ marginRight: 12, color: "green" }}>Signature & consent ✓</span>
        )}
        <button onClick={handleCalculateAndSave}>Calculate Dosage & Save (Auto PDF)</button>
      </div>

      {/* Recent Invoices */}
      <RecentInvoices
        token={token}
        profile={profile}
        onOpenDetails={(id) => setOpenId(id)}
      />

      {/* Signature modal */}
      <SignaturePad
        open={sigOpen}
        onClose={() => setSigOpen(false)}
        onSave={({ dataUrl, consent }) => {
          setSignatureData(dataUrl);
          setConsentMeta(consent || null);
          setSigOpen(false);
        }}
      />

      {/* Details modal */}
      {openId && (
        <DetailsModal
          token={token}
          invoiceId={openId}
          profile={profile}
          onClose={() => setOpenId(null)}
          onEdited={() => {}}
        />
      )}
    </div>
  );
}

// ===== Admin & Super Admin (simplified to invoices only for now) =====
function AdminApp({ token, onLogout }) {
  return (
    <div style={{ maxWidth: 1200, margin: "20px auto", padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Admin Console</h1>
        <button
          onClick={() => {
            localStorage.removeItem("maxtt_token");
            localStorage.removeItem("maxtt_role");
            onLogout();
          }}
        >
          Logout
        </button>
      </div>
      <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10 }}>
        Logged in as <strong>Admin</strong>
      </div>
      <RecentInvoices token={token} profile={null} onOpenDetails={() => {}} />
    </div>
  );
}

function SuperAdminApp({ token, onLogout }) {
  return (
    <div style={{ maxWidth: 1200, margin: "20px auto", padding: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Super Admin Console</h1>
        <button
          onClick={() => {
            localStorage.removeItem("maxtt_token");
            localStorage.removeItem("maxtt_role");
            onLogout();
          }}
        >
          Logout
        </button>
      </div>
      <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10 }}>
        Logged in as <strong>Super Admin</strong>
      </div>
      <RecentInvoices token={token} profile={null} onOpenDetails={() => {}} />
    </div>
  );
}

// ===== Root App =====
export default function App() {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("maxtt_token") || "";
    const role = localStorage.getItem("maxtt_role") || "";
    return token ? { token, role } : null;
  });

  if (!auth) return <LoginView onLoggedIn={setAuth} />;

  if (auth.role === "admin") return <AdminApp token={auth.token} onLogout={() => setAuth(null)} />;
  if (auth.role === "super_admin")
    return <SuperAdminApp token={auth.token} onLogout={() => setAuth(null)} />;
  return <FranchiseeApp token={auth.token} onLogout={() => setAuth(null)} />;
}
