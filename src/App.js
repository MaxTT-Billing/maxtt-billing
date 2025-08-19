// src/App.js — Base Layout v1 (locked) — IST fix, per-tyre treads in PDF, hanging indent paragraphs, bottom signature bands
import React, { useState, useEffect, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

// ====== Config ======
const API_URL = process.env.REACT_APP_API_BASE_URL || "https://maxtt-billing-api.onrender.com";
const API_KEY = "supersecret123"; // used for writes (create/update)
const IST_TZ = "Asia/Kolkata";

// Pricing & tax (fixed)
const PRICE_PER_ML = 4.5;     // ₹ per ml — fixed
const GST_PERCENT  = 18;      // % — fixed
const DISCOUNT_MAX_PCT = 30;  // hard cap at 30%

// ====== Font loader (Poppins, no HTML edits needed) ======
function HeadFontLoader() {
  useEffect(() => {
    const id = "poppins-font-link";
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap";
      document.head.appendChild(link);
    }
  }, []);
  return null;
}

// ===== Helpers (IST + money) =====
function parseDateFlexible(v) {
  if (v instanceof Date) return v;
  if (!v) return new Date();
  const s = String(v);
  const d = new Date(s);
  if (!isNaN(d)) return d;
  // try ISO without timezone → assume UTC
  const s2 = s.includes("T") ? s : s.replace(" ", "T");
  const addZ = /[zZ]|[+\-]\d{2}:\d{2}$/.test(s2) ? s2 : (s2 + "Z");
  const d2 = new Date(addZ);
  return isNaN(d2) ? new Date() : d2;
}
function formatIST(dateLike) {
  const d = parseDateFlexible(dateLike);
  const fmt = new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(d);
  return `${fmt} IST`;
}
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
const num = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

// ===== Vehicle dosage config =====
const VEHICLE_CFG = {
  "2-Wheeler (Scooter/Motorcycle)": { k: 2.6, bufferPct: 0.03, defaultTyres: 2, options: [2] },
  "3-Wheeler (Auto)":               { k: 2.2, bufferPct: 0.03, defaultTyres: 3, options: [3] },
  "4-Wheeler (Passenger Car/Van/SUV)": { k: 2.56, bufferPct: 0.08, defaultTyres: 4, options: [4] },
  "6-Wheeler (Bus/LTV)":            { k: 3.0,  bufferPct: 0.05, defaultTyres: 6, options: [6] },
  "HTV (>6 wheels: Trucks/Trailers/Mining)": {
    k: 3.0, bufferPct: 0.05, defaultTyres: 8, options: [8,10,12,14,16,18]
  }
};
const TREAD_MIN_MM = {
  "2-Wheeler (Scooter/Motorcycle)": 1.5,
  "3-Wheeler (Auto)": 1.5,
  "4-Wheeler (Passenger Car/Van/SUV)": 1.5,
  "6-Wheeler (Bus/LTV)": 1.5,
  "HTV (>6 wheels: Trucks/Trailers/Mining)": 1.5
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

// ===== Fitment helpers =====
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
    rearEach
  };
}
const textFromFitState = (stateObj) =>
  Object.entries(stateObj).filter(([, v]) => !!v).map(([k]) => k).join(", ");

