import React, { useState } from "react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

const API_URL = "https://maxtt-billing-api.onrender.com"; // change if needed
const BRAND_NAME = "MaxTT";
const WATERMARK_TEXT = "MaxTT Billing - Treadstone Solutions";
const COMPANY_NAME = "Treadstone Solutions";
const COMPANY_SUB = "MaxTT Billing Prototype";
const CURRENCY_FMT = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

// Vehicle config: K, buffer, default tyre count, and allowed options for dropdown
const VEHICLE_CFG = {
  "Passenger Car": { k: 2.48, bufferPct: 0.08, defaultTyres: 4, options: [4] },
  "SUV / Large":   { k: 2.65, bufferPct: 0.08, defaultTyres: 4, options: [4] },
  "Motorcycle":    { k: 2.60, bufferPct: 0.03, defaultTyres: 2, options: [2, 3] }, // 2/3 as requested
  "Scooter":       { k: 2.20, bufferPct: 0.00, defaultTyres: 2, options: [2] },    // 2/2
  "Light Truck / LCV": { k: 2.20, bufferPct: 0.00, defaultTyres: 4, options: [4] },
  "Truck / Bus (On-road)": { k: 3.00, bufferPct: 0.00, defaultTyres: 6, options: [6] },
  "Mining / Off-Road": { k: 7.00, bufferPct: 0.08, defaultTyres: 4, options: [4] }
};

function roundTo25(x) {
  return Math.round(x / 25) * 25;
}

function computePerTyreDosageMl(vehicleType, widthMm, aspectPct, rimIn) {
  const entry = VEHICLE_CFG[vehicleType] || VEHICLE_CFG["Passenger Car"];
  const widthIn = Number(widthMm || 0) * 0.03937;
  const totalHeightIn = (widthIn * (Number(aspectPct || 0) / 100) * 2) + Number(rimIn || 0);
  let dosage = (widthIn * totalHeightIn * entry.k);
  dosage = dosage * (1 + entry.bufferPct);
  return roundTo25(dosage);
}

