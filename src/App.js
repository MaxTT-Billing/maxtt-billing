// src/App.js — Consent → Review & Confirm (manual override), outlier checks, strict IST, robust treads/fitment, signatures Plan A, HTV caps
import React, { useState, useEffect, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";
import "jspdf-autotable";

/* =======================
   App / Backend Config
   ======================= */
const API_URL = process.env.REACT_APP_API_BASE_URL || "https://maxtt-billing-api.onrender.com";
const API_KEY = "supersecret123"; // frontend key (backend also checks its own server key)

// Pricing policy (fixed)
const PRICE_PER_ML = 4.5;
const GST_PERCENT  = 18;
const DISCOUNT_MAX_PCT = 30;

// Per-tyre outlier thresholds (yellow/red) — SOFT checks (confirm / double-confirm)
const OUTLIER_THRESHOLDS = {
  "2-Wheeler (Scooter/Motorcycle)":          { yellow: 750,   red: 1500 },
  "3-Wheeler (Auto)":                        { yellow: 500,   red: 1200 },
  "4-Wheeler (Passenger Car/Van/SUV)":       { yellow: 1300,  red: 2000 },
  "6-Wheeler (Bus/LTV)":                     { yellow: 3500,  red: 6000 },
  "HTV (>6 wheels: Trucks/Trailers/Mining)": { yellow: 10000, red: 30000 },
};

// Vehicle dosage constants + tyre options
const VEHICLE_CFG = {
  "2-Wheeler (Scooter/Motorcycle)": { k: 2.6,  bufferPct: 0.03, defaultTyres: 2, options: [2] },
  "3-Wheeler (Auto)":               { k: 2.2,  bufferPct: 0.03, defaultTyres: 3, options: [3] },
  "4-Wheeler (Passenger Car/Van/SUV)": { k: 2.56, bufferPct: 0.08, defaultTyres: 4, options: [4] },
  "6-Wheeler (Bus/LTV)":            { k: 3.0,  bufferPct: 0.05, defaultTyres: 6, options: [6] },
  "HTV (>6 wheels: Trucks/Trailers/Mining)": { k: 3.0, bufferPct: 0.05, defaultTyres: 8, options: [8,10,12,14,16,18] }
};

/* =======================
   Dynamic size limits
   ======================= */
const SIZE_LIMITS_DEFAULT = { widthMin: 90, widthMax: 445, aspectMin: 25, aspectMax: 95, rimMin: 8, rimMax: 25 };
const SIZE_LIMITS_HTV     = { widthMin: 90, widthMax: 1200, aspectMin: 10, aspectMax: 100, rimMin: 8, rimMax: 63 };
function sizeLimitsForVehicle(vehicleType) {
  return vehicleType === "HTV (>6 wheels: Trucks/Trailers/Mining)" ? SIZE_LIMITS_HTV : SIZE_LIMITS_DEFAULT;
}

// Per-category min tread (mm)
const TREAD_MIN_MM = {
  "2-Wheeler (Scooter/Motorcycle)": 1.5,
  "3-Wheeler (Auto)": 1.5,
  "4-Wheeler (Passenger Car/Van/SUV)": 1.5,
  "6-Wheeler (Bus/LTV)": 1.5,
  "HTV (>6 wheels: Trucks/Trailers/Mining)": 1.5
};
const minTreadFor = (v) => TREAD_MIN_MM[v] ?? 1.5;

/* =======================
   Fonts for UI
   ======================= */
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

/* =======================
   Helpers
   ======================= */
const num = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};
function roundTo25(x) { return Math.round(x / 25) * 25; }
function inrRs(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const [iRaw, dec="00"] = v.toFixed(2).split(".");
  const i = String(iRaw);
  if (i.length <= 3) return `Rs. ${i}.${dec}`;
  const last3 = i.slice(-3);
  const other = i.slice(0, -3);
  const withCommas = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  return `Rs. ${withCommas}.${dec}`;
}

/** Timestamp utils */
function hasExplicitTZ(s) { return /[zZ]|[+\-]\d{2}:\d{2}$/.test(s); }
/** Parse a Date assuming **UTC** if the string is naive (no timezone). */
function parseAssumingUTC(dateLike) {
  if (dateLike instanceof Date) return new Date(dateLike.getTime());
  if (!dateLike) return new Date();
  let s = String(dateLike).trim();
  if (!s) return new Date();
  if (!s.includes("T") && s.includes(" ")) s = s.replace(" ", "T");
  const src = hasExplicitTZ(s) ? s : (s + "Z");
  const d = new Date(src);
  if (!isNaN(d)) return d;
  return new Date(s);
}
const pad2 = (x) => String(x).padStart(2, "0");
/** Strong IST formatter (always converts from UTC to IST; naive strings are treated as UTC) */
function formatIST(dateLike) {
  const d = parseAssumingUTC(dateLike);
  const utcMs = Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()
  );
  const istMs = utcMs + 330 * 60 * 1000; // +5:30
  const t = new Date(istMs);
  return `${pad2(t.getUTCDate())}/${pad2(t.getUTCMonth()+1)}/${t.getUTCFullYear()}, ${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())} IST`;
}

/* =======================
   Fitment helpers
   ======================= */
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
const textFromFitState = (obj) => Object.entries(obj).filter(([,v]) => !!v).map(([k]) => k).join(", ");
function parseTreadDepthsMap(maybe) {
  if (!maybe) return null;
  if (typeof maybe === "string") {
    try { return JSON.parse(maybe); } catch { return null; }
  }
  if (typeof maybe === "object") return maybe;
  return null;
}
function buildTreadLines(inv) {
  const labels = fitmentSchema(inv.vehicle_type, inv.tyre_count || 0).labels;
  const map = parseTreadDepthsMap(inv.tread_depths_json) || {};
  const entries = labels.map(lbl => {
    const key = Object.keys(map).find(k => k === lbl || k.split(" ×")[0] === lbl.split(" ×")[0]);
    const raw = key ? map[key] : null;
    const val = (raw !== null && raw !== undefined && String(raw).trim() !== "") ? Number(raw) : null;
    return { pos: lbl.split(" ×")[0], val };
  });
  return entries;
}
function deriveFitmentFromTreads(inv) {
  const map = parseTreadDepthsMap(inv.tread_depths_json);
  if (!map || typeof map !== "object") return null;
  const labels = fitmentSchema(inv.vehicle_type, inv.tyre_count || 0).labels;
  const chosen = labels.filter(lbl => {
    const key = Object.keys(map).find(k => k === lbl || k.split(" ×")[0] === lbl.split(" ×")[0]);
    const raw = key ? map[key] : null;
    return raw !== null && raw !== undefined && String(raw).trim() !== "";
  });
  return chosen.length ? chosen.join(", ") : null;
}
function impliedInstalledCount(fitState, vehicleType, tyreCount) {
  const schema = fitmentSchema(vehicleType, tyreCount);
  const rearEach = schema.rearEach || 0;
  const labels = schema.labels;
  let count = 0;
  for (const label of labels) {
    const checked = !!fitState[label];
    if (!checked) continue;
    if (/Rear Left ×\d+/.test(label)) count += rearEach;
    else if (/Rear Right ×\d+/.test(label)) count += rearEach;
    else count += 1;
  }
  return count;
}

/* =======================
   Dosage formula
   ======================= */
function computePerTyreDosageMl(vehicleType, widthMm, aspectPct, rimIn) {
  const entry = VEHICLE_CFG[vehicleType] || VEHICLE_CFG["4-Wheeler (Passenger Car/Van/SUV)"];
  const widthIn = Number(widthMm || 0) * 0.03937;
  const totalHeightIn = widthIn * (Number(aspectPct || 0) / 100) * 2 + Number(rimIn || 0);
  let dosage = widthIn * totalHeightIn * entry.k;
  dosage = dosage * (1 + entry.bufferPct);
  return roundTo25(dosage);
}