// ===== State code from GSTIN or profile =====
const GST_STATE_NUM_TO_ABBR = {
  "01":"JK","02":"HP","03":"PB","04":"CH","05":"UT","06":"HR","07":"DL","08":"RJ","09":"UP","10":"BR","11":"SK",
  "12":"AR","13":"NL","14":"MN","15":"MZ","16":"TR","17":"ML","18":"AS","19":"WB","20":"JH","21":"OR","22":"CT",
  "23":"MP","24":"GJ","26":"DD","27":"MH","28":"AP","29":"KA","30":"GA","31":"LD","32":"KL","33":"TN","34":"PY",
  "35":"AN","36":"TS","37":"ANP","97":"Other","99":"Center"
};
const INDIA_STATE_ABBR = {
  "JAMMU AND KASHMIR":"JK","HIMACHAL PRADESH":"HP","PUNJAB":"PB","CHANDIGARH":"CH","UTTARAKHAND":"UT",
  "HARYANA":"HR","DELHI":"DL","RAJASTHAN":"RJ","UTTAR PRADESH":"UP","BIHAR":"BR","SIKKIM":"SK","ARUNACHAL PRADESH":"AR",
  "NAGALAND":"NL","MANIPUR":"MN","MIZORAM":"MZ","TRIPURA":"TR","MEGHALAYA":"ML","ASSAM":"AS","WEST BENGAL":"WB",
  "JHARKHAND":"JH","ODISHA":"OR","CHHATTISGARH":"CT","MADHYA PRADESH":"MP","GUJARAT":"GJ","DAMAN AND DIU":"DD",
  "MAHARASHTRA":"MH","ANDHRA PRADESH":"AP","KARNATAKA":"KA","GOA":"GA","LAKSHADWEEP":"LD","KERALA":"KL","TAMIL NADU":"TN",
  "PUDUCHERRY":"PY","ANDAMAN AND NICOBAR ISLANDS":"AN","TELANGANA":"TS","ANDHRA PRADESH (NEW)":"ANP"
};
function stateAbbrFromProfile(profile) {
  const pstate = (profile?.franchisee_state || "").trim().toUpperCase();
  if (pstate && INDIA_STATE_ABBR[pstate]) return INDIA_STATE_ABBR[pstate];
  const gstin = (profile?.gstin || "").trim();
  if (gstin.length >= 2) {
    const code = gstin.slice(0,2);
    if (GST_STATE_NUM_TO_ABBR[code]) return GST_STATE_NUM_TO_ABBR[code];
  }
  const adr = (profile?.address || "").toUpperCase();
  for (const [name, ab] of Object.entries(INDIA_STATE_ABBR)) {
    if (adr.includes(name)) return ab;
  }
  return "XX";
}
// Order: FR_CODE / STATE / SEQ / MMYY
function displayInvoiceCode(inv, profile) {
  const fr = (profile?.franchisee_id || "FR").replace(/\s+/g, "");
  const st = stateAbbrFromProfile(profile);
  const dt = parseDateFlexible(inv?.created_at || Date.now());
  const mm = String(dt.getMonth()+1).padStart(2,"0");
  const yy = String(dt.getFullYear()).slice(-2);
  const seq = String(inv?.id || 1).padStart(4,"0");
  return `${fr}/${st}/${seq}/${mm}${yy}`;
}