// ---------- PDF ----------
function generateInvoicePDF(inv) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  // Watermark
  doc.saveGraphicsState && doc.saveGraphicsState();
  doc.setFontSize(60);
  doc.setTextColor(225);
  doc.text(WATERMARK_TEXT, pageWidth / 2, 400, { angle: 35, align: "center" });
  doc.setTextColor(0);
  doc.restoreGraphicsState && doc.restoreGraphicsState();

  // Header
  doc.setFontSize(20);
  doc.text(COMPANY_NAME, margin, 50);
  doc.setFontSize(11);
  doc.text(COMPANY_SUB, margin, 68);

  // Title + meta
  doc.setFontSize(16);
  doc.text(`${BRAND_NAME} Invoice`, margin, 100);
  const created = inv.created_at ? new Date(inv.created_at) : new Date();
  const dateStr = created.toLocaleString();
  doc.setFontSize(11);
  doc.text(`Invoice ID: ${inv.id}`, pageWidth - margin, 50, { align: "right" });
  doc.text(`Date: ${dateStr}`, pageWidth - margin, 68, { align: "right" });

  // Customer
  const yCustStart = 130;
  doc.setFontSize(12);
  doc.text("Customer Details", margin, yCustStart);
  doc.setFontSize(11);
  const custLines = [
    `Name: ${inv.customer_name || ""}`,
    `Mobile: ${inv.mobile_number || ""}`,
    `Vehicle: ${inv.vehicle_number || ""}`,
    `Installer: ${inv.installer_name || ""}`
  ];
  custLines.forEach((t, i) => doc.text(t, margin, yCustStart + 18 + i * 16));

  // Tyre/Vehicle
  const yTyreStart = yCustStart;
  const xRight = pageWidth / 2 + 20;
  doc.setFontSize(12);
  doc.text("Tyre / Vehicle", xRight, yTyreStart);
  doc.setFontSize(11);
  const perTyre = inv.tyre_count ? Math.round((Number(inv.dosage_ml || 0) / inv.tyre_count) / 25) * 25 : null;
  const tyreLines = [
    `Vehicle Type: ${inv.vehicle_type || ""}`,
    `Tyres: ${inv.tyre_count ?? ""}`,
    `Tyre Size: ${inv.tyre_width_mm || ""}/${inv.aspect_ratio || ""} R${inv.rim_diameter_in || ""}`,
    `Tread Depth: ${inv.tread_depth_mm ?? ""} mm`,
    `Per-tyre Dosage: ${perTyre ?? ""} ml`,
    `Total Dosage: ${inv.dosage_ml ?? ""} ml`
  ];
  tyreLines.forEach((t, i) => doc.text(t, xRight, yTyreStart + 18 + i * 16));

  // Amounts
  const price = Number(inv.price_per_ml ?? 0);
  const before = Number(inv.total_before_gst ?? 0);
  const gst = Number(inv.gst_amount ?? 0);
  const total = Number(inv.total_with_gst ?? 0);

  doc.autoTable({
    startY: yCustStart + 140,
    head: [["Description", "Value"]],
    body: [
      ["Total Dosage (ml)", `${inv.dosage_ml ?? ""}`],
      ["MRP per ml", CURRENCY_FMT.format(price)],
      ["Amount (before GST)", CURRENCY_FMT.format(before)],
      ["GST", CURRENCY_FMT.format(gst)],
      ["Total (with GST)", CURRENCY_FMT.format(total)]
    ],
    styles: { fontSize: 11, cellPadding: 6 },
    headStyles: { fillColor: [0, 0, 0] }
  });

  // Footer
  const yAfter = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 24 : 500;
  doc.setFontSize(10);
  doc.text(
    "This invoice is system-generated. Pricing and GST are computed per configured rates. © " + new Date().getFullYear() + " " + COMPANY_NAME,
    margin,
    yAfter
  );

  doc.save(`${BRAND_NAME}_Invoice_${inv.id || "draft"}.pdf`);
}

