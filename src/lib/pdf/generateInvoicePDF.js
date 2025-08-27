import jsPDF from "jspdf";
import "jspdf-autotable";

export function generateInvoicePDF(invoice) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pad = 18;
  let y = pad;

  const val = (v, d = "—") => (v === 0 || v ? String(v) : d);

  const id = invoice?.id ?? invoice?.ID ?? invoice?.invoice_id;
  const computedCustomerCode = id ? `C${String(id).padStart(6, "0")}` : "";
  const customerCode =
    invoice?.customer_code ??
    invoice?.customerCode ??
    computedCustomerCode;

  const hsnCode =
    invoice?.hsn_code ??
    invoice?.hsnCode ??
    "3403.19.00";

  const odo = invoice?.odometer ?? invoice?.odo ?? null;

  const treadLegacy = invoice?.tread_depth_mm ?? invoice?.treadDepthMm ?? null;
  const treadFL = invoice?.tread_fl_mm ?? invoice?.treadFlMm ?? treadLegacy;
  const treadFR = invoice?.tread_fr_mm ?? invoice?.treadFrMm ?? treadLegacy;
  const treadRL = invoice?.tread_rl_mm ?? invoice?.treadRlMm ?? treadLegacy;
  const treadRR = invoice?.tread_rr_mm ?? invoice?.treadRrMm ?? treadLegacy;

  const totalBefore = Number(invoice?.total_before_gst ?? invoice?.totalBeforeGst ?? NaN);
  const gstAmt = Number(invoice?.gst_amount ?? invoice?.gstAmount ?? NaN);
  const gstRateRaw = invoice?.gst_rate ?? invoice?.gstRate;
  const gstPct =
    (gstRateRaw !== undefined && gstRateRaw !== null && String(gstRateRaw) !== "")
      ? Number(gstRateRaw)
      : (Number.isFinite(totalBefore) && totalBefore > 0 && Number.isFinite(gstAmt))
          ? Number(((gstAmt / totalBefore) * 100).toFixed(2))
          : null;

  // Header
  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("MaxTT Tyre Sealant — Invoice", pad, y); y += 18;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Invoice #: ${val(id)}`, pad, y);
  doc.text(`Date: ${invoice?.created_at ? new Date(invoice.created_at).toLocaleString() : "—"}`, pad + 220, y);
  y += 18;

  // Zone 2
  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text("Customer Details", pad, y); y += 10;

  const zone2 = [
    ["Customer Name", val(invoice?.customer_name ?? invoice?.customerName)],
    ["Mobile", val(invoice?.mobile_number ?? invoice?.mobileNumber)],
    ["Vehicle No.", val(invoice?.vehicle_number ?? invoice?.vehicleNumber)],
    ["Installer", val(invoice?.installer_name ?? invoice?.installerName)],
    ["Customer Code (Seal & Earn)", val(customerCode)],
    ["HSN Code", val(hsnCode)],
    ["Odometer", val(odo)],
    ["Tread Depth FL (mm)", val(treadFL)],
    ["Tread Depth FR (mm)", val(treadFR)],
    ["Tread Depth RL (mm)", val(treadRL)],
    ["Tread Depth RR (mm)", val(treadRR)],
    ["Customer GSTIN", val(invoice?.customer_gstin ?? invoice?.customerGstin)],
    ["Customer Address", val(invoice?.customer_address ?? invoice?.customerAddress)],
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

  // Zone 3
  doc.setFont("helvetica", "bold"); doc.text("Vehicle & Tyre Details", pad, y); y += 10;
  const zone3 = [
    ["Vehicle Type", val(invoice?.vehicle_type ?? invoice?.vehicleType)],
    ["Tyre Width (mm)", val(invoice?.tyre_width_mm ?? invoice?.tyreWidthMm)],
    ["Aspect Ratio", val(invoice?.aspect_ratio ?? invoice?.aspectRatio)],
    ["Rim Diameter (in)", val(invoice?.rim_diameter_in ?? invoice?.rimDiameterIn)],
    ["Tyre Count", val(invoice?.tyre_count ?? invoice?.tyreCount)],
    ["Fitment Locations", val(invoice?.fitment_locations ?? invoice?.fitmentLocations)],
  ];
  doc.autoTable({ startY: y, margin: { left: pad, right: pad }, styles: { font: "helvetica", fontSize: 10, cellPadding: 4 }, headStyles: { fillColor: [240,240,240] }, theme: "grid", head: [["Field","Value"]], body: zone3 });
  y = doc.lastAutoTable.finalY + 14;

  // Zone 4
  doc.setFont("helvetica", "bold"); doc.text("Billing", pad, y); y += 10;
  const zone4 = [
    ["Dosage (ml)", val(invoice?.dosage_ml ?? invoice?.dosageMl)],
    ["Price / ml", val(invoice?.price_per_ml ?? invoice?.pricePerMl)],
    ["Total before GST", val(totalBefore)],
    ["GST %", gstPct === null ? "—" : String(gstPct)],
    ["GST Amount", val(gstAmt)],
    ["Total with GST", val(invoice?.total_with_gst ?? invoice?.totalWithGst)],
  ];
  doc.autoTable({ startY: y, margin: { left: pad, right: pad }, styles: { font: "helvetica", fontSize: 10, cellPadding: 4 }, headStyles: { fillColor: [240,240,240] }, theme: "grid", head: [["Field","Value"]], body: zone4 });

  doc.save(`MaxTT_Invoice_${val(id, "NA")}.pdf`);
}