// ===== Watermark image preloader =====
let WATERMARK_DATAURL = null;
async function preloadWatermark() {
  if (WATERMARK_DATAURL) return WATERMARK_DATAURL;
  try {
    const res = await fetch("/treadstone-watermark.png", { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => { WATERMARK_DATAURL = reader.result; resolve(WATERMARK_DATAURL); };
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}
function AssetsLoader() {
  useEffect(() => { preloadWatermark(); }, []);
  return null;
}

// ===== PDF helpers =====
function drawNumberedSection(doc, title, items, x, y, maxWidth, lineH = 12) {
  // Title
  try { doc.setFont(undefined, "bold"); } catch {}
  doc.setFontSize(10.5);
  doc.text(title, x, y);
  y += lineH;
  try { doc.setFont(undefined, "normal"); } catch {}

  // Hanging indent for numbers (1., 2., …)
  const numberWidth = doc.getTextWidth("00. "); // rough width
  const gap = 4;
  const textWidth = maxWidth - numberWidth - gap;

  items.forEach((txt, idx) => {
    const label = `${idx + 1}.`;
    doc.text(label, x, y);
    const lines = doc.splitTextToSize(txt, textWidth);
    lines.forEach((ln) => {
      doc.text(ln, x + numberWidth + gap, y);
      y += lineH;
    });
    y += 2; // small gap between points
  });
  return y;
}

// ===== PDF =====
function generateInvoicePDF(inv, profile, taxMode) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36; // tighter
  doc.setFont("helvetica", "normal");

  // Header (Franchisee)
  doc.setFontSize(15);
  doc.text(profile?.name || "Franchisee", margin, 40);
  doc.setFontSize(10.5);
  const addrLines = String(profile?.address || "Address not set").split(/\n|, /g).filter(Boolean);
  addrLines.slice(0, 3).forEach((t, i) => doc.text(t, margin, 56 + i * 12));
  let y = 56 + addrLines.length * 12 + 2;
  doc.text(`Franchisee ID: ${profile?.franchisee_id || ""}`, margin, y); y += 12;
  doc.text(`GSTIN: ${profile?.gstin || ""}`, margin, y);

  // Meta
  const created = parseDateFlexible(inv.created_at || Date.now());
  const dispCode = displayInvoiceCode(inv, profile);
  doc.text(`Invoice No: ${dispCode}`, pageWidth - margin, 40, { align: "right" });
  doc.text(`Date: ${formatIST(created)}`, pageWidth - margin, 56, { align: "right" });

  // Watermark (logo or fallback text)
  if (WATERMARK_DATAURL) {
    try {
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.10 }));
      const wmWidth = 360, wmHeight = 360;
      doc.addImage(WATERMARK_DATAURL, "PNG", (pageWidth - wmWidth)/2, (pageHeight - wmHeight)/2 - 40, wmWidth, wmHeight);
      doc.restoreGraphicsState();
    } catch {}
  } else {
    try { doc.saveGraphicsState(); } catch {}
    doc.setFontSize(52);
    doc.setTextColor(210);
    doc.text("Treadstone Solutions", pageWidth / 2, pageHeight/2 - 20, { angle: 35, align: "center" });
    doc.setTextColor(0);
    try { doc.restoreGraphicsState(); } catch {}
  }

  // Customer block
  const yCustStart = 100;
  doc.setFontSize(12); doc.text("Customer Details", margin, yCustStart);
  doc.setFontSize(10.5);
  [
    `Name: ${inv.customer_name || ""}`,
    `Mobile: ${inv.mobile_number || ""}`,
    `Vehicle: ${inv.vehicle_number || ""}`,
    `Customer GSTIN: ${inv.customer_gstin || ""}`,
    `Address: ${inv.customer_address || ""}`,
    `Installer: ${inv.installer_name || ""}`,
  ].forEach((t, i) => doc.text(t, margin, yCustStart + 16 + i * 14));

  // Tyre/Vehicle block
  const yTyreStart = yCustStart;
  const xRight = pageWidth / 2 + 10;
  doc.setFontSize(12); doc.text("Tyre / Vehicle", xRight, yTyreStart);
  doc.setFontSize(10.5);
  const perTyre = inv.tyre_count ? Math.round((Number(inv.dosage_ml || 0) / inv.tyre_count) / 25) * 25 : null;

  const treadList = (() => {
    try { return inv.tread_depths_json ? JSON.parse(inv.tread_depths_json) : null; } catch { return null; }
  })();
  const treadLine = treadList
    ? Object.entries(treadList).map(([k, v]) => `${k.split(" ×")[0]}: ${v}mm`).join(" | ")
    : (inv.tread_depth_mm != null ? `Min Tread: ${inv.tread_depth_mm} mm` : "");

  [
    `Vehicle Category: ${inv.vehicle_type || ""}`,
    `Tyres: ${inv.tyre_count ?? ""}`,
    `Tyre Size: ${inv.tyre_width_mm || ""}/${inv.aspect_ratio || ""} R${inv.rim_diameter_in || ""}`,
    `Tread Depths: ${treadLine}`,
    `Fitment: ${inv.fitment_locations || ""}`,
    `Per-tyre Dosage: ${perTyre ?? ""} ml`,
    `Total Dosage: ${inv.dosage_ml ?? ""} ml`,
  ].forEach((t, i) => doc.text(t, xRight, yTyreStart + 16 + i * 14));

  // Amounts (with discount/installation/tax split)
  const baseRaw = Number(inv.dosage_ml || 0) * Number(inv.price_per_ml || PRICE_PER_ML);
  const maxDisc = Math.round((baseRaw * DISCOUNT_MAX_PCT) / 100);
  const discountUsed = Math.min(Number(inv.discount || 0), maxDisc);
  const install = Number(inv.installation_fee || 0);
  const base = Math.max(0, baseRaw - discountUsed + install);
  let cgst = 0, sgst = 0, igst = 0;
  const mode = (taxMode || inv.tax_mode) === "IGST" ? "IGST" : "CGST_SGST";
  if (mode === "CGST_SGST") {
    cgst = (base * GST_PERCENT) / 200;
    sgst = (base * GST_PERCENT) / 200;
  } else {
    igst = (base * GST_PERCENT) / 100;
  }
  const gstTotal = cgst + sgst + igst;
  const grand = base + gstTotal;

  doc.autoTable({
    startY: yCustStart + 140,
    head: [["Description", "Value"]],
    body: [
      ["Total Dosage (ml)", `${inv.dosage_ml ?? ""}`],
      ["MRP per ml", inr(Number(inv.price_per_ml || PRICE_PER_ML))],
      ["Gross (dosage × price)", inr(baseRaw)],
      ["Discount (₹)", `-${inr(discountUsed)} (cap ${DISCOUNT_MAX_PCT}%)`],
      ["Installation Charges (₹)", inr(install)],
      ["Tax Mode", mode === "CGST_SGST" ? "CGST+SGST" : "IGST"],
      ["CGST (9%)", inr(cgst)],
      ["SGST (9%)", inr(sgst)],
      ["IGST (18%)", inr(igst)],
      ["Amount (before GST)", inr(base)],
      ["GST Total", inr(gstTotal)],
      ["Total (with GST)", inr(grand)],
    ],
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: [60, 60, 60] },
    margin: { left: margin, right: margin }
  });

  // Signature block
  let yAfter = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY + 14 : 460;
  doc.setFontSize(10.5);
  doc.text("Customer Signature:", margin, yAfter);
  if (inv.customer_signature) {
    try { doc.addImage(inv.customer_signature, "PNG", margin + 120, yAfter - 12, 130, 44); } catch {}
  }
  if (inv.signed_at) {
    const sdt = parseDateFlexible(inv.signed_at);
    doc.text(`Signed at: ${formatIST(sdt)}`, margin + 280, yAfter);
  }
  yAfter += 60;

  // Declaration + T&C with hanging indent
  const maxWidth = pageWidth - margin * 2;
  const declItems = [
    "I hereby acknowledge that the MaxTT Tyre Sealant installation has been completed on my vehicle to my satisfaction, as per my earlier consent to proceed.",
    "I have read, understood, and accepted the Terms & Conditions stated herein.",
    "I acknowledge that the total amount shown is correct and payable to the franchisee/installer of Treadstone Solutions."
  ];
  yAfter = drawNumberedSection(doc, "Customer Declaration", declItems, margin, yAfter, maxWidth, 12);

  const termsItems = [
    "The MaxTT Tyre Sealant, developed in New Zealand and supplied by Treadstone Solutions, is a preventive safety solution designed to reduce tyre-related risks and virtually eliminate punctures and blowouts.",
    "Effectiveness is assured only when the vehicle is operated within the speed limits prescribed by the competent traffic/transport authorities (RTO/Transport Department) in India.",
    "By signing/accepting this invoice, the customer affirms that the installation has been carried out to their satisfaction and agrees to abide by these conditions."
  ];
  yAfter = drawNumberedSection(doc, "Terms & Conditions", termsItems, margin, yAfter, maxWidth, 12);

  // Bottom signature bands (Installer stamp left, Customer signature right)
  const bandY = pageHeight - 80;
  // lines
  doc.line(margin, bandY, margin + 220, bandY);
  doc.line(pageWidth - margin - 220, bandY, pageWidth - margin, bandY);
  // labels
  doc.setFontSize(10);
  doc.text("Installer Sign & Stamp", margin, bandY + 16);
  doc.text("Customer Signature", pageWidth - margin - 220, bandY + 16);

  doc.save(`MaxTT_Invoice_${inv.id || "draft"}.pdf`);
}

