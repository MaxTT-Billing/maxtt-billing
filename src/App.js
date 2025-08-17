import React, { useState } from "react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

const API_URL = "https://maxtt-billing-api.onrender.com"; // <-- change if your API URL differs
const BRAND_NAME = "MaxTT";
const WATERMARK_TEXT = "MaxTT Billing - Treadstone Solutions";
const COMPANY_NAME = "Treadstone Solutions";
const COMPANY_SUB = "MaxTT Billing Prototype";
const CURRENCY_FMT = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

// ---- MaxTT dosage logic (simplified per your rules) ----
// Width_in = Tyre Width (mm) × 0.03937
// Total_Height_in = (Width_in × Aspect_Ratio/100 × 2) + Rim_Diameter (in)
// K by vehicle type, with buffers and rounding to nearest 25 ml
const VEHICLE_K = {
  "Passenger Car": { k: 2.48, bufferPct: 0.08, defaultTyres: 4 },
  "SUV / Large": { k: 2.65, bufferPct: 0.08, defaultTyres: 4 },
  "Motorcycle": { k: 2.60, bufferPct: 0.03, defaultTyres: 2 },
  "Scooter": { k: 2.20, bufferPct: 0.00, defaultTyres: 2 },
  "Light Truck / LCV": { k: 2.20, bufferPct: 0.00, defaultTyres: 4 },
  "Truck / Bus (On-road)": { k: 3.00, bufferPct: 0.00, defaultTyres: 6 },
  "Mining / Off-Road": { k: 7.00, bufferPct: 0.08, defaultTyres: 4 }
};

function roundTo25(x) {
  return Math.round(x / 25) * 25;
}

function computePerTyreDosageMl(vehicleType, widthMm, aspectPct, rimIn) {
  const entry = VEHICLE_K[vehicleType] || VEHICLE_K["Passenger Car"];
  const widthIn = Number(widthMm || 0) * 0.03937;
  const totalHeightIn = (widthIn * (Number(aspectPct || 0) / 100) * 2) + Number(rimIn || 0);
  let dosage = (widthIn * totalHeightIn * entry.k);
  dosage = dosage * (1 + entry.bufferPct);
  return roundTo25(dosage);
}

// ---------- PDF GENERATION ----------
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

  // Invoice title + meta
  doc.setFontSize(16);
  doc.text(`${BRAND_NAME} Invoice`, margin, 100);

  const created = inv.created_at ? new Date(inv.created_at) : new Date();
  const dateStr = created.toLocaleString();
  doc.setFontSize(11);
  doc.text(`Invoice ID: ${inv.id}`, pageWidth - margin, 50, { align: "right" });
  doc.text(`Date: ${dateStr}`, pageWidth - margin, 68, { align: "right" });

  // Customer block
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

  // Tyre/Vehicle block
  const yTyreStart = yCustStart;
  const xRightBlock = pageWidth / 2 + 20;
  doc.setFontSize(12);
  doc.text("Tyre / Vehicle", xRightBlock, yTyreStart);
  doc.setFontSize(11);
  const tyreLines = [
    `Vehicle Type: ${inv.vehicle_type || ""}`,
    `Tyre: ${inv.tyre_width_mm || ""}/${inv.aspect_ratio || ""} R${inv.rim_diameter_in || ""}`,
    `Tread Depth: ${inv.tread_depth_mm ?? ""} mm`,
    `Total Dosage: ${inv.dosage_ml ?? ""} ml` // total saved in DB
  ];
  tyreLines.forEach((t, i) => doc.text(t, xRightBlock, yTyreStart + 18 + i * 16));

  // Amounts table
  const price = Number(inv.price_per_ml ?? 0);
  const before = Number(inv.total_before_gst ?? 0);
  const gst = Number(inv.gst_amount ?? 0);
  const total = Number(inv.total_with_gst ?? 0);

  const body = [
    ["Total Dosage (ml)", `${inv.dosage_ml ?? ""}`],
    ["MRP per ml", CURRENCY_FMT.format(price)],
    ["Amount (before GST)", CURRENCY_FMT.format(before)],
    ["GST", CURRENCY_FMT.format(gst)],
    ["Total (with GST)", CURRENCY_FMT.format(total)]
  ];

  doc.autoTable({
    startY: yCustStart + 120,
    head: [["Description", "Value"]],
    body,
    styles: { fontSize: 11, cellPadding: 6 },
    headStyles: { fillColor: [0, 0, 0] }
  });

  // Footer
  const yAfter = doc.lastAutoTable ? doc.lastAutoTable.finalY + 24 : 500;
  doc.setFontSize(10);
  doc.text(
    "This invoice is system-generated. Pricing and GST are computed per configured rates. © " + new Date().getFullYear() + " " + COMPANY_NAME,
    margin,
    yAfter
  );

  const safeName = `${BRAND_NAME}_Invoice_${inv.id || "draft"}.pdf`;
  doc.save(safeName);
}