/* =======================
   Invoice / Display helpers
   ======================= */
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
  const adr = (profile?.address || "").toUpperCase();
  for (const [name, ab] of Object.entries(INDIA_STATE_ABBR)) {
    if (adr.includes(name)) return ab;
  }
  return "XX";
}
function displayInvoiceCode(inv, profile) {
  const fr = (profile?.franchisee_id || "FR").replace(/\s+/g, "");
  const st = stateAbbrFromProfile(profile);
  const dt = parseAssumingUTC(inv?.created_at || Date.now());
  const mm = String(dt.getUTCMonth()+1).padStart(2,"0");
  const yy = String(dt.getUTCFullYear()).slice(-2);
  const seq = String(inv?.id || 1).padStart(4,"0");
  return `${fr}/${st}/${seq}/${mm}${yy}`;
}

/* =======================
   PDF helpers (no watermark)
   ======================= */
function drawSeparator(doc, y, pageWidth, margin) {
  doc.setDrawColor(200); doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);
}
function drawNumberedSection(doc, title, items, x, y, maxWidth, lineH = 11, fontSize = 9.5) {
  doc.setFontSize(fontSize + 1); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text(title, x, y); y += lineH; try { doc.setFont(undefined,"normal"); } catch {}
  const numberWidth = doc.getTextWidth("00. "); const gap = 4; const textWidth = maxWidth - numberWidth - gap;
  doc.setFontSize(fontSize);
  items.forEach((txt, idx) => {
    const label = `${idx + 1}.`;
    doc.text(label, x, y);
    const lines = doc.splitTextToSize(txt, textWidth);
    lines.forEach((ln) => { doc.text(ln, x + numberWidth + gap, y); y += lineH; });
    y += 1;
  });
  return y;
}

/** ====== Full invoice PDF with fixed zones, strict IST, mini-table for treads, signatures Plan A ====== */
function generateInvoicePDF(inv, profile, taxMode) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();

  // Base metrics
  const M = 36;
  const gapZ12 = 24;  // Zone 1 ↔ Zone 2
  const gapZ23 = 10;  // Zone 2 ↔ Zone 3
  const lineH = 12;

  doc.setFont("helvetica", "normal");

  /** Zone 1 — Franchisee header */
  const headerTop = 40;
  doc.setFontSize(15); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text(profile?.name || "Franchisee", M, headerTop);
  try { doc.setFont(undefined,"normal"); } catch {}
  doc.setFontSize(10.5);
  const addrLines = String(profile?.address || "Address not set").split(/\n|, /g).filter(Boolean);
  addrLines.slice(0,3).forEach((t,i) => doc.text(t, M, headerTop + 16 + i*lineH));
  let yLeft = headerTop + 16 + addrLines.length*lineH + 2;
  doc.text(`Franchisee ID: ${profile?.franchisee_id || ""}`, M, yLeft); yLeft += lineH;
  doc.text(`GSTIN: ${profile?.gstin || ""}`, M, yLeft);

  const createdDt = inv.created_at || Date.now();
  doc.text(`Invoice No: ${displayInvoiceCode(inv, profile)}`, W - M, headerTop, { align: "right" });
  doc.text(`Date: ${formatIST(createdDt)}`, W - M, headerTop + 16, { align: "right" });

  drawSeparator(doc, headerTop + 46, W, M);

  /** Zone 2 — Left: Customer Details, Right: Vehicle Details */
  let y = headerTop + 46 + gapZ12;

  // Left block
  doc.setFontSize(12); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text("Customer Details", M, y);
  try { doc.setFont(undefined,"normal"); } catch {}
  doc.setFontSize(10.5);
  [
    `Name: ${inv.customer_name || ""}`,
    `Mobile: ${inv.mobile_number || ""}`,
    `Vehicle: ${inv.vehicle_number || ""}`,
    `Customer GSTIN: ${inv.customer_gstin || ""}`,
    `Address: ${inv.customer_address || ""}`,
    `Installer: ${inv.installer_name || ""}`
  ].forEach((t,i) => doc.text(t, M, y + 16 + i*lineH));

  // Right block
  const xR = W/2 + 10; let yR = y;
  doc.setFontSize(12); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text("Vehicle Details", xR, yR);
  try { doc.setFont(undefined,"normal"); } catch {}
  doc.setFontSize(10.5);

  // Build Fitment & Treads mini-table rows
  const treadRows = buildTreadLines(inv); // [{pos, val}]
  const installedCount = (() => {
    // prefer fitment_locations derived count if present, else tread-based derivation
    const derived = deriveFitmentFromTreads(inv);
    const tmpFit = {};
    const labels = fitmentSchema(inv.vehicle_type, inv.tyre_count || 0).labels;
    for (const lbl of labels) tmpFit[lbl] = false;
    if (inv.fitment_locations) {
      inv.fitment_locations.split(",").map(s => s.trim()).forEach(lbl => { if (lbl) tmpFit[lbl] = true; });
    } else if (derived) {
      derived.split(",").map(s => s.trim()).forEach(lbl => { if (lbl) tmpFit[lbl] = true; });
    }
    return impliedInstalledCount(tmpFit, inv.vehicle_type, inv.tyre_count || 0);
  })();

  // Right details header lines
  const rightHeader = [
    `Category: ${inv.vehicle_type || ""}`,
    `Tyres: ${inv.tyre_count ?? ""}`,
    `Tyre Size: ${inv.tyre_width_mm || ""}/${inv.aspect_ratio || ""} R${inv.rim_diameter_in || ""}`,
  ];
  rightHeader.forEach((t,i) => doc.text(t, xR, yR + 16 + i*lineH));
  let yRH = yR + 16 + rightHeader.length*lineH;

  // Mini-table title
  doc.setFontSize(11); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text("Fitment & Tread Depth (mm)", xR, yRH + 12);
  try { doc.setFont(undefined,"normal"); } catch {}
  doc.setFontSize(10.5);

  // Render two-column compact table (borderless)
  const posColX = xR;
  const valColX = W - 50; // right-aligned value
  let yTbl = yRH + 12 + 12;
  doc.setFontSize(10.5);
  treadRows.forEach(({pos, val}) => {
    doc.text(pos, posColX, yTbl);
    doc.text(val != null ? `${val} mm` : "—", valColX, yTbl, { align: "right" });
    yTbl += lineH;
  });

  // Installed Tyres: N
  doc.setFontSize(10);
  doc.text(`Installed Tyres: ${installedCount}`, xR, yTbl + 8);
  yTbl += 8 + lineH;

  // Per-tyre & Total dosage lines
  const perTyre = inv.tyre_count ? Math.round((Number(inv.dosage_ml||0)/inv.tyre_count)/25)*25 : null;
  const dosageLines = [
    `Per-tyre Dosage: ${perTyre ?? ""} ml`,
    `Total Dosage: ${inv.dosage_ml ?? ""} ml`
  ];
  dosageLines.forEach((t,i) => doc.text(t, xR, yTbl + i*lineH));
  const z2RightBottom = yTbl + dosageLines.length*lineH;

  // Baseline for next zone (Zone 3)
  const z2LeftBottom  = y + 16 + 6*lineH;
  const z2Bottom = Math.max(z2LeftBottom, z2RightBottom);
  drawSeparator(doc, z2Bottom + gapZ23, W, M);
  let yAfter = z2Bottom + gapZ23 + 6;

  /** Zone 3 — Amounts (recompute to be safe) */
  const pml = Number(inv.price_per_ml || PRICE_PER_ML);
  const baseRaw = Number(inv.dosage_ml || 0) * pml;
  const maxDisc = Math.round((baseRaw * DISCOUNT_MAX_PCT) / 100);
  const discountUsed = Math.min(Math.max(0, Number(inv.discount || 0)), maxDisc);
  const install = Math.max(0, Number(inv.installation_fee || 0));
  const base = Math.max(0, baseRaw - discountUsed + install);
  const mode = (taxMode || inv.tax_mode) === "IGST" ? "IGST" : "CGST_SGST";
  const cgst = mode==="CGST_SGST" ? (base * GST_PERCENT)/200 : 0;
  const sgst = mode==="CGST_SGST" ? (base * GST_PERCENT)/200 : 0;
  const igst = mode==="IGST" ? (base * GST_PERCENT)/100 : 0;
  const gstTotal = cgst + sgst + igst;
  const grand = base + gstTotal;

  doc.autoTable({
    startY: yAfter,
    head: [["Description", "Value"]],
    body: [
      ["Total Dosage (ml)", `${inv.dosage_ml ?? ""}`],
      ["MRP per ml", inrRs(pml)],
      ["Gross (dosage × price)", inrRs(baseRaw)],
      ["Discount", `-${inrRs(discountUsed)}`],
      ["Installation Charges", inrRs(install)],
      ["Tax Mode", mode === "CGST_SGST" ? "CGST+SGST" : "IGST"],
      ["CGST (9%)", inrRs(cgst)],
      ["SGST (9%)", inrRs(sgst)],
      ["IGST (18%)", inrRs(igst)],
      ["Amount (before GST)", inrRs(base)],
      ["GST Total", inrRs(gstTotal)],
      ["Total (with GST)", inrRs(grand)],
    ],
    styles: { fontSize: 10, cellPadding: 5 },
    headStyles: { fillColor: [60,60,60] },
    margin: { left: M, right: M }
  });

  yAfter = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : yAfter + 140;

  /** Mid-install confirmation block */
  const midTitle = "Customer Mid-Install Confirmation";
  const midText = (() => {
    const when = inv.consent_signed_at ? formatIST(inv.consent_signed_at) : formatIST(inv.created_at || Date.now());
    return [
      `Customer consent to proceed was captured and recorded.`,
      `Consent timestamp: ${when}`
    ];
  })();
  const blockPadY = 8, blockPadX = 8;
  const blockWidth = W - 2*M;

  const z3Bottom = yAfter + 8;
  drawSeparator(doc, z3Bottom, W, M);
  let yBlock = z3Bottom + 10;

  doc.setFontSize(11); try { doc.setFont(undefined, "bold"); } catch {}
  doc.text(midTitle, M, yBlock); yBlock += 12; try { doc.setFont(undefined, "normal"); } catch {}
  doc.setDrawColor(220); doc.setLineWidth(0.8);
  const blockHeight = blockPadY*2 + (midText.length * 12);
  doc.rect(M, yBlock, blockWidth, blockHeight);
  let yy = yBlock + blockPadY + 2;
  doc.setFontSize(10.5);
  midText.forEach(t => { doc.text(t, M + blockPadX, yy); yy += 12; });
  yAfter = yBlock + blockHeight;
  drawSeparator(doc, yAfter + 10, W, M);
  yAfter += 20;

  /** Zone 4 — Customer Declaration */
  const maxW = W - M*2;
  const declItems = [
    "I hereby acknowledge that the MaxTT Tyre Sealant installation has been completed on my vehicle to my satisfaction, as per my earlier consent to proceed.",
    "I have read, understood, and accepted the Terms & Conditions stated herein.",
    "I acknowledge that the total amount shown is correct and payable to the franchisee/installer of Treadstone Solutions."
  ];
  yAfter = drawNumberedSection(doc, "Customer Declaration", declItems, M, yAfter, maxW, 11, 9.0);
  drawSeparator(doc, yAfter + 6, W, M);
  yAfter += 16;

  /** Zone 5 — Terms & Conditions */
  const termsItems = [
    "The MaxTT Tyre Sealant, developed in New Zealand and supplied by Treadstone Solutions, is a preventive safety solution designed to reduce tyre-related risks and virtually eliminate punctures and blowouts.",
    "Effectiveness is assured only when the vehicle is operated within the speed limits prescribed by the competent traffic/transport authorities (RTO/Transport Department) in India.",
    "By signing/accepting this invoice, the customer affirms that the installation has been carried out to their satisfaction and agrees to abide by these conditions."
  ];
  yAfter = drawNumberedSection(doc, "Terms & Conditions", termsItems, M, yAfter, maxW, 11, 9.0);
  // (Plan A) Do NOT draw a separator above signatures; just add a small spacer:
  yAfter += 10;

  /** Zone 6 — Signature boxes (Plan A: shorter & lower, no separator above) */
  const boxWidth = 260, boxHeight = 60;
  const bottomMargin = 14; // closer to page bottom
  const maxY = H - bottomMargin - boxHeight;
  const minY = Math.max(yAfter, M + 12);
  const boxY = Math.min(maxY, minY);

  // Left box: Installer Signature & Stamp
  doc.setDrawColor(0); doc.setLineWidth(0.8);
  doc.rect(M, boxY, boxWidth, boxHeight);
  doc.setFontSize(10); doc.text("Installer Signature & Stamp", M + 10, boxY + 14);
  // baseline
  doc.line(M + 10, boxY + boxHeight - 14, M + boxWidth - 10, boxY + boxHeight - 14);

  // Right box: Customer Accepted & Confirmed
  const rightX = W - M - boxWidth;
  doc.rect(rightX, boxY, boxWidth, boxHeight);
  doc.text("Customer Accepted & Confirmed", rightX + 10, boxY + 14);
  if (inv.signed_at) {
    doc.setFontSize(9.5);
    doc.text(`Signed at: ${formatIST(inv.signed_at)}`, rightX + 10, boxY + boxHeight - 26);
  }
  doc.line(rightX + 10, boxY + boxHeight - 14, rightX + boxWidth - 10, boxY + boxHeight - 14);

  if (inv.customer_signature) {
    try { doc.addImage(inv.customer_signature, "PNG", rightX + 10, boxY + 18, 140, 30); } catch {}
  }

  doc.save(`MaxTT_Invoice_${inv.id || "draft"}.pdf`);
}

