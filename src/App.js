// src/App.js — IST snapshot + pricing snapshot + one-page adaptive layout
// Consent → Review & Confirm (manual override), installed-tyre aware dosage,
// robust IST time via Intl + client snapshot fallback, aligned right column,
// signature-box no-overlap on one page, no watermark.

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

// Strict size validation limits (hard blocks)
const SIZE_LIMITS = { widthMin: 90, widthMax: 445, aspectMin: 25, aspectMax: 95, rimMin: 8, rimMax: 25 };

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
  // HTV/OTR relaxed UI limits (Option B)
  "HTV (>6 wheels: Trucks/Trailers/Mining)": { k: 3.0, bufferPct: 0.05, defaultTyres: 8, options: [8,10,12,14,16,18] }
};

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

// Robust date coercion (handles epoch, ISO, and "YYYY-MM-DD HH:mm:ss" as local)
function toDate(any) {
  if (any == null) return new Date();
  if (any instanceof Date) return any;
  if (typeof any === "number") {
    return new Date(any < 1e12 ? any * 1000 : any);
  }
  if (typeof any === "string") {
    const s = any.trim();
    if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000);
    if (/^\d{13}$/.test(s)) return new Date(Number(s));
    // Plain datetime without TZ → parse as local time to avoid double-shift
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?$/);
    if (m) {
      const [,Y,Mo,D,H,Mi,S,Ms] = m;
      const ms = Ms ? Number(Ms.slice(1).padEnd(3,'0').slice(0,3)) : 0;
      return new Date(Number(Y), Number(Mo)-1, Number(D), Number(H), Number(Mi), Number(S), ms);
    }
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  return new Date(any);
}

/** IST formatter using Intl */
function formatIST(dateLike) {
  const d = toDate(dateLike);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = fmt.formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  const DD = parts.day, MM = parts.month, YYYY = parts.year, HH = parts.hour, mm = parts.minute;
  return `${DD}/${MM}/${YYYY}, ${HH}:${mm} IST`;
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
const installedCountFromFit = (fit) => Object.values(fit).filter(Boolean).length;

/* =======================
   Dosage formula
   ======================= */
function computePerTyreDosageMl(vehicleType, widthMm, aspectPct, rimIn) {
  const entry = VEHICLE_CFG[vehicleType] || VEHICLE_CFG["4-Wheeler (Passenger Car/Van/SUV)"];
  const w = num(widthMm);
  const a = num(aspectPct);
  const r = num(rimIn);
  const widthIn = w * 0.03937;
  const totalHeightIn = widthIn * (a / 100) * 2 + r;
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
  const dtSrc = inv?.created_at_client || inv?.created_at || Date.now();
  const dt = toDate(dtSrc);
  const mm = String(dt.getMonth()+1).padStart(2,"0");
  const yy = String(dt.getFullYear()).slice(-2);
  const seq = String(inv?.id || 1).padStart(4,"0");
  return `${fr}/${st}/${seq}/${mm}${yy}`;
}

// Compact label for PDF only
function vehicleTypeForPDF(s) {
  if (!s) return "";
  return s.replace("4-Wheeler (Passenger Car/Van/SUV)", "4-Wheeler (Car/Van/SUV)");
}

// Robust treads parser
function parseTreadsMaybe(v) {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      const o = JSON.parse(v);
      return (o && typeof o === "object") ? o : {};
    } catch { return {}; }
  }
  if (typeof v === "object") return v;
  return {};
}

// Parse [AUDIT] JSON from consent_snapshot
function parseAuditFromSnapshot(inv) {
  const snap = String(inv?.consent_snapshot || "");
  const mark = snap.indexOf("[AUDIT]");
  if (mark === -1) return null;
  const brace = snap.indexOf("{", mark);
  if (brace === -1) return null;
  const jsonPart = snap.slice(brace).trim();
  try { return JSON.parse(jsonPart); } catch { return null; }
}

/* =======================
   PDF helpers (no watermark)
   ======================= */