// ===== Login =====
function LoginView({ onLoggedIn }) {
  const [role, setRole] = useState("franchisee"); // franchisee | admin | super_admin
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  async function doLogin() {
    setErr("");
    const path = role === "admin" ? "/api/admin/login"
               : role === "super_admin" ? "/api/sa/login"
               : "/api/login";
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password: pw })
      });
      const data = await res.json();
      if (!res.ok) { setErr(data?.error === "invalid_credentials" ? "Invalid credentials" : "Login failed"); return; }
      localStorage.setItem("maxtt_token", data.token);
      localStorage.setItem("maxtt_role", role);
      onLoggedIn({ token: data.token, role });
    } catch { setErr("Network error"); }
  }

  return (
    <div style={{ maxWidth: 480, margin: "120px auto", padding: 16, border: "1px solid #ddd", borderRadius: 8, fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' }}>
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

// ===== SignaturePad with consent =====
function SignaturePad({ open, onClose, onSave, title = "Customer Consent & Signature" }) {
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
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e) => { setDrawing(true); const { x, y } = getPos(e); const ctx = canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(x, y); };
  const move  = (e) => { if (!drawing) return; const { x, y } = getPos(e); const ctx = canvasRef.current.getContext("2d"); ctx.lineTo(x, y); ctx.stroke(); setHasStroke(true); };
  const end   = () => setDrawing(false);

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
    onSave({ dataUrl, consent: { agreed: true, text: TERMS_TEXT, agreedAt: nowIso } });
  };

  if (!open) return null;
  return (
    <div style={modalWrap}>
      <div style={{ ...modalBox, maxWidth: 780, fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>

        <div style={{
          border: "1px solid #ddd", background: "#fbfbfb", padding: 10, borderRadius: 6,
          maxHeight: 140, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.35, marginBottom: 10
        }}>
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
            onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
            onTouchStart={start} onTouchMove={move} onTouchEnd={end}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10 }}>
          <div><button onClick={clear} style={{ marginRight: 8 }}>Clear</button></div>
          <div>
            <button onClick={onClose} style={{ marginRight: 8 }}>Cancel</button>
            <button onClick={save} disabled={!agreed || !hasStroke}
              title={!agreed ? "Tick the consent box first" : !hasStroke ? "Sign in the box first" : ""}>
              Use this Signature
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Invoices list =====
function RecentInvoices({ token, profile }) {
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
      .then(r => r.json()).then(data => { setRows(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setError("Could not load invoices"); setLoading(false); });

    fetch(`${API_URL}/api/summary?${params.toString()}`, { headers: headersAuth })
      .then(r => r.json()).then(setSummary).catch(() => setSummary(null));
  }, [q, from, to, token]);

  useEffect(() => { const t = setTimeout(fetchRows, 400); return () => clearTimeout(t); }, [q, from, to, fetchRows]);
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
      const name = disp.includes("filename=") ? disp.split('filename="')[1]?.split('"')[0] || "invoices.csv" : "invoices.csv";
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch { alert("Export failed"); }
  }

  async function printPdfFor(id) {
    try {
      const r = await fetch(`${API_URL}/api/invoices/${id}`, { headers: headersAuth });
      const inv = await r.json();
      if (!r.ok) throw new Error("fetch failed");
      generateInvoicePDF(inv, profile, inv.tax_mode || "CGST_SGST");
    } catch { alert("Could not fetch invoice for PDF"); }
  }

  if (loading) return <div style={{ marginTop: 20 }}>Loading recent invoices…</div>;
  if (error)   return <div style={{ marginTop: 20, color: "crimson" }}>{error}</div>;

  return (
    <div style={{ marginTop: 24, fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' }}>
      <h2>Invoices</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center",
                    marginBottom: 10, border: "1px solid #eee", padding: 8, borderRadius: 6 }}>
        <input placeholder="Search name or vehicle no." value={q} onChange={e => setQ(e.target.value)}
               style={{ flex: 1, minWidth: 280 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          From: <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          To: <input type="date" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <button onClick={fetchRows}>Apply</button>
        <button onClick={() => { setQ(""); setFrom(""); setTo(""); }}>Show All</button>
        <button onClick={exportCsv}>Export CSV</button>
      </div>

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

      {rows.length === 0 ? <div>No invoices found.</div> : (
        <div style={{ overflowX: "auto" }}>
          <table border="1" cellPadding="6" style={{ minWidth: 1260 }}>
            <thead>
              <tr>
                <th>ID</th><th>Date/Time (IST)</th><th>Customer</th><th>Vehicle</th>
                <th>Category</th><th>Tyres</th><th>Fitment</th>
                <th>Total Dosage (ml)</th><th>Total (₹)</th><th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{formatIST(r.created_at)}</td>
                  <td>{r.customer_name ?? ""}</td>
                  <td>{r.vehicle_number ?? ""}</td>
                  <td>{r.vehicle_type ?? ""}</td>
                  <td>{r.tyre_count ?? ""}</td>
                  <td>{r.fitment_locations || ""}</td>
                  <td>{r.dosage_ml ?? ""}</td>
                  <td>{inr(r.total_with_gst)}</td>
                  <td><button onClick={() => printPdfFor(r.id)}>PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const modalWrap = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.40)",
  display: "flex", alignItems: "center", justifyContent: "center",
  padding: 16, zIndex: 9999
};
const modalBox  = { background: "#fff", borderRadius: 8, padding: 12, maxWidth: 900, width: "100%" };

// ===== Franchisee App (Base Layout v1) =====
function FranchiseeApp({ token, onLogout }) {
  const [profile, setProfile] = useState(null);

  // Consent/signature
  const [sigOpen, setSigOpen] = useState(false);
  const [signatureData, setSignatureData] = useState("");
  const [consentMeta, setConsentMeta] = useState(null);

  // 1) Customer & Vehicle
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [odometer, setOdometer] = useState("");

  // 2) Vehicle & Fitment
  const [vehicleType, setVehicleType] = useState("4-Wheeler (Passenger Car/Van/SUV)");
  const [tyreCount, setTyreCount] = useState(4);
  const [tyreWidth, setTyreWidth] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [rimDiameter, setRimDiameter] = useState("");
  const [fit, setFit] = useState(() => {
    const init = {}; fitmentSchema("4-Wheeler (Passenger Car/Van/SUV)", 4).labels.forEach(l => (init[l] = false));
    return init;
  });
  // Per-tyre tread depths
  const [treadByTyre, setTreadByTyre] = useState(() => {
    const obj = {}; fitmentSchema("4-Wheeler (Passenger Car/Van/SUV)", 4).labels.forEach(l => obj[l] = "");
    return obj;
  });
  const [installerName, setInstallerName] = useState("");

  // 3) Pricing & Taxes (fixed)
  const [discountInr, setDiscountInr] = useState("");             // ₹
  const [installationFeeInr, setInstallationFeeInr] = useState(""); // ₹
  const [taxMode, setTaxMode] = useState("CGST_SGST");            // or "IGST"

  // Optional customer GSTIN
  const [gstin, setGstin] = useState("");

  // Profile
  useEffect(() => {
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        if (r.status === 401) { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); window.location.reload(); return null; }
        return r.json();
      })
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [token]);

  // Preload assets (logo watermark)
  useEffect(() => { preloadWatermark(); }, []);

  function onVehicleTypeChange(v) {
    setVehicleType(v);
    const cfg = VEHICLE_CFG[v] || VEHICLE_CFG["4-Wheeler (Passenger Car/Van/SUV)"];
    const nextTyres = cfg.defaultTyres;
    setTyreCount(nextTyres);
    const schema = fitmentSchema(v, nextTyres);

    const nextFit = {}; schema.labels.forEach(l => (nextFit[l] = false)); setFit(nextFit);
    const nextTread = {}; schema.labels.forEach(l => (nextTread[l] = "")); setTreadByTyre(nextTread);
  }
  function onTyreCountChange(n) {
    setTyreCount(n);
    const schema = fitmentSchema(vehicleType, n);

    const nextFit = {}; schema.labels.forEach(l => (nextFit[l] = false)); setFit(nextFit);
    const nextTread = {}; schema.labels.forEach(l => (nextTread[l] = "")); setTreadByTyre(nextTread);
  }

  // Save
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
      if (res.status === 401) { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); alert("Session expired. Please log in again."); window.location.reload(); return null; }
      const data = await res.json();
      if (!res.ok) { alert("Save failed: " + (data?.error || "unknown_error")); return null; }
      window.dispatchEvent(new Event("invoices-updated"));
      return data;
    } catch { alert("Network error while saving invoice"); return null; }
  }

  const handleCalculateAndSave = async () => {
    // Consent gate
    if (!signatureData) { setSigOpen(true); return; }

    // Required basics
    const minTd = minTreadFor(vehicleType);
    if (!customerName || !vehicleNumber) { alert("Please fill Customer Name and Vehicle Number."); return; }

    // Validate per-tyre tread depth
    const schema = fitmentSchema(vehicleType, tyreCount);
    for (const label of schema.labels) {
      const v = num(treadByTyre[label], -1);
      if (v < 0) { alert(`Enter tread depth for: ${label}`); return; }
      if (v < minTd) { alert(`Installation blocked: Tread depth at "${label}" is below ${minTd} mm.`); return; }
    }

    // Dosage
    const perTyre = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const tCount = parseInt(tyreCount || "0", 10);
    if (!tCount || tCount < 1) { alert("Please select number of tyres."); return; }
    const totalMl = perTyre * tCount;

    // Pricing math
    const baseRaw = totalMl * PRICE_PER_ML;
    const maxDiscount = Math.round((baseRaw * DISCOUNT_MAX_PCT) / 100);
    const enteredDiscount = Math.max(0, Math.round(num(discountInr)));
    const discountUsed = Math.min(enteredDiscount, maxDiscount);
    const installation = Math.max(0, Math.round(num(installationFeeInr)));

    const amountBeforeTax = Math.max(0, baseRaw - discountUsed + installation);
    let cgst = 0, sgst = 0, igst = 0;
    if (taxMode === "CGST_SGST") {
      cgst = (amountBeforeTax * GST_PERCENT) / 200; // half
      sgst = (amountBeforeTax * GST_PERCENT) / 200; // half
    } else {
      igst = (amountBeforeTax * GST_PERCENT) / 100;
    }
    const gstTotal = cgst + sgst + igst;
    const grand = amountBeforeTax + gstTotal;

    // Consent snapshot
    const consentSnapshot =
      "Customer Consent to Proceed: Informed of process, pricing and GST; consents to installation and undertakes to pay upon completion.";
    const consentSignedAt = (consentMeta && consentMeta.agreedAt) || new Date().toISOString();

    // Save
    const saved = await saveInvoiceToServer({
      // 1) Customer & Vehicle
      customer_name: customerName,
      customer_address: customerAddress || null,
      mobile_number: mobileNumber || null,
      vehicle_number: vehicleNumber,
      odometer: num(odometer),
      installer_name: installerName || null,

      // 2) Vehicle & Fitment
      vehicle_type: vehicleType,
      tyre_count: tCount,
      tyre_width_mm: num(tyreWidth),
      aspect_ratio: num(aspectRatio),
      rim_diameter_in: num(rimDiameter),
      fitment_locations: textFromFitState(fit) || null,

      // tread depths
      tread_depth_mm: Math.min(...Object.values(treadByTyre).map(v => num(v, 0))), // legacy min
      tread_depths_json: JSON.stringify(treadByTyre),

      // Dosage
      dosage_ml: totalMl,

      // Optional customer GSTIN
      customer_gstin: gstin || null,

      // 3) Pricing & Tax (fixed)
      price_per_ml: PRICE_PER_ML,
      discount: discountUsed,
      installation_fee: installation,
      tax_mode: taxMode,
      gst_percentage: GST_PERCENT,          // legacy field
      total_before_gst: amountBeforeTax,    // legacy field (pre-tax)
      gst_amount: gstTotal,                 // legacy field (total GST)
      total_with_gst: grand,                // grand total
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,

      // 4) Consent/signature
      consent_signature: signatureData,
      consent_signed_at: consentSignedAt,
      consent_snapshot: consentSnapshot,
      customer_signature: signatureData,
      signed_at: consentSignedAt,

      gps_lat: null, gps_lng: null, customer_code: null
    });

    if (saved?.id) {
      alert(`Invoice saved. ID: ${saved.id}`);
      // Fetch full invoice (so PDF has everything), but also ensure per-tyre depths are present even if DB column not added yet
      const inv = await fetch(`${API_URL}/api/invoices/${saved.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).catch(() => null);
      if (inv) {
        const invForPdf = { ...inv, tread_depths_json: JSON.stringify(treadByTyre) };
        generateInvoicePDF(invForPdf, profile, taxMode);
      }
      setSignatureData(""); setConsentMeta(null); // ready for next invoice
    }
  };

  const schema = fitmentSchema(vehicleType, tyreCount);
  const baseStyle = { fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' };

  return (
    <div style={{ maxWidth: 1220, margin: "20px auto", padding: 10, ...baseStyle }}>
      <HeadFontLoader />
      <AssetsLoader />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>MaxTT Billing & Dosage Calculator</h1>
        <button onClick={() => { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); onLogout(); }}>
          Logout
        </button>
      </div>

      {profile && (
        <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
          <strong>Franchisee:</strong> {profile.name} &nbsp;|&nbsp;
          <strong>ID:</strong> {profile.franchisee_id} &nbsp;|&nbsp;
          <strong>GSTIN:</strong> {profile.gstin}
          <div style={{ color: "#666" }}>{profile.address || "Address not set"}</div>
        </div>
      )}

      {/* 1) Customer & Vehicle */}
      <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Customer & Vehicle</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input placeholder="Customer Name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          <input placeholder="Address" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} />
          <input placeholder="Telephone/Mobile" value={mobileNumber} onChange={e => setMobileNumber(e.target.value)} />
          <input placeholder="Vehicle Number" value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} />
          <input placeholder="Odometer Reading" value={odometer} onChange={e => setOdometer(e.target.value)} />
          <input placeholder="Installer Name" value={installerName} onChange={e => setInstallerName(e.target.value)} />
        </div>
      </div>

      {/* 2) Vehicle & Fitment */}
      <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Vehicle & Fitment</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div>
            <label style={{ marginRight: 8 }}>Vehicle Category</label>
            <select value={vehicleType} onChange={e => onVehicleTypeChange(e.target.value)}>
              <option>2-Wheeler (Scooter/Motorcycle)</option>
              <option>3-Wheeler (Auto)</option>
              <option>4-Wheeler (Passenger Car/Van/SUV)</option>
              <option>6-Wheeler (Bus/LTV)</option>
              <option>HTV (>6 wheels: Trucks/Trailers/Mining)</option>
            </select>
          </div>
          <div>
            <label style={{ marginRight: 8 }}>Number of Tyres</label>
            <select value={tyreCount} onChange={e => onTyreCountChange(e.target.value)}>
              {(VEHICLE_CFG[vehicleType]?.options || [4]).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          <input placeholder="Tyre Width (mm)" value={tyreWidth} onChange={e => setTyreWidth(e.target.value)} />
          <input placeholder="Aspect Ratio (%)" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} />
          <input placeholder="Rim Diameter (in)" value={rimDiameter} onChange={e => setRimDiameter(e.target.value)} />
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ marginBottom: 6 }}><strong>Fitment Location:</strong></div>
          {schema.labels.map(label => (
            <label key={label} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={!!fit[label]}
                     onChange={(e) => setFit(prev => ({ ...prev, [label]: e.target.checked }))} /> {label}
            </label>
          ))}
        </div>

        {/* Per-tyre tread depths */}
        <div style={{ marginTop: 10 }}>
          <strong>Tread Depth per Tyre (mm)</strong>
          <div style={{ overflowX: "auto" }}>
            <table border="1" cellPadding="6" style={{ minWidth: 600, marginTop: 6 }}>
              <thead><tr><th>Position</th><th>Tread (mm)</th></tr></thead>
              <tbody>
                {schema.labels.map(label => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>
                      <input
                        placeholder={`>= ${minTreadFor(vehicleType)} mm`}
                        value={treadByTyre[label]}
                        onChange={e => setTreadByTyre(prev => ({ ...prev, [label]: e.target.value }))}
                        style={{ width: 160 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
            Minimum tread depth required: <strong>{minTreadFor(vehicleType)} mm</strong> at each measured tyre.
          </div>
        </div>
      </div>

      {/* 3) Pricing & Taxes (fixed) */}
      <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Pricing & Taxes</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div><label>Price per ml (fixed)</label><div><strong>{inr(PRICE_PER_ML)}</strong></div></div>
          <div>
            <label>Discount (₹)</label>
            <input placeholder="e.g., 250" value={discountInr} onChange={e => setDiscountInr(e.target.value)} />
          </div>
          <div>
            <label>Installation Charges (₹)</label>
            <input placeholder="e.g., 200" value={installationFeeInr} onChange={e => setInstallationFeeInr(e.target.value)} />
          </div>
          <div>
            <label>GST Mode</label>
            <div style={{ display: "flex", gap: 12 }}>
              <label><input type="radio" checked={taxMode==="CGST_SGST"} onChange={()=>setTaxMode("CGST_SGST")} /> CGST+SGST</label>
              <label><input type="radio" checked={taxMode==="IGST"} onChange={()=>setTaxMode("IGST")} /> IGST</label>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#666", marginTop: 6 }}>
          Discount is capped at <strong>{DISCOUNT_MAX_PCT}%</strong> of (dosage × price). GST at <strong>{GST_PERCENT}%</strong>.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, marginTop: 10 }}>
          <input placeholder="Customer GSTIN (optional)" value={gstin} onChange={e => setGstin(e.target.value)} />
        </div>
      </div>

      {/* 4) Consent gate */}
      {!signatureData ? (
        <button onClick={() => setSigOpen(true)} style={{ marginRight: 8 }}>
          Capture Customer Signature (Consent)
        </button>
      ) : (
        <span style={{ marginRight: 12, color: "green" }}>Signature & consent ✓</span>
      )}
      <button onClick={handleCalculateAndSave}>Calculate Dosage & Save (Auto PDF)</button>

      {/* 5) Recent Invoices */}
      <RecentInvoices token={token} profile={profile} />

      {/* Consent modal */}
      <SignaturePad
        open={sigOpen}
        onClose={() => setSigOpen(false)}
        onSave={({ dataUrl, consent }) => { setSignatureData(dataUrl); setConsentMeta(consent || null); setSigOpen(false); }}
      />
    </div>
  );
}

// ===== Admin / Super Admin (table only) =====
function AdminApp({ token, onLogout }) {
  return (
    <div style={{ maxWidth: 1200, margin: "20px auto", padding: 10, fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Admin Console</h1>
        <button onClick={() => { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); onLogout(); }}>
          Logout
        </button>
      </div>
      <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10 }}>
        Logged in as <strong>Admin</strong>
      </div>
      <RecentInvoices token={token} profile={null} />
    </div>
  );
}

function SuperAdminApp({ token, onLogout }) {
  return (
    <div style={{ maxWidth: 1200, margin: "20px auto", padding: 10, fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Super Admin Console</h1>
        <button onClick={() => { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); onLogout(); }}>
          Logout
        </button>
      </div>
      <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10 }}>
        Logged in as <strong>Super Admin</strong>
      </div>
      <RecentInvoices token={token} profile={null} />
    </div>
  );
}

// ===== Root =====
export default function App() {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("maxtt_token") || "";
    const role = localStorage.getItem("maxtt_role") || "";
    return token ? { token, role } : null;
  });

  if (!auth) return <LoginView onLoggedIn={setAuth} />;

  if (auth.role === "admin")         return <AdminApp token={auth.token} onLogout={() => setAuth(null)} />;
  if (auth.role === "super_admin")   return <SuperAdminApp token={auth.token} onLogout={() => setAuth(null)} />;
  return <FranchiseeApp token={auth.token} onLogout={() => setAuth(null)} />;
}
