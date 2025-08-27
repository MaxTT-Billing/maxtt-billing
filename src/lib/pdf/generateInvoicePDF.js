/**
 * generateInvoicePDF.js
 * Creates the PDF. Adds two rows in Zone-2 below Installer:
 *  - Customer Code (Seal & Earn)
 *  - HSN Code
 *
 * Assumes jsPDF + autoTable are available in your project.
 */
import jsPDF from "jspdf";
import "jspdf-autotable";

export function generateInvoicePDF(invoice) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pad = 18;
  let y = pad;

  const get = (v, d = "—") => (v === 0 || v ? String(v) : d);
  const customerCode = invoice?.customer_code || "";
  const hsnCode = invoice?.hsn_code || "3403.19.00";

  // Header (Zone 1)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("MaxTT Tyre Sealant — Invoice", pad, y);
  y += 18;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Invoice #: ${get(invoice?.id)}`, pad, y);
  doc.text(
    `Date: ${invoice?.created_at ? new Date(invoice.created_at).toLocaleString() : "—"}`,
    pad + 220,
    y
  );
  y += 18;

  // Zone 2: Customer Details (with new rows)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Customer Details", pad, y);
  y += 10;

  const zone2 = [
    ["Customer Name", get(invoice?.customer_name)],
    ["Mobile", get(invoice?.mobile_number)],
    ["Vehicle No.", get(invoice?.vehicle_number)],
    ["Installer", get(invoice?.installer_name)],
    // NEW ROWS:
    ["Customer Code (Seal & Earn)", customerCode || "—"],
    ["HSN Code", hsnCode],
    // existing:
    ["Odometer", get(invoice?.odometer)],
    ["Tread Depth (mm)", get(invoice?.tread_depth_mm)],
    ["Customer GSTIN", get(invoice?.customer_gstin)],
    ["Customer Address", get(invoice?.customer_address)],
  ];

  doc.autoTable({
    startY: y,
    margin: { left: pad, right: pad },
    styles: { font: "helvetica", fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [240, 240, 240] },
    theme: "grid",
    head: [["Field", "Value"]],
    body: zone2,
  });
  y = doc.lastAutoTable.finalY + 14;

  // Zone 3: Vehicle & Tyre
  doc.setFont("helvetica", "bold");
  doc.text("Vehicle & Tyre Details", pad, y);
  y += 10;

  const zone3 = [
    ["Vehicle Type", get(invoice?.vehicle_type)],
    ["Tyre Width (mm)", get(invoice?.tyre_width_mm)],
    ["Aspect Ratio", get(invoice?.aspect_ratio)],
    ["Rim Diameter (in)", get(invoice?.rim_diameter_in)],
    ["Tyre Count", get(invoice?.tyre_count)],
    ["Fitment Locations", get(invoice?.fitment_locations)],
  ];

  doc.autoTable({
    startY: y,
    margin: { left: pad, right: pad },
    styles: { font: "helvetica", fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [240, 240, 240] },
    theme: "grid",
    head: [["Field", "Value"]],
    body: zone3,
  });
  y = doc.lastAutoTable.finalY + 14;

  // Zone 4: Billing
  doc.setFont("helvetica", "bold");
  doc.text("Billing", pad, y);
  y += 10;

  const zone4 = [
    ["Dosage (ml)", get(invoice?.dosage_ml)],
    ["Price / ml", get(invoice?.price_per_ml)],
    ["Total before GST", get(invoice?.total_before_gst)],
    ["GST %", get(invoice?.gst_rate)],
    ["GST Amount", get(invoice?.gst_amount)],
    ["Total with GST", get(invoice?.total_with_gst)],
  ];

  doc.autoTable({
    startY: y,
    margin: { left: pad, right: pad },
    styles: { font: "helvetica", fontSize: 10, cellPadding: 4 },
    headStyles: { fillColor: [240, 240, 240] },
    theme: "grid",
    head: [["Field", "Value"]],
    body: zone4,
  });
  y = doc.lastAutoTable.finalY + 18;

  // Zone 5: Signatures (compact)
  doc.setFont("helvetica", "bold");
  doc.text("Signatures", pad, y);
  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(
    `Customer Signature: ${invoice?.customer_signature ? "Captured" : "—"}`,
    pad,
    y
  );
  doc.text(
    `Signed At: ${invoice?.signed_at ? new Date(invoice.signed_at).toLocaleString() : "—"}`,
    pad + 250,
    y
  );

  // Footer (optional watermark/branding can go here)

  // Save
  doc.save(`MaxTT_Invoice_${get(invoice?.id, "NA")}.pdf`);
}
