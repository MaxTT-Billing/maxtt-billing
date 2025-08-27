import React from "react";

/**
 * InvoicePreview.jsx
 * Renders the invoice on-screen. Zone-2 (Customer Details) now includes:
 *  - Customer Code (Seal & Earn)
 *  - HSN Code
 *
 * Expects `invoice` prop with fields used below.
 */
export default function InvoicePreview({ invoice }) {
  if (!invoice) return null;

  // Safe getters
  const customerCode = invoice.customer_code || "";
  const hsnCode = invoice.hsn_code || "3403.19.00";

  return (
    <div className="invoice-preview" style={{ fontFamily: "sans-serif", color: "#111" }}>
      {/* Zone 1: Header */}
      <section style={{ marginBottom: 16, borderBottom: "1px solid #ddd", paddingBottom: 8 }}>
        <h2 style={{ margin: 0 }}>MaxTT Tyre Sealant — Invoice</h2>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          <strong>Invoice #:</strong> {invoice.id ?? "—"} &nbsp;|&nbsp;
          <strong>Date:</strong>{" "}
          {invoice.created_at ? new Date(invoice.created_at).toLocaleString() : "—"}
        </div>
      </section>

      {/* Zone 2: Customer Details (with the 2 new rows) */}
      <section style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 16, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
          Customer Details
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 6, columnGap: 12, fontSize: 14 }}>
          <div><strong>Customer Name</strong></div>
          <div>{invoice.customer_name || "—"}</div>

          <div><strong>Mobile</strong></div>
          <div>{invoice.mobile_number || "—"}</div>

          <div><strong>Vehicle No.</strong></div>
          <div>{invoice.vehicle_number || "—"}</div>

          <div><strong>Installer</strong></div>
          <div>{invoice.installer_name || "—"}</div>

          {/* NEW ROW 1 */}
          <div><strong>Customer Code (Seal & Earn)</strong></div>
          <div>{customerCode || "—"}</div>

          {/* NEW ROW 2 */}
          <div><strong>HSN Code</strong></div>
          <div>{hsnCode}</div>

          <div><strong>Odometer</strong></div>
          <div>{invoice.odometer ?? "—"}</div>

          <div><strong>Tread Depth (mm)</strong></div>
          <div>{invoice.tread_depth_mm ?? "—"}</div>

          <div><strong>Customer GSTIN</strong></div>
          <div>{invoice.customer_gstin || "—"}</div>

          <div><strong>Customer Address</strong></div>
          <div>{invoice.customer_address || "—"}</div>
        </div>
      </section>

      {/* Zone 3: Tyre/Vehicle */}
      <section style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 16, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
          Vehicle & Tyre Details
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 6, columnGap: 12, fontSize: 14 }}>
          <div><strong>Vehicle Type</strong></div>
          <div>{invoice.vehicle_type || "—"}</div>

          <div><strong>Tyre Width (mm)</strong></div>
          <div>{invoice.tyre_width_mm ?? "—"}</div>

          <div><strong>Aspect Ratio</strong></div>
          <div>{invoice.aspect_ratio ?? "—"}</div>

          <div><strong>Rim Diameter (in)</strong></div>
          <div>{invoice.rim_diameter_in ?? "—"}</div>

          <div><strong>Tyre Count</strong></div>
          <div>{invoice.tyre_count ?? "—"}</div>

          <div><strong>Fitment Locations</strong></div>
          <div>{invoice.fitment_locations || "—"}</div>
        </div>
      </section>

      {/* Zone 4: Price/GST */}
      <section style={{ marginBottom: 16 }}>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 16, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
          Billing
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", rowGap: 6, columnGap: 12, fontSize: 14 }}>
          <div><strong>Dosage (ml)</strong></div>
          <div>{invoice.dosage_ml ?? "—"}</div>

          <div><strong>Price / ml</strong></div>
          <div>{invoice.price_per_ml ?? "—"}</div>

          <div><strong>Total before GST</strong></div>
          <div>{invoice.total_before_gst ?? "—"}</div>

          <div><strong>GST %</strong></div>
          <div>{invoice.gst_rate ?? "—"}</div>

          <div><strong>GST Amount</strong></div>
          <div>{invoice.gst_amount ?? "—"}</div>

          <div><strong>Total with GST</strong></div>
          <div>{invoice.total_with_gst ?? "—"}</div>
        </div>
      </section>

      {/* Zone 5: Signatures */}
      <section>
        <h3 style={{ margin: "0 0 8px 0", fontSize: 16, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
          Signatures
        </h3>
        <div style={{ fontSize: 12 }}>
          <div><strong>Customer Signature:</strong> {invoice.customer_signature ? "Captured" : "—"}</div>
          <div><strong>Signed At:</strong> {invoice.signed_at ? new Date(invoice.signed_at).toLocaleString() : "—"}</div>
        </div>
      </section>
    </div>
  );
}
