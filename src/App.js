import React, { useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

const API_URL = "https://maxtt-billing-api.onrender.com"; // change if needed
const API_KEY = "REPLACE_WITH_YOUR_API_KEY"; // same as backend

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

// ---------- PDF (includes Franchisee ID & GSTIN from profile) ----------
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

// ---------- Recent Invoices ----------
function RecentInvoices({ profile }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchRows = React.useCallback(() => {
    setLoading(true);
    fetch(`${API_URL}/api/invoices`)
      .then(r => r.json())
      .then(d => { setRows(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => { setError("Could not load invoices"); setLoading(false); });
  }, []);

  useEffect(() => {
    fetchRows();
    const onUpdated = () => fetchRows();
    window.addEventListener("invoices-updated", onUpdated);
    return () => window.removeEventListener("invoices-updated", onUpdated);
  }, [fetchRows]);

  if (loading) return <div style={{ marginTop: 20 }}>Loading recent invoices…</div>;
  if (error) return <div style={{ marginTop: 20, color: "crimson" }}>{error}</div>;

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Recent Invoices</h2>
      {rows.length === 0 ? (
        <div>No invoices yet.</div>
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
                <th>Per-tyre (ml)</th>
                <th>Total Dosage (ml)</th>
                <th>Total (₹)</th>
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
                    <td>{r.customer_name ?? ""}</td>
                    <td>{r.vehicle_number ?? ""}</td>
                    <td>{r.vehicle_type ?? ""}</td>
                    <td>{r.tyre_count ?? ""}</td>
                    <td>{r.fitment_locations || ""}</td>
                    <td>{perTyre ?? ""}</td>
                    <td>{r.dosage_ml ?? ""}</td>
                    <td>{inr(r.total_with_gst)}</td>
                    <td><button onClick={() => generateInvoicePDF(r, profile)}>Download PDF</button></td>
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

// =================== MAIN (with login) ====================
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("maxtt_token") || "");
  const [profile, setProfile] = useState(null);

  // login
  const [fid, setFid] = useState("");
  const [fpw, setFpw] = useState("");
  const [loginErr, setLoginErr] = useState("");

  // form fields
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

  // load franchisee profile (includes franchisee_id + gstin)
  useEffect(() => {
    fetch(`${API_URL}/api/profile`).then(r => r.json()).then(setProfile).catch(() => {});
  }, []);

  async function doLogin() {
    setLoginErr("");
    try {
      const res = await fetch(`${API_URL}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: fid, password: fpw })
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginErr(data?.error === "invalid_credentials" ? "Invalid ID or password" : "Login failed");
        return;
      }
      localStorage.setItem("maxtt_token", data.token);
      setToken(data.token);
    } catch {
      setLoginErr("Network error");
    }
  }

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
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Save failed: " + (data?.error || "unknown_error"));
        return null;
      }
      alert(
        `Invoice saved.\nID: ${data.id}\nTotal (before GST): ${inr(data.total_before_gst || 0)}\nGST: ${inr(data.gst_amount || 0)}\nTotal (with GST): ${inr(data.total_with_gst || 0)}`
      );
      window.dispatchEvent(new Event("invoices-updated"));
      return data;
    } catch {
      alert("Network error while saving invoice");
      return null;
    }
  }

  const handleCalculate = async () => {
    if (Number(treadDepth || 0) < 1.5) { alert("Installation blocked: Tread depth below 1.5mm."); return; }
    const tCount = parseInt(tyreCount || "0", 10);
    if (!tCount || tCount < 1) { alert("Please select number of tyres."); return; }
    const perTyre = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const totalMl = perTyre * tCount;
    setDosagePerTyre(perTyre);
    setDosageTotal(totalMl);
    if (!customerName || !vehicleNumber) { alert("Please fill Customer Name and Vehicle Number to save invoice."); return; }
    const fitmentText = selectedFitmentsToText();
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
      dosage_ml: Number(totalMl),
      gps_lat: null, gps_lng: null, customer_code: null,
      tyre_count: tCount,
      fitment_locations: fitmentText || null,
      customer_gstin: gstin || null,
      customer_address: address || null
    });
  };

  if (!token) {
    return (
      <div style={{ maxWidth: 420, margin: "120px auto", padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
        <h2 style={{ marginTop: 0 }}>Franchisee Login</h2>
        <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
          <input placeholder="Franchisee ID" value={fid} onChange={e => setFid(e.target.value)} />
          <input placeholder="Password" type="password" value={fpw} onChange={e => setFpw(e.target.value)} />
          {loginErr && <div style={{ color: "crimson" }}>{loginErr}</div>}
          <button onClick={doLogin}>Login</button>
        </div>
        {profile && (
          <div style={{ marginTop: 16, fontSize: 12, color: "#555" }}>
            <div><strong>Franchisee:</strong> {profile.name}</div>
            <div>{profile.address}</div>
            <div>Franchisee ID: {profile.franchisee_id}</div>
            <div>GSTIN: {profile.gstin}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "20px auto", padding: 10 }}>
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

      {/* Customer / job fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <input placeholder="Customer Name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
        <input placeholder="Vehicle Number" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} />
        <input placeholder="Mobile Number" value={mobileNumber} onChange={e => setMobileNumber(e.target.value)} />
        <input placeholder="Odometer Reading" value={odometer} onChange={e => setOdometer(e.target.value)} />
        <input placeholder="Tread Depth (mm)" value={treadDepth} onChange={e => setTreadDepth(e.target.value)} />
        <input placeholder="Installer Name" value={installerName} onChange={e => setInstallerName(e.target.value)} />
      </div>

      {/* Customer GSTIN & Address */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <input placeholder="Customer GSTIN (optional)" value={gstin} onChange={e => setGstin(e.target.value)} />
        <input placeholder="Billing Address (optional)" value={address} onChange={e => setAddress(e.target.value)} />
      </div>

      {/* Vehicle & tyres */}
      <VehicleAndTyres
        vehicleType={vehicleType}
        setVehicleType={setVehicleType}
        tyreCount={tyreCount}
        setTyreCount={setTyreCount}
        onVehicleTypeChange={onVehicleTypeChange}
      />

      {/* Tyre size */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
        <input placeholder="Tyre Width (mm)" value={tyreWidth} onChange={e => setTyreWidth(e.target.value)} />
        <input placeholder="Aspect Ratio (%)" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} />
        <input placeholder="Rim Diameter (in)" value={rimDiameter} onChange={e => setRimDiameter(e.target.value)} />
      </div>

      {/* Fitment checkboxes */}
      <Fitment
        fitFL={fitFL} setFitFL={setFitFL}
        fitFR={fitFR} setFitFR={setFitFR}
        fitRL={fitRL} setFitRL={setFitRL}
        fitRR={fitRR} setFitRR={setFitRR}
      />

      <button onClick={handleCalculate}>Calculate Dosage & Save</button>

      {(dosagePerTyre !== null || dosageTotal !== null) && (
        <div style={{ marginTop: 12 }}>
          {dosagePerTyre !== null && (<div><strong>Per-tyre Dosage:</strong> {dosagePerTyre} ml</div>)}
          {dosageTotal !== null && (<div><strong>Total Dosage:</strong> {dosageTotal} ml for {tyreCount} tyres</div>)}
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            (Per-tyre rounded to nearest 25 ml; includes buffer by category)
          </div>
        </div>
      )}

      <RecentInvoices profile={profile} />
    </div>
  );
}

function VehicleAndTyres({ vehicleType, setVehicleType, tyreCount, setTyreCount, onVehicleTypeChange }) {
  const tyreOptions = (VEHICLE_CFG[vehicleType]?.options || [4]);
  return (
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
          {tyreOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={{ fontSize: 12, color: "#666" }}>
          (Auto-selected by category; HTV lets you choose 8/10/12/14/16)
        </div>
      </div>
    </div>
  );
}

function Fitment({ fitFL, setFitFL, fitFR, setFitFR, fitRL, setFitRL, fitRR, setFitRR }) {
  return (
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
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
        (Tick where sealant was installed; this prints on the invoice)
      </div>
    </div>
  );
}