/* =======================
   Login
   ======================= */
function LoginView({ onLoggedIn }) {
  const [role, setRole] = useState("franchisee");
  const [id, setId] = useState(""); const [pw, setPw] = useState(""); const [err, setErr] = useState("");

  async function doLogin() {
    setErr("");
    const path = role==="admin" ? "/api/admin/login" : role==="super_admin" ? "/api/sa/login" : "/api/login";
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
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
        <input placeholder={`${role==="franchisee"?"Franchisee":role==="admin"?"Admin":"Super Admin"} ID`} value={id} onChange={e=>setId(e.target.value)} />
        <input placeholder="Password" type="password" value={pw} onChange={e=>setPw(e.target.value)} />
        {err && <div style={{ color: "crimson" }}>{err}</div>}
        <button onClick={doLogin}>Login</button>
      </div>
    </div>
  );
}

/* =======================
   Consent Signature Modal (blocking)
   ======================= */
function SignaturePad({ open, onClose, onSave }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStroke, setHasStroke] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const TERMS = `Customer Consent to Proceed
1) I have been informed about the MaxTT sealant installation process, pricing and applicable GST.
2) I understand the preventive nature of the product and that effectiveness requires normal, lawful vehicle operation.
3) I consent to proceed and undertake to pay the total invoice amount to the franchisee/installer upon completion.`;

  useEffect(() => {
    if (!open) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,c.width,c.height);
    ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.strokeStyle = "#111";
    setHasStroke(false); setAgreed(false);
  }, [open]);

  const getPos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    if (e.touches && e.touches.length) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const start = (e) => { setDrawing(true); const {x,y}=getPos(e); const ctx=canvasRef.current.getContext("2d"); ctx.beginPath(); ctx.moveTo(x,y); };
  const move =  (e) => { if (!drawing) return; const {x,y}=getPos(e); const ctx=canvasRef.current.getContext("2d"); ctx.lineTo(x,y); ctx.stroke(); setHasStroke(true); };
  const end =   () => setDrawing(false);
  const clear = () => { const ctx=canvasRef.current.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height); setHasStroke(false); };
  const save = () => {
    if (!agreed || !hasStroke) return;
    const dataUrl = canvasRef.current.toDataURL("image/png");
    const nowIso = new Date().toISOString();
    onSave({ dataUrl, consent: { agreed: true, text: TERMS, agreedAt: nowIso } });
  };

  if (!open) return null;
  return (
    <div style={modalWrap}>
      <div style={{ ...modalBox, maxWidth: 780, fontFamily: '"Poppins",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif' }}>
        <h3 style={{ marginTop: 0 }}>Customer Consent & Signature</h3>
        <div style={{ border: "1px solid #ddd", background: "#fbfbfb", padding: 10, borderRadius: 6, maxHeight: 140, overflow: "auto", whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.35, marginBottom: 10 }}>
          {TERMS}
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <input type="checkbox" checked={agreed} onChange={(e)=>setAgreed(e.target.checked)} />
          <span>I have read and agree to the above terms, and consent to proceed.</span>
        </label>
        <div style={{ border: "1px solid #ccc", borderRadius: 6, background: "#fff", touchAction: "none" }}>
          <canvas
            ref={canvasRef} width={660} height={220}
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

/* =======================
   Confirmation Modal (installer review + manual override + fitment mismatch exception)
   ======================= */
function computeOutlierLevel(perTyreMl, vehicleType) {
  const t = OUTLIER_THRESHOLDS[vehicleType];
  if (!t) return "none";
  if (perTyreMl > t.red) return "red";
  if (perTyreMl > t.yellow) return "yellow";
  return "none";
}
function ConfirmationModal({ open, onClose, onConfirm, data }) {
  const [useManual, setUseManual] = useState(false);
  const [manualPerTyre, setManualPerTyre] = useState("");
  const [chartVersion, setChartVersion] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [overrideAck, setOverrideAck] = useState(false);
  const [doubleConfirm, setDoubleConfirm] = useState(false);

  // Fitment mismatch fields
  const [mismatchReason, setMismatchReason] = useState("");
  const [mismatchNote, setMismatchNote] = useState("");
  const [mismatchAck, setMismatchAck] = useState(false);

  useEffect(() => {
    if (open) {
      setUseManual(false);
      setManualPerTyre("");
      setChartVersion("");
      setOverrideReason("");
      setOverrideNote("");
      setOverrideAck(false);
      setDoubleConfirm(false);

      setMismatchReason("");
      setMismatchNote("");
      setMismatchAck(false);
    }
  }, [open]);

  if (!open) return null;

  const {
    vehicleType, tyreCount, impliedCount,
    tyreWidth, aspectRatio, rimDiameter,
    computedPerTyre, pricePerMl, discountCapPct, enteredDiscount,
    installation, taxMode, gstPercent,
    outlierLevelComputed
  } = data || {};

  const mismatch = Number(impliedCount) !== Number(tyreCount);
  const diff = Math.abs(Number(impliedCount) - Number(tyreCount));
  const needsDoubleConfirm = mismatch && (diff >= 2 || vehicleType.startsWith("HTV"));
  const perTyreBase = computedPerTyre;

  // The per-tyre value we will use (manual or computed)
  const finalPerTyre = useManual ? Number(manualPerTyre || 0) : perTyreBase;
  // The tyre count used for totals: if mismatch, require manual; totals use implied count
  const countUsed = mismatch ? Number(impliedCount) : Number(tyreCount);

  // Recompute price/tax preview for the *used* plan
  const baseRaw = Number(finalPerTyre || 0) * Number(countUsed || 0) * Number(pricePerMl || 0);
  const maxDisc = Math.round((baseRaw * Number(discountCapPct || 0)) / 100);
  const discountUsed = Math.min(Math.max(0, Math.round(Number(enteredDiscount || 0))), maxDisc);
  const amountBeforeTax = Math.max(0, baseRaw - discountUsed + Math.max(0, Number(installation || 0)));
  const mode = taxMode === "IGST" ? "IGST" : "CGST_SGST";
  const cgst = mode==="CGST_SGST" ? (amountBeforeTax * Number(gstPercent || 0))/200 : 0;
  const sgst = mode==="CGST_SGST" ? (amountBeforeTax * Number(gstPercent || 0))/200 : 0;
  const igst = mode==="IGST" ? (amountBeforeTax * Number(gstPercent || 0))/100 : 0;
  const gstTotal = cgst + sgst + igst;
  const grand = amountBeforeTax + gstTotal;

  const outlierLevelManual = useManual ? computeOutlierLevel(finalPerTyre, vehicleType) : "none";
  const levelUsed = useManual ? outlierLevelManual : outlierLevelComputed;

  const mismatchBanner = mismatch
    ? { bg: "#eef5ff", bd: "#a7c6ff", icon: "ℹ️", text: `Fitment count (${impliedCount}) ≠ Tyres selected (${tyreCount}). To proceed, enable Manual Dosage Override and complete the exception fields. Totals will use Installed Tyres = ${impliedCount}.` }
    : null;

  const outlierBanner = levelUsed === "red"
    ? { bg: "#fdecea", bd: "#f5c2c0", icon: "⛔", text: "Extreme dosage for this vehicle class. Double-confirmation required to proceed." }
    : levelUsed === "yellow"
      ? { bg: "#fff8e1", bd: "#ffe08a", icon: "⚠️", text: "Unusual dosage for this vehicle class. Please review carefully before saving." }
      : null;

  // Confirm rules:
  // - If mismatch: must use manual + mismatch fields + (double confirm if big diff/HTV).
  // - If no mismatch: allow either computed or manual (but manual requires its own reason/chart/ack).
  const needManualForMismatch = mismatch;
  const manualBlockers = useManual ? (Number(manualPerTyre) > 0 && overrideReason && chartVersion && overrideAck) : false;
  const mismatchBlockers = !needManualForMismatch || (useManual && mismatchReason && mismatchAck);

  const canConfirm =
    (!needManualForMismatch
      ? (!useManual || manualBlockers)
      : (useManual && manualBlockers && mismatchBlockers))
    && (!needsDoubleConfirm || doubleConfirm);

  const shareText =
`MaxTT Invoice (preview)
Vehicle: ${vehicleType}, Tyres selected: ${tyreCount}, Installed Tyres (Fitment): ${impliedCount}
Size: ${tyreWidth}/${aspectRatio} R${rimDiameter}
Dosage per tyre: ${finalPerTyre} ml
Total dosage: ${Number(finalPerTyre||0) * Number(countUsed||0)} ml
Amount before GST: ${inrRs(amountBeforeTax)}
GST: ${inrRs(gstTotal)}
Grand Total: ${inrRs(grand)}
Tax Mode: ${mode}`;

  return (
    <div style={modalWrap}>
      <div style={{ ...modalBox, maxWidth: 860, fontFamily: '"Poppins",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif' }}>
        <h3 style={{ marginTop: 0 }}>Review & Confirm Before Save</h3>

        {mismatchBanner && (
          <div style={{ background: mismatchBanner.bg, border: `1px solid ${mismatchBanner.bd}`, padding: 10, borderRadius: 6, marginBottom: 10 }}>
            {mismatchBanner.icon} <strong>{mismatchBanner.text}</strong>
          </div>
        )}
        {outlierBanner && (
          <div style={{ background: outlierBanner.bg, border: `1px solid ${outlierBanner.bd}`, padding: 10, borderRadius: 6, marginBottom: 10 }}>
            {outlierBanner.icon} <strong>{outlierBanner.text}</strong>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><strong>Vehicle Category:</strong> {vehicleType}</div>
          <div><strong>Tyres (selected):</strong> {tyreCount}</div>
          <div><strong>Installed Tyres (Fitment):</strong> {impliedCount}</div>
          <div><strong>Tyre Size:</strong> {tyreWidth}/{aspectRatio} R{rimDiameter}</div>
          <div><strong>Per-tyre Dosage (computed):</strong> {perTyreBase} ml</div>
          <div><strong>Per-tyre Dosage (final):</strong> {finalPerTyre} ml</div>
          <div><strong>Total Dosage (final):</strong> {Number(finalPerTyre||0) * Number(countUsed||0)} ml</div>
          <div><strong>Gross (dosage × price):</strong> {inrRs(baseRaw)}</div>
          <div><strong>Discount:</strong> -{inrRs(discountUsed)}</div>
          <div><strong>Installation:</strong> {inrRs(installation)}</div>
          <div><strong>Amount before GST:</strong> {inrRs(amountBeforeTax)}</div>
          <div><strong>GST ({mode==="CGST_SGST" ? "CGST+SGST" : "IGST"}) :</strong> {inrRs(gstTotal)}</div>
          <div><strong>Grand Total:</strong> {inrRs(grand)}</div>
        </div>

        {/* Manual override */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #ddd" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={useManual} onChange={(e)=>{ setUseManual(e.target.checked); setDoubleConfirm(false); }} />
            <strong>Use manual dosage per tyre (from official chart)</strong>
          </label>

          {useManual && (
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Per-tyre dosage (ml)</label>
                <input value={manualPerTyre} onChange={e=>setManualPerTyre(e.target.value.replace(/[^\d.]/g,""))}
                       placeholder={`${perTyreBase}`} />
                {Number(manualPerTyre) <= 0 && <div style={{ color: "crimson", fontSize: 12 }}>Enter a valid number &gt; 0</div>}
              </div>
              <div>
                <label>Chart/version</label>
                <input value={chartVersion} onChange={e=>setChartVersion(e.target.value)} placeholder="e.g., Chart v3 / Aug 2025" />
              </div>
              <div>
                <label>Reason</label>
                <select value={overrideReason} onChange={e=>setOverrideReason(e.target.value)}>
                  <option value="">Select…</option>
                  <option>Odd tyre size</option>
                  <option>Vintage vehicle</option>
                  <option>EV-specific</option>
                  <option>Formula mismatch</option>
                  <option>Emergency completion</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label>Note (optional)</label>
                <input value={overrideNote} onChange={e=>setOverrideNote(e.target.value)} placeholder="Short note…" />
              </div>
              <label style={{ gridColumn: "1 / span 2", display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <input type="checkbox" checked={overrideAck} onChange={(e)=>setOverrideAck(e.target.checked)} />
                I confirm this manual value is taken from the official chart.
              </label>
              {/* Manual outlier indicator */}
              {useManual && outlierBanner && (
                <div style={{ gridColumn: "1 / span 2", fontSize: 12, color: levelUsed==="red" ? "#a40000" : "#7a5900" }}>
                  Manual dosage is {levelUsed.toUpperCase()} outlier for {vehicleType}.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fitment mismatch exception fields */}
        {mismatch && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #ddd" }}>
            <strong>Fitment–Tyres Mismatch Exception</strong>
            {!useManual && <div style={{ color: "crimson", marginTop: 6 }}>Enable <em>Manual Dosage Override</em> above to proceed.</div>}
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Mismatch reason</label>
                <select value={mismatchReason} onChange={e=>setMismatchReason(e.target.value)} disabled={!useManual}>
                  <option value="">Select…</option>
                  <option>Partial install (front only / rear only)</option>
                  <option>Spare not serviced</option>
                  <option>Wheel inaccessible / damaged</option>
                  <option>OTR/HTV chart-specific exception</option>
                  <option>Emergency completion</option>
                  <option>Other</option>
                </select>
              </div>
              <div>
                <label>Note (optional)</label>
                <input value={mismatchNote} onChange={e=>setMismatchNote(e.target.value)} disabled={!useManual} placeholder="Short note…" />
              </div>
              <label style={{ gridColumn: "1 / span 2", display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={mismatchAck} onChange={(e)=>setMismatchAck(e.target.checked)} disabled={!useManual} />
                I acknowledge that Fitment ({impliedCount}) differs from Tyres selected ({tyreCount}), and totals will use Installed Tyres.
              </label>
            </div>
          </div>
        )}

        {/* Double-confirm for RED outliers or large mismatch */}
        {(levelUsed === "red" || needsDoubleConfirm) && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: "#fdecea", border: "1px solid #f5c2c0", padding: 8, borderRadius: 6 }}>
            <input type="checkbox" checked={doubleConfirm} onChange={(e)=>setDoubleConfirm(e.target.checked)} />
            I understand this is a high-risk configuration (extreme dosage and/or large fitment mismatch) and still confirm it is correct.
          </label>
        )}

        <div style={{ marginTop: 10, fontSize: 12, color: "#555" }}>
          A share preview will be available after save (Email / WhatsApp – text only).
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose}>Back & Edit</button>
          <button
            onClick={() => onConfirm({
              shareText,
              // manual override fields
              useManual,
              manualPerTyre: useManual ? Number(manualPerTyre || 0) : null,
              override_reason: useManual ? overrideReason : null,
              override_chart_version: useManual ? chartVersion : null,
              override_note: useManual ? overrideNote : null,
              override_ack: useManual ? overrideAck : false,
              // mismatch audit fields
              fitment_mismatch: mismatch,
              fitment_mismatch_reason: mismatch ? mismatchReason : null,
              fitment_mismatch_note: mismatch ? mismatchNote : null,
              fitment_mismatch_ack: mismatch ? mismatchAck : false,
              // computed context
              outlier_level: levelUsed,
              computed_per_tyre: perTyreBase,
              implied_installed_count: Number(impliedCount),
              tyres_selected: Number(tyreCount),
              // preview totals for reference
              preview_amounts: { baseRaw, discountUsed, amountBeforeTax, gstTotal, grand }
            })}
            disabled={!canConfirm}
            style={{ background: canConfirm ? "#0a7" : "#8fa", color: "#fff", border: "none", padding: "6px 12px", borderRadius: 6 }}
          >
            Confirm & Save
          </button>
        </div>
      </div>
    </div>
  );
}

/* =======================
   Invoices List
   ======================= */
function RecentInvoices({ token, profile }) {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [q, setQ] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [summary, setSummary] = useState(null);
  const headersAuth = { Authorization: `Bearer ${token}` };

  const enrichRow = useCallback((r) => {
    if ((!r.fitment_locations || !String(r.fitment_locations).trim()) && r.tread_depths_json) {
      const derived = deriveFitmentFromTreads(r);
      if (derived) r.fitment_locations = derived;
    }
    return r;
  }, []);

  const fetchRows = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("limit", "500");

    fetch(`${API_URL}/api/invoices?${params.toString()}`, { headers: headersAuth })
      .then(r => r.json()).then(data => {
        const arr = (Array.isArray(data) ? data : []).map(enrichRow);
        arr.sort((a,b) => (Number(b.id||0) - Number(a.id||0)) || (parseAssumingUTC(b.created_at) - parseAssumingUTC(a.created_at)));
        setRows(arr);
        setLoading(false);
      })
      .catch(() => { setError("Could not load invoices"); setLoading(false); });

    fetch(`${API_URL}/api/summary?${params.toString()}`, { headers: headersAuth })
      .then(r => r.json()).then(setSummary).catch(() => setSummary(null));
  }, [q, from, to, token, enrichRow]);

  useEffect(() => { const t = setTimeout(fetchRows, 400); return () => clearTimeout(t); }, [q, from, to, fetchRows]);
  useEffect(() => { fetchRows(); const onU = () => fetchRows(); window.addEventListener("invoices-updated", onU); return () => window.removeEventListener("invoices-updated", onU); }, [fetchRows]);

  async function exportCsv() {
    try {
      const params = new URLSearchParams(); if (q) params.set("q", q); if (from) params.set("from", from); if (to) params.set("to", to);
      const res = await fetch(`${API_URL}/api/invoices/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, "x-api-key": API_KEY }
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>"(no body)");
        throw new Error(`Export failed (${res.status}) — ${txt}`);
      }
      const blob = await res.blob(); const a = document.createElement("a"); const url = URL.createObjectURL(blob);
      const disp = res.headers.get("Content-Disposition") || "";
      const name = disp.includes("filename=") ? disp.split('filename="')[1]?.split('"')[0] || "invoices.csv" : "invoices.csv";
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) {
      alert(String(e));
    }
  }

  async function printPdfFor(id) {
    try {
      const r = await fetch(`${API_URL}/api/invoices/${id}`, { headers: headersAuth });
      const inv = await r.json(); if (!r.ok) throw new Error("fetch failed");
      generateInvoicePDF(inv, profile, inv.tax_mode || "CGST_SGST");
    } catch { alert("Could not fetch invoice for PDF"); }
  }

  if (loading) return <div style={{ marginTop: 20 }}>Loading recent invoices…</div>;
  if (error)   return <div style={{ marginTop: 20, color: "crimson" }}>{error}</div>;

  return (
    <div style={{ marginTop: 24, fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' }}>
      <h2>Invoices</h2>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10, border: "1px solid #eee", padding: 8, borderRadius: 6 }}>
        <input placeholder="Search name or vehicle no." value={q} onChange={e=>setQ(e.target.value)} style={{ flex: 1, minWidth: 280 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          From: <input type="date" value={from} onChange={e=>setFrom(e.target.value)} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          To: <input type="date" value={to} onChange={e=>setTo(e.target.value)} />
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
          Before GST: {inrRs(summary.total_before_gst)} &nbsp; | &nbsp;
          GST: {inrRs(summary.gst_amount)} &nbsp; | &nbsp;
          Total: {inrRs(summary.total_with_gst)}
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
                  <td>{inrRs(r.total_with_gst)}</td>
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

/* =======================
   Franchisee App (main)
   ======================= */
const modalWrap = { position: "fixed", inset: 0, background: "rgba(0,0,0,.40)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 9999 };
const modalBox  = { background: "#fff", borderRadius: 8, padding: 12, maxWidth: 900, width: "100%" };

function FranchiseeApp({ token, onLogout }) {
  const [profile, setProfile] = useState(null);

  // Consent/signature & confirmation
  const [sigOpen, setSigOpen] = useState(false);
  const [signatureData, setSignatureData] = useState("");
  const [consentMeta, setConsentMeta] = useState(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmRef = useRef({}); // data for confirmation

  // Customer & Vehicle
  const [customerName, setCustomerName] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [odometer, setOdometer] = useState("");
  const [installerName, setInstallerName] = useState("");

  // Vehicle & Fitment
  const [vehicleType, setVehicleType] = useState("4-Wheeler (Passenger Car/Van/SUV)");
  const [tyreCount, setTyreCount] = useState(4);
  const [tyreWidth, setTyreWidth] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [rimDiameter, setRimDiameter] = useState("");
  const [fit, setFit] = useState(() => { const m = {}; fitmentSchema("4-Wheeler (Passenger Car/Van/SUV)", 4).labels.forEach(l => m[l] = true); return m; }); // pre-check all
  const [treadByTyre, setTreadByTyre] = useState(() => { const m = {}; fitmentSchema("4-Wheeler (Passenger Car/Van/SUV)", 4).labels.forEach(l => m[l] = ""); return m; });

  // Pricing & Taxes (fixed)
  const [discountInr, setDiscountInr] = useState("");
  const [installationFeeInr, setInstallationFeeInr] = useState("");
  const [taxMode, setTaxMode] = useState("CGST_SGST");
  const [gstin, setGstin] = useState("");

  // Live preview (per-tyre + total)
  const [livePerTyre, setLivePerTyre] = useState(0);
  const [liveTotal, setLiveTotal] = useState(0);

  // Profile
  useEffect(() => {
    fetch(`${API_URL}/api/profile`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (r.status===401){ localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); window.location.reload(); return null; } return r.json(); })
      .then(setProfile).catch(()=>setProfile(null));
  }, [token]);

  // Recompute preview dosage
  useEffect(() => {
    const per = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const count = parseInt(tyreCount || "0", 10);
    const tot = count > 0 ? per * count : 0;
    setLivePerTyre(per); setLiveTotal(tot);
  }, [vehicleType, tyreWidth, aspectRatio, rimDiameter, tyreCount]);

  // Validation helpers with dynamic caps
  const sizeErrors = (() => {
    const limits = sizeLimitsForVehicle(vehicleType);
    const errs = {};
    const w = num(tyreWidth), a = num(aspectRatio), r = num(rimDiameter);
    if (!(w >= limits.widthMin && w <= limits.widthMax)) errs.width = `Width must be ${limits.widthMin}–${limits.widthMax} mm`;
    if (!(a >= limits.aspectMin && a <= limits.aspectMax)) errs.aspect = `Aspect must be ${limits.aspectMin}–${limits.aspectMax}%`;
    if (!(r >= limits.rimMin && r <= limits.rimMax)) errs.rim = `Rim must be ${limits.rimMin}–${limits.rimMax} inches`;
    return errs;
  })();

  function onVehicleTypeChange(v) {
    setVehicleType(v);
    const cfg = VEHICLE_CFG[v] || VEHICLE_CFG["4-Wheeler (Passenger Car/Van/SUV)"];
    const nextTyres = cfg.defaultTyres; setTyreCount(nextTyres);
    const schema = fitmentSchema(v, nextTyres);
    const nextFit = {}; schema.labels.forEach(l => nextFit[l] = true); setFit(nextFit); // pre-check all
    const nextT = {}; schema.labels.forEach(l => nextT[l] = ""); setTreadByTyre(nextT);
  }
  function onTyreCountChange(n) {
    setTyreCount(n);
    const schema = fitmentSchema(vehicleType, n);
    const nextFit = {}; schema.labels.forEach(l => nextFit[l] = true); setFit(nextFit); // pre-check all
    const nextT = {}; schema.labels.forEach(l => nextT[l] = ""); setTreadByTyre(nextT);
  }

  // Fitment helpers (UI)
  const selectAllFitment = () => setFit(prev => {
    const schema = fitmentSchema(vehicleType, tyreCount);
    const next = {}; schema.labels.forEach(l => next[l] = true); return next;
  });
  const clearAllFitment = () => setFit(prev => {
    const schema = fitmentSchema(vehicleType, tyreCount);
    const next = {}; schema.labels.forEach(l => next[l] = false); return next;
  });
  const autoFromTreads = () => setFit(prev => {
    const schema = fitmentSchema(vehicleType, tyreCount);
    const next = {};
    schema.labels.forEach(l => {
      const v = num(treadByTyre[l], -1);
      next[l] = v >= 0 && String(treadByTyre[l]).trim() !== "";
    });
    return next;
  });

  async function saveInvoiceToServer(payload) {
    try {
      const res = await fetch(`${API_URL}/api/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": API_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.status === 401) { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); alert("Session expired. Please log in again."); window.location.reload(); return null; }
      const data = await res.json();
      if (!res.ok) { alert("Save failed: " + (data?.error || "unknown_error")); return null; }
      window.dispatchEvent(new Event("invoices-updated"));
      return data;
    } catch { alert("Network error while saving invoice"); return null; }
  }

  function outlierMessage(perTyre) {
    const t = OUTLIER_THRESHOLDS[vehicleType];
    if (!t) return "";
    if (perTyre > t.red) return `Per-tyre ${perTyre} ml is an EXTREME outlier (> ${t.red} ml) for ${vehicleType}.`;
    if (perTyre > t.yellow) return `Per-tyre ${perTyre} ml is an unusual value (> ${t.yellow} ml) for ${vehicleType}.`;
    return "";
  }

  // Main flow
  const handleCalculateAndReview = async () => {
    // Size validation
    if (sizeErrors.width || sizeErrors.aspect || sizeErrors.rim) { alert("Please fix tyre size fields before continuing."); return; }
    if (!customerName || !vehicleNumber) { alert("Please fill Customer Name and Vehicle Number."); return; }

    // Per-tyre tread validation
    const schema = fitmentSchema(vehicleType, tyreCount);
    const minTd = minTreadFor(vehicleType);
    for (const label of schema.labels) {
      const v = num(treadByTyre[label], -1);
      if (v < 0) { alert(`Enter tread depth for: ${label}`); return; }
      if (v < minTd) { alert(`Installation blocked: Tread depth at "${label}" is below ${minTd} mm.`); return; }
    }

    // Fitment required: at least one
    const impliedCount = impliedInstalledCount(fit, vehicleType, tyreCount);
    if (impliedCount === 0) {
      alert("Select the tyres where sealant was installed (Fitment is required).");
      return;
    }

    // Capture consent/signature first if missing
    if (!signatureData) { setSigOpen(true); return; }

    // Compute base pricing preview with selected Tyres (final may use implied count if mismatch + manual)
    const perTyre = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const tCount = parseInt(tyreCount || "0", 10); if (!tCount || tCount < 1) { alert("Please select number of tyres."); return; }

    const enteredDiscount = Math.max(0, Math.round(num(discountInr)));
    const installation = Math.max(0, Math.round(num(installationFeeInr)));
    const outlierLevel = computeOutlierLevel(perTyre, vehicleType);

    confirmRef.current = {
      vehicleType, tyreCount: tCount, impliedCount,
      tyreWidth, aspectRatio, rimDiameter,
      computedPerTyre: perTyre,
      pricePerMl: PRICE_PER_ML,
      discountCapPct: DISCOUNT_MAX_PCT,
      enteredDiscount,
      installation,
      taxMode,
      gstPercent: GST_PERCENT,
      outlierLevelComputed: outlierLevel
    };
    setConfirmOpen(true);
  };

  async function finalizeSave({
    shareText,
    useManual,
    manualPerTyre,
    override_reason,
    override_chart_version,
    override_note,
    override_ack,
    fitment_mismatch,
    fitment_mismatch_reason,
    fitment_mismatch_note,
    fitment_mismatch_ack,
    outlier_level,
    computed_per_tyre,
    implied_installed_count,
    tyres_selected
  }) {
    setConfirmOpen(false);

    const tCountSelected = parseInt(tyreCount || "0", 10);
    const impliedCount = implied_installed_count;
    const mismatch = fitment_mismatch;

    // Decide per-tyre used
    const perTyreUsed = useManual ? Number(manualPerTyre || 0) : Number(computed_per_tyre || 0);

    // Totals use implied count when mismatch (only allowed if manual override path used)
    const countUsed = mismatch ? Number(impliedCount || 0) : Number(tCountSelected || 0);
    const totalUsed   = perTyreUsed * countUsed;

    // Recompute totals with the used dosage
    const baseRaw = totalUsed * PRICE_PER_ML;
    const maxDiscount = Math.round((baseRaw * DISCOUNT_MAX_PCT) / 100);
    const discountUsed = Math.min(Math.max(0, Math.round(num(discountInr))), maxDiscount);
    const installation = Math.max(0, Math.round(num(installationFeeInr)));
    const amountBeforeTax = Math.max(0, baseRaw - discountUsed + installation);
    const mode = taxMode === "IGST" ? "IGST" : "CGST_SGST";
    const cgst = mode==="CGST_SGST" ? (amountBeforeTax * GST_PERCENT)/200 : 0;
    const sgst = mode==="CGST_SGST" ? (amountBeforeTax * GST_PERCENT)/200 : 0;
    const igst = mode==="IGST" ? (amountBeforeTax * GST_PERCENT)/100 : 0;
    const gstTotal = cgst + sgst + igst;
    const grand = amountBeforeTax + gstTotal;

    // Consent snapshot + AUDIT (override & mismatch details)
    const consentSnapshotBase =
      "Customer Consent to Proceed: Informed of process, pricing and GST; consents to installation and undertakes to pay upon completion.";
    const audit = {
      outlier_level,
      computed_per_tyre_ml: computed_per_tyre,
      override_used: !!useManual,
      override_per_tyre_ml: useManual ? perTyreUsed : null,
      override_total_ml: useManual ? totalUsed : null,
      override_reason: useManual ? override_reason : null,
      override_chart_version: useManual ? override_chart_version : null,
      override_note: useManual ? override_note : null,
      override_ack: !!override_ack,
      fitment_implied_count: impliedCount,
      tyres_selected: tCountSelected,
      fitment_mismatch: !!mismatch,
      fitment_mismatch_reason: mismatch ? fitment_mismatch_reason : null,
      fitment_mismatch_note: mismatch ? fitment_mismatch_note : null,
      fitment_mismatch_ack: !!fitment_mismatch_ack
    };
    const consentSnapshot = `${consentSnapshotBase}\n[AUDIT] ${JSON.stringify(audit)}`;
    const consentSignedAt = (consentMeta && consentMeta.agreedAt) || new Date().toISOString();

    // Build fitment text; ensure not empty
    const fitmentTextStored = textFromFitState(fit) || deriveFitmentFromTreads({ vehicle_type: vehicleType, tyre_count: tCountSelected, tread_depths_json: treadByTyre }) || null;

    const payload = {
      // Customer & Vehicle
      customer_name: customerName,
      customer_address: customerAddress || null,
      mobile_number: mobileNumber || null,
      vehicle_number: vehicleNumber,
      odometer: num(odometer),
      installer_name: installerName || null,

      // Vehicle & Fitment
      vehicle_type: vehicleType,
      tyre_count: tCountSelected,
      tyre_width_mm: num(tyreWidth),
      aspect_ratio: num(aspectRatio),
      rim_diameter_in: num(rimDiameter),
      fitment_locations: fitmentTextStored,

      // Treads
      tread_depth_mm: Math.min(...Object.values(treadByTyre).map(v => num(v, 0))),
      tread_depths_json: JSON.stringify(treadByTyre),

      // Dosage (USED — computed or manual)
      dosage_ml: totalUsed,

      // GSTIN (optional)
      customer_gstin: gstin || null,

      // Pricing & Tax (USED)
      price_per_ml: PRICE_PER_ML,
      discount: discountUsed,
      installation_fee: installation,
      tax_mode: mode,
      gst_percentage: GST_PERCENT,
      total_before_gst: amountBeforeTax,
      gst_amount: gstTotal,
      total_with_gst: grand,
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,

      // Consent/signature
      consent_signature: signatureData,
      consent_signed_at: consentSignedAt,
      consent_snapshot: consentSnapshot,
      customer_signature: signatureData,
      signed_at: consentSignedAt,

      gps_lat: null, gps_lng: null, customer_code: null
    };

    const saved = await saveInvoiceToServer(payload);

    if (saved?.id) {
      alert(`Invoice saved. ID: ${saved.id}`);

      // Fetch full to print, then safety-merge local values if server misses them
      let inv = await fetch(`${API_URL}/api/invoices/${saved.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).catch(() => null);
      if (!inv) inv = {};

      const ensure = (v, fallback) => {
        if (v === undefined || v === null || (typeof v === "number" && !isFinite(v))) return fallback;
        if (typeof v === "string" && v.trim() === "") return fallback;
        return v;
      };
      const printable = {
        ...inv,
        price_per_ml: ensure(inv?.price_per_ml, PRICE_PER_ML),
        discount: ensure(inv?.discount, discountUsed),
        installation_fee: ensure(inv?.installation_fee, installation),
        tax_mode: ensure(inv?.tax_mode, mode),
        gst_percentage: ensure(inv?.gst_percentage, GST_PERCENT),
        total_before_gst: ensure(inv?.total_before_gst, amountBeforeTax),
        gst_amount: ensure(inv?.gst_amount, gstTotal),
        total_with_gst: ensure(inv?.total_with_gst, grand),
        cgst_amount: ensure(inv?.cgst_amount, cgst),
        sgst_amount: ensure(inv?.sgst_amount, sgst),
        igst_amount: ensure(inv?.igst_amount, igst),

        fitment_locations: ensure(inv?.fitment_locations, fitmentTextStored),
        tread_depth_mm: ensure(inv?.tread_depth_mm, Math.min(...Object.values(treadByTyre).map(v => num(v, 0)))),
        tread_depths_json: ensure(inv?.tread_depths_json, treadByTyre),

        customer_signature: ensure(inv?.customer_signature, signatureData),
        consent_signed_at: ensure(inv?.consent_signed_at, consentSignedAt),
        signed_at: ensure(inv?.signed_at, consentSignedAt),

        dosage_ml: ensure(inv?.dosage_ml, totalUsed),
        tyre_count: ensure(inv?.tyre_count, tCountSelected),
        tyre_width_mm: ensure(inv?.tyre_width_mm, num(tyreWidth)),
        aspect_ratio: ensure(inv?.aspect_ratio, num(aspectRatio)),
        rim_diameter_in: ensure(inv?.rim_diameter_in, num(rimDiameter)),
        vehicle_type: ensure(inv?.vehicle_type, vehicleType),
      };

      generateInvoicePDF(printable, profile, printable.tax_mode || "CGST_SGST");

      const subject = encodeURIComponent(`MaxTT Invoice #${saved.id}`);
      const body = encodeURIComponent(shareText);
      const mailto = `mailto:?subject=${subject}&body=${body}`;
      const wa = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
      const share = window.confirm("Open Email/WhatsApp share text?\n\nPress OK for Email, Cancel for WhatsApp.");
      if (share) { window.location.href = mailto; } else { window.open(wa, "_blank"); }

      setSignatureData(""); setConsentMeta(null);
    }
  }

  // UI
  const schema = fitmentSchema(vehicleType, tyreCount);
  const baseStyle = { fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' };
  const hasSizeError = !!(sizeErrors.width || sizeErrors.aspect || sizeErrors.rim);
  const impliedCountUI = impliedInstalledCount(fit, vehicleType, tyreCount);
  const mismatchUI = impliedCountUI !== Number(tyreCount);

  const limits = sizeLimitsForVehicle(vehicleType);

  return (
    <div style={{ maxWidth: 1220, margin: "20px auto", padding: 10, ...baseStyle }}>
      <HeadFontLoader />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>MaxTT Billing & Dosage Calculator</h1>
        <button onClick={() => { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); onLogout(); }}>Logout</button>
      </div>

      {profile && (
        <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10, fontSize: 13 }}>
          <strong>Franchisee:</strong> {profile.name} &nbsp;|&nbsp;
          <strong>ID:</strong> {profile.franchisee_id} &nbsp;|&nbsp;
          <strong>GSTIN:</strong> {profile.gstin}
          <div style={{ color: "#666" }}>{profile.address || "Address not set"}</div>
        </div>
      )}

      {/* Zone A — Customer & Vehicle */}
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

      {/* Zone B — Vehicle & Fitment */}
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
            <label style={{ marginRight: 8 }}>Tyres (installed today)</label>
            <select value={tyreCount} onChange={e => onTyreCountChange(e.target.value)}>
              {(VEHICLE_CFG[vehicleType]?.options || [4]).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 6 }}>
          <div>
            <input placeholder={`Tyre Width (${limits.widthMin}–${limits.widthMax} mm)`} value={tyreWidth} onChange={e => setTyreWidth(e.target.value.replace(/[^\d]/g,""))} />
            {sizeErrors.width && <div style={{ color: "crimson", fontSize: 12 }}>{sizeErrors.width}</div>}
          </div>
          <div>
            <input placeholder={`Aspect Ratio (${limits.aspectMin}–${limits.aspectMax} %)`} value={aspectRatio} onChange={e => setAspectRatio(e.target.value.replace(/[^\d]/g,""))} />
            {sizeErrors.aspect && <div style={{ color: "crimson", fontSize: 12 }}>{sizeErrors.aspect}</div>}
          </div>
          <div>
            <input placeholder={`Rim Diameter (${limits.rimMin}–${limits.rimMax} in)`} value={rimDiameter} onChange={e => setRimDiameter(e.target.value.replace(/[^\d]/g,""))} />
            {sizeErrors.rim && <div style={{ color: "crimson", fontSize: 12 }}>{sizeErrors.rim}</div>}
          </div>
        </div>

        <div style={{ marginBottom: 8, marginTop: 6 }}>
          <div style={{ marginBottom: 6 }}><strong>Fitment Location (required)</strong></div>
          {schema.labels.map(label => (
            <label key={label} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={!!fit[label]} onChange={(e)=>setFit(prev=>({ ...prev, [label]: e.target.checked }))} /> {label}
            </label>
          ))}
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={selectAllFitment}>Select All</button>
            <button type="button" onClick={clearAllFitment}>Clear All</button>
            <button type="button" onClick={autoFromTreads}>Auto-select from Treads</button>
            <span style={{ marginLeft: 10, fontSize: 12, color: impliedCountUI===0 ? "crimson" : (mismatchUI ? "#a05a00" : "#555") }}>
              Installed Tyres (from Fitment): <strong>{impliedCountUI}</strong>{mismatchUI ? " — does not match Tyres" : ""}
            </span>
          </div>
          {impliedCountUI===0 && <div style={{ color: "crimson", fontSize: 12, marginTop: 4 }}>Select the tyres where sealant was installed (required).</div>}
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
                        onChange={e => setTreadByTyre(prev => ({ ...prev, [label]: e.target.value.replace(/[^\d.]/g,"") }))}
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

        {/* Live dosage preview */}
        <div style={{ background: "#f7faf7", border: "1px solid #d8eed8", padding: 8, borderRadius: 6, marginTop: 10 }}>
          <strong>Live Dosage Preview:</strong> &nbsp; Per-tyre <strong>{livePerTyre} ml</strong> &nbsp; | &nbsp; Total <strong>{liveTotal} ml</strong>
          {(() => {
            const msg = outlierMessage(livePerTyre);
            return msg ? <span style={{ color:"#a05a00", marginLeft: 10 }}>⚠ {msg}</span> : null;
          })()}
        </div>
      </div>

      {/* Zone C — Pricing & Taxes */}
      <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Pricing & Taxes</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div><label>Price per ml (fixed)</label><div><strong>{inrRs(PRICE_PER_ML)}</strong></div></div>
          <div>
            <label>Discount (₹)</label>
            <input placeholder="e.g., 250" value={discountInr} onChange={e => setDiscountInr(e.target.value.replace(/[^\d]/g,""))} />
          </div>
          <div>
            <label>Installation Charges (₹)</label>
            <input placeholder="e.g., 200" value={installationFeeInr} onChange={e => setInstallationFeeInr(e.target.value.replace(/[^\d]/g,""))} />
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

      {/* Consent + Review buttons */}
      {!signatureData ? (
        <button onClick={() => setSigOpen(true)} style={{ marginRight: 8 }}>
          Capture Customer Signature (Consent)
        </button>
      ) : (
        <span style={{ marginRight: 12, color: "green" }}>Signature & consent ✓</span>
      )}
      <button onClick={handleCalculateAndReview} disabled={hasSizeError || impliedCountUI===0}>
        Review → Confirm → Save (Auto PDF)
      </button>
      {(hasSizeError || impliedCountUI===0) && <div style={{ color: "crimson", marginTop: 6 }}>{impliedCountUI===0 ? "Fitment is required." : "Fix tyre size errors to continue."}</div>}

      {/* Recent Invoices */}
      <RecentInvoices token={token} profile={profile} />

      {/* Modals */}
      <SignaturePad
        open={sigOpen}
        onClose={() => setSigOpen(false)}
        onSave={({ dataUrl, consent }) => { setSignatureData(dataUrl); setConsentMeta(consent || null); setSigOpen(false); }}
      />
      <ConfirmationModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={finalizeSave}
        data={confirmRef.current}
      />
    </div>
  );
}

/* =======================
   Admin / Super Admin (reuse list)
   ======================= */
function AdminApp({ token, onLogout }) {
  return (
    <div style={{ maxWidth: 1200, margin: "20px auto", padding: 10, fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>Admin Console</h1>
        <button onClick={() => { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); onLogout(); }}>Logout</button>
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
        <button onClick={() => { localStorage.removeItem("maxtt_token"); localStorage.removeItem("maxtt_role"); onLogout(); }}>Logout</button>
      </div>
      <div style={{ background: "#f9f9f9", padding: 8, borderRadius: 6, marginBottom: 10 }}>
        Logged in as <strong>Super Admin</strong>
      </div>
      <RecentInvoices token={token} profile={null} />
    </div>
  );
}

/* =======================
   Root
   ======================= */
export default function App() {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("maxtt_token") || "";
    const role = localStorage.getItem("maxtt_role") || "";
    return token ? { token, role } : null;
  });

  if (!auth) return <LoginView onLoggedIn={setAuth} />;

  if (auth.role === "admin")       return <AdminApp token={auth.token} onLogout={() => setAuth(null)} />;
  if (auth.role === "super_admin") return <SuperAdminApp token={auth.token} onLogout={() => setAuth(null)} />;
  return <FranchiseeApp token={auth.token} onLogout={() => setAuth(null)} />;
}