// ---------- Recent Invoices ----------
function RecentInvoices() {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");

  const fetchRows = React.useCallback(() => {
    setLoading(true);
    fetch(`${API_URL}/api/invoices`)
      .then(r => r.json())
      .then(data => {
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setError("Could not load invoices");
        setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    fetchRows();
    const onUpdated = () => fetchRows();
    window.addEventListener("invoices-updated", onUpdated);
    return () => window.removeEventListener("invoices-updated", onUpdated);
  }, [fetchRows]);

  const inr = (n) =>
    n == null ? "" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

  if (loading) return <div style={{ marginTop: 20 }}>Loading recent invoices…</div>;
  if (error) return <div style={{ marginTop: 20, color: "crimson" }}>{error}</div>;

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Recent Invoices</h2>
      {rows.length === 0 ? (
        <div>No invoices yet.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table border="1" cellPadding="6" style={{ minWidth: 1050 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Date/Time</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Tyres</th>
                <th>Per-tyre (ml)</th>
                <th>Total Dosage (ml)</th>
                <th>Total (₹ with GST)</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const perTyre = r.tyre_count ? Math.round((Number(r.dosage_ml || 0) / r.tyre_count) / 25) * 25 : null;
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.customer_name}</td>
                    <td>{r.vehicle_number}</td>
                    <td>{r.tyre_count ?? ""}</td>
                    <td>{perTyre ?? ""}</td>
                    <td>{r.dosage_ml}</td>
                    <td>{inr(r.total_with_gst)}</td>
                    <td><button onClick={() => generateInvoicePDF(r)}>Download PDF</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [customerName, setCustomerName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [odometer, setOdometer] = useState("");
  const [treadDepth, setTreadDepth] = useState("");
  const [installerName, setInstallerName] = useState("");
  const [vehicleType, setVehicleType] = useState("Passenger Car");
  const [tyreWidth, setTyreWidth] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [rimDiameter, setRimDiameter] = useState("");
  const [tyreCount, setTyreCount] = useState(VEHICLE_CFG["Passenger Car"].defaultTyres);
  const [dosagePerTyre, setDosagePerTyre] = useState(null);
  const [dosageTotal, setDosageTotal] = useState(null);

  const MRP_PER_ML = 4.5;
  const GST_RATE = 0.18;

  function onVehicleTypeChange(v) {
    setVehicleType(v);
    const cfg = VEHICLE_CFG[v] || VEHICLE_CFG["Passenger Car"];
    setTyreCount(cfg.defaultTyres);
  }

  async function saveInvoiceToServer(payload) {
    try {
      const res = await fetch(`${API_URL}/api/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Save failed: " + (data?.error || "unknown_error"));
        return null;
      }
      alert(
        `Invoice saved.\nID: ${data.id}\nTotal (before GST): ${CURRENCY_FMT.format(data.total_before_gst || 0)}\nGST: ${CURRENCY_FMT.format(data.gst_amount || 0)}\nTotal (with GST): ${CURRENCY_FMT.format(data.total_with_gst || 0)}`
      );
      window.dispatchEvent(new Event("invoices-updated"));
      return data;
    } catch (e) {
      alert("Network error while saving invoice");
      return null;
    }
  }

  const handleCalculate = async () => {
    if (Number(treadDepth || 0) < 1.5) {
      alert("Installation blocked: Tread depth below 1.5mm.");
      return;
    }

    // tyre count from dropdown
    const tCount = parseInt(tyreCount || "0", 10);
    if (!tCount || tCount < 1) {
      alert("Please select number of tyres.");
      return;
    }

    const perTyre = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const totalMl = perTyre * tCount;

    setDosagePerTyre(perTyre);
    setDosageTotal(totalMl);

    if (!customerName || !vehicleNumber) {
      alert("Please fill Customer Name and Vehicle Number to save invoice.");
      return;
    }

    await saveInvoiceToServer({
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
      dosage_ml: Number(totalMl), // total dosage
      gps_lat: null,
      gps_lng: null,
      customer_code: null,
      tyre_count: tCount            // NEW: save tyre count
    });
  };

  const tyreOptions = (VEHICLE_CFG[vehicleType] || VEHICLE_CFG["Passenger Car"]).options || [4];

  return (
    <div style={{ maxWidth: 1000, margin: "20px auto", padding: 10 }}>
      <h1>MaxTT Billing & Dosage Calculator</h1>

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
          <label style={{ marginRight: 8 }}>Vehicle Type</label>
          <select value={vehicleType} onChange={e => onVehicleTypeChange(e.target.value)}>
            {Object.keys(VEHICLE_CFG).map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label style={{ marginRight: 8 }}>Number of Tyres</label>
          <select value={tyreCount} onChange={e => setTyreCount(e.target.value)}>
            {tyreOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div style={{ fontSize: 12, color: "#666" }}>(Auto-selected for vehicle; you can change if needed)</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <input placeholder="Tyre Width (mm)" value={tyreWidth} onChange={e => setTyreWidth(e.target.value)} />
        <input placeholder="Aspect Ratio (%)" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} />
        <input placeholder="Rim Diameter (in)" value={rimDiameter} onChange={e => setRimDiameter(e.target.value)} />
      </div>

      <button onClick={handleCalculate}>Calculate Dosage & Save</button>

      {(dosagePerTyre !== null || dosageTotal !== null) && (
        <div style={{ marginTop: 12 }}>
          {dosagePerTyre !== null && (
            <div><strong>Per-tyre Dosage:</strong> {dosagePerTyre} ml</div>
          )}
          {dosageTotal !== null && (
            <div><strong>Total Dosage:</strong> {dosageTotal} ml for {tyreCount} tyres</div>
          )}
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            (Per-tyre rounded to nearest 25 ml; includes buffer by vehicle type)
          </div>
        </div>
      )}

      <RecentInvoices />
    </div>
  );
}