// ---------- Recent Invoices table (auto-refresh after save) ----------
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
          <table border="1" cellPadding="6" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Date/Time</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Total Dosage (ml)</th>
                <th>Total (₹ with GST)</th>
                <th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.customer_name}</td>
                  <td>{r.vehicle_number}</td>
                  <td>{r.dosage_ml}</td>
                  <td>{inr(r.total_with_gst)}</td>
                  <td>
                    <button onClick={() => generateInvoicePDF(r)}>Download PDF</button>
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
  const [tyreCount, setTyreCount] = useState(VEHICLE_K["Passenger Car"].defaultTyres);
  const [dosagePerTyre, setDosagePerTyre] = useState(null);
  const [dosageTotal, setDosageTotal] = useState(null);

  const MRP_PER_ML = 4.5;
  const GST_RATE = 0.18;

  // When vehicle type changes, prefill tyre count with a sensible default (editable)
  function onVehicleTypeChange(v) {
    setVehicleType(v);
    const def = (VEHICLE_K[v] || VEHICLE_K["Passenger Car"]).defaultTyres || 4;
    setTyreCount(def);
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
      window.dispatchEvent(new Event("invoices-updated")); // refresh table
      return data;
    } catch (e) {
      alert("Network error while saving invoice");
      return null;
    }
  }

  const handleCalculate = async () => {
    // Safety lock: tread depth
    if (Number(treadDepth || 0) < 1.5) {
      alert("Installation blocked: Tread depth below 1.5mm.");
      return;
    }

    // Basic validation on tyre count
    const tCount = Math.max(1, Math.min(20, parseInt(tyreCount || "0", 10) || 0));
    if (!tCount) {
      alert("Please enter number of tyres (e.g., 4 for cars).");
      return;
    }
    setTyreCount(tCount);

    // Compute per-tyre and total
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
      dosage_ml: Number(totalMl), // <-- save TOTAL dosage to DB
      gps_lat: null,
      gps_lng: null,
      customer_code: null
    });
  };

  return (
    <div style={{ maxWidth: 900, margin: "20px auto", padding: 10 }}>
      <h1>MaxTT Billing & Dosage Calculator</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <input placeholder="Customer Name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
        <input placeholder="Vehicle Number" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} />
        <input placeholder="Mobile Number" value={mobileNumber} onChange={e => setMobileNumber(e.target.value)} />
        <input placeholder="Odometer Reading" value={odometer} onChange={e => setOdometer(e.target.value)} />
        <input placeholder="Tread Depth (mm)" value={treadDepth} onChange={e => setTreadDepth(e.target.value)} />
        <input placeholder="Installer Name" value={installerName} onChange={e => setInstallerName(e.target.value)} />
      </div>

      <div style={{ marginBottom: 8 }}>
        <label style={{ marginRight: 8 }}>Vehicle Type</label>
        <select value={vehicleType} onChange={e => onVehicleTypeChange(e.target.value)}>
          <option>Passenger Car</option>
          <option>SUV / Large</option>
          <option>Motorcycle</option>
          <option>Scooter</option>
          <option>Light Truck / LCV</option>
          <option>Truck / Bus (On-road)</option>
          <option>Mining / Off-Road</option>
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <input placeholder="Tyre Width (mm)" value={tyreWidth} onChange={e => setTyreWidth(e.target.value)} />
        <input placeholder="Aspect Ratio (%)" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} />
        <input placeholder="Rim Diameter (in)" value={rimDiameter} onChange={e => setRimDiameter(e.target.value)} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <input
          placeholder="Number of tyres to treat (e.g., 4)"
          value={tyreCount}
          onChange={e => setTyreCount(e.target.value)}
          style={{ width: 260, marginRight: 8 }}
        />
        <span style={{ fontSize: 12, color: "#666" }}>
          (Defaults based on vehicle type; you can change it)
        </span>
      </div>

      <button onClick={handleCalculate}>Calculate Dosage</button>

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

      {/* Recent invoices table with PDF buttons */}
      <RecentInvoices />
    </div>
  );
}