function drawSeparator(doc, y, pageWidth, margin) {
  doc.setDrawColor(200); doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);
}
function drawNumberedSection(doc, title, items, x, y, maxWidth, lineH = 10, fontSize = 9.5) {
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
function kv(doc, xLabel, xValue, y, label, value) {
  doc.text(label + ":", xLabel, y);
  doc.text(String(value), xValue, y);
}

function installedCountFromInvoice(inv) {
  const fitTxt = (inv?.fitment_locations || "").split(",").map(s => s.trim()).filter(Boolean);
  if (fitTxt.length) return fitTxt.length;
  const map = parseTreadsMaybe(inv?.tread_depths_json);
  const count = Object.values(map).filter(v => v !== "" && v != null).length;
  return count || (num(inv.tyre_count) || 0);
}

/* =======================
   PDF Generator
   (this edit: +1 line gap between Z3 & Z4; move signatures up by 2 lines)
   ======================= */
function generateInvoicePDF(inv, profile, taxMode) {
  const audit = parseAuditFromSnapshot(inv);
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 36;

  // Signature box geometry (tuned)
  let boxWidth = 260, boxHeight = 58;
  let bottomGap = 30; // push boxes lower
  const baseLineH = 10;

  doc.setFont("helvetica","normal");

  /* Zone 1 — Franchisee header */
  doc.setFontSize(15); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text(profile?.name || "Franchisee", M, 40);
  try { doc.setFont(undefined,"normal"); } catch {}
  doc.setFontSize(10.5);
  const addrLines = String(profile?.address || "Address not set").split(/\n|, /g).filter(Boolean);
  addrLines.slice(0,2).forEach((t,i) => doc.text(t, M, 56 + i*12));
  let y = 56 + Math.min(addrLines.length,2)*12 + 2;
  doc.text(`Franchisee ID: ${profile?.franchisee_id || ""}`, M, y); y += 12;
  doc.text(`GSTIN: ${profile?.gstin || ""}`, M, y);
  const createdSrc = inv.created_at_client || inv.created_at || Date.now();
  const createdDisplay = audit?.created_at_ist_str || formatIST(createdSrc);
  doc.text(`Invoice No: ${displayInvoiceCode(inv, profile)}`, W - M, 40, { align: "right" });
  doc.text(`Date: ${createdDisplay}`, W - M, 56, { align: "right" });

  drawSeparator(doc, 86, W, M);
  y = 98;

  /* Zone 2 — Customer (left) & Vehicle (right) */
  // Left: Customer
  doc.setFontSize(12); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text("Customer Details", M, y);
  try { doc.setFont(undefined,"normal"); } catch {}
  doc.setFontSize(10.5);
  const leftLines = [
    `Name: ${inv.customer_name || ""}`,
    `Mobile: ${inv.mobile_number || ""}`,
    `Vehicle: ${inv.vehicle_number || ""}`,
    `Odometer Reading: ${inv.odometer != null && inv.odometer !== "" ? inv.odometer + " km" : ""}`,
    `Customer GSTIN: ${inv.customer_gstin || ""}`,
    `Address: ${inv.customer_address || ""}`,
    `Installer: ${inv.installer_name || ""}`
  ];
  const leftBudget = 14;
  try {
    const addrRaw = String(inv.customer_address || "");
    const addrParts = addrRaw.split(/\n/g);
    if (addrParts.length > 1 && leftLines.length < leftBudget) {
      const idx = leftLines.findIndex(l => l.startsWith("Address:"));
      if (idx >= 0) leftLines.splice(idx+1, 0, `Address (contd): ${addrParts.slice(1).join(" ").trim()}`);
    }
    if (inv.customer_email && leftLines.length < leftBudget) {
      leftLines.push(`Email: ${inv.customer_email}`);
    }
  } catch {}

  leftLines.slice(0, leftBudget).forEach((t,i)=>doc.text(t, M, y + 16 + i*14));

  // Right: Vehicle
  const xR = W/2 + 8; let yR = y;
  doc.setFontSize(12); try { doc.setFont(undefined,"bold"); } catch {}
  doc.text("Vehicle Details", xR, yR);
  try { doc.setFont(undefined,"normal"); } catch {}
  doc.setFontSize(10.5);

  const labelW = 120;
  const xVal = xR + labelW;

  const treadMapRaw = parseTreadsMaybe(inv.tread_depths_json);
  const treadMap = treadMapRaw && typeof treadMapRaw === "object" ? treadMapRaw : {};
  const fitTxt = (inv.fitment_locations || "").split(",").map(s=>s.trim()).filter(Boolean);
  const installed = fitTxt.length || Object.values(treadMap).filter(v => v !== "" && v != null).length || num(inv.tyre_count);

  const rightKV = [
    ["Category", vehicleTypeForPDF(inv.vehicle_type || "")],
    ["Tyres", `${inv.tyre_count ?? ""}`],
    ["Installed Tyres", `${installed}`],
    ["Tyre Size", `${inv.tyre_width_mm || ""}/${inv.aspect_ratio || ""} R${inv.rim_diameter_in || ""}`],
  ];
  const rightRowH = 12.5; const rightHeaderGap = 13;
  rightKV.forEach((pair,i) => kv(doc, xR, xVal, yR + rightHeaderGap + i*rightRowH, pair[0], pair[1]));

  // Fitment & Treads (installed only)
  const showRows = (fitTxt.length ? fitTxt : Object.keys(treadMap))
    .filter(k => (fitTxt.length ? true : (treadMap[k] !== "" && treadMap[k] != null)));
  const ftY = yR + rightHeaderGap + rightKV.length*rightRowH + 3;
  let yAfter = ftY;

  if (showRows.length) {
    try { doc.setFont(undefined,"bold"); } catch {}
    doc.text("Fitment & Tread Depth (mm)", xR, ftY);
    try { doc.setFont(undefined,"normal"); } catch {}
    const body = showRows.map(lbl => {
      const key = lbl;
      const val = (treadMap[key] ?? inv.tread_depth_mm ?? "");
      return [key.replace(" ×", " x"), String(val)];
    });
    doc.autoTable({
      startY: ftY + 3,
      head: [["Position","Tread (mm)"]],
      body,
      styles: { fontSize: 10, cellPadding: 4 },
      headStyles: { fillColor: [60,60,60] },
      margin: { left: xR, right: M },
      tableWidth: W - xR - M
    });
    yAfter = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : ftY + 30;
  }

  // Dosage lines (aligned with right column values)
  const perTyre = installed ? Math.round((Number(inv.dosage_ml||0)/installed)/25)*25 : null;
  kv(doc, xR, xVal, yAfter + 16, "Per-tyre Dosage", `${perTyre ?? ""} ml`);
  kv(doc, xR, xVal, yAfter + 30, "Total Dosage", `${inv.dosage_ml ?? ""} ml`);

  // Zone 3 start (slightly above earlier to win space)
  const z3StartBase = Math.max(y + 160, yAfter + 46);

  // Remain space estimate against bottom boxes
  const boxYDefault = H - bottomGap - boxHeight;
  const spaceLeft = boxYDefault - (z3StartBase + 12);

  // Tight mode detection
  const tightMode = spaceLeft < 190 || showRows.length >= 4 || addrLines.length >= 3;
  const zoneGap = tightMode ? 8 : 10;
  const secLineH = tightMode ? 9 : baseLineH;
  const secFont = tightMode ? 9.2 : 9.5;

  drawSeparator(doc, z3StartBase - 10, W, M);

  /* Zone 3 — Amounts table (with pricing snapshot fallback) */
  const pSnap = audit?.pricing_snapshot || null;
  const pricePerMlUsed = Number(inv.price_per_ml || (pSnap && pSnap.price_per_ml) || PRICE_PER_ML);

  let baseRaw = Number(inv.dosage_ml || 0) * pricePerMlUsed;
  let discountField = inv.discount ?? inv.discount_inr;
  let installField  = inv.installation_fee ?? inv.installation;

  let discountUsed = Number(discountField != null ? discountField : (pSnap ? pSnap.discount_rupees : 0)) || 0;
  let installUsed  = Number(installField  != null ? installField  : (pSnap ? pSnap.installation_rupees : 0)) || 0;

  const maxDisc = Math.round((baseRaw * DISCOUNT_MAX_PCT) / 100);
  discountUsed = Math.min(discountUsed, maxDisc);

  const base = Math.max(0, baseRaw - discountUsed + installUsed);
  const mode = (taxMode || inv.tax_mode) === "IGST" ? "IGST" : "CGST_SGST";
  const cgst = mode==="CGST_SGST" ? (base * GST_PERCENT)/200 : 0;
  const sgst = mode==="CGST_SGST" ? (base * GST_PERCENT)/200 : 0;
  const igst = mode==="IGST"       ? (base * GST_PERCENT)/100 : 0;
  const gstTotal = cgst + sgst + igst;
  const grand = base + gstTotal;

  // Align columns with right column start
  const descWidth = (W/2 + 8) - M;
  const valueWidth = W - M - (W/2 + 8);

  doc.autoTable({
    startY: z3StartBase,
    head: [["Description", "Value"]],
    body: [
      ["Total Dosage (ml)", `${inv.dosage_ml ?? ""}`],
      ["MRP per ml", inrRs(pricePerMlUsed)],
      ["Gross", inrRs(baseRaw)],
      ["Discount", `-${inrRs(discountUsed)}`],
      ["Installation Charges", inrRs(installUsed)],
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
    margin: { left: M, right: M },
    tableWidth: W - 2*M,
    columnStyles: {
      0: { cellWidth: descWidth },
      1: { cellWidth: valueWidth }
    }
  });

  let yZ3End = (doc.lastAutoTable && doc.lastAutoTable.finalY) ? doc.lastAutoTable.finalY : z3StartBase + 140;
  drawSeparator(doc, yZ3End + 6, W, M);
  let yAfter3 = yZ3End + zoneGap + 6;

  // ******** EDIT #1: Add ONE line gap between Zone 3 & Zone 4 ********
  yAfter3 += secLineH;

  /* Zone 4 — Customer Declaration */
  const maxW = W - M*2;
  const declItems = [
    "I hereby acknowledge that the MaxTT Tyre Sealant installation has been completed on my vehicle to my satisfaction, as per my earlier consent to proceed.",
    "I have read, understood, and accepted the Terms & Conditions stated herein.",
    "I acknowledge that the total amount shown is correct and payable to the franchisee/installer of Treadstone Solutions."
  ];
  yAfter3 = drawNumberedSection(doc, "Customer Declaration", declItems, M, yAfter3, maxW, secLineH, secFont);
  drawSeparator(doc, yAfter3 + 6, W, M); yAfter3 += zoneGap + 6;

  // Uniform 1-line gap between Zone 4 & Zone 5
  yAfter3 += secLineH;

  /* Zone 5 — Terms & Conditions (+ Jurisdiction: Gurgaon) */
  const termsItems = [
    "The MaxTT Tyre Sealant, developed in New Zealand and supplied by Treadstone Solutions, is a preventive safety solution designed to reduce tyre-related risks and virtually eliminate punctures and blowouts.",
    "Effectiveness is assured only when the vehicle is operated within the speed limits prescribed by the competent traffic/transport authorities (RTO/Transport Department) in India.",
    "By signing/accepting this invoice, the customer affirms that the installation has been carried out to their satisfaction and agrees to abide by these conditions. Jurisdiction: Gurgaon."
  ];
  yAfter3 = drawNumberedSection(doc, "Terms & Conditions", termsItems, M, yAfter3, maxW, secLineH, secFont);

  // (Separator above signatures remains removed to keep space)

  /* Zone 6 — Signature boxes (pushed down; labels small) */

  // ******** EDIT #2: Move signatures UP by TWO lines (reduce gap: 5 → 3 lines) ********
  const minGapAboveBoxes = 1 * secLineH; // was 5 * secLineH
  const labelPad = 12; // smaller label baseline

  // If still ultra-tight after compressing, shave box height a hair
  if (yAfter3 > (H - bottomGap - boxHeight - 10)) {
    boxHeight = 56;
  }

  // Compute final Y: respect bottom margin and min gap above
  let finalBoxY = Math.max(H - bottomGap - boxHeight, yAfter3 + minGapAboveBoxes);

  // Guard: keep labels within page bottom
  if (finalBoxY + boxHeight + labelPad > H - 8) {
    finalBoxY = H - 8 - (boxHeight + labelPad);
    if (finalBoxY < yAfter3 + minGapAboveBoxes) {
      // last resort: reduce box height a bit more
      boxHeight = Math.max(54, boxHeight - 2);
      finalBoxY = Math.max(H - bottomGap - boxHeight, yAfter3 + minGapAboveBoxes);
    }
  }

  // Installer box
  doc.rect(M, finalBoxY, boxWidth, boxHeight);
  doc.setFontSize(9);
  try { doc.setFont(undefined,"bold"); } catch {}
  doc.text("Installer Signature & Stamp", M + 10, finalBoxY + boxHeight + labelPad);
  try { doc.setFont(undefined,"normal"); } catch {}

  // Customer box (with signature image)
  const rightX = W - M - boxWidth;
  doc.rect(rightX, finalBoxY, boxWidth, boxHeight);
  try { doc.setFont(undefined,"bold"); } catch {}
  doc.text("Customer Accepted & Confirmed", rightX + 10, finalBoxY + boxHeight + labelPad);
  try { doc.setFont(undefined,"normal"); } catch {}

  if (inv.customer_signature) {
    try { doc.addImage(inv.customer_signature, "PNG", rightX + 10, finalBoxY + 8, 140, boxHeight - 18); } catch {}
  }
  const signedDisplay = audit?.signed_at_ist_str || (inv.signed_at ? formatIST(inv.signed_at) : null);
  if (signedDisplay) {
    doc.setFontSize(9);
    doc.text(`Signed at: ${signedDisplay}`, rightX + 10, finalBoxY + boxHeight - 6);
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
   Confirmation Modal (installer review + manual override)
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

  useEffect(() => {
    if (open) {
      setUseManual(false);
      setManualPerTyre("");
      setChartVersion("");
      setOverrideReason("");
      setOverrideNote("");
      setOverrideAck(false);
      setDoubleConfirm(false);
    }
  }, [open]);

  if (!open) return null;
  const {
    vehicleType, tyreCount, installedCount, tyreWidth, aspectRatio, rimDiameter,
    perTyreMl, totalMl, baseRaw, discountUsed, installation,
    mode, cgst, sgst, igst, amountBeforeTax, gstTotal, grand
  } = data || {};

  const computedLevel = computeOutlierLevel(perTyreMl, vehicleType);
  const manualVal = Number(manualPerTyre || 0);
  const manualLevel = useManual ? computeOutlierLevel(manualVal, vehicleType) : "none";
  const levelUsed = useManual ? manualLevel : computedLevel;
  const finalPerTyre = useManual ? manualVal : perTyreMl;
  const finalTotal   = finalPerTyre * Number(installedCount || 0);

  const levelBanner = levelUsed === "red"
    ? { bg: "#fdecea", bd: "#f5c2c0", icon: "⛔", text: "Extreme dosage for this vehicle class. Double-confirmation required to proceed." }
    : levelUsed === "yellow"
      ? { bg: "#fff8e1", bd: "#ffe08a", icon: "⚠️", text: "Unusual dosage for this vehicle class. Please review carefully before saving." }
      : null;

  const shareText =
`MaxTT Invoice (preview)
Vehicle: ${vehicleType}, Tyres (selected/installed): ${tyreCount} → ${installedCount}
Size: ${tyreWidth}/${aspectRatio} R${rimDiameter}
Dosage per tyre: ${finalPerTyre} ml
Total dosage: ${finalTotal} ml
Amount before GST: ${inrRs(amountBeforeTax)}
GST: ${inrRs(gstTotal)}
Grand Total: ${inrRs(grand)}
Tax Mode: ${mode}`;

  const canConfirm =
    (!useManual || (manualVal > 0 && overrideReason && chartVersion && overrideAck)) &&
    (levelUsed !== "red" || doubleConfirm);

  return (
    <div style={modalWrap}>
      <div style={{ ...modalBox, maxWidth: 820, fontFamily: '"Poppins",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif' }}>
        <h3 style={{ marginTop: 0 }}>Review & Confirm Before Save</h3>

        {levelBanner && (
          <div style={{ background: levelBanner.bg, border: `1px solid ${levelBanner.bd}`, padding: 10, borderRadius: 6, marginBottom: 10 }}>
            {levelBanner.icon} <strong>{levelBanner.text}</strong>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><strong>Vehicle Category:</strong> {vehicleType}</div>
          <div><strong>Tyres (selected → installed):</strong> {tyreCount} → {installedCount}</div>
          <div><strong>Tyre Size:</strong> {tyreWidth}/{aspectRatio} R{rimDiameter}</div>
          <div><strong>Per-tyre Dosage (computed):</strong> {perTyreMl} ml</div>
          <div><strong>Total Dosage (computed):</strong> {totalMl} ml</div>
          <div><strong>Gross:</strong> {inrRs(baseRaw)}</div>
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
                       placeholder={`${perTyreMl}`} />
                {manualVal <= 0 && <div style={{ color: "crimson", fontSize: 12 }}>Enter a valid number &gt; 0</div>}
              </div>
              <div>
                <label>Chart/version</label>
                <input value={chartVersion} onChange={e=>setChartVersion(e.target.value)} placeholder="e.g., Chart v3 / Aug 2025" />
              </div>
              <div>
                <label>Reason</label>
                <select value={overrideReason} onChange={e=>setOverrideReason(e.target.value)}>
                  <option value="">Select…</option>
                  <option>Partial/odd size</option>
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
              {manualLevel !== "none" && (
                <div style={{ gridColumn: "1 / span 2", fontSize: 12, color: manualLevel==="red" ? "#a40000" : "#7a5900" }}>
                  Manual dosage is {manualLevel.toUpperCase()} outlier for {vehicleType}.
                </div>
              )}
            </div>
          )}
        </div>

        {levelUsed === "red" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: "#fdecea", border: "1px solid #f5c2c0", padding: 8, borderRadius: 6 }}>
            <input type="checkbox" checked={doubleConfirm} onChange={(e)=>setDoubleConfirm(e.target.checked)} />
            I understand this is an **extreme** dosage value and still confirm it is correct.
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
              useManual,
              manualPerTyre: useManual ? manualVal : null,
              outlier_level: levelUsed,
              override_reason: useManual ? overrideReason : null,
              override_chart_version: useManual ? chartVersion : null,
              override_note: useManual ? overrideNote : null,
              computed_per_tyre: perTyreMl,
              computed_total: totalMl
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

  const fetchRows = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("limit", "500");

    fetch(`${API_URL}/api/invoices?${params.toString()}`, { headers: headersAuth })
      .then(r => r.json()).then(data => {
        const arr = Array.isArray(data) ? data.slice().sort((a,b)=> (num(b.id) - num(a.id))) : [];
        setRows(arr); setLoading(false);
      })
      .catch(() => { setError("Could not load invoices"); setLoading(false); });

    fetch(`${API_URL}/api/summary?${params.toString()}`, { headers: headersAuth })
      .then(r => r.json()).then(setSummary).catch(() => setSummary(null));
  }, [q, from, to, token]);

  useEffect(() => { const t = setTimeout(fetchRows, 400); return () => clearTimeout(t); }, [q, from, to, fetchRows]);
  useEffect(() => { fetchRows(); const onU = () => fetchRows(); window.addEventListener("invoices-updated", onU); return () => window.removeEventListener("invoices-updated", onU); }, [fetchRows]);

  async function exportCsv() {
    try {
      const params = new URLSearchParams(); if (q) params.set("q", q); if (from) params.set("from", from); if (to) params.set("to", to);
      const res = await fetch(`${API_URL}/api/invoices/export?${params.toString()}`);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob(); const a = document.createElement("a"); const url = URL.createObjectURL(blob);
      const disp = res.headers.get("Content-Disposition") || "";
      const name = disp.includes("filename=") ? disp.split('filename="')[1]?.split('"')[0] || "invoices.csv" : "invoices.csv";
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { alert(`Export failed: backend route not ready.\n${String(e)}`); }
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
          <table border="1" cellPadding="6" style={{ minWidth: 1280 }}>
            <thead>
              <tr>
                <th>ID</th><th>Date/Time (IST)</th><th>Customer</th><th>Vehicle</th>
                <th>Category</th><th>Tyres (sel → inst)</th><th>Fitment</th>
                <th>Total Dosage (ml)</th><th>Total (₹)</th><th>PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const inst = (r.fitment_locations || "").split(",").map(s => s.trim()).filter(Boolean).length;
                const createdSrc = r.created_at_client || r.created_at;
                const audit = parseAuditFromSnapshot(r);
                const when = audit?.created_at_ist_str || formatIST(createdSrc);
                return (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{when}</td>
                    <td>{r.customer_name ?? ""}</td>
                    <td>{r.vehicle_number ?? ""}</td>
                    <td>{r.vehicle_type ?? ""}</td>
                    <td>{r.tyre_count ?? ""} → {inst || 0}</td>
                    <td>{r.fitment_locations || ""}</td>
                    <td>{r.dosage_ml ?? ""}</td>
                    <td>{inrRs(r.total_with_gst)}</td>
                    <td><button onClick={() => printPdfFor(r.id)}>PDF</button></td>
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
  const [fit, setFit] = useState(() => { const m = {}; fitmentSchema("4-Wheeler (Passenger Car/Van/SUV)", 4).labels.forEach(l => m[l] = false); return m; });
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

  // Recompute preview dosage (installed count)
  useEffect(() => {
    const per = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const inst = installedCountFromFit(fit);
    const tot = inst > 0 ? per * inst : 0;
    setLivePerTyre(per); setLiveTotal(tot);
  }, [vehicleType, tyreWidth, aspectRatio, rimDiameter, fit]);

  // Validation helpers
  const sizeErrors = (() => {
    const errs = {};
    const w = num(tyreWidth), a = num(aspectRatio), r = num(rimDiameter);
    const isHTV = vehicleType.startsWith("HTV");
    const lim = isHTV
      ? { widthMin: 90, widthMax: 1200, aspectMin: 10, aspectMax: 100, rimMin: 8, rimMax: 63 }
      : SIZE_LIMITS;
    if (!(w >= lim.widthMin && w <= lim.widthMax)) errs.width = `Width must be ${lim.widthMin}–${lim.widthMax} mm`;
    if (!(a >= lim.aspectMin && a <= lim.aspectMax)) errs.aspect = `Aspect must be ${lim.aspectMin}–${lim.aspectMax}%`;
    if (!(r >= lim.rimMin && r <= lim.rimMax)) errs.rim = `Rim must be ${lim.rimMin}–${lim.rimMax} inches`;
    return errs;
  })();

  function onVehicleTypeChange(v) {
    setVehicleType(v);
    const cfg = VEHICLE_CFG[v] || VEHICLE_CFG["4-Wheeler (Passenger Car/Van/SUV)"];
    const nextTyres = cfg.defaultTyres; setTyreCount(nextTyres);
    const schema = fitmentSchema(v, nextTyres);
    const nextFit = {}; schema.labels.forEach(l => nextFit[l] = false); setFit(nextFit);
    const nextT = {}; schema.labels.forEach(l => nextT[l] = ""); setTreadByTyre(nextT);
  }
  function onTyreCountChange(n) {
    setTyreCount(n);
    const schema = fitmentSchema(vehicleType, n);
    const nextFit = {}; schema.labels.forEach(l => nextFit[l] = false); setFit(nextFit);
    const nextT = {}; schema.labels.forEach(l => nextT[l] = ""); setTreadByTyre(nextT);
  }

  // Fitment quick actions
  const fitSchema = fitmentSchema(vehicleType, tyreCount);
  function selectAllFit() {
    const next = {}; fitSchema.labels.forEach(l => next[l] = true); setFit(next);
  }
  function clearAllFit() {
    const next = {}; fitSchema.labels.forEach(l => next[l] = false); setFit(next);
  }
  function autoSelectFromTreads() {
    const next = {}; fitSchema.labels.forEach(l => next[l] = !!treadByTyre[l]); setFit(next);
  }

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

  // Main flow: click → ensure consent → review modal → save → PDF + share
  const handleCalculateAndReview = async () => {
    if (sizeErrors.width || sizeErrors.aspect || sizeErrors.rim) { alert("Please fix tyre size fields before continuing."); return; }
    if (!customerName || !vehicleNumber) { alert("Please fill Customer Name and Vehicle Number."); return; }

    const schema = fitmentSchema(vehicleType, tyreCount);
    const minTd = minTreadFor(vehicleType);

    // Require at least one fitment
    const installed = installedCountFromFit(fit);
    if (installed <= 0) { alert("Select at least one Fitment Location (installed today)."); return; }

    // Require tread values only for checked positions
    for (const label of schema.labels) {
      if (!fit[label]) continue; // only installed tyres
      const v = num(treadByTyre[label], -1);
      if (v < 0) { alert(`Enter tread depth for: ${label}`); return; }
      if (v < minTd) { alert(`Installation blocked: Tread at "${label}" is below ${minTd} mm.`); return; }
    }

    // Capture consent/signature first if missing
    if (!signatureData) { setSigOpen(true); return; }

    // Compute pricing from computed dosage (installed count)
    const perTyre = computePerTyreDosageMl(vehicleType, tyreWidth, aspectRatio, rimDiameter);
    const total = perTyre * installed;

    const baseRaw = total * PRICE_PER_ML;
    const maxDiscount = Math.round((baseRaw * DISCOUNT_MAX_PCT) / 100);
    const enteredDiscount = Math.max(0, Math.round(num(discountInr)));
    const discountUsed = Math.min(enteredDiscount, maxDiscount);
    const installation = Math.max(0, Math.round(num(installationFeeInr)));
    const amountBeforeTax = Math.max(0, baseRaw - discountUsed + installation);
    let cgst=0, sgst=0, igst=0;
    const mode = taxMode === "IGST" ? "IGST" : "CGST_SGST";
    if (mode === "CGST_SGST") { cgst = (amountBeforeTax * GST_PERCENT)/200; sgst = (amountBeforeTax * GST_PERCENT)/200; }
    else { igst = (amountBeforeTax * GST_PERCENT)/100; }
    const gstTotal = cgst + sgst + igst;
    const grand = amountBeforeTax + gstTotal;

    confirmRef.current = {
      vehicleType, tyreCount, installedCount: installed, tyreWidth, aspectRatio, rimDiameter,
      perTyreMl: perTyre, totalMl: total, baseRaw, discountUsed, installation,
      mode, cgst, sgst, igst, amountBeforeTax, gstTotal, grand
    };
    setConfirmOpen(true);
  };

  async function finalizeSave({
    shareText,
    useManual,
    manualPerTyre,
    outlier_level,
    override_reason,
    override_chart_version,
    override_note,
    computed_per_tyre,
    computed_total
  }) {
    setConfirmOpen(false);

    const installed = installedCountFromFit(fit);
    const perTyreUsed = useManual ? Number(manualPerTyre || 0) : Number(confirmRef.current.perTyreMl || 0);
    const totalUsed   = perTyreUsed * installed;

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

    // Consent snapshot + AUDIT (also carry IST display strings + pricing snapshot)
    const consentSnapshotBase =
      "Customer Consent to Proceed: Informed of process, pricing and GST; consents to installation and undertakes to pay upon completion.";
    const now = new Date();
    const createdIst = formatIST(now);
    const consentSignedAt = (consentMeta && consentMeta.agreedAt) || now.toISOString();
    const signedIst = formatIST(consentSignedAt);

    const audit = {
      outlier_level,
      computed_per_tyre_ml: computed_per_tyre,
      computed_total_ml: computed_total,
      override_used: !!useManual,
      override_per_tyre_ml: useManual ? perTyreUsed : null,
      override_total_ml: useManual ? totalUsed : null,
      override_reason: useManual ? override_reason : null,
      override_chart_version: useManual ? override_chart_version : null,
      override_note: useManual ? override_note : null,
      tyre_count_selected: num(tyreCount),
      tyre_count_installed: installed,
      created_at_ist_str: createdIst,
      signed_at_ist_str: signedIst,
      pricing_snapshot: {
        price_per_ml: PRICE_PER_ML,
        discount_rupees: discountUsed,
        installation_rupees: installation,
        amount_before_gst: amountBeforeTax,
        gst_total: gstTotal,
        total_with_gst: grand
      }
    };
    const consentSnapshot = `${consentSnapshotBase}\n[AUDIT] ${JSON.stringify(audit)}`;

    const createdAtClient = now.toISOString();

    const saved = await saveInvoiceToServer({
      // Customer & Vehicle
      customer_name: customerName,
      customer_address: customerAddress || null,
      mobile_number: mobileNumber || null,
      vehicle_number: vehicleNumber,
      odometer: num(odometer),
      installer_name: installerName || null,

      // Vehicle & Fitment
      vehicle_type: vehicleType,
      tyre_count: num(tyreCount),
      tyre_width_mm: num(tyreWidth),
      aspect_ratio: num(aspectRatio),
      rim_diameter_in: num(rimDiameter),
      fitment_locations: textFromFitState(fit) || null,

      // Treads (min of installed positions)
      tread_depth_mm: Math.min(...Object.entries(treadByTyre).filter(([k])=>fit[k]).map(([,v]) => num(v, 9999))),
      tread_depths_json: JSON.stringify(treadByTyre),

      // Dosage (USED)
      dosage_ml: totalUsed,

      // GSTIN (optional)
      customer_gstin: gstin || null,

      // Pricing & Tax (USED)
      price_per_ml: PRICE_PER_ML,
      discount: discountUsed,              // primary
      discount_inr: discountUsed,          // alt
      installation_fee: installation,      // primary
      installation: installation,          // alt
      tax_mode: mode,
      gst_percentage: GST_PERCENT,
      total_before_gst: amountBeforeTax,
      gst_amount: gstTotal,
      total_with_gst: grand,
      cgst_amount: cgst,
      sgst_amount: sgst,
      igst_amount: igst,

      // Client timestamps for robust IST display later
      created_at_client: createdAtClient,

      // Consent/signature + snapshot incl. IST strings & pricing snapshot
      consent_signature: signatureData,
      consent_signed_at: consentSignedAt,
      consent_snapshot: consentSnapshot,
      customer_signature: signatureData,
      signed_at: consentSignedAt,

      gps_lat: null, gps_lng: null, customer_code: null
    });

    if (saved?.id) {
      alert(`Invoice saved. ID: ${saved.id}`);

      // Fetch full to print
      const inv = await fetch(`${API_URL}/api/invoices/${saved.id}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json()).catch(() => null);
      if (inv) generateInvoicePDF(inv, profile, inv.tax_mode || "CGST_SGST");

      // quick share helpers (text only)
      const subject = encodeURIComponent(`MaxTT Invoice #${saved.id}`);
      const body = encodeURIComponent(shareText);
      const mailto = `mailto:?subject=${subject}&body=${body}`;
      const wa = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
      const share = window.confirm("Open Email/WhatsApp share text?\n\nPress OK for Email, Cancel for WhatsApp.");
      if (share) { window.location.href = mailto; } else { window.open(wa, "_blank"); }

      // reset signature for next invoice
      setSignatureData(""); setConsentMeta(null);
    }
  }

  // UI
  const baseStyle = { fontFamily: '"Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' };
  const hasSizeError = !!(sizeErrors.width || sizeErrors.aspect || sizeErrors.rim);
  const installedCount = installedCountFromFit(fit);
  const mismatch = installedCount !== num(tyreCount);

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
            <label style={{ marginRight: 8 }}>Tyres (selected)</label>
            <select value={tyreCount} onChange={e => onTyreCountChange(e.target.value)}>
              {(VEHICLE_CFG[vehicleType]?.options || [4]).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ marginLeft: 12, fontSize: 13 }}>
              <strong>Tyres (installed today):</strong> {installedCount}
              {mismatch && <span style={{ color:"#a05a00" }}> &nbsp;• mismatch with selected</span>}
            </span>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 6 }}>
          <div>
            <input placeholder="Tyre Width (mm)" value={tyreWidth} onChange={e => setTyreWidth(e.target.value.replace(/[^\d]/g,""))} />
            {sizeErrors.width && <div style={{ color: "crimson", fontSize: 12 }}>{sizeErrors.width}</div>}
          </div>
          <div>
            <input placeholder="Aspect Ratio (%)" value={aspectRatio} onChange={e => setAspectRatio(e.target.value.replace(/[^\d]/g,""))} />
            {sizeErrors.aspect && <div style={{ color: "crimson", fontSize: 12 }}>{sizeErrors.aspect}</div>}
          </div>
          <div>
            <input placeholder="Rim Diameter (in)" value={rimDiameter} onChange={e => setRimDiameter(e.target.value.replace(/[^\d]/g,""))} />
            {sizeErrors.rim && <div style={{ color: "crimson", fontSize: 12 }}>{sizeErrors.rim}</div>}
          </div>
        </div>

        <div style={{ marginBottom: 6, marginTop: 6 }}>
          <div style={{ marginBottom: 6 }}>
            <strong>Fitment Location (required)</strong>
            <span style={{ marginLeft: 10, fontSize: 12, color: mismatch ? "#a05a00" : "#777" }}>
              {mismatch ? "Please sync selected ↔ installed before save (or explain via override)." : "Select the positions serviced today."}
            </span>
          </div>
          {fitSchema.labels.map(label => (
            <label key={label} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={!!fit[label]} onChange={(e)=>setFit(prev=>({ ...prev, [label]: e.target.checked }))} /> {label}
            </label>
          ))}
          <div style={{ marginTop: 6 }}>
            <button onClick={selectAllFit} style={{ marginRight: 6 }}>Select All</button>
            <button onClick={clearAllFit} style={{ marginRight: 6 }}>Clear All</button>
            <button onClick={autoSelectFromTreads}>Auto-select from Treads</button>
            {mismatch && <span style={{ marginLeft: 12, fontSize: 12 }}>
              Quick sync: <a href="#set" onClick={(e)=>{e.preventDefault(); onTyreCountChange(installedCount);}}>Set Tyres = Installed</a> &nbsp;|&nbsp; 
              <a href="#set" onClick={(e)=>{e.preventDefault(); selectAllFit();}}>Set Fitment = Tyres</a>
            </span>}
          </div>
        </div>

        {/* Per-tyre tread depths (required only for the checked positions) */}
        <div style={{ marginTop: 8 }}>
          <strong>Tread Depth per Tyre (mm)</strong>
          <div style={{ overflowX: "auto" }}>
            <table border="1" cellPadding="6" style={{ minWidth: 600, marginTop: 6 }}>
              <thead><tr><th>Position</th><th>Tread (mm)</th></tr></thead>
              <tbody>
                {fitSchema.labels.map(label => (
                  <tr key={label} style={{ background: fit[label] ? "white" : "#fafafa" }}>
                    <td>{label}</td>
                    <td>
                      <input
                        placeholder={fit[label] ? `>= ${minTreadFor(vehicleType)} mm` : "(not installed today)"}
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
            return (
              <span style={{ marginLeft: 10 }}>
                {msg ? <span style={{ color:"#a05a00" }}>⚠ {msg}</span> : null}
                {mismatch ? <span style={{ color:"#a05a00", marginLeft: 12 }}>(selected {tyreCount} vs installed {installedCount})</span> : null}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Zone C — Pricing & Taxes */}
      <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Pricing & Taxes</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, alignItems: "center" }}>
          <div><label>Price per ml (fixed)</label><div><strong>{inrRs(PRICE_PER_ML)}</strong></div></div>
          <div>
            <label>Discount</label>
            <input placeholder="e.g., 250" value={discountInr} onChange={e => setDiscountInr(e.target.value.replace(/[^\d]/g,""))} />
          </div>
          <div>
            <label>Installation Charges</label>
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
      <button onClick={handleCalculateAndReview} disabled={hasSizeError}>
        Review → Confirm → Save (Auto PDF)
      </button>
      {hasSizeError && <div style={{ color: "crimson", marginTop: 6 }}>Fix tyre size errors to continue.</div>}

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
