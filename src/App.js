import React, { useState } from "react";

const API_URL = "https://maxtt-billing-api.onrender.com"; // <-- change if your API URL differs

// ---- MaxTT dosage logic (simplified per your rules) ----
// Width_in = Tyre Width (mm) × 0.03937
// Total_Height_in = (Width_in × Aspect_Ratio/100 × 2) + Rim_Diameter (in)
// K by vehicle type, with buffers and rounding to nearest 25 ml

const VEHICLE_K = {
  "Passenger Car": { k: 2.48, bufferPct: 0.08 },   // 8% buffer
  "SUV / Large": { k: 2.65, bufferPct: 0.08 },      // 8%
  "Motorcycle": { k: 2.60, bufferPct: 0.03 },       // 3%
  "Scooter": { k: 2.20, bufferPct: 0.00 },          // 0%
  "Light Truck / LCV": { k: 2.20, bufferPct: 0.00 },// 0%
  "Truck / Bus (On-road)": { k: 3.00, bufferPct: 0.00 }, // 0%
  "Mining / Off-Road": { k: 7.00, bufferPct: 0.08 } // 8%
};

function roundTo25(x) {
  return Math.round(x / 25) * 25;
}

function computeDosageMl(vehicleType, widthMm, aspectPct, rimIn) {
  const entry = VEHICLE_K[vehicleType] || VEHICLE_K["Passenger Car"];
  const widthIn = Number(widthMm || 0) * 0.03937;
  const totalHeightIn = (widthIn * (Number(aspectPct || 0) / 100) * 2) + Number(rimIn || 0);
  let dosage = (widthIn * totalHeightIn * entry.k);
  dosage = dosage * (1 + entry.bufferPct);
  return roundTo25(dosage);
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
  const [dosage, setDosage] = useState(null);

  const MRP_PER_ML = 4.5;
  const GST_RATE = 0.18;

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
        `Invoice saved.\nID: ${data.id}\nTotal (before GST): ₹${(data.total_before_gst || 0).toFixed(2)}\nGST: ₹${(data.gst_amount || 0).toFixed(2)}\nTotal (with GST): ₹${(data.total_with_gst || 0).toFixed(2)}`
      );
      return data;
    } catch (e) {
      alert("Network error while saving invoice");
      return null;
    }
  }

  const handleCalculate = async () => {
    // Safety locks as per your rules
    if (Number(treadDepth || 0) < 1.5) {
      alert("Installation blocked: Tread depth below 1.5mm.");
      return;
    }

    const dosageMl = computeDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    setDosage(dosageMl);

    if (!customerName || !vehicleNumber) {
      alert("Please fill Customer Name and Vehicle Number to save invoice.");
      return;
    }

    // Compute totals client-side just for display; server is source of truth
    const totalBeforeGst = dosageMl * MRP_PER_ML;
    const gstAmount = totalBeforeGst * GST_RATE;
    const totalWithGst = totalBeforeGst + gstAmount;

    // POST to API (only 3 fields required: customer_name, vehicle_number, dosage_ml)
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
      dosage_ml: Number(dosageMl),
      // gps_lat/gps_lng can be added later when you wire GPS
      gps_lat: null,
      gps_lng: null,
      customer_code: null
    });

    console.log("Computed totals (client-side):", {
      dosageMl, totalBeforeGst, gstAmount, totalWithGst
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
        <select value={vehicleType} onChange={e => setVehicleType(e.target.value)}>
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

      <button onClick={handleCalculate}>Calculate Dosage</button>

      {dosage !== null && (
        <div style={{ marginTop: 12 }}>
          <strong>Recommended Dosage: {dosage} ml</strong>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            (Rounded to nearest 25 ml; includes buffer based on vehicle type)
          </div>
        </div>
      )}
    </div>
  );
}
