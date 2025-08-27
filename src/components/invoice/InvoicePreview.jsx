import React from "react";

export default function InvoicePreview({ invoice }) {
  if (!invoice) return null;

  const val = (v, d = "—") => (v === 0 || v ? String(v) : d);

  // Normalize keys + fallbacks
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

  // Per-tyre treads with legacy fallback
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

  return (
    <div style={{ color: "#111" }}>
      {/* Zone 1 */}
      <section style={{ marginBottom: 16, borderBottom: "1px solid #ddd", paddingBottom: 8 }}>
        <h3 style={{ margin: 0 }}>MaxTT Tyre Sealant — Invoice</h3>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          <strong>Invoice #:</strong> {val(id)} &nbsp;|&nbsp;
          <strong>Date:</strong>{" "}
          {invoice?.created_at ? new Date(invoice.created_at).toLocaleString() : "—"}
        </div>
      </section>

      {/* Zone 2 */}
      <section style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 16, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
          Customer Details
        </h4>

        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", rowGap: 6, columnGap: 12, fontSize: 14 }}>
          <div><strong>Customer Name</strong></div>
          <div>{val(invoice?.customer_name ?? invoice?.customerName)}</div>

          <div><strong>Mobile</strong></div>
          <div>{val(invoice?.mobile_number ?? invoice?.mobileNumber)}</div>

          <div><strong>Vehicle No.</strong></div>
          <div>{val(invoice?.vehicle_number ?? invoice?.vehicleNumber)}</div>

          <div><strong>Installer</strong></div>
          <div>{val(invoice?.installer_name ?? invoice?.installerName)}</div>

          {/* NEW rows */}
          <div><strong>Customer Code (Seal & Earn)</strong></div>
          <div>{val(customerCode)}</div>

          <div><strong>HSN Code</strong></div>
          <div>{val(hsnCode)}</div>

          <div><strong>Odometer</strong></div>
          <div>{val(odo)}</div>

          <div><strong>Tread Depth FL (mm)</strong></div>
          <div>{val(treadFL)}</div>

          <div><strong>Tread Depth FR (mm)</strong></div>
          <div>{val(treadFR)}</div>

          <div><strong>Tread Depth RL (mm)</strong></div>
          <div>{val(treadRL)}</div>

          <div><strong>Tread Depth RR (mm)</strong></div>
          <div>{val(treadRR)}</div>

          <div><strong>Customer GSTIN</strong></div>
          <div>{val(invoice?.customer_gstin ?? invoice?.customerGstin)}</div>

          <div><strong>Customer Address</strong></div>
          <div>{val(invoice?.customer_address ?? invoice?.customerAddress)}</div>
        </div>
      </section>

      {/* Zone 3 */}
      <section style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 16, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
          Vehicle & Tyre Details
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", rowGap: 6, columnGap: 12, fontSize: 14 }}>
          <div><strong>Vehicle Type</strong></div>
          <div>{val(invoice?.vehicle_type ?? invoice?.vehicleType)}</div>

          <div><strong>Tyre Width (mm)</strong></div>
          <div>{val(invoice?.tyre_width_mm ?? invoice?.tyreWidthMm)}</div>

          <div><strong>Aspect Ratio</strong></div>
          <div>{val(invoice?.aspect_ratio ?? invoice?.aspectRatio)}</div>

          <div><strong>Rim Diameter (in)</strong></div>
          <div>{val(invoice?.rim_diameter_in ?? invoice?.rimDiameterIn)}</div>

          <div><strong>Tyre Count</strong></div>
          <div>{val(invoice?.tyre_count ?? invoice?.tyreCount)}</div>

          <div><strong>Fitment Locations</strong></div>
          <div>{val(invoice?.fitment_locations ?? invoice?.fitmentLocations)}</div>
        </div>
      </section>

      {/* Zone 4 */}
      <section style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 16, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
          Billing
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", rowGap: 6, columnGap: 12, fontSize: 14 }}>
          <div><strong>Dosage (ml)</strong></div>
          <div>{val(invoice?.dosage_ml ?? invoice?.dosageMl)}</div>

          <div><strong>Price / ml</strong></div>
          <div>{val(invoice?.price_per_ml ?? invoice?.pricePerMl)}</div>

          <div><strong>Total before GST</strong></div>
          <div>{val(totalBefore)}</div>

          <div><strong>GST %</strong></div>
          <div>{gstPct === null ? "—" : `${gstPct}`}</div>

          <div><strong>GST Amount</strong></div>
          <div>{val(gstAmt)}</div>

          <div><strong>Total with GST</strong></div>
          <div>{val(invoice?.total_with_gst ?? invoice?.totalWithGst)}</div>
        </div>
      </section>
    </div>
  );
}
